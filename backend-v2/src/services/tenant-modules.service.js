import { prisma } from "../lib/db.js";
import { MODULES, PLAN_DEFINITIONS, getModulesForPlan, normalizePlanCode } from "../lib/modules.js";
import { getAnyIndustryTemplate, getTemplateModules } from "./industry-templates.service.js";
import { filterModulesForIndustry } from "../lib/industry-module-access.js";

// Tenants creados durante las primeras versiones guardaron nombres visibles
// (agenda, pipeline, campanas). Las rutas nuevas usan las claves canonicas.
// Mantener esta compatibilidad evita bloquear cuentas existentes sin volver a
// habilitar modulos que un administrador desactivo manualmente.
const MODULE_ALIASES = Object.freeze({
  [MODULES.SALES]: ["pipeline", "ventas"],
  [MODULES.BOOKINGS]: ["agenda", "reservas"],
  [MODULES.MARKETING]: ["campaigns", "campanas", "campañas"],
  [MODULES.ANALYTICS]: ["dashboard", "analytics"],
  [MODULES.REPORTS]: ["reportes", "informes"],
  [MODULES.INTEGRATIONS]: ["integraciones", "conectores"],
  [MODULES.CUSTOMERS]: ["clientes", "pacientes"],
  [MODULES.REALTY_CLIENTS]: ["clientes_inmobiliarios", "clientes"],
  [MODULES.PATIENTS]: ["pacientes"],
  [MODULES.EXAMS]: ["examenes", "presupuestos", "examenes_y_presupuestos"],
  [MODULES.REVENUE]: ["ganancias", "ingresos"],
  [MODULES.PROPERTIES]: ["propiedades"],
  [MODULES.REALTY_LOADS]: ["cargas_inmobiliarias", "cargas"],
  [MODULES.REALTY_ACTIVITY]: ["actividad_inmobiliaria"],
  [MODULES.BROKER_PORTAL]: ["portal_corredor"],
  [MODULES.BROKERS]: ["corredores"],
  [MODULES.PROPERTY_ASSIGNMENTS]: ["asignacion_ventas", "seller_assignments"],
  [MODULES.VEHICLES]: ["vehiculos"],
  [MODULES.VEHICLE_OWNERS]: ["duenos_vehiculos", "dueños_vehículos", "vehiculos"],
  [MODULES.PARTS_INVENTORY]: ["repuestos", "inventario_repuestos"],
  [MODULES.MECHANIC_ASSIGNMENTS]: ["asignacion_mecanicos"],
  [MODULES.READY_NOTIFICATIONS]: ["avisos_retiro"],
  [MODULES.FINANCE_INVOICES]: ["facturas", "cuentas_por_cobrar"],
  [MODULES.FINANCE_BANK_SYNC]: ["cartolas", "bank_sync", "movimientos_bancarios"],
  [MODULES.FINANCE_RECONCILIATION]: ["conciliacion", "conciliacion_ia"],
  [MODULES.FINANCE_EXCEPTIONS]: ["excepciones_financieras"],
  [MODULES.FINANCE_COLLECTIONS]: ["cobranza", "cobranza_ia"],
  [MODULES.FINANCE_ANALYTICS]: ["dashboard_financiero", "analitica_financiera"],
});

function normalizeModuleKey(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, "_");
}

export function getModuleCandidates(module) {
  const requested = normalizeModuleKey(module);
  if (!requested) return [];

  const canonical = Object.entries(MODULE_ALIASES).find(([key, aliases]) =>
    key === requested || aliases.some((alias) => normalizeModuleKey(alias) === requested),
  );

  if (!canonical) return [requested];
  return [...new Set([canonical[0], ...canonical[1]].map(normalizeModuleKey))];
}

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

export async function ensureTenantSubscriptionAndModules({ tenantId, planCode = "STARTER", forcePlanSync = false } = {}) {
  const normalized = normalizePlanCode(planCode);
  await syncPlans();
  const plan = await prisma.plan.findUnique({ where: { code: normalized } });

  await prisma.subscription.upsert({
    where: { id: `${tenantId}:${normalized}` },
    update: { status: "ACTIVE", planId: plan?.id },
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

  const existingModules = await prisma.tenantModule.findMany({ where: { tenantId } });
  const hasManualConfiguration = existingModules.some((item) => item.source === "MANUAL");

  // Importante:
  // Si el SUPER_ADMIN ya configuró módulos manualmente para este cliente,
  // NO debemos volver a activar automáticamente los módulos del plan.
  // Antes, /api/modules/me llamaba esta función y reactivaba servicios bloqueados.
  if (hasManualConfiguration && !forcePlanSync) {
    return getTenantModules(tenantId);
  }

  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { industry: true }
  }).catch(() => null);

  const industryTemplate = await getAnyIndustryTemplate(tenant?.industry || "GENERAL");
  const modules = [
    ...new Set([
      ...getModulesForPlan(normalized),
      ...getTemplateModules(industryTemplate, normalized)
    ])
  ];

  // En sincronización forzada de plan, el plan vuelve a ser la fuente de verdad.
  if (forcePlanSync) {
    await prisma.tenantModule.updateMany({
      where: { tenantId },
      data: { enabled: false, source: "PLAN" }
    });
  }

  for (const module of modules) {
    await prisma.tenantModule.upsert({
      where: { tenantId_module: { tenantId, module } },
      update: { enabled: true, source: "PLAN" },
      create: { tenantId, module, enabled: true, source: "PLAN" }
    });
  }

  return getTenantModules(tenantId);
}

export async function getTenantModules(tenantId, industry = null) {
  const modules = await prisma.tenantModule.findMany({
    where: { tenantId, enabled: true },
    orderBy: { module: "asc" }
  });
  // También protegemos cuentas antiguas que conservaron módulos de otra
  // vertical en la base de datos antes de que existiera la regla de rubros.
  const tenantIndustry = industry || (await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { industry: true }
  }))?.industry;
  return filterModulesForIndustry(modules.map((item) => item.module), tenantIndustry);
}

export async function hasTenantModule(tenantId, module) {
  if (!module) return true;
  const found = await prisma.tenantModule.findFirst({
    where: {
      tenantId,
      module: { in: getModuleCandidates(module) },
      enabled: true,
    },
    select: { id: true }
  });
  return Boolean(found);
}

// Recupera modulos propios del plan o de la vertical cuando una cuenta antigua
// quedo con una configuracion parcial. Una desactivacion MANUAL explicita
// siempre gana: no reactivamos servicios que un administrador eligio bloquear.
export async function ensureTenantModuleEligibility({ tenantId, module, tenant: knownTenant = null } = {}) {
  if (!tenantId || !module) return false;

  const candidates = getModuleCandidates(module);
  const configured = await prisma.tenantModule.findMany({
    where: { tenantId, module: { in: candidates } },
    select: { module: true, enabled: true, source: true }
  });

  if (configured.some((item) => item.enabled)) return true;
  if (configured.some((item) => !item.enabled && item.source === "MANUAL")) return false;

  const tenant = knownTenant || await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { plan: true, industry: true }
  });
  if (!tenant) return false;

  const planCode = normalizePlanCode(tenant.plan || "STARTER");
  const template = await getAnyIndustryTemplate(tenant.industry || "GENERAL");
  const eligibleModules = [
    ...new Set([
      ...getModulesForPlan(planCode),
      ...getTemplateModules(template, planCode)
    ])
  ];
  const canonical = eligibleModules.find((item) => getModuleCandidates(item).some((candidate) => candidates.includes(candidate)));
  if (!canonical) return false;

  await prisma.tenantModule.upsert({
    where: { tenantId_module: { tenantId, module: canonical } },
    update: { enabled: true, source: "INDUSTRY" },
    create: { tenantId, module: canonical, enabled: true, source: "INDUSTRY" }
  });

  return true;
}

export async function setTenantModules({ tenantId, modules = [], source = "MANUAL" }) {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { industry: true }
  });
  if (!tenant) {
    const error = new Error("Cliente no encontrado");
    error.statusCode = 404;
    throw error;
  }

  // Super Admin puede configurar una cuenta con capacidades de más de una
  // vertical. Los datos siguen aislados por tenant y tipo de registro.
  const normalized = filterModulesForIndustry(
    [...new Set(modules.map(normalizeModuleKey).filter(Boolean))],
    tenant.industry
  );
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

export async function enableTenantModules({ tenantId, modules = [], source = "INDUSTRY" }) {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { industry: true }
  });
  if (!tenant) return [];
  const normalized = filterModulesForIndustry(modules, tenant.industry);
  for (const module of normalized) {
    await prisma.tenantModule.upsert({
      where: { tenantId_module: { tenantId, module } },
      update: { enabled: true, source },
      create: { tenantId, module, enabled: true, source }
    });
  }
  return getTenantModules(tenantId);
}

// Reemplaza solo capacidades propias de una vertical. Conserva módulos del
// plan y no toca configuraciones MANUAL, evitando duplicados históricos al
// actualizar una plantilla de rubro.
export async function syncTenantIndustryModules({ tenantId, modules = [], planCode = "STARTER" }) {
  const desired = new Set(modules.map((module) => String(module).trim()).filter(Boolean));
  const planModules = new Set(getModulesForPlan(normalizePlanCode(planCode)));
  const currentIndustryModules = await prisma.tenantModule.findMany({
    where: { tenantId, source: "INDUSTRY" },
    select: { id: true, module: true }
  });

  const obsolete = currentIndustryModules
    .filter((item) => !desired.has(item.module) && !planModules.has(item.module))
    .map((item) => item.id);
  if (obsolete.length) {
    await prisma.tenantModule.updateMany({
      where: { id: { in: obsolete } },
      data: { enabled: false }
    });
  }

  return enableTenantModules({ tenantId, modules: [...desired], source: "INDUSTRY" });
}
