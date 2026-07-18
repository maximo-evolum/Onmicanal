import { prisma } from "../lib/db.js";
import { normalizeMetadata } from "../lib/metadata.js";

export const DEFAULT_AI_GOVERNANCE = Object.freeze({
  requireApprovalFor: ["create_booking", "mark_payment_ready"],
  maxAutonomousActions: 3,
  blockedTerms: [],
  recordEvaluations: true,
  maxAiRepliesPerDay: null,
  monthlyCostLimit: null
});

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function cleanTerms(value) {
  return Array.isArray(value)
    ? value.map((item) => String(item || "").trim()).filter(Boolean).slice(0, 50)
    : [];
}

function boundedOptionalNumber(value, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.min(max, Math.max(min, number));
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
    recordEvaluations: input.recordEvaluations === undefined ? true : Boolean(input.recordEvaluations),
    maxAiRepliesPerDay: boundedOptionalNumber(input.maxAiRepliesPerDay, { min: 1, max: 100_000 }),
    monthlyCostLimit: boundedOptionalNumber(input.monthlyCostLimit, { min: 0, max: 10_000_000 })
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

function periodStarts(reference = new Date()) {
  const date = new Date(reference);
  return {
    dayStart: new Date(date.getFullYear(), date.getMonth(), date.getDate()),
    monthStart: new Date(date.getFullYear(), date.getMonth(), 1),
    nextMonthStart: new Date(date.getFullYear(), date.getMonth() + 1, 1)
  };
}

/** Uso agregado, sin contenido de conversaciones, para controles de IA. */
export async function getAiGovernanceUsage(tenantId, reference = new Date()) {
  const { dayStart, monthStart, nextMonthStart } = periodStarts(reference);
  const [dailyReplies, monthlyAi] = await Promise.all([
    prisma.usageEvent.aggregate({
      where: { tenantId, type: "AI_REPLY", createdAt: { gte: dayStart } },
      _sum: { quantity: true }
    }),
    prisma.usageEvent.aggregate({
      where: { tenantId, type: "AI_REPLY", createdAt: { gte: monthStart, lt: nextMonthStart } },
      _sum: { quantity: true, cost: true }
    })
  ]);
  return {
    period: { dayStart, monthStart, nextMonthStart },
    dailyReplies: dailyReplies._sum.quantity || 0,
    monthlyReplies: monthlyAi._sum.quantity || 0,
    monthlyCost: monthlyAi._sum.cost || 0
  };
}

/**
 * Bloquea generación y herramientas autónomas cuando el tenant definió un
 * límite. Si no se configuró un límite, conserva exactamente el flujo actual.
 */
export async function evaluateAiUsageLimits({ tenantId, governance, reference = new Date() }) {
  const policy = normalizeAiGovernance(governance);
  const usage = await getAiGovernanceUsage(tenantId, reference);
  if (policy.maxAiRepliesPerDay !== null && usage.dailyReplies >= policy.maxAiRepliesPerDay) {
    return { allowed: false, reason: "DAILY_AI_REPLY_LIMIT", policy, usage };
  }
  if (policy.monthlyCostLimit !== null && usage.monthlyCost >= policy.monthlyCostLimit) {
    return { allowed: false, reason: "MONTHLY_AI_COST_LIMIT", policy, usage };
  }
  return { allowed: true, reason: null, policy, usage };
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
