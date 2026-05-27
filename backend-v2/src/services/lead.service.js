import { prisma } from "../lib/db.js";
import { predictCloseProbability } from "./close-prediction.service.js";
import { calculateDynamicLeadScore } from "./dynamic-scoring.service.js";
import { calculateCloseScore } from "./predictive-scoring.service.js";

export async function getLeadByConversationId(conversationId) {
  return prisma.lead.findUnique({ where: { conversationId } });
}

export async function getOrCreateLead({ tenantId, conversationId, contact }) {
  const existing = await prisma.lead.findUnique({ where: { conversationId } });
  if (existing) return existing;

  return prisma.lead.create({
    data: {
      tenantId,
      conversationId,
      name: contact?.name || null,
      phone: contact?.externalId || null,
      status: "NEW",
      nextFollowUpAt: new Date(Date.now() + 2 * 60 * 60 * 1000)
    }
  });
}

export async function upsertLeadFromConversation({
  tenantId,
  conversationId,
  contact,
  entities,
  intent
}) {
  const existing = await prisma.lead.findUnique({ where: { conversationId } });

  const data = {
    tenantId,
    name: contact?.name || existing?.name || null,
    phone: contact?.externalId || existing?.phone || null,
    interest: entities?.interest || existing?.interest || null,
    propertyType: entities?.propertyType || existing?.propertyType || null,
    commune: entities?.commune || existing?.commune || null,
    budget: entities?.budget ?? existing?.budget ?? null,
    urgency: entities?.urgency || existing?.urgency || null,
    status: existing?.status || mapIntent(intent),
    nextFollowUpAt: existing?.nextFollowUpAt || new Date(Date.now() + 2 * 60 * 60 * 1000)
  };

  const lead = existing
    ? await prisma.lead.update({ where: { conversationId }, data })
    : await prisma.lead.create({ data: { conversationId, ...data } });

  await refreshLeadPrediction({ conversationId });
  return lead;
}

export async function updateLead({ conversationId, data }) {
  const allowed = ["name", "phone", "interest", "propertyType", "commune", "budget", "urgency", "status", "notes", "nextFollowUpAt"];
  const clean = Object.fromEntries(Object.entries(data || {}).filter(([key]) => allowed.includes(key)));

  const previous = await prisma.lead.findUnique({ where: { conversationId } });
  const updated = await prisma.lead.update({ where: { conversationId }, data: clean });
  const refreshed = await refreshLeadPrediction({ conversationId });

  if (clean.status && ["WON", "LOST"].includes(clean.status) && previous?.status !== clean.status) {
    const conversation = await prisma.conversation.findUnique({ where: { id: conversationId }, include: { tenant: true } });
    await prisma.salesOutcome.create({
      data: {
        tenantId: updated.tenantId,
        conversationId,
        leadId: updated.id,
        outcome: clean.status,
        reason: clean.notes || updated.closeReason || null,
        closeScore: refreshed?.closeProbability ?? updated.closeProbability ?? null,
        industry: conversation?.tenant?.industry || null
      }
    }).catch(() => null);
  }

  return updated;
}

export async function refreshLeadPrediction({ conversationId }) {
  const [lead, conversation, memory] = await Promise.all([
    prisma.lead.findUnique({ where: { conversationId } }),
    prisma.conversation.findUnique({ where: { id: conversationId } }),
    prisma.conversationMemory.findUnique({ where: { conversationId } }).catch(() => null)
  ]);

  if (!lead || !conversation) return null;

  const prediction = predictCloseProbability({ lead, conversation });
  const dynamic = calculateDynamicLeadScore({ lead, conversation });
  const predictive = calculateCloseScore({ memory, lead, conversation });
  const finalScore = Math.max(prediction.probability || 0, predictive.score || 0);

  await prisma.conversation.update({
    where: { id: conversationId },
    data: {
      priorityScore: Math.max(dynamic.score, finalScore),
      priorityLabel: finalScore >= 75 ? "high" : finalScore >= 45 ? "medium" : dynamic.label,
      aiCloseScore: finalScore,
      aiDecisionLabel: predictive.label,
      aiDecisionReason: predictive.reasons.join(", "),
      aiNextActionCode: predictive.nextAction,
      decisionSummary: `Score predictivo: ${finalScore}. ${predictive.reasons.join(", ")}`
    }
  });

  return prisma.lead.update({
    where: { id: lead.id },
    data: {
      closeProbability: finalScore,
      closeReason: predictive.reasons.join(", ") || prediction.reason
    }
  });
}

function mapIntent(intent) {
  switch (intent) {
    case "schedule_visit": return "VISIT_SCHEDULED";
    case "pricing_request": return "QUALIFIED";
    case "property_search": return "CONTACTED";
    default: return "NEW";
  }
}
