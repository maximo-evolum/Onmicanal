import { prisma } from "../lib/db.js";
import { PLAN_DEFINITIONS, normalizePlanCode, getModulesForPlan } from "../lib/modules.js";

export const DEFAULT_AI_SETTINGS = Object.freeze({
  tone: "cercano, profesional y consultivo",
  personality: "vendedor experto que ayuda antes de vender",
  objective: "convertir conversaciones en oportunidades y avisar al humano cuando el cliente esté listo para cerrar",
  responseStyle: "breve, claro, natural, con una pregunta útil al final",
  forbidden: "no inventar precios, stock, disponibilidad ni enlaces de pago",
  businessRules: []
});

export function planLimits(planCode = "STARTER") {
  const plan = PLAN_DEFINITIONS[normalizePlanCode(planCode)] || PLAN_DEFINITIONS.STARTER;
  return {
    messagesMonthly: plan.limits?.messagesMonthly ?? null,
    users: plan.limits?.users ?? null,
    modules: plan.modules || [],
    priceMonthly: plan.priceMonthly,
    currency: plan.currency,
    planName: plan.name
  };
}

export function monthRange(date = new Date()) {
  return {
    start: new Date(date.getFullYear(), date.getMonth(), 1),
    end: new Date(date.getFullYear(), date.getMonth() + 1, 1)
  };
}

export async function recordUsageEvent({ tenantId, type, quantity = 1, cost = 0, metadata = null }) {
  if (!tenantId || !type) return null;
  try {
    return await prisma.usageEvent.create({
      data: { tenantId, type, quantity: Number(quantity) || 1, cost: Number(cost) || 0, metadata }
    });
  } catch (error) {
    // No debe romper el flujo de conversación si el tracking falla.
    console.warn("Usage tracking skipped:", error.message);
    return null;
  }
}

export async function auditTenantAction({ tenantId, actorUserId = null, action, entity = null, entityId = null, metadata = null }) {
  if (!tenantId || !action) return null;
  try {
    return await prisma.tenantAuditLog.create({ data: { tenantId, actorUserId, action, entity, entityId, metadata } });
  } catch (error) {
    console.warn("Audit log skipped:", error.message);
    return null;
  }
}

export async function getTenantUsageSummary(tenantId) {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant) return null;
  const { start, end } = monthRange();
  const events = await prisma.usageEvent.groupBy({
    by: ["type"],
    where: { tenantId, createdAt: { gte: start, lt: end } },
    _sum: { quantity: true, cost: true },
    _count: { _all: true }
  }).catch(() => []);

  const messages = events
    .filter((event) => ["MESSAGE_IN", "MESSAGE_OUT", "AI_REPLY"].includes(event.type))
    .reduce((sum, event) => sum + (event._sum.quantity || 0), 0);
  const aiReplies = events.find((event) => event.type === "AI_REPLY")?._sum.quantity || 0;
  const toolCalls = events.find((event) => event.type === "TOOL_CALL")?._sum.quantity || 0;
  const cost = events.reduce((sum, event) => sum + (event._sum.cost || 0), 0);
  const limits = { ...planLimits(tenant.plan), ...(tenant.billingLimits || {}) };
  const usagePercent = limits.messagesMonthly ? Math.min(100, Math.round((messages / limits.messagesMonthly) * 100)) : 0;

  return { tenant, period: { start, end }, events, messages, aiReplies, toolCalls, cost, limits, usagePercent };
}

export async function checkPlanLimit({ tenantId, metric = "messagesMonthly", increment = 1 }) {
  const summary = await getTenantUsageSummary(tenantId);
  if (!summary) return { ok: false, reason: "Tenant no encontrado" };
  const limit = summary.limits?.[metric];
  if (limit == null) return { ok: true, limit: null, current: summary.messages };
  const current = metric === "messagesMonthly" ? summary.messages : 0;
  return { ok: current + increment <= limit, limit, current, remaining: Math.max(0, limit - current) };
}

export async function getAISettings(tenantId) {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  return { ...DEFAULT_AI_SETTINGS, ...(tenant?.aiSettings || {}) };
}

export async function updateAISettings({ tenantId, settings, actorUserId = null }) {
  const next = { ...DEFAULT_AI_SETTINGS, ...(settings || {}) };
  const tenant = await prisma.tenant.update({ where: { id: tenantId }, data: { aiSettings: next } });
  await auditTenantAction({ tenantId, actorUserId, action: "AI_SETTINGS_UPDATED", entity: "Tenant", entityId: tenantId, metadata: next });
  return tenant.aiSettings;
}

export async function getOnboardingState(tenantId) {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  const state = tenant?.onboardingState || {};
  const steps = {
    business: Boolean(state.business || tenant?.industry || tenant?.businessPrompt),
    ai: Boolean(state.ai || tenant?.aiSettings),
    channels: Boolean(state.channels || tenant?.whatsappPhoneNumberId || tenant?.instagramBusinessAccountId),
    team: Boolean(state.team),
    botlab: Boolean(state.botlab)
  };
  const completed = Object.values(steps).filter(Boolean).length;
  return { steps, completed, total: Object.keys(steps).length, completedPercent: Math.round((completed / Object.keys(steps).length) * 100), raw: state };
}

export async function updateOnboardingState({ tenantId, patch, actorUserId = null }) {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  const next = { ...(tenant?.onboardingState || {}), ...(patch || {}) };
  const state = await getOnboardingState(tenantId);
  const updated = await prisma.tenant.update({
    where: { id: tenantId },
    data: { onboardingState: next, onboardingCompleted: state.completedPercent >= 80 }
  });
  await auditTenantAction({ tenantId, actorUserId, action: "ONBOARDING_UPDATED", entity: "Tenant", entityId: tenantId, metadata: patch });
  return { tenant: updated, onboarding: await getOnboardingState(tenantId) };
}

export async function getCommercialAnalytics(tenantId) {
  const [usage, conversations, leads, users, outcomes, modules] = await Promise.all([
    getTenantUsageSummary(tenantId),
    prisma.conversation.findMany({ where: { tenantId }, include: { lead: true, contact: true }, orderBy: { updatedAt: "desc" }, take: 50 }),
    prisma.lead.findMany({ where: { tenantId } }),
    prisma.workspaceUser.findMany({ where: { tenantId } }),
    prisma.salesOutcome.findMany({ where: { tenantId }, orderBy: { createdAt: "desc" }, take: 100 }).catch(() => []),
    prisma.tenantModule.findMany({ where: { tenantId, enabled: true } })
  ]);

  const hot = conversations.filter((c) => (c.aiCloseScore || c.lead?.closeProbability || 0) >= 75).length;
  const handoff = conversations.filter((c) => c.aiHandoffRequired).length;
  const ready = conversations.filter((c) => c.aiNextActionCode === "READY_TO_CLOSE" || c.lead?.status === "READY_TO_CLOSE").length;
  const won = outcomes.filter((o) => ["WON", "BOOKED", "PAID"].includes(o.outcome)).length;
  const lost = outcomes.filter((o) => ["LOST", "NO_RESPONSE"].includes(o.outcome)).length;
  const closeRate = outcomes.length ? Math.round((won / outcomes.length) * 100) : 0;

  const recommendations = [];
  if (usage?.limits?.messagesMonthly && usage.usagePercent >= 80) recommendations.push("El tenant está cerca del límite mensual de mensajes. Recomienda upgrade o ajuste de límites.");
  if (handoff > 0) recommendations.push("Hay conversaciones que requieren intervención humana. Revisa Sales Queue.");
  if (ready > 0) recommendations.push("Hay leads listos para cierre. Prioriza seguimiento humano.");
  if (hot === 0 && conversations.length > 10) recommendations.push("Pocos leads calientes detectados. Revisa prompts, oferta y calidad de discovery.");
  if (!recommendations.length) recommendations.push("Operación estable. Mantén seguimiento a cierres, objeciones y tasa de respuesta.");

  return {
    usage,
    kpis: {
      conversations: conversations.length,
      leads: leads.length,
      users: users.length,
      modules: modules.length,
      hot,
      handoff,
      ready,
      closeRate,
      won,
      lost
    },
    recommendations,
    recentConversations: conversations.slice(0, 8),
    outcomes: outcomes.slice(0, 8)
  };
}

export async function buildSaasOverview(tenantId) {
  const [tenant, modules, usage, onboarding, analytics, aiSettings] = await Promise.all([
    prisma.tenant.findUnique({ where: { id: tenantId } }),
    prisma.tenantModule.findMany({ where: { tenantId, enabled: true }, orderBy: { module: "asc" } }),
    getTenantUsageSummary(tenantId),
    getOnboardingState(tenantId),
    getCommercialAnalytics(tenantId),
    getAISettings(tenantId)
  ]);
  const planCode = normalizePlanCode(tenant?.plan || "STARTER");
  return {
    tenant,
    plan: PLAN_DEFINITIONS[planCode],
    modules: modules.map((m) => m.module),
    usage,
    onboarding,
    analytics: analytics.kpis,
    recommendations: analytics.recommendations,
    aiSettings
  };
}
