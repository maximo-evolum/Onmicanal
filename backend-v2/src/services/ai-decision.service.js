
import { prisma } from "../lib/db.js";
import { detectObjection } from "./objection.service.js";
import { shouldHandoff } from "./handoff.service.js";
import { calculateCloseScore } from "./predictive-scoring.service.js";
import { buildReasoningSnapshot } from "./ai-reasoning.service.js";

export async function updateAIDecision({ conversationId, memory = null, lead = null, message = "" }) {
  const conversation = await prisma.conversation.findUnique({ where: { id: conversationId } });
  if (!conversation) return null;

  if (!memory) {
    memory = await prisma.conversationMemory.findUnique({ where: { conversationId } }).catch(() => null);
  }
  if (!lead) {
    lead = await prisma.lead.findUnique({ where: { conversationId } }).catch(() => null);
  }

  const objection = detectObjection(message);
  const reasoning = buildReasoningSnapshot({
    tenant: conversation.tenant || null,
    userMessage: message,
    memory,
    lead,
    industry: "general"
  });
  const prediction = calculateCloseScore({ memory, lead, conversation, objection });
  const handoff = shouldHandoff({ memory, objection, closeScore: prediction.score, message });

  return prisma.conversation.update({
    where: { id: conversationId },
    data: {
      aiCloseScore: prediction.score,
      aiDecisionLabel: prediction.label,
      aiDecisionReason: prediction.reasons.join(", "),
      aiNextActionCode: handoff.handoff ? "handoff_human" : (reasoning.recommendedStrategy || prediction.nextAction),
      aiHandoffRequired: handoff.handoff,
      aiHandoffReason: handoff.reason || null,
      lastClosingAttempt: prediction.label === "HOT" ? new Date() : undefined,
      decisionSummary: `${prediction.label} ${prediction.score}% · Reasoning ${reasoning.priority} ${reasoning.opportunityScore}/100 · ${reasoning.recommendedStrategy}: ${prediction.reasons.join(", ")}`
    }
  });
}
