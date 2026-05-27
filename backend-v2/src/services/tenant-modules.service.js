import { prisma } from "../lib/db.js";
import { PLAN_DEFINITIONS, getModulesForPlan, normalizePlanCode } from "../lib/modules.js";

export async function syncPlans() {
  const plans = Object.values(PLAN_DEFINITIONS);
  for (const plan of plans) {
    await prisma.plan.upsert({
      where: { code: plan.code },
      update: {
        name: plan.name,
        description: plan.description,
        priceMonthly: plan.priceMonthly,
        currency: plan.currency,
        modules: plan.modules,
        limits: plan.limits,
        isActive: true
      },
      create: {
        code: plan.code,
        name: plan.name,
        description: plan.description,
        priceMonthly: plan.priceMonthly,
        currency: plan.currency,
        modules: plan.modules,
        limits: plan.limits,
        isActive: true
      }
    });
  }
}

export async function ensureTenantSubscriptionAndModules({ tenantId, planCode = "STARTER" }) {
  const normalized = normalizePlanCode(planCode);
  await syncPlans();
  const plan = await prisma.plan.findUnique({ where: { code: normalized } });

  await prisma.subscription.upsert({
    where: { id: `${tenantId}:${normalized}` },
    update: {},
    create: {
      id: `${tenantId}:${normalized}`,
      tenantId,
      planCode: normalized,
      planId: plan?.id,
      status: "ACTIVE"
    }
  }).catch(async () => {
    const existing = await prisma.subscription.findFirst({ where: { tenantId, status: "ACTIVE" } });
    if (!existing) {
      await prisma.subscription.create({ data: { tenantId, planCode: normalized, planId: plan?.id, status: "ACTIVE" } });
    }
  });

  const modules = getModulesForPlan(normalized);
  for (const module of modules) {
    await prisma.tenantModule.upsert({
      where: { tenantId_module: { tenantId, module } },
      update: { enabled: true, source: "PLAN" },
      create: { tenantId, module, enabled: true, source: "PLAN" }
    });
  }

  return getTenantModules(tenantId);
}

export async function getTenantModules(tenantId) {
  const modules = await prisma.tenantModule.findMany({
    where: { tenantId, enabled: true },
    orderBy: { module: "asc" }
  });
  return modules.map((m) => m.module);
}

export async function hasTenantModule(tenantId, module) {
  if (!module) return true;
  const found = await prisma.tenantModule.findUnique({
    where: { tenantId_module: { tenantId, module } }
  });
  return Boolean(found?.enabled);
}

export async function setTenantModules({ tenantId, modules = [], source = "MANUAL" }) {
  const normalized = [...new Set(modules.map((m) => String(m).trim()).filter(Boolean))];
  await prisma.tenantModule.updateMany({ where: { tenantId }, data: { enabled: false, source } });
  for (const module of normalized) {
    await prisma.tenantModule.upsert({
      where: { tenantId_module: { tenantId, module } },
      update: { enabled: true, source },
      create: { tenantId, module, enabled: true, source }
    });
  }
  return getTenantModules(tenantId);
}
