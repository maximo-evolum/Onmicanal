import { Router } from "express";
import { prisma } from "../lib/db.js";
import { requireRole, ROLE_GROUPS } from "../middleware/tenant-access.js";
import { recordAuditLog } from "../lib/audit.js";
import {
  BROKER_RECORD_AREAS,
  BROKER_RECORD_TYPES,
  BROKER_RECORD_DEFINITIONS,
  BROKER_OPERATION_TYPES,
  BROKER_AGENT_CATALOG,
  BROKER_AGENT_SCENARIOS,
  BROKER_AUTOMATION_RULES,
  BROKER_OPERATION_CHECKLISTS,
  BROKER_DEFAULT_OPERATING_POLICY,
  BROKER_EXTERNAL_READINESS,
  BROKER_ROLE_TEMPLATES,
  BROKER_SOP_LIBRARY,
  FINANCING_STAGES,
  SALE_STAGES,
  TERMINAL_STAGES,
  brokerAgentScenario,
  brokerStageChecklist,
  brokerFinancingChecklist,
  calculateBrokerAdministrationLiquidation,
  calculateBrokerCommission,
  normalizeBrokerOperatingPolicy,
  normalizeBrokerFinancingStage,
  isBrokerRecordArea,
  normalizeBrokerOperationType,
  normalizeBrokerStage,
  propertyHealthSnapshot,
  stagesForBrokerOperation,
  validateBrokerStageTransition,
  validateBrokerFinancingTransition,
  validateBrokerRecord
} from "../services/broker-workflows.service.js";
import { brokerRelationalCoverage } from "../services/broker-relational-data.service.js";
import { brokerFinancingActionForStage, brokerRecordWhere, canBrokerAction, loadBrokerAccessContext, profileRecordData, requireBrokerAction } from "../services/broker-access.service.js";
import { administrationActionForLiquidationStage, buildMonthlyAdministration, normalizeAdministrationPeriod, validateAdministrationLiquidationTransition } from "../services/broker-monthly-administration.service.js";

export const brokerRouter = Router();

brokerRouter.use(async (req, res, next) => {
  try {
    req.brokerAccess = await loadBrokerAccessContext({ prisma, tenantId: req.tenantId, user: req.user });
    next();
  } catch (error) {
    next(error);
  }
});

// Expone el avance del traspaso sin ocultar que IndustryRecord sigue siendo
// la fuente histórica mientras cada tenant migra de forma controlada.
brokerRouter.get("/broker/data-model/coverage", requireBrokerAction("configuration", "VIEW"), async (req, res) => {
  const [legacyProperties, strictProperties, owners] = await Promise.all([
    prisma.industryRecord.count({ where: { tenantId: req.tenantId, recordType: "property" } }),
    prisma.brokerProperty.count({ where: { tenantId: req.tenantId } }),
    prisma.brokerOwner.count({ where: { tenantId: req.tenantId } }),
  ]);
  res.json({
    model: "BROKER_RELATIONAL_CORE_V1",
    compatibilityMode: strictProperties < legacyProperties,
    ...brokerRelationalCoverage({ legacyProperties, strictProperties, owners }),
  });
});

function text(value, fallback = "") {
  const result = String(value ?? "").trim();
  return result || fallback;
}

function dataOf(record) {
  return record?.data && typeof record.data === "object" && !Array.isArray(record.data) ? record.data : {};
}

function brokerWhere(req, extra = {}) {
  return brokerRecordWhere(req, extra);
}

function allowBrokerAreaAction(req, res, area, action) {
  if (canBrokerAction(req.brokerAccess, area, action)) return true;
  res.status(403).json({ error: "No tienes permiso para esta acción en el área de Broker OS.", area, action, scope: req.brokerAccess?.accessScope || "ASSIGNED" });
  return false;
}

async function monthlyAdministrationSnapshot(req, period) {
  const recordTypes = ["administration_profile", "rental_contract", "rental_payment", "utility_monitoring", "maintenance_ticket", "administration_liquidation"];
  const [properties, records] = await Promise.all([
    prisma.industryRecord.findMany({ where: brokerWhere(req, { recordType: "property" }), select: { id: true, title: true } }),
    prisma.industryRecord.findMany({ where: brokerWhere(req, { recordType: { in: recordTypes } }), orderBy: { updatedAt: "desc" }, take: 1200 }),
  ]);
  const byType = (type) => records.filter((record) => record.recordType === type);
  return buildMonthlyAdministration({
    period,
    properties,
    profiles: byType("administration_profile"),
    contracts: byType("rental_contract"),
    payments: byType("rental_payment"),
    utilities: byType("utility_monitoring"),
    maintenance: byType("maintenance_ticket"),
    liquidations: byType("administration_liquidation"),
  });
}

function operationPayload(record) {
  const data = dataOf(record);
  const operationType = normalizeBrokerOperationType(data.operationType) || "SALE";
  const stages = stagesForBrokerOperation(operationType);
  return {
    ...record,
    data: {
      ...data,
      operationType,
      stage: normalizeBrokerStage(operationType, text(data.stage, stages[0])),
      checklist: brokerStageChecklist(operationType, data.stage || stages[0]),
      timeline: Array.isArray(data.timeline) ? data.timeline : []
    }
  };
}

const BROKER_AGENT_MODULES = Object.freeze({
  commercial: "pipeline",
  marketing: "campaigns",
  analytics: "dashboard",
  legal: "documents",
  documental: "documents",
  maintenance: "realty_activity",
  finance: "payments",
  collections: "payments",
  inspection: "realty_activity",
  administration: "broker_portal",
  architect: "realty_loads",
  crm: "inbox",
  customer_care: "inbox"
});

function brokerAgentPayload(agent) {
  return {
    key: agent.key,
    name: agent.label,
    status: agent.status,
    module: BROKER_AGENT_MODULES[agent.key] || "properties",
    description: agent.scope
  };
}

function evaluationPayload(record) {
  const data = dataOf(record);
  return {
    ...record,
    scenarioKey: text(data.scenarioKey),
    agentKey: text(data.agentKey),
    decision: text(data.decision, "PENDING_REVIEW"),
    outcome: text(data.outcome),
    note: text(data.note),
    reviewedAt: text(data.reviewedAt),
    reviewedBy: text(data.reviewedBy)
  };
}

function brokerReporting({ properties, operations, evaluations, brokerRecords = [] }) {
  const portfolioValue = properties.reduce((sum, property) => sum + Number(dataOf(property).price || 0), 0);
  const projectedFromOperations = operations.reduce((sum, operation) => {
    const data = dataOf(operation);
    return sum + Number(data.estimatedCommission || data.monthlyManagementFee || 0);
  }, 0);
  const projectedFromPolicies = brokerRecords
    .filter((record) => record.recordType === "commission_policy" && ["ACTIVE", "DRAFT"].includes(String(record.status).toUpperCase()))
    .reduce((sum, record) => {
      const preview = calculateBrokerCommission(dataOf(record));
      return sum + (preview.ok ? preview.totalCommission : 0);
    }, 0);
  const byOperationType = Object.values(BROKER_OPERATION_TYPES).map((type) => ({
    type,
    count: operations.filter((operation) => (normalizeBrokerOperationType(dataOf(operation).operationType) || "SALE") === type).length
  }));
  const propertyHealth = properties.map((property) => propertyHealthSnapshot(property, brokerRecords.filter((record) => String(dataOf(record).propertyId || "") === property.id)));
  const completeProperties = propertyHealth.filter((item) => item.score >= 85).length;
  const confirmedEvaluations = evaluations.filter((item) => text(dataOf(item).decision) === "CONFIRMED").length;
  return {
    portfolioValue,
    projectedCommission: projectedFromPolicies || projectedFromOperations,
    propertyCompleteness: properties.length ? Math.round((completeProperties / properties.length) * 100) : 0,
    portfolioHealth: properties.length ? Math.round(propertyHealth.reduce((sum, item) => sum + item.score, 0) / properties.length) : 0,
    propertiesReady: completeProperties,
    byOperationType,
    aiEvaluations: {
      total: evaluations.length,
      confirmed: confirmedEvaluations,
      needsAdjustment: evaluations.filter((item) => text(dataOf(item).decision) === "ADJUSTMENT_NEEDED").length,
      pending: evaluations.filter((item) => text(dataOf(item).decision, "PENDING_REVIEW") === "PENDING_REVIEW").length
    }
  };
}

function missingPropertyData(property) {
  const data = dataOf(property);
  const missing = [];
  if (!text(data.price)) missing.push("precio");
  if (!text(data.address)) missing.push("dirección");
  if (!text(data.commune)) missing.push("comuna");
  if (!text(data.photoUrl) && !(Array.isArray(data.gallery) && data.gallery.length)) missing.push("foto principal");
  return missing;
}

function brokerRecommendations({ properties, operations, maintenance, postSale, financing, brokerRecords = [] }) {
  const recommendations = [];
  for (const property of properties) {
    const missing = missingPropertyData(property);
    if (missing.length) {
      recommendations.push({
        id: `property-${property.id}-completion`,
        priority: missing.includes("foto principal") ? "MEDIUM" : "HIGH",
        area: "commercial",
        title: `Completar ficha: ${property.title}`,
        detail: `Faltan ${missing.join(", ")}. La publicación y el matching serán más precisos con esa información.`,
        propertyId: property.id,
        requiresApproval: false
      });
    }
  }
  for (const operation of operations) {
    const normalized = operationPayload(operation);
    const stages = stagesForBrokerOperation(normalized.data.operationType);
    const currentIndex = stages.indexOf(normalized.data.stage);
    const next = stages[currentIndex + 1];
    if (next) {
      recommendations.push({
        id: `operation-${operation.id}-${next}`,
        priority: "MEDIUM",
        area: "commercial",
        title: `Siguiente paso: ${operation.title}`,
        detail: `La operación está en ${normalized.data.stage}. Puedes avanzar a ${next} cuando el equipo confirme el hito.`,
        operationId: operation.id,
        requiresApproval: true
      });
    }
  }
  if (maintenance > 0) recommendations.push({ id: "maintenance-open", priority: "HIGH", area: "maintenance", title: "Mantenciones pendientes", detail: `${maintenance} caso(s) requiere(n) revisión, proveedor o confirmación de cierre.`, requiresApproval: true });
  if (postSale > 0) recommendations.push({ id: "post-sale-open", priority: "HIGH", area: "post_sale", title: "Casos de postventa abiertos", detail: `${postSale} caso(s) mantiene(n) una decisión o seguimiento pendiente.`, requiresApproval: true });
  if (financing > 0) recommendations.push({ id: "financing-open", priority: "MEDIUM", area: "financing", title: "Financiamientos en seguimiento", detail: `${financing} solicitud(es) requiere(n) antecedentes o una revisión humana.`, requiresApproval: true });
  const today = new Date();
  const soon = new Date(today);
  soon.setDate(soon.getDate() + 30);
  for (const record of brokerRecords) {
    const data = dataOf(record);
    const dueDate = text(data.dueDate || data.warrantyUntil || data.endDate || data.expiresAt);
    const date = dueDate ? new Date(dueDate) : null;
    if (!date || Number.isNaN(date.getTime())) continue;
    if (["PAID", "CLOSED", "RESOLVED", "ENDED", "REPLACED"].includes(String(record.status).toUpperCase())) continue;
    const isOverdue = date < today;
    const isRelevantSoon = date <= soon;
    if (!isOverdue && !isRelevantSoon) continue;
    recommendations.push({
      id: `due-${record.id}`,
      priority: isOverdue ? "HIGH" : "MEDIUM",
      area: BROKER_RECORD_DEFINITIONS[record.recordType]?.area || "documents",
      title: `${isOverdue ? "Vencido" : "Próximo a vencer"}: ${record.title}`,
      detail: `${BROKER_RECORD_DEFINITIONS[record.recordType]?.label || record.recordType} con fecha ${date.toLocaleDateString("es-CL")}. Revisa y confirma la acción antes de comunicar o ejecutar cambios externos.`,
      propertyId: text(data.propertyId) || undefined,
      requiresApproval: true
    });
  }
  return recommendations.slice(0, 12);
}

async function assertRelatedProperty(req, propertyId) {
  if (!propertyId) return null;
  const property = await prisma.industryRecord.findFirst({
    where: brokerWhere(req, { id: String(propertyId), recordType: "property" }),
    select: { id: true, title: true }
  });
  if (!property) throw new Error("La propiedad relacionada no pertenece a esta cuenta.");
  return property;
}

async function assertAssignedUser(req, assignedToId) {
  if (!assignedToId) return null;
  const user = await prisma.workspaceUser.findFirst({
    where: { id: String(assignedToId), tenantId: req.tenantId, isActive: true },
    select: { id: true }
  });
  if (!user) throw new Error("El usuario asignado no pertenece a esta cuenta.");
  return user;
}

brokerRouter.get("/broker/overview", requireBrokerAction("overview", "VIEW"), async (req, res) => {
  try {
    const [propertyCount, properties, operations, visits, alerts, rentals, maintenance, postSale, financing, evaluations, brokerRecords] = await Promise.all([
      prisma.industryRecord.count({ where: brokerWhere(req, { recordType: "property" }) }),
      prisma.industryRecord.findMany({ where: brokerWhere(req, { recordType: "property" }), orderBy: { updatedAt: "desc" }, take: 12 }),
      prisma.industryRecord.findMany({ where: brokerWhere(req, { recordType: "broker_operation" }), orderBy: { updatedAt: "desc" }, take: 50 }),
      prisma.industryRecord.count({ where: brokerWhere(req, { recordType: "visit", status: { in: ["SCHEDULED", "PENDING", "ACTIVE"] } }) }),
      prisma.industryRecord.count({ where: brokerWhere(req, { recordType: "realty_alert", status: { not: "RESOLVED" } }) }),
      prisma.industryRecord.count({ where: brokerWhere(req, { recordType: "rental_contract", status: { in: ["ACTIVE", "PENDING_RENEWAL"] } }) }),
      prisma.industryRecord.count({ where: brokerWhere(req, { recordType: "maintenance_ticket", status: { notIn: ["CLOSED", "CANCELLED"] } }) }),
      prisma.industryRecord.count({ where: brokerWhere(req, { recordType: "post_sale_case", status: { notIn: ["CLOSED", "RESOLVED"] } }) }),
      prisma.industryRecord.count({ where: brokerWhere(req, { recordType: "operation_financing", status: { in: ["REQUESTED", "UNDER_REVIEW", "APPROVED", "DISBURSED"] } }) }),
      prisma.industryRecord.findMany({ where: brokerWhere(req, { recordType: "broker_agent_evaluation" }), orderBy: { updatedAt: "desc" }, take: 100 }),
      prisma.industryRecord.findMany({ where: brokerWhere(req, { recordType: { in: BROKER_RECORD_TYPES } }), orderBy: { updatedAt: "desc" }, take: 500 })
    ]);
    const normalizedOperations = operations.map(operationPayload);
    const kpis = {
      properties: propertyCount,
      activeOperations: normalizedOperations.filter((item) => !TERMINAL_STAGES.has(String(item.data.stage))).length,
      scheduledVisits: visits,
      openAlerts: alerts,
      activeRentals: rentals,
      openMaintenance: maintenance,
      openPostSale: postSale,
      activeFinancing: financing
    };
    res.json({
      kpis,
      properties,
      operations: normalizedOperations,
      recommendations: brokerRecommendations({ properties, operations, maintenance, postSale, financing, brokerRecords }),
      agents: BROKER_AGENT_CATALOG.map(brokerAgentPayload),
      reporting: brokerReporting({ properties, operations, evaluations, brokerRecords }),
      aiTraining: {
        scenarios: BROKER_AGENT_SCENARIOS,
        evaluations: evaluations.map(evaluationPayload),
        automationRules: BROKER_AUTOMATION_RULES
      }
    });
  } catch (error) {
    console.error("Broker overview error:", error);
    res.status(500).json({ error: "No se pudo preparar el resumen operativo del Broker." });
  }
});

brokerRouter.get("/broker/catalog", requireBrokerAction("overview", "VIEW"), (_req, res) => {
  res.json({
    areas: BROKER_RECORD_AREAS,
    recordDefinitions: BROKER_RECORD_DEFINITIONS,
    agents: BROKER_AGENT_CATALOG.map(brokerAgentPayload),
    aiScenarios: BROKER_AGENT_SCENARIOS,
    automationRules: BROKER_AUTOMATION_RULES,
    roleTemplates: BROKER_ROLE_TEMPLATES,
    sopLibrary: BROKER_SOP_LIBRARY,
    financingStages: FINANCING_STAGES,
    operationChecklists: BROKER_OPERATION_CHECKLISTS,
    operationStages: {
      SALE: SALE_STAGES,
      RENTAL: stagesForBrokerOperation("RENTAL"),
      ADMINISTRATION: stagesForBrokerOperation("ADMINISTRATION")
    }
  });
});

brokerRouter.get("/broker/access/me", (req, res) => {
  const access = req.brokerAccess;
  res.json({
    businessRole: access.businessRole,
    profileLabel: access.profileLabel,
    accessScope: access.accessScope,
    requestedScope: access.requestedScope,
    teamKey: access.teamKey,
    branchKey: access.branchKey,
    technicalRole: access.technicalRole,
    holding: access.holding,
    policy: access.policy,
    scopeDescription: access.accessScope === "ASSIGNED" ? "Solo registros asignados a tu usuario" : access.accessScope === "TEAM" ? "Registros asignados a tu equipo" : access.accessScope === "BRANCH" ? "Registros asignados a tu sucursal" : access.accessScope === "HOLDING" ? `Registros de ${access.holding?.tenantCount || 0} empresas autorizadas del holding` : "Registros de toda la empresa",
  });
});

brokerRouter.get("/broker/access/holding", requireBrokerAction("access", "CONFIGURE"), async (req, res, next) => {
  try {
    const membership = await prisma.brokerHoldingTenant.findUnique({
      where: { tenantId: req.tenantId },
      include: {
        holding: {
          include: {
            tenants: { include: { tenant: { select: { id: true, slug: true, name: true, industry: true } } }, orderBy: { tenant: { name: "asc" } } },
            accesses: { where: { isActive: true }, include: { user: { select: { id: true, name: true, email: true } } }, orderBy: { user: { name: "asc" } } },
          },
        },
      },
    });
    const availableTenants = await prisma.tenant.findMany({ where: { industry: "REAL_ESTATE" }, select: { id: true, slug: true, name: true, industry: true }, orderBy: { name: "asc" } });
    res.json({
      holding: membership?.holding ? {
        id: membership.holding.id,
        code: membership.holding.code,
        name: membership.holding.name,
        isActive: membership.holding.isActive,
        tenants: membership.holding.tenants.map((item) => item.tenant),
        accesses: membership.holding.accesses.map((item) => ({ userId: item.userId, name: item.user.name, email: item.user.email })),
      } : null,
      availableTenants,
      canConfigure: req.user?.role === "SUPER_ADMIN",
    });
  } catch (error) { next(error); }
});

brokerRouter.put("/broker/access/holding", requireBrokerAction("access", "CONFIGURE"), async (req, res, next) => {
  try {
    if (req.user?.role !== "SUPER_ADMIN") return res.status(403).json({ error: "Solo un superadministrador puede unir empresas y otorgar alcance holding." });
    const code = text(req.body?.code).toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/(^-|-$)/g, "");
    const name = text(req.body?.name);
    if (!code || !name) return res.status(422).json({ error: "Indica un nombre y un código válido para el holding." });
    const requestedSlugs = [...new Set([req.tenant?.slug, ...(Array.isArray(req.body?.tenantSlugs) ? req.body.tenantSlugs : [])].map((item) => text(item)).filter(Boolean))];
    const tenants = await prisma.tenant.findMany({ where: { slug: { in: requestedSlugs } }, select: { id: true, slug: true, name: true } });
    if (tenants.length !== requestedSlugs.length) return res.status(422).json({ error: "Una o más empresas indicadas no existen." });
    const holding = await prisma.brokerHolding.upsert({ where: { code }, update: { name, isActive: true }, create: { code, name } });
    await prisma.$transaction(async (tx) => {
      for (const tenant of tenants) await tx.brokerHoldingTenant.upsert({ where: { tenantId: tenant.id }, update: { holdingId: holding.id }, create: { holdingId: holding.id, tenantId: tenant.id } });
      const userIds = [...new Set((Array.isArray(req.body?.userIds) ? req.body.userIds : []).map((item) => text(item)).filter(Boolean))];
      if (userIds.length) {
        const users = await tx.workspaceUser.findMany({ where: { id: { in: userIds }, tenantId: { in: tenants.map((tenant) => tenant.id) }, isActive: true }, select: { id: true } });
        if (users.length !== userIds.length) throw Object.assign(new Error("Solo puedes autorizar usuarios activos de empresas incluidas en el holding."), { status: 422 });
        for (const user of users) await tx.brokerHoldingAccess.upsert({ where: { holdingId_userId: { holdingId: holding.id, userId: user.id } }, update: { isActive: true }, create: { holdingId: holding.id, userId: user.id } });
      }
    });
    await recordAuditLog(req, "BROKER_HOLDING_CONFIGURED", "broker_holding", holding.id, { code: holding.code, tenantSlugs: tenants.map((tenant) => tenant.slug), authorizedUserIds: req.body?.userIds || [] });
    res.json({ holding: { id: holding.id, code: holding.code, name: holding.name }, tenants });
  } catch (error) { next(error); }
});

brokerRouter.get("/broker/access/team", requireBrokerAction("access", "CONFIGURE"), async (req, res, next) => {
  try {
    const [users, profiles] = await Promise.all([
      prisma.workspaceUser.findMany({ where: { tenantId: req.tenantId }, select: { id: true, name: true, email: true, role: true, jobTitle: true, isActive: true }, orderBy: { name: "asc" } }),
      prisma.industryRecord.findMany({ where: { tenantId: req.tenantId, recordType: "broker_access_profile", status: "ACTIVE" }, select: { data: true, updatedAt: true } }),
    ]);
    const profileByUser = new Map(profiles.map((record) => [String(dataOf(record).userId || ""), { ...dataOf(record), updatedAt: record.updatedAt }]));
    res.json({ users: users.map((user) => ({ ...user, profile: profileByUser.get(user.id) || profileRecordData(user.id, {}, user) })) });
  } catch (error) { next(error); }
});

brokerRouter.put("/broker/access/users/:userId", requireBrokerAction("access", "CONFIGURE"), async (req, res, next) => {
  try {
    const user = await prisma.workspaceUser.findFirst({ where: { id: req.params.userId, tenantId: req.tenantId }, select: { id: true, name: true, email: true, role: true, jobTitle: true } });
    if (!user) return res.status(404).json({ error: "Usuario no encontrado en esta empresa." });
    if (String(req.body?.accessScope || "").toUpperCase() === "HOLDING" && req.user?.role !== "SUPER_ADMIN") {
      return res.status(422).json({ error: "El alcance holding requiere una estructura multiempresa y solo puede ser asignado por un superadministrador." });
    }
    const profile = profileRecordData(user.id, req.body || {}, user);
    const existing = await prisma.industryRecord.findFirst({ where: { tenantId: req.tenantId, recordType: "broker_access_profile", data: { path: ["userId"], equals: user.id } } });
    const record = existing
      ? await prisma.industryRecord.update({ where: { id: existing.id }, data: { title: `Acceso Broker: ${user.name}`, status: "ACTIVE", data: profile } })
      : await prisma.industryRecord.create({ data: { tenantId: req.tenantId, recordType: "broker_access_profile", title: `Acceso Broker: ${user.name}`, status: "ACTIVE", assignedToId: user.id, data: profile } });
    await recordAuditLog(req, "BROKER_ACCESS_PROFILE_UPDATED", "broker_access_profile", record.id, { targetUserId: user.id, businessRole: profile.businessRole, accessScope: profile.accessScope, teamKey: profile.teamKey, branchKey: profile.branchKey });
    res.json({ user, profile, updatedAt: record.updatedAt });
  } catch (error) { next(error); }
});

function policyPayload(record) {
  return {
    policy: normalizeBrokerOperatingPolicy(dataOf(record).policy || BROKER_DEFAULT_OPERATING_POLICY),
    updatedAt: record?.updatedAt || null,
    configured: Boolean(record)
  };
}

brokerRouter.get("/broker/configuration", requireBrokerAction("configuration", "VIEW"), async (req, res) => {
  try {
    const record = await prisma.industryRecord.findFirst({
      where: brokerWhere(req, { recordType: "broker_operating_policy" }),
      orderBy: { updatedAt: "desc" }
    });
    res.json(policyPayload(record));
  } catch (error) {
    console.error("Broker configuration error:", error);
    res.status(500).json({ error: "No se pudo obtener la configuración comercial." });
  }
});

// Estado de preparación; no equivale a una aprobación legal ni activa un
// proveedor externo. Sirve para que el equipo sepa qué evidencia falta antes
// de proponer una firma, publicación o intercambio de datos.
brokerRouter.get("/broker/legal-readiness", requireBrokerAction("documents", "VIEW"), async (req, res) => {
  try {
    const consentTypes = ["data_processing_consent", "communication_consent", "external_authorization"];
    const consents = await prisma.industryRecord.findMany({
      where: brokerWhere(req, { recordType: { in: consentTypes } }),
      orderBy: { updatedAt: "desc" },
      take: 500
    });
    const summary = Object.fromEntries(["PENDING", "GRANTED", "REVOKED", "EXPIRED"].map((status) => [status, consents.filter((item) => String(item.status).toUpperCase() === status).length]));
    res.json({ providers: BROKER_EXTERNAL_READINESS, consents, summary });
  } catch (error) {
    console.error("Broker legal readiness error:", error);
    res.status(500).json({ error: "No se pudo obtener el estado de cumplimiento y proveedores." });
  }
});

brokerRouter.put("/broker/configuration", requireRole("OWNER", "ADMIN"), requireBrokerAction("configuration", "CONFIGURE"), async (req, res) => {
  try {
    const policy = normalizeBrokerOperatingPolicy(req.body?.policy);
    if (Math.round((policy.sales.brokerSplitPct + policy.sales.companySplitPct) * 100) !== 10000) {
      return res.status(422).json({ error: "La distribución de comisión entre corredor y empresa debe sumar 100%." });
    }
    const existing = await prisma.industryRecord.findFirst({ where: brokerWhere(req, { recordType: "broker_operating_policy" }), orderBy: { updatedAt: "desc" } });
    const data = { policy, updatedBy: req.user?.name || req.user?.email || "Usuario autorizado", source: "broker_os" };
    const record = existing
      ? await prisma.industryRecord.update({ where: { id: existing.id }, data: { title: "Configuración comercial Broker OS", status: "ACTIVE", data } })
      : await prisma.industryRecord.create({ data: { tenantId: req.tenantId, recordType: "broker_operating_policy", title: "Configuración comercial Broker OS", status: "ACTIVE", data } });
    await recordAuditLog(req, "BROKER_OPERATING_POLICY_UPDATED", "broker_operating_policy", record.id, { policy });
    res.json(policyPayload(record));
  } catch (error) {
    console.error("Update broker configuration error:", error);
    res.status(500).json({ error: "No se pudo guardar la configuración comercial." });
  }
});

// Vista previa puramente informativa. Nunca crea una liquidación, pago,
// transferencia ni modifica una operación.
brokerRouter.post("/broker/commission-preview", requireRole(ROLE_GROUPS.STAFF), requireBrokerAction("commissions", "VIEW"), (req, res) => {
  const preview = calculateBrokerCommission(req.body || {});
  if (!preview.ok) return res.status(422).json(preview);
  res.json(preview);
});

// Simulación interna de liquidación mensual. No crea pagos, no transfiere
// dinero y exige aprobación humana antes de registrar una liquidación real.
brokerRouter.post("/broker/administration-preview", requireRole(ROLE_GROUPS.STAFF), requireBrokerAction("administration", "VIEW"), (req, res) => {
  res.json(calculateBrokerAdministrationLiquidation(req.body || {}));
});

// Administración recurrente por período. Consolida solo registros existentes
// de contratos, cobros y gastos; nunca ordena ni ejecuta transferencias.
brokerRouter.get("/broker/administration/monthly", requireBrokerAction("administration", "VIEW"), async (req, res) => {
  try {
    res.json(await monthlyAdministrationSnapshot(req, normalizeAdministrationPeriod(req.query?.period)));
  } catch (error) {
    console.error("Broker monthly administration error:", error);
    res.status(500).json({ error: "No se pudo preparar la administración mensual." });
  }
});

brokerRouter.post("/broker/administration/monthly/liquidations", requireRole(ROLE_GROUPS.STAFF), requireBrokerAction("administration", "CREATE"), async (req, res) => {
  try {
    const period = normalizeAdministrationPeriod(req.body?.period);
    const propertyId = text(req.body?.propertyId);
    if (!propertyId) return res.status(422).json({ error: "Selecciona la propiedad para preparar la liquidación." });
    const snapshot = await monthlyAdministrationSnapshot(req, period);
    const row = snapshot.rows.find((item) => item.propertyId === propertyId);
    if (!row?.readyToPrepare) return res.status(422).json({ error: "La propiedad requiere una ficha de administración activa y un contrato vigente con renta mensual." });
    if (row.liquidation && row.liquidation.status !== "DRAFT") return res.status(409).json({ error: "La liquidación ya fue enviada a revisión o emitida; no puede reemplazarse sin una revisión responsable." });
    const valueOrDefault = (value, fallback) => value === undefined || value === null || String(value).trim() === "" ? fallback : Number(value);
    const monthlyRent = valueOrDefault(req.body?.monthlyRent, row.monthlyRent);
    const paidAmount = valueOrDefault(req.body?.paidAmount, row.paidAmount);
    const commonExpenses = valueOrDefault(req.body?.commonExpenses, row.commonExpenses);
    const utilities = valueOrDefault(req.body?.utilities, row.utilities);
    const maintenanceCost = valueOrDefault(req.body?.maintenanceCost, row.maintenanceCost);
    const managementRatePct = valueOrDefault(req.body?.managementRatePct, row.managementRatePct);
    const preview = calculateBrokerAdministrationLiquidation({ monthlyRent, paidAmount, commonExpenses, utilities, maintenanceCost, managementRatePct });
    const transferDate = `${period}-${String(Math.min(28, Math.max(1, Number(row.ownerPaymentDay) || 10))).padStart(2, "0")}`;
    const previousTimeline = Array.isArray(row.liquidation?.data?.timeline) ? row.liquidation.data.timeline : [];
    const data = {
      propertyId,
      period,
      ownerName: row.ownerName,
      tenantName: row.tenantName,
      monthlyRent,
      paidAmount,
      commonExpenses,
      utilities,
      maintenanceCost,
      managementRatePct,
      amount: preview.paidAmount,
      managementFee: preview.managementFee,
      ownerTransferAmount: preview.ownerTransferAmount,
      transferDate,
      requiresHumanApproval: true,
      automaticTransfer: false,
      timeline: [...previousTimeline, { at: new Date().toISOString(), type: row.liquidation ? "MONTHLY_LIQUIDATION_RECALCULATED" : "MONTHLY_LIQUIDATION_PREPARED", stage: "DRAFT", note: "Liquidación mensual preparada para revisión humana.", by: req.user?.name || req.user?.email || "Usuario autorizado" }],
    };
    const title = `Liquidación ${period} · ${row.propertyTitle}`;
    const record = row.liquidation
      ? await prisma.industryRecord.update({ where: { id: row.liquidation.id }, data: { title, data } })
      : await prisma.industryRecord.create({ data: { tenantId: req.tenantId, recordType: "administration_liquidation", title, status: "DRAFT", data } });
    await recordAuditLog(req, row.liquidation ? "BROKER_MONTHLY_LIQUIDATION_RECALCULATED" : "BROKER_MONTHLY_LIQUIDATION_PREPARED", "administration_liquidation", record.id, { period, propertyId, ownerTransferAmount: preview.ownerTransferAmount });
    res.status(row.liquidation ? 200 : 201).json(record);
  } catch (error) {
    console.error("Prepare broker monthly liquidation error:", error);
    res.status(500).json({ error: "No se pudo preparar la liquidación mensual." });
  }
});

brokerRouter.patch("/broker/administration/monthly/liquidations/:id/status", requireRole(ROLE_GROUPS.STAFF), requireBrokerAction("administration", "EDIT"), async (req, res) => {
  try {
    const existing = await prisma.industryRecord.findFirst({ where: brokerWhere(req, { id: req.params.id, recordType: "administration_liquidation" }) });
    if (!existing) return res.status(404).json({ error: "Liquidación mensual no encontrada." });
    const transition = validateAdministrationLiquidationTransition({ currentStatus: existing.status, nextStatus: req.body?.status });
    if (!transition.ok) return res.status(422).json({ error: transition.error });
    const action = administrationActionForLiquidationStage(transition.next);
    if (!canBrokerAction(req.brokerAccess, "administration", action)) return res.status(403).json({ error: "No tienes permiso para confirmar este estado de liquidación.", action, status: transition.next });
    const currentData = dataOf(existing);
    const timeline = Array.isArray(currentData.timeline) ? currentData.timeline : [];
    const record = await prisma.industryRecord.update({
      where: { id: existing.id },
      data: { status: transition.next, data: { ...currentData, timeline: [...timeline, { at: new Date().toISOString(), type: "MONTHLY_LIQUIDATION_STATUS", stage: transition.next, note: text(req.body?.note, `Estado actualizado a ${transition.next}.`), by: req.user?.name || req.user?.email || "Usuario autorizado" }], requiresHumanApproval: true, automaticTransfer: false } }
    });
    await recordAuditLog(req, "BROKER_MONTHLY_LIQUIDATION_STATUS_CHANGED", "administration_liquidation", record.id, { from: transition.current, to: transition.next });
    res.json(record);
  } catch (error) {
    console.error("Update broker monthly liquidation error:", error);
    res.status(500).json({ error: "No se pudo actualizar el estado de la liquidación mensual." });
  }
});

brokerRouter.get("/broker/financing", requireBrokerAction("financing", "VIEW"), async (req, res) => {
  try {
    const records = await prisma.industryRecord.findMany({
      where: brokerWhere(req, { recordType: "operation_financing" }),
      include: { assignedTo: { select: { id: true, name: true, email: true, role: true } } },
      orderBy: { updatedAt: "desc" },
      take: 300
    });
    res.json(records.map((record) => {
      const data = dataOf(record);
      const stage = normalizeBrokerFinancingStage(record.status || data.stage);
      return { ...record, status: stage, data: { ...data, stage, checklist: brokerFinancingChecklist(stage), timeline: Array.isArray(data.timeline) ? data.timeline : [] } };
    }));
  } catch (error) {
    console.error("List broker financing error:", error);
    res.status(500).json({ error: "No se pudieron obtener los financiamientos." });
  }
});

brokerRouter.patch("/broker/financing/:id/stage", requireRole(ROLE_GROUPS.STAFF), requireBrokerAction("financing", "EDIT"), async (req, res) => {
  try {
    const existing = await prisma.industryRecord.findFirst({ where: brokerWhere(req, { id: req.params.id, recordType: "operation_financing" }) });
    if (!existing) return res.status(404).json({ error: "Financiamiento no encontrado." });
    const currentData = dataOf(existing);
    const transition = validateBrokerFinancingTransition({ currentStage: existing.status || currentData.stage, nextStage: req.body?.stage });
    if (!transition.ok) return res.status(422).json({ error: transition.error });
    const requiredAction = brokerFinancingActionForStage(transition.next);
    if (!canBrokerAction(req.brokerAccess, "financing", requiredAction)) return res.status(403).json({ error: "No tienes permiso para confirmar esta etapa de financiamiento.", action: requiredAction, stage: transition.next });
    const timeline = Array.isArray(currentData.timeline) ? currentData.timeline : [];
    timeline.push({ at: new Date().toISOString(), type: "FINANCING_STAGE", stage: transition.next, note: text(req.body?.note, "Etapa actualizada por usuario autorizado."), by: req.user?.name || req.user?.email || "Usuario autorizado" });
    const record = await prisma.industryRecord.update({
      where: { id: existing.id },
      data: { status: transition.next, data: { ...currentData, stage: transition.next, checklist: brokerFinancingChecklist(transition.next), timeline, requiresHumanApproval: true, automaticDisbursement: false } }
    });
    await recordAuditLog(req, "BROKER_FINANCING_STAGE_CHANGED", "operation_financing", record.id, { from: transition.current, to: transition.next });
    res.json(record);
  } catch (error) {
    console.error("Update broker financing stage error:", error);
    res.status(500).json({ error: "No se pudo actualizar la etapa de financiamiento." });
  }
});

brokerRouter.get("/broker/ai-evaluations", requireBrokerAction("ai", "VIEW"), async (req, res) => {
  try {
    const records = await prisma.industryRecord.findMany({
      where: brokerWhere(req, { recordType: "broker_agent_evaluation" }),
      include: { assignedTo: { select: { id: true, name: true, email: true, role: true } } },
      orderBy: { updatedAt: "desc" },
      take: 200
    });
    res.json({ scenarios: BROKER_AGENT_SCENARIOS, evaluations: records.map(evaluationPayload), automationRules: BROKER_AUTOMATION_RULES });
  } catch (error) {
    console.error("List broker AI evaluations error:", error);
    res.status(500).json({ error: "No se pudieron obtener las evaluaciones de los agentes." });
  }
});

// Genera alertas internas, idempotentes y revisables. No envía mensajes, no
// publica inmuebles y no ejecuta acciones externas. La ejecución puede ser
// invocada desde la interfaz o por un trabajo programado autorizado.
brokerRouter.post("/broker/automation-scan", requireRole(ROLE_GROUPS.STAFF), requireBrokerAction("ai", "APPROVE"), async (req, res) => {
  try {
    const [properties, operations, maintenance, postSale, financing, brokerRecords, existingAlerts] = await Promise.all([
      prisma.industryRecord.findMany({ where: brokerWhere(req, { recordType: "property" }), take: 500 }),
      prisma.industryRecord.findMany({ where: brokerWhere(req, { recordType: "broker_operation" }), take: 500 }),
      prisma.industryRecord.count({ where: brokerWhere(req, { recordType: "maintenance_ticket", status: { notIn: ["CLOSED", "CANCELLED", "COMPLETED"] } }) }),
      prisma.industryRecord.count({ where: brokerWhere(req, { recordType: "post_sale_case", status: { notIn: ["CLOSED", "RESOLVED"] } }) }),
      prisma.industryRecord.count({ where: brokerWhere(req, { recordType: "operation_financing", status: { notIn: ["CIERRE", "RECHAZADO", "CANCELADO"] } }) }),
      prisma.industryRecord.findMany({ where: brokerWhere(req, { recordType: { in: BROKER_RECORD_TYPES } }), take: 1000 }),
      prisma.industryRecord.findMany({ where: brokerWhere(req, { recordType: "realty_alert", status: { not: "RESOLVED" } }), take: 500 })
    ]);
    const recommendations = brokerRecommendations({ properties, operations, maintenance, postSale, financing, brokerRecords });
    const fingerprints = new Set(existingAlerts.map((item) => text(dataOf(item).automationKey)));
    const created = [];
    for (const recommendation of recommendations) {
      const automationKey = `broker:${recommendation.id}:${recommendation.propertyId || recommendation.operationId || "tenant"}`;
      if (fingerprints.has(automationKey)) continue;
      const record = await prisma.industryRecord.create({
        data: {
          tenantId: req.tenantId,
          recordType: "realty_alert",
          title: recommendation.title,
          status: "OPEN",
          data: { ...recommendation, automationKey, source: "broker_automation_scan", requiresHumanApproval: Boolean(recommendation.requiresApproval), externalActionExecuted: false }
        }
      });
      created.push(record);
    }
    await recordAuditLog(req, "BROKER_AUTOMATION_SCAN", "realty_alert", req.tenantId, { recommendations: recommendations.length, created: created.length });
    res.json({ recommendations, created, message: created.length ? "Se crearon alertas internas para revisión." : "No se detectaron alertas nuevas." });
  } catch (error) {
    console.error("Broker automation scan error:", error);
    res.status(500).json({ error: "No se pudo ejecutar la revisión automática interna." });
  }
});

brokerRouter.post("/broker/ai-evaluations", requireRole(ROLE_GROUPS.STAFF), requireBrokerAction("ai", "APPROVE"), async (req, res) => {
  try {
    const scenario = brokerAgentScenario(req.body?.scenarioKey);
    if (!scenario) return res.status(400).json({ error: "El escenario de evaluación no existe." });
    const decision = text(req.body?.decision, "PENDING_REVIEW").toUpperCase();
    if (!["PENDING_REVIEW", "CONFIRMED", "ADJUSTMENT_NEEDED", "DISCARDED"].includes(decision)) {
      return res.status(400).json({ error: "La decisión de evaluación no es válida." });
    }
    const now = new Date().toISOString();
    const title = `Evaluación IA: ${scenario.title}`;
    const existing = await prisma.industryRecord.findFirst({ where: brokerWhere(req, { recordType: "broker_agent_evaluation", title }) });
    const data = {
      scenarioKey: scenario.key,
      agentKey: scenario.agentKey,
      area: scenario.area,
      expectedRecommendation: scenario.expectedRecommendation,
      requiresHumanApproval: scenario.requiresHumanApproval,
      decision,
      outcome: text(req.body?.outcome),
      note: text(req.body?.note),
      reviewedAt: now,
      reviewedBy: req.user?.name || req.user?.email || "Usuario autorizado",
      source: "broker_os"
    };
    const record = existing
      ? await prisma.industryRecord.update({ where: { id: existing.id }, data: { status: decision, data } })
      : await prisma.industryRecord.create({ data: { tenantId: req.tenantId, recordType: "broker_agent_evaluation", title, status: decision, data } });
    await recordAuditLog(req, "BROKER_AGENT_EVALUATION_RECORDED", "broker_agent_evaluation", record.id, { scenarioKey: scenario.key, decision });
    res.status(existing ? 200 : 201).json(evaluationPayload(record));
  } catch (error) {
    console.error("Create broker AI evaluation error:", error);
    res.status(500).json({ error: "No se pudo guardar la evaluación del agente." });
  }
});

brokerRouter.get("/broker/operations", requireBrokerAction("operations", "VIEW"), async (req, res) => {
  try {
    const type = req.query.type ? normalizeBrokerOperationType(req.query.type) : null;
    if (req.query.type && !type) return res.status(400).json({ error: "Tipo de operación inválido." });
    const records = await prisma.industryRecord.findMany({
      where: brokerWhere(req, { recordType: "broker_operation" }),
      include: { assignedTo: { select: { id: true, name: true, email: true, role: true } } },
      orderBy: { updatedAt: "desc" },
      take: Math.min(Number(req.query.limit || 200), 500)
    });
    const operations = records.map(operationPayload).filter((item) => !type || item.data.operationType === type);
    res.json(operations);
  } catch (error) {
    console.error("List broker operations error:", error);
    res.status(500).json({ error: "No se pudieron obtener las operaciones." });
  }
});

brokerRouter.post("/broker/operations", requireRole(ROLE_GROUPS.STAFF), requireBrokerAction("operations", "CREATE"), async (req, res) => {
  try {
    const title = text(req.body?.title);
    const operationType = normalizeBrokerOperationType(req.body?.operationType);
    if (!title || !operationType) return res.status(400).json({ error: "Nombre y tipo de operación son requeridos." });
    const propertyId = text(req.body?.propertyId);
    await assertRelatedProperty(req, propertyId);
    const requestedAssignment = text(req.body?.assignedToId);
    const assignedToId = requestedAssignment || (Array.isArray(req.brokerAccess?.scopeUserIds) ? req.user?.id : null);
    if (requestedAssignment && requestedAssignment !== req.user?.id && !canBrokerAction(req.brokerAccess, "operations", "ASSIGN")) return res.status(403).json({ error: "No puedes asignar esta operación a otro usuario." });
    await assertAssignedUser(req, assignedToId);
    const stages = stagesForBrokerOperation(operationType);
    const stage = normalizeBrokerStage(operationType, text(req.body?.stage, stages[0]));
    if (!stages.includes(stage)) return res.status(400).json({ error: "La etapa inicial no pertenece a este flujo." });
    const now = new Date().toISOString();
    const record = await prisma.industryRecord.create({
      data: {
        tenantId: req.tenantId,
        recordType: "broker_operation",
        title,
        status: "ACTIVE",
        assignedToId: assignedToId || null,
        data: {
          ...(dataOf({ data: req.body?.data })),
          operationType,
          propertyId: propertyId || null,
          buyerId: text(req.body?.buyerId) || null,
          stage,
          checklist: brokerStageChecklist(operationType, stage),
          timeline: [{ at: now, type: "OPERATION_CREATED", stage, note: "Operación creada" }]
        }
      },
      include: { assignedTo: { select: { id: true, name: true, email: true, role: true } } }
    });
    await recordAuditLog(req, "BROKER_OPERATION_CREATED", "broker_operation", record.id, { operationType, stage, propertyId: propertyId || null });
    res.status(201).json(operationPayload(record));
  } catch (error) {
    if (error?.message?.includes("propiedad relacionada") || error?.message?.includes("usuario asignado")) return res.status(400).json({ error: error.message });
    console.error("Create broker operation error:", error);
    res.status(500).json({ error: "No se pudo crear la operación." });
  }
});

brokerRouter.patch("/broker/operations/:id/stage", requireRole(ROLE_GROUPS.STAFF), requireBrokerAction("operations", "EDIT"), async (req, res) => {
  try {
    const existing = await prisma.industryRecord.findFirst({ where: brokerWhere(req, { id: req.params.id, recordType: "broker_operation" }) });
    if (!existing) return res.status(404).json({ error: "Operación no encontrada." });
    const current = operationPayload(existing);
    const transition = validateBrokerStageTransition({ operationType: current.data.operationType, currentStage: current.data.stage, nextStage: req.body?.stage });
    if (!transition.ok) return res.status(422).json({ error: transition.error });
    const now = new Date().toISOString();
    const timeline = [...current.data.timeline, { at: now, type: "STAGE_CHANGED", from: transition.current, stage: transition.next, note: text(req.body?.note, `Etapa cambiada a ${transition.next}`) }];
    const record = await prisma.industryRecord.update({
      where: { id: existing.id },
      data: { status: transition.terminal ? "COMPLETED" : "ACTIVE", data: { ...current.data, stage: transition.next, checklist: brokerStageChecklist(current.data.operationType, transition.next), timeline } }
    });
    await recordAuditLog(req, "BROKER_OPERATION_STAGE_CHANGED", "broker_operation", record.id, { from: transition.current, to: transition.next });
    res.json(operationPayload(record));
  } catch (error) {
    console.error("Advance broker operation error:", error);
    res.status(500).json({ error: "No se pudo actualizar la etapa de la operación." });
  }
});

brokerRouter.post("/broker/operations/:id/timeline", requireRole(ROLE_GROUPS.STAFF), requireBrokerAction("operations", "EDIT"), async (req, res) => {
  try {
    const existing = await prisma.industryRecord.findFirst({ where: brokerWhere(req, { id: req.params.id, recordType: "broker_operation" }) });
    if (!existing) return res.status(404).json({ error: "Operación no encontrada." });
    const note = text(req.body?.note);
    if (!note) return res.status(400).json({ error: "Describe el evento que quieres registrar." });
    const operation = operationPayload(existing);
    const event = { at: new Date().toISOString(), type: text(req.body?.type, "NOTE").toUpperCase(), stage: operation.data.stage, note };
    const record = await prisma.industryRecord.update({ where: { id: existing.id }, data: { data: { ...operation.data, timeline: [...operation.data.timeline, event] } } });
    await recordAuditLog(req, "BROKER_OPERATION_EVENT_RECORDED", "broker_operation", record.id, event);
    res.status(201).json(operationPayload(record));
  } catch (error) {
    console.error("Create broker timeline event error:", error);
    res.status(500).json({ error: "No se pudo registrar el evento." });
  }
});

brokerRouter.get("/broker/records/:area", async (req, res) => {
  try {
    const area = String(req.params.area || "");
    if (!isBrokerRecordArea(area)) return res.status(404).json({ error: "Área operativa no encontrada." });
    if (!allowBrokerAreaAction(req, res, area, "VIEW")) return;
    const records = await prisma.industryRecord.findMany({
      where: brokerWhere(req, { recordType: { in: BROKER_RECORD_AREAS[area] } }),
      include: { assignedTo: { select: { id: true, name: true, email: true, role: true } } },
      orderBy: { updatedAt: "desc" },
      take: Math.min(Number(req.query.limit || 200), 500)
    });
    res.json(records);
  } catch (error) {
    console.error("List broker records error:", error);
    res.status(500).json({ error: "No se pudieron obtener los registros operativos." });
  }
});

brokerRouter.post("/broker/records", requireRole(ROLE_GROUPS.STAFF), async (req, res) => {
  try {
    const recordType = text(req.body?.recordType).toLowerCase();
    const title = text(req.body?.title);
    if (!BROKER_RECORD_TYPES.includes(recordType)) return res.status(400).json({ error: "Tipo de registro Broker no válido." });
    if (!title) return res.status(400).json({ error: "El nombre del registro es requerido." });
    const area = BROKER_RECORD_DEFINITIONS[recordType]?.area;
    if (!area || !allowBrokerAreaAction(req, res, area, "CREATE")) return;
    const requestedAssignment = text(req.body?.assignedToId);
    const assignedToId = requestedAssignment || (Array.isArray(req.brokerAccess?.scopeUserIds) ? req.user?.id : null);
    if (requestedAssignment && requestedAssignment !== req.user?.id && !canBrokerAction(req.brokerAccess, area, "ASSIGN")) return res.status(403).json({ error: "No puedes asignar este registro a otro usuario." });
    const recordData = { ...dataOf({ data: req.body?.data }) };
    const propertyId = text(recordData.propertyId || req.body?.propertyId);
    if (propertyId) recordData.propertyId = propertyId;
    const validation = validateBrokerRecord({ recordType, data: recordData, status: req.body?.status });
    if (!validation.ok) return res.status(422).json({ error: validation.error });
    await assertRelatedProperty(req, propertyId);
    await assertAssignedUser(req, assignedToId);
    const normalizedRecordData = recordType === "operation_financing"
      ? {
          ...recordData,
          stage: validation.status,
          checklist: brokerFinancingChecklist(validation.status),
          timeline: [{ at: new Date().toISOString(), type: "FINANCING_CREATED", stage: validation.status, note: "Solicitud registrada en Broker OS.", by: req.user?.name || req.user?.email || "Usuario autorizado" }],
          requiresHumanApproval: true,
          automaticDisbursement: false
        }
      : recordData;
    const record = await prisma.industryRecord.create({
      data: {
        tenantId: req.tenantId,
        recordType,
        title,
        status: validation.status,
        assignedToId: assignedToId || null,
        data: { ...normalizedRecordData, propertyId: propertyId || null, createdFrom: "broker_os" }
      },
      include: { assignedTo: { select: { id: true, name: true, email: true, role: true } } }
    });
    await recordAuditLog(req, "BROKER_RECORD_CREATED", recordType, record.id, { propertyId: propertyId || null, status: record.status });
    res.status(201).json(record);
  } catch (error) {
    if (error?.message?.includes("propiedad relacionada") || error?.message?.includes("usuario asignado")) return res.status(400).json({ error: error.message });
    console.error("Create broker record error:", error);
    res.status(500).json({ error: "No se pudo crear el registro operativo." });
  }
});

brokerRouter.patch("/broker/records/:id", requireRole(ROLE_GROUPS.STAFF), async (req, res) => {
  try {
    const existing = await prisma.industryRecord.findFirst({ where: brokerWhere(req, { id: req.params.id, recordType: { in: BROKER_RECORD_TYPES } }) });
    if (!existing) return res.status(404).json({ error: "Registro operativo no encontrado." });
    const area = BROKER_RECORD_DEFINITIONS[existing.recordType]?.area;
    if (!area || !allowBrokerAreaAction(req, res, area, "EDIT")) return;
    if (req.body?.assignedToId !== undefined && text(req.body.assignedToId) !== req.user?.id && !canBrokerAction(req.brokerAccess, area, "ASSIGN")) return res.status(403).json({ error: "No puedes reasignar este registro." });
    const nextData = req.body?.data === undefined
      ? dataOf(existing)
      : { ...dataOf(existing), ...dataOf({ data: req.body.data }) };
    const propertyId = text(nextData.propertyId);
    const nextStatus = req.body?.status === undefined ? existing.status : text(req.body.status, existing.status).toUpperCase();
    if (existing.recordType === "operation_financing" && req.body?.status !== undefined) {
      const transition = validateBrokerFinancingTransition({ currentStage: existing.status || dataOf(existing).stage, nextStage: nextStatus });
      if (!transition.ok) return res.status(422).json({ error: transition.error });
      const requiredAction = brokerFinancingActionForStage(transition.next);
      if (!canBrokerAction(req.brokerAccess, "financing", requiredAction)) return res.status(403).json({ error: "No tienes permiso para confirmar esta etapa de financiamiento.", action: requiredAction, stage: transition.next });
      const timeline = Array.isArray(nextData.timeline) ? nextData.timeline : [];
      nextData.stage = transition.next;
      nextData.checklist = brokerFinancingChecklist(transition.next);
      nextData.timeline = [...timeline, { at: new Date().toISOString(), type: "FINANCING_STAGE", stage: transition.next, note: "Etapa actualizada desde la ficha operativa.", by: req.user?.name || req.user?.email || "Usuario autorizado" }];
      nextData.requiresHumanApproval = true;
      nextData.automaticDisbursement = false;
    }
    const validation = validateBrokerRecord({ recordType: existing.recordType, data: nextData, status: nextStatus });
    if (!validation.ok) return res.status(422).json({ error: validation.error });
    await assertRelatedProperty(req, propertyId);
    if (req.body?.assignedToId !== undefined) await assertAssignedUser(req, text(req.body.assignedToId));
    const record = await prisma.industryRecord.update({
      where: { id: existing.id },
      data: { title: req.body?.title === undefined ? existing.title : text(req.body.title, existing.title), status: validation.status, ...(req.body?.assignedToId === undefined ? {} : { assignedToId: text(req.body.assignedToId) || null }), data: nextData }
    });
    await recordAuditLog(req, "BROKER_RECORD_UPDATED", record.recordType, record.id, { status: record.status });
    res.json(record);
  } catch (error) {
    if (error?.message?.includes("propiedad relacionada") || error?.message?.includes("usuario asignado")) return res.status(400).json({ error: error.message });
    console.error("Update broker record error:", error);
    res.status(500).json({ error: "No se pudo actualizar el registro operativo." });
  }
});

brokerRouter.get("/broker/properties/:propertyId/expedient", requireBrokerAction("documents", "VIEW"), async (req, res) => {
  try {
    const property = await assertRelatedProperty(req, req.params.propertyId);
    const records = await prisma.industryRecord.findMany({
      where: brokerWhere(req, { recordType: { in: [...BROKER_RECORD_TYPES, "broker_operation", "visit", "realty_alert"] } }),
      orderBy: { updatedAt: "desc" },
      take: 500
    });
    const related = records.filter((record) => String(dataOf(record).propertyId || "") === property.id);
    const grouped = Object.fromEntries(Object.keys(BROKER_RECORD_AREAS).map((area) => [area, related.filter((record) => BROKER_RECORD_AREAS[area].includes(record.recordType))]));
    const health = propertyHealthSnapshot(property, related);
    const timeline = related
      .flatMap((record) => {
        const data = dataOf(record);
        const events = record.recordType === "broker_operation" && Array.isArray(data.timeline)
          ? data.timeline.map((event) => ({ at: text(event?.at, record.updatedAt?.toISOString?.() || ""), title: record.title, type: text(event?.type, "EVENT"), note: text(event?.note), recordType: record.recordType, status: text(event?.stage || record.status) }))
          : [{ at: record.updatedAt?.toISOString?.() || "", title: record.title, type: record.recordType, note: "Registro actualizado en expediente.", recordType: record.recordType, status: record.status }];
        return events;
      })
      .sort((a, b) => String(b.at).localeCompare(String(a.at)))
      .slice(0, 50);
    const propertyData = dataOf(property);
    const journey = {
      property: {
        title: property.title,
        comuna: text(propertyData.comuna || propertyData.commune),
        precio: propertyData.price ?? null,
        estado: property.status
      },
      people: {
        propietarios: [...new Set(related.filter((item) => item.recordType === "property_mandate").map((item) => text(dataOf(item).ownerName)).filter(Boolean))],
        interesados: [...new Set(related.filter((item) => ["property_offer", "rental_application", "property_promise"].includes(item.recordType)).map((item) => text(dataOf(item).buyerName || dataOf(item).tenantName)).filter(Boolean))]
      },
      control: {
        operaciones: related.filter((item) => item.recordType === "broker_operation").length,
        visitas: related.filter((item) => item.recordType === "visit").length,
        documentos: grouped.documents.length,
        consentimientos: grouped.documents.filter((item) => ["data_processing_consent", "communication_consent", "external_authorization"].includes(item.recordType)).length,
        ofertas: grouped.commercial.filter((item) => item.recordType === "property_offer").length,
        financiamientos: grouped.financing.filter((item) => item.recordType === "operation_financing").length,
        incidencias: grouped.maintenance.filter((item) => item.recordType === "maintenance_ticket").length,
        postventa: grouped.post_sale.filter((item) => ["post_sale_case", "warranty_case"].includes(item.recordType)).length,
        alertasAbiertas: related.filter((item) => item.recordType === "realty_alert" && item.status !== "RESOLVED").length
      }
    };
    res.json({
      property,
      records: related,
      grouped,
      completion: { missing: missingPropertyData(property), complete: missingPropertyData(property).length === 0 },
      health,
      timeline,
      journey
    });
  } catch (error) {
    if (error?.message?.includes("propiedad relacionada")) return res.status(404).json({ error: "Propiedad no encontrada." });
    console.error("Broker property expediente error:", error);
    res.status(500).json({ error: "No se pudo preparar el expediente de la propiedad." });
  }
});
