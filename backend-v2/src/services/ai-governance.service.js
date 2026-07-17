import { prisma } from "../lib/db.js";
import { normalizeMetadata } from "../lib/metadata.js";

export const DEFAULT_AI_GOVERNANCE = Object.freeze({
  requireApprovalFor: ["create_booking", "mark_payment_ready"],
  maxAutonomousActions: 3,
  blockedTerms: [],
  recordEvaluations: true
});

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function cleanTerms(value) {
  return Array.isArray(value)
    ? value.map((item) => String(item || "").trim()).filter(Boolean).slice(0, 50)
    : [];
}

export function normalizeAiGovernance(value = {}) {
  const input = asObject(value);
  const maxAutonomousActions = Number(input.maxAutonomousActions);
  return {
    requireApprovalFor: cleanTerms(input.requireApprovalFor || DEFAULT_AI_GOVERNANCE.requireApprovalFor),
    maxAutonomousActions: Number.isFinite(maxAutonomousActions)
      ? Math.max(0, Math.min(Math.floor(maxAutonomousActions), 10))
      : DEFAULT_AI_GOVERNANCE.maxAutonomousActions,
    blockedTerms: cleanTerms(input.blockedTerms),
    recordEvaluations: input.recordEvaluations === undefined ? true : Boolean(input.recordEvaluations)
  };
}

export async function getAiGovernance(tenantId) {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { aiSettings: true } });
  return normalizeAiGovernance(tenant?.aiSettings?.governance);
}

export function evaluateAiOutput({ output = "", governance = DEFAULT_AI_GOVERNANCE } = {}) {
  const text = String(output || "");
  const blockedTerms = cleanTerms(governance.blockedTerms);
  const matches = blockedTerms.filter((term) => text.toLocaleLowerCase("es").includes(term.toLocaleLowerCase("es")));
  return {
    passed: matches.length === 0,
    matches,
    score: matches.length ? Math.max(0, 100 - matches.length * 35) : 100
  };
}

export function needsHumanApproval(governance, toolName) {
  return normalizeAiGovernance(governance).requireApprovalFor.includes(String(toolName || "").trim());
}

export async function createAiActionApproval({ tenantId, conversationId = null, tool, args = {}, reason = "Política de gobierno IA", requestedBy = "agent" }) {
  return prisma.industryRecord.create({
    data: {
      tenantId,
      recordType: "ai_action_approval",
      title: `Aprobación IA · ${String(tool || "acción")}`,
      status: "PENDING",
      data: normalizeMetadata({ conversationId, tool, args: asObject(args), reason, requestedBy, requestedAt: new Date().toISOString() }, {})
    }
  });
}

export async function createAiEvaluation({ tenantId, scenario, output, expected = "", governance }) {
  const result = evaluateAiOutput({ output, governance });
  const record = await prisma.industryRecord.create({
    data: {
      tenantId,
      recordType: "ai_evaluation",
      title: String(scenario || "Evaluación IA").trim() || "Evaluación IA",
      status: result.passed ? "PASSED" : "REVIEW",
      data: normalizeMetadata({ scenario, output, expected, result, evaluatedAt: new Date().toISOString() }, {})
    }
  });
  return { record, result };
}
