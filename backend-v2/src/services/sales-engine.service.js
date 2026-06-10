
import { prisma } from "../lib/db.js";

const CLOSING_PATTERNS = /(cotizaci[oó]n\s*final|valor\s*final|precio\s*final|total\s*final|quiero\s*reservar|reservemos|avancemos|lo\s*tomo|lo\s*quiero|quiero\s*pagar|pagar|abono|transferencia|reserva)/i;
const QUOTE_PATTERNS = /(cotizaci[oó]n|cotizar|precio|valor|cu[aá]nto|cuanto|presupuesto|total)/i;
const HUMAN_PATTERNS = /(asesor|humano|vendedor|ejecutivo|llamar|tel[eé]fono|contactar)/i;

function safeNumber(value, fallback = 0) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n : fallback;
}

function mergeNotes(...parts) {
  return parts.filter(Boolean).join("\n").slice(0, 4000);
}

export function detectSalesSignal(message = "", quote = null) {
  const text = String(message || "");
  const wantsQuote = QUOTE_PATTERNS.test(text);
  const wantsClose = CLOSING_PATTERNS.test(text);
  const wantsHuman = HUMAN_PATTERNS.test(text);
  const hasQuote = Boolean(quote?.ready);

  if (wantsClose && hasQuote) return "READY_TO_CLOSE";
  if (wantsClose || wantsHuman) return "HANDOFF_REQUIRED";
  if (wantsQuote && hasQuote) return "QUOTE_SENT";
  if (wantsQuote) return "QUOTE_REQUESTED";
  return null;
}

export async function registerSalesSignal({
  tenantId,
  conversationId,
  contact = null,
  message = "",
  quote = null,
  reason = ""
}) {
  if (!tenantId || !conversationId) return null;

  const signal = detectSalesSignal(message, quote);
  if (!signal) return null;

  const existingLead = await prisma.lead.findUnique({
    where: { conversationId }
  }).catch(() => null);

  const scoreBySignal = {
    QUOTE_REQUESTED: 60,
    QUOTE_SENT: 78,
    HANDOFF_REQUIRED: 85,
    READY_TO_CLOSE: 94
  };

  const statusBySignal = {
    QUOTE_REQUESTED: "QUALIFIED",
    QUOTE_SENT: "QUOTE_SENT",
    HANDOFF_REQUIRED: "READY_TO_CLOSE",
    READY_TO_CLOSE: "READY_TO_CLOSE"
  };

  const score = Math.max(
    safeNumber(existingLead?.closeProbability),
    scoreBySignal[signal] || 50,
    safeNumber(quote?.total) > 0 ? 82 : 0
  );

  const quoteSummary = quote?.ready
    ? [
        `Cotización generada por IA`,
        `Servicio: ${quote.service}`,
        `Personas: ${quote.guests}`,
        `Lugar: ${quote.location}`,
        `Fecha: ${quote.date}`,
        `Total: $${Number(quote.total || 0).toLocaleString("es-CL")} CLP`
      ].join(" · ")
    : null;

  const leadData = {
    tenantId,
    conversationId,
    name: contact?.name || existingLead?.name || null,
    phone: contact?.externalId || existingLead?.phone || null,
    status: statusBySignal[signal],
    interest: quote?.service || existingLead?.interest || "Interés comercial detectado",
    commune: quote?.location && quote.location !== "No especificado" ? quote.location : existingLead?.commune || null,
    budget: quote?.total ? Math.round(Number(quote.total)) : existingLead?.budget || null,
    urgency: ["READY_TO_CLOSE", "HANDOFF_REQUIRED"].includes(signal) ? "HIGH" : existingLead?.urgency || "MEDIUM",
    closeProbability: score,
    closeReason: reason || quoteSummary || `Señal comercial detectada: ${signal}`,
    notes: mergeNotes(existingLead?.notes, quoteSummary, reason),
    lastContactAt: new Date(),
    nextFollowUpAt: ["READY_TO_CLOSE", "HANDOFF_REQUIRED"].includes(signal) ? null : existingLead?.nextFollowUpAt || null
  };

  const lead = existingLead
    ? await prisma.lead.update({
        where: { id: existingLead.id },
        data: leadData
      })
    : await prisma.lead.create({
        data: leadData
      });

  const conversationData = {
    priorityLabel: score >= 75 ? "high" : score >= 50 ? "medium" : "low",
    priorityScore: score,
    aiCloseScore: score,
    aiLeadScore: score,
    aiDecisionLabel: signal === "READY_TO_CLOSE" ? "READY_TO_CLOSE" : score >= 75 ? "HOT" : "WARM",
    aiDecisionReason: reason || quoteSummary || `Señal comercial detectada: ${signal}`,
    aiReason: quoteSummary || reason || null,
    aiNextActionCode: signal,
    aiNextAction:
      signal === "READY_TO_CLOSE"
        ? "Tomar conversación y coordinar pago/reserva"
        : signal === "QUOTE_SENT"
          ? "Dar seguimiento a la cotización y confirmar reserva"
          : "Continuar calificación comercial",
    aiHandoffRequired: ["READY_TO_CLOSE", "HANDOFF_REQUIRED"].includes(signal),
    aiHandoffReason: ["READY_TO_CLOSE", "HANDOFF_REQUIRED"].includes(signal)
      ? "Cliente mostró intención alta o pidió avanzar"
      : null,
    lastClosingAttempt: ["READY_TO_CLOSE", "QUOTE_SENT"].includes(signal) ? new Date() : undefined,
    decisionSummary: `Sales Engine: ${signal} · Score ${score}%${quote?.total ? ` · Total $${Number(quote.total).toLocaleString("es-CL")}` : ""}`
  };

  await prisma.conversation.update({
    where: { id: conversationId },
    data: conversationData
  }).catch(() => null);

  if (signal === "READY_TO_CLOSE") {
    await prisma.salesOutcome.create({
      data: {
        tenantId,
        conversationId,
        leadId: lead.id,
        outcome: "READY_TO_CLOSE",
        reason: reason || quoteSummary || "Cliente listo para cierre asistido",
        closeScore: score,
        industry: "events"
      }
    }).catch(() => null);
  }

  return { signal, score, lead, quote };
}

export async function getSalesQueue({ tenantId }) {
  const where = {
    tenantId,
    OR: [
      { aiHandoffRequired: true },
      { aiNextActionCode: { in: ["READY_TO_CLOSE", "HANDOFF_REQUIRED", "QUOTE_SENT"] } },
      { aiCloseScore: { gte: 75 } },
      { lead: { status: { in: ["READY_TO_CLOSE", "QUOTE_SENT", "NEGOTIATION", "PAYMENT_PENDING", "PARTIAL_PAYMENT", "PAID"] } } }
    ]
  };

  return prisma.conversation.findMany({
    where,
    include: {
      contact: true,
      assignedTo: true,
      lead: true,
      tenant: true
    },
    orderBy: [
      { aiCloseScore: "desc" },
      { priorityScore: "desc" },
      { lastMessageAt: "desc" }
    ],
    take: 100
  });
}
