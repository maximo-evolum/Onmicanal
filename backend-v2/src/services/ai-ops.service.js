
import { prisma } from "../lib/db.js";

function riskFromConversation(conversation) {
  const score = Number(conversation.aiCloseScore || conversation.aiLeadScore || conversation.lead?.closeProbability || 0);
  const text = `${conversation.aiDecisionReason || ""} ${conversation.aiHandoffReason || ""} ${conversation.lead?.notes || ""}`.toLowerCase();

  const urgency = text.includes("urgente") || text.includes("hoy") || text.includes("ahora") || score >= 80 ? "high" : score >= 55 ? "medium" : "low";
  const risk = text.includes("no responde") || text.includes("riesgo") || text.includes("perder") || conversation.aiHandoffRequired ? "high" : score >= 70 ? "medium" : "low";
  const priceSensitivity = text.includes("caro") || text.includes("precio") || text.includes("presupuesto") ? "high" : "medium";

  return { score, urgency, risk, priceSensitivity };
}

function stateFromConversation(conversation) {
  if (conversation.aiHandoffRequired) return "ESCALATED";
  if (conversation.aiNextActionCode === "READY_TO_CLOSE" || conversation.lead?.status === "READY_TO_CLOSE") return "READY_TO_CLOSE";
  if (conversation.lead?.status === "QUOTE_SENT" || conversation.aiNextActionCode === "QUOTE_SENT") return "QUOTE_SENT";
  if ((conversation.aiCloseScore || conversation.lead?.closeProbability || 0) >= 55) return "QUALIFIED";
  return "DISCOVERY";
}

export async function getAiOperationsSummary({ tenantId = null, superAdmin = false } = {}) {
  const where = tenantId ? { tenantId } : {};
  if (!tenantId && !superAdmin) return {
    metrics: { total: 0, critical: 0, opportunities: 0, averageScore: 0, recovery: 0 },
    priorities: [],
    strategies: [],
    learning: [],
    alerts: []
  };

  const conversations = await prisma.conversation.findMany({
    where,
    include: { contact: true, assignedTo: true, lead: true, tenant: true },
    orderBy: [{ priorityScore: "desc" }, { lastMessageAt: "desc" }],
    take: 200
  });

  const enriched = conversations.map((conversation) => {
    const risk = riskFromConversation(conversation);
    const state = stateFromConversation(conversation);
    const label = state === "READY_TO_CLOSE"
      ? "Listo para cierre"
      : state === "ESCALATED"
        ? "Requiere intervención humana"
        : state === "QUOTE_SENT"
          ? "Cotización enviada"
          : risk.score >= 55
            ? "Oportunidad comercial"
            : "Descubrimiento";

    const strategy = conversation.aiStrategy ||
      (state === "READY_TO_CLOSE"
        ? "Tomar el chat y coordinar reserva/pago."
        : state === "QUOTE_SENT"
          ? "Dar seguimiento a la cotización y resolver dudas."
          : "Continuar discovery con una pregunta breve.");

    return {
      conversation,
      profile: {
        label,
        state,
        score: risk.score,
        urgency: risk.urgency,
        risk: risk.risk,
        priceSensitivity: risk.priceSensitivity,
        strategy,
        nextBestAction: conversation.aiRecommendedAction || conversation.aiNextAction || strategy,
        reason: conversation.aiReasoningSummary || conversation.aiDecisionReason || conversation.aiReason || conversation.lead?.closeReason || "Sin razonamiento registrado todavía."
      }
    };
  }).sort((a, b) => b.profile.score - a.profile.score);

  const critical = enriched.filter((item) =>
    item.conversation.aiHandoffRequired ||
    item.profile.state === "READY_TO_CLOSE" ||
    item.profile.risk === "high"
  );

  const opportunities = enriched.filter((item) => item.profile.score >= 55 && item.profile.score < 80);
  const learning = enriched.filter((item) =>
    item.conversation.aiFeedbackSummary ||
    item.conversation.aiRecoveryPlan ||
    item.conversation.aiReasoningSummary
  );

  const averageScore = enriched.length
    ? Math.round(enriched.reduce((sum, item) => sum + item.profile.score, 0) / enriched.length)
    : 0;

  const alerts = [];
  for (const item of critical.slice(0, 6)) {
    alerts.push({
      conversationId: item.conversation.id,
      title: item.profile.label,
      message: item.profile.nextBestAction,
      score: item.profile.score
    });
  }

  return {
    metrics: {
      total: enriched.length,
      critical: critical.length,
      opportunities: opportunities.length,
      averageScore,
      recovery: learning.length
    },
    priorities: critical.length ? critical.slice(0, 12) : enriched.slice(0, 8),
    strategies: opportunities.slice(0, 12),
    learning: learning.slice(0, 12),
    alerts
  };
}
