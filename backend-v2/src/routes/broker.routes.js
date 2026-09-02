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
  RENTAL_STAGES,
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
import { brokerRelationalCoverage, normalizeLegacyBrokerProperty } from "../services/broker-relational-data.service.js";
import { BROKER_CAPTURE_OPTIONS, captureReadiness, normalizeBrokerCapture, validateBrokerCapture } from "../services/broker-capture.service.js";
import { BROKER_SALE_OPTIONS, brokerSaleReadiness, normalizeBrokerSaleCase } from "../services/broker-sale.service.js";
import { BROKER_RENTAL_OPTIONS, brokerRentalReadiness, normalizeBrokerRentalCase } from "../services/broker-rental.service.js";
import { BROKER_MAINTENANCE_OPTIONS, brokerMaintenanceReadiness, brokerProjectReadiness, normalizeBrokerMaintenance, normalizeBrokerMaintenanceQuote, normalizeBrokerProject } from "../services/broker-maintenance-project.service.js";
import { BROKER_POST_SALE_OPTIONS, brokerPostSaleReadiness, normalizeBrokerHandover, normalizeBrokerInspection, normalizeBrokerPostSaleCase, normalizeBrokerWarrantyCase, postSaleStages } from "../services/broker-post-sale.service.js";
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

// Catálogo y ficha de captación: el proceso registra la visita, el análisis
// comercial y los antecedentes previos al mandato sin confundirlos con la
// publicación ni con una operación de venta/arriendo ya iniciada.
brokerRouter.get("/broker/captures/options", requireBrokerAction("commercial", "VIEW"), (_req, res) => {
  res.json(BROKER_CAPTURE_OPTIONS);
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

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(String(value).replace(/[^0-9,.-]/g, "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

function propertyDataFromCapture(input, capture) {
  const gallery = Array.isArray(capture.photoUrls) ? capture.photoUrls : [];
  return {
    ...input,
    operation: capture.intendedService.toLowerCase(),
    captureOrigin: capture.captureOrigin || input.captureOrigin || "",
    captureDate: capture.firstContactAt?.toISOString?.() || input.captureDate || "",
    siteVisitAt: capture.siteVisitAt?.toISOString?.() || "",
    ownerExpectedPrice: capture.ownerExpectedPrice,
    suggestedPrice: capture.suggestedPrice,
    preliminaryAppraisal: capture.preliminaryAppraisal,
    marketAnalysisAt: capture.marketAnalysisAt?.toISOString?.() || "",
    comparableSummary: capture.comparableSummary || "",
    ownerAcceptedEvaluationAt: capture.ownerAcceptedEvaluationAt?.toISOString?.() || "",
    preliminaryTitleStatus: capture.preliminaryTitleStatus,
    titleReviewNotes: capture.titleReviewNotes || "",
    regularizationStatus: capture.regularizationStatus,
    irregularConstructionNote: capture.irregularConstructionNote || "",
    ownershipStatus: capture.ownershipStatus,
    propertyConditionAtHandover: capture.propertyConditionAtHandover || "",
    kitchenType: capture.kitchenType || "",
    heatingSystem: capture.heatingSystem || "",
    gasSystem: capture.gasSystem || "",
    buildingFloors: capture.buildingFloors,
    unitsPerFloor: capture.unitsPerFloor,
    elevators: capture.elevators,
    commonExpenses: capture.commonExpenses,
    commonAreas: capture.commonAreas || [],
    floorPlanUrl: capture.floorPlanUrl || "",
    documentChecklist: capture.documentChecklist || [],
    publicationReadiness: capture.publicationReadiness,
    captureStatus: capture.status,
    gallery: gallery.length ? gallery : (Array.isArray(input.gallery) ? input.gallery : []),
    photoUrl: gallery[0] || text(input.photoUrl),
    videoUrls: capture.videoUrls || [],
    videoUrl: (capture.videoUrls || [])[0] || text(input.videoUrl),
  };
}

async function ensureBrokerCaptureProperty(db, { tenantId, property, propertyData }) {
  const normalized = normalizeLegacyBrokerProperty({ ...property, data: propertyData });
  if (normalized.errors.length) throw new Error(normalized.errors.join(" "));
  const ownerData = normalized.owner;
  const owner = ownerData.rut
    ? await db.brokerOwner.upsert({
      where: { tenantId_rut: { tenantId, rut: ownerData.rut } },
      create: { tenantId, ...ownerData },
      update: { name: ownerData.name, phone: ownerData.phone || null, email: ownerData.email || null }
    })
    : await db.brokerOwner.findFirst({ where: { tenantId, name: ownerData.name } }) || await db.brokerOwner.create({ data: { tenantId, ...ownerData } });

  const strictData = {
    ...normalized.property,
    usableSquareMeters: numberOrNull(propertyData.usableSquareMeters ?? propertyData.builtM2 ?? propertyData.meters),
    totalSquareMeters: numberOrNull(propertyData.totalSquareMeters ?? propertyData.landM2 ?? propertyData.meters),
    askingPrice: numberOrNull(propertyData.price ?? propertyData.suggestedPrice),
    conservationStatus: text(propertyData.conservationStatus || propertyData.propertyConditionAtHandover) || null,
    siiAssessmentRole: text(propertyData.siiAssessmentRole) || null,
    cbrInscription: text(propertyData.cbrInscription) || null,
    coverImageUrl: text(propertyData.photoUrl) || null,
    metadata: normalized.property.metadata,
  };
  const existing = await db.brokerProperty.findUnique({ where: { legacyRecordId: property.id } });
  if (existing) return db.brokerProperty.update({ where: { id: existing.id }, data: { ...strictData, ownerId: owner.id, assignedBrokerId: property.assignedToId || null } });
  return db.brokerProperty.create({ data: { tenantId, ownerId: owner.id, legacyRecordId: property.id, ...strictData } });
}

function capturePayload(property, capture) {
  const propertyData = dataOf(property);
  const merged = { ...propertyData, ...(capture || {}) };
  return {
    property,
    capture: capture ? { ...capture, readiness: captureReadiness({ ...merged, ...capture }) } : null,
    readiness: captureReadiness(merged),
    options: BROKER_CAPTURE_OPTIONS,
  };
}

brokerRouter.get("/broker/properties/:propertyId/capture", requireBrokerAction("commercial", "VIEW"), async (req, res) => {
  try {
    const property = await assertRelatedProperty(req, req.params.propertyId);
    const strictProperty = await prisma.brokerProperty.findUnique({ where: { legacyRecordId: property.id }, include: { capture: true } });
    res.json(capturePayload(property, strictProperty?.capture || null));
  } catch (error) {
    if (error?.message?.includes("propiedad relacionada")) return res.status(404).json({ error: "Propiedad no encontrada." });
    console.error("Get broker capture error:", error);
    res.status(500).json({ error: "No se pudo cargar la ficha de captación." });
  }
});

async function persistBrokerCapture(req, { property, rawInput, created = false }) {
  const baseData = dataOf(property);
  const raw = { ...baseData, ...rawInput };
  const ownerName = text(raw.ownerName);
  const address = text(raw.address);
  const comuna = text(raw.comuna || raw.commune);
  const propertyType = text(raw.propertyType);
  if (!ownerName) throw new Error("Indica el nombre del propietario para iniciar la captación.");
  if (!address || !comuna || !propertyType) throw new Error("La ficha requiere dirección, comuna y tipo de propiedad.");

  const captureValidation = validateBrokerCapture(raw);
  if (!captureValidation.ok) throw new Error(captureValidation.errors.join(" "));
  const capture = captureValidation.normalized;
  const requestedAssignment = text(raw.assignedToId || capture.captureBrokerId);
  const assignedToId = requestedAssignment || (Array.isArray(req.brokerAccess?.scopeUserIds) ? req.user?.id : null);
  if (requestedAssignment && requestedAssignment !== req.user?.id && !canBrokerAction(req.brokerAccess, "commercial", "ASSIGN")) throw new Error("No puedes asignar esta captación a otro usuario.");
  await assertAssignedUser(req, assignedToId);

  const propertyData = propertyDataFromCapture({ ...raw, assignedBrokerId: assignedToId, assignedBrokerName: raw.assignedBrokerName || "" }, { ...capture, captureBrokerId: assignedToId || null });
  const saved = await prisma.$transaction(async (db) => {
    const updatedProperty = await db.industryRecord.update({
      where: { id: property.id },
      data: {
        title: text(raw.title, property.title),
        assignedToId: assignedToId || null,
        status: capture.status === "DESCARTADA" ? "ARCHIVED" : "ACTIVE",
        data: propertyData
      }
    });
    const strictProperty = await ensureBrokerCaptureProperty(db, { tenantId: req.tenantId, property: updatedProperty, propertyData });
    const savedCapture = await db.brokerPropertyCapture.upsert({
      where: { propertyId: strictProperty.id },
      create: { tenantId: req.tenantId, propertyId: strictProperty.id, ...capture, captureBrokerId: assignedToId || null },
      update: { ...capture, captureBrokerId: assignedToId || null }
    });
    const ownerRecord = await db.industryRecord.findFirst({ where: { tenantId: req.tenantId, recordType: "owner", title: ownerName } });
    if (!ownerRecord) await db.industryRecord.create({ data: { tenantId: req.tenantId, recordType: "owner", title: ownerName, status: "ACTIVE", data: { phone: text(raw.ownerPhone), email: text(raw.ownerEmail), rut: text(raw.ownerRut), propertyId: updatedProperty.id, propertyTitle: updatedProperty.title, source: "captacion_broker" } } });
    return { property: updatedProperty, capture: savedCapture };
  });
  await recordAuditLog(req, created ? "BROKER_CAPTURE_CREATED" : "BROKER_CAPTURE_UPDATED", "broker_property_capture", saved.capture.id, { propertyId: saved.property.id, status: saved.capture.status, readiness: captureValidation.readiness.score });
  return capturePayload(saved.property, saved.capture);
}

async function ensureBrokerSaleBuyer(db, { tenantId, buyerId, buyerName }) {
  const requestedId = text(buyerId);
  if (requestedId) {
    const existingById = await db.brokerBuyer.findFirst({ where: { id: requestedId, tenantId } });
    if (existingById) return existingById;
  }
  const name = text(buyerName);
  if (!name) return null;
  const existingByName = await db.brokerBuyer.findFirst({ where: { tenantId, name }, orderBy: { updatedAt: "desc" } });
  if (existingByName) return existingByName;
  return db.brokerBuyer.create({ data: { tenantId, name, status: "INTERESADO" } });
}

async function ensureBrokerSaleCase(db, { tenantId, operation, property, buyerId, buyerName }) {
  const propertyData = dataOf(property);
  const strictProperty = await ensureBrokerCaptureProperty(db, { tenantId, property, propertyData });
  const buyer = await ensureBrokerSaleBuyer(db, { tenantId, buyerId, buyerName });
  const operationData = dataOf(operation);
  const stage = normalizeBrokerStage("SALE", operationData.stage || SALE_STAGES[0]);
  return db.brokerSaleCase.upsert({
    where: { operationId: operation.id },
    create: {
      tenantId,
      operationId: operation.id,
      propertyId: strictProperty.id,
      buyerId: buyer?.id || null,
      buyerName: text(buyerName || operationData.clientName) || null,
      currentStage: stage,
      currency: text(operationData.currency, "CLP").toUpperCase(),
      metadata: { source: "broker_operation", createdFrom: "broker_os" },
    },
    update: {
      propertyId: strictProperty.id,
      ...(buyer ? { buyerId: buyer.id } : {}),
      ...(text(buyerName || operationData.clientName) ? { buyerName: text(buyerName || operationData.clientName) } : {}),
      currentStage: stage,
    },
  });
}

async function ensureBrokerLeaseTenant(db, { tenantId, leaseTenantId, tenantName, input = {} }) {
  const requestedId = text(leaseTenantId);
  if (requestedId) {
    const existingById = await db.brokerLeaseTenant.findFirst({ where: { id: requestedId, tenantId } });
    if (existingById) return existingById;
  }
  const name = text(tenantName);
  if (!name) return null;
  const existingByName = await db.brokerLeaseTenant.findFirst({ where: { tenantId, name }, orderBy: { updatedAt: "desc" } });
  if (existingByName) return existingByName;
  return db.brokerLeaseTenant.create({
    data: {
      tenantId,
      name,
      rut: text(input.rut) || null,
      phone: text(input.phone) || null,
      email: text(input.email) || null,
      taxEvaluationStatus: text(input.applicantTaxStatus || input.taxEvaluationStatus, "PENDIENTE").toUpperCase(),
      declaredIncome: input.declaredIncome === "" || input.declaredIncome === undefined ? null : Number(input.declaredIncome) || null,
      guarantorName: text(input.guarantorName) || null,
    }
  });
}

async function ensureBrokerRentalCase(db, { tenantId, operation, property, leaseTenantId, tenantName, input = {} }) {
  const propertyData = dataOf(property);
  const strictProperty = await ensureBrokerCaptureProperty(db, { tenantId, property, propertyData });
  const leaseTenant = await ensureBrokerLeaseTenant(db, { tenantId, leaseTenantId, tenantName, input });
  const operationData = dataOf(operation);
  const stage = normalizeBrokerStage("RENTAL", operationData.stage || RENTAL_STAGES[0]);
  return db.brokerRentalCase.upsert({
    where: { operationId: operation.id },
    create: {
      tenantId,
      operationId: operation.id,
      propertyId: strictProperty.id,
      leaseTenantId: leaseTenant?.id || null,
      tenantName: text(tenantName || operationData.clientName) || null,
      currentStage: stage,
      currency: text(operationData.currency, "CLP").toUpperCase(),
      metadata: { source: "broker_operation", createdFrom: "broker_os" },
    },
    update: {
      propertyId: strictProperty.id,
      ...(leaseTenant ? { leaseTenantId: leaseTenant.id } : {}),
      ...(text(tenantName || operationData.clientName) ? { tenantName: text(tenantName || operationData.clientName) } : {}),
      currentStage: stage,
    },
  });
}

async function brokerSaleContext(req, operation) {
  const operationData = dataOf(operation);
  const propertyId = text(operationData.propertyId);
  if (!propertyId) throw new Error("La operación de venta debe tener una propiedad asociada.");
  const property = await assertRelatedProperty(req, propertyId);
  const saleCase = await prisma.$transaction((db) => ensureBrokerSaleCase(db, {
    tenantId: req.tenantId,
    operation,
    property,
    buyerId: operationData.buyerId,
    buyerName: operationData.clientName,
  }));
  const [strictProperty, relatedRecords] = await Promise.all([
    prisma.brokerProperty.findUnique({ where: { id: saleCase.propertyId }, include: { capture: true } }),
    prisma.industryRecord.findMany({
      where: brokerWhere(req, { recordType: { in: [...BROKER_RECORD_TYPES, "visit"] } }),
      orderBy: { updatedAt: "desc" },
      take: 500,
    }),
  ]);
  const related = relatedRecords.filter((record) => String(dataOf(record).propertyId || "") === property.id);
  const currentIndex = SALE_STAGES.indexOf(normalizeBrokerStage("SALE", operationData.stage || SALE_STAGES[0]));
  const nextStage = SALE_STAGES[currentIndex + 1] || null;
  return {
    operation: operationPayload(operation),
    property,
    saleCase,
    capture: strictProperty?.capture || null,
    relatedRecords: related,
    nextStage,
    readiness: nextStage ? brokerSaleReadiness({ targetStage: nextStage, saleCase, capture: strictProperty?.capture || null, relatedRecords: related }) : { requirements: [], ready: true, missing: [] },
  };
}

function brokerSalePayload(context) {
  return {
    operation: context.operation,
    property: context.property,
    saleCase: context.saleCase,
    capture: context.capture,
    nextStage: context.nextStage,
    readiness: context.readiness,
    options: BROKER_SALE_OPTIONS,
  };
}

async function brokerRentalContext(req, operation) {
  const operationData = dataOf(operation);
  const propertyId = text(operationData.propertyId);
  if (!propertyId) throw new Error("La operación de arriendo debe tener una propiedad asociada.");
  const property = await assertRelatedProperty(req, propertyId);
  const rentalCase = await prisma.$transaction((db) => ensureBrokerRentalCase(db, {
    tenantId: req.tenantId,
    operation,
    property,
    leaseTenantId: operationData.leaseTenantId,
    tenantName: operationData.clientName,
  }));
  const [strictProperty, relatedRecords] = await Promise.all([
    prisma.brokerProperty.findUnique({ where: { id: rentalCase.propertyId }, include: { capture: true } }),
    prisma.industryRecord.findMany({
      where: brokerWhere(req, { recordType: { in: [...BROKER_RECORD_TYPES, "visit"] } }),
      orderBy: { updatedAt: "desc" },
      take: 500,
    }),
  ]);
  const related = relatedRecords.filter((record) => String(dataOf(record).propertyId || "") === property.id);
  const currentIndex = RENTAL_STAGES.indexOf(normalizeBrokerStage("RENTAL", operationData.stage || RENTAL_STAGES[0]));
  const nextStage = RENTAL_STAGES[currentIndex + 1] || null;
  return {
    operation: operationPayload(operation),
    property,
    rentalCase,
    capture: strictProperty?.capture || null,
    relatedRecords: related,
    nextStage,
    readiness: nextStage ? brokerRentalReadiness({ targetStage: nextStage, rentalCase, capture: strictProperty?.capture || null, relatedRecords: related }) : { requirements: [], ready: true, missing: [] },
  };
}

function brokerRentalPayload(context) {
  return {
    operation: context.operation,
    property: context.property,
    rentalCase: context.rentalCase,
    capture: context.capture,
    nextStage: context.nextStage,
    readiness: context.readiness,
    options: BROKER_RENTAL_OPTIONS,
  };
}

async function ensureBrokerProvider(db, { tenantId, providerId, providerName }) {
  const requestedId = text(providerId);
  if (requestedId) {
    const existing = await db.brokerProvider.findFirst({ where: { id: requestedId, tenantId } });
    if (existing) return existing;
  }
  const name = text(providerName);
  if (!name) return null;
  const existing = await db.brokerProvider.findFirst({ where: { tenantId, name }, orderBy: { updatedAt: "desc" } });
  if (existing) return existing;
  return db.brokerProvider.create({ data: { tenantId, name, status: "ACTIVO" } });
}

async function syncBrokerProvidersFromRecords(tenantId) {
  const records = await prisma.industryRecord.findMany({ where: { tenantId, recordType: "service_provider" }, take: 300, orderBy: { updatedAt: "desc" } });
  await Promise.all(records.map(async (record) => {
    const data = dataOf(record);
    const name = text(data.providerName || record.title);
    if (!name) return;
    const existing = await prisma.brokerProvider.findUnique({ where: { legacyRecordId: record.id } });
    const providerData = { name, contactName: text(data.contactName) || null, phone: text(data.phone) || null, email: text(data.email) || null, specialties: data.specialty ? [text(data.specialty)] : Array.isArray(data.specialties) ? data.specialties : null, averageRating: data.rating === undefined || data.rating === "" ? null : Number(data.rating) || null, status: text(record.status, "ACTIVO").toUpperCase() === "SUSPENDED" ? "INACTIVO" : "ACTIVO" };
    if (existing) await prisma.brokerProvider.update({ where: { id: existing.id }, data: providerData });
    else await prisma.brokerProvider.create({ data: { tenantId, legacyRecordId: record.id, ...providerData } });
  }));
}

async function ensureBrokerMaintenance(db, { tenantId, record }) {
  const existing = await db.brokerMaintenance.findUnique({ where: { legacyRecordId: record.id } });
  if (existing) return existing;
  const data = dataOf(record);
  const propertyId = text(data.propertyId);
  if (!propertyId) throw new Error("La mantención debe tener una propiedad asociada.");
  const property = await db.industryRecord.findFirst({ where: { id: propertyId, tenantId, recordType: "property" } });
  if (!property) throw new Error("La mantención no tiene una propiedad válida.");
  const strictProperty = await ensureBrokerCaptureProperty(db, { tenantId, property, propertyData: dataOf(property) });
  const normalized = normalizeBrokerMaintenance({ ...data, category: data.category || "General", description: data.description || record.title, workflowStage: data.workflowStage || "REPORTE" });
  const provider = await ensureBrokerProvider(db, { tenantId, providerId: data.providerId, providerName: data.providerName });
  return db.brokerMaintenance.create({ data: { tenantId, propertyId: strictProperty.id, providerId: provider?.id || null, legacyRecordId: record.id, ...normalized, reportedAt: data.reportedAt ? new Date(data.reportedAt) : new Date(), evidence: { source: "broker_record", demo: Boolean(data.demo) } } });
}

async function brokerMaintenanceContext(req, record) {
  await syncBrokerProvidersFromRecords(req.tenantId);
  const maintenance = await prisma.$transaction((db) => ensureBrokerMaintenance(db, { tenantId: req.tenantId, record }));
  const [quotes, providers] = await Promise.all([
    prisma.brokerMaintenanceQuote.findMany({ where: { tenantId: req.tenantId, maintenanceId: maintenance.id }, include: { provider: true }, orderBy: { updatedAt: "desc" } }),
    prisma.brokerProvider.findMany({ where: { tenantId: req.tenantId, status: { not: "INACTIVO" } }, orderBy: { name: "asc" }, take: 200 }),
  ]);
  const stages = BROKER_MAINTENANCE_OPTIONS.stages;
  const index = Math.max(0, stages.indexOf(maintenance.workflowStage));
  const nextStage = stages[index + 1] || null;
  return { record, maintenance, quotes, providers, nextStage, readiness: nextStage ? brokerMaintenanceReadiness({ targetStage: nextStage, maintenance, quotes }) : { requirements: [], ready: true, missing: [] } };
}

function brokerMaintenancePayload(context) {
  return { ...context, options: BROKER_MAINTENANCE_OPTIONS };
}

async function ensureBrokerProject(db, { tenantId, record }) {
  const existing = await db.brokerProject.findUnique({ where: { legacyRecordId: record.id } });
  if (existing) return existing;
  const data = dataOf(record);
  const propertyId = text(data.propertyId);
  if (!propertyId) throw new Error("El proyecto debe tener una propiedad asociada.");
  const property = await db.industryRecord.findFirst({ where: { id: propertyId, tenantId, recordType: "property" } });
  if (!property) throw new Error("El proyecto no tiene una propiedad válida.");
  const strictProperty = await ensureBrokerCaptureProperty(db, { tenantId, property, propertyData: dataOf(property) });
  const normalized = normalizeBrokerProject({ ...data, name: data.name || record.title, projectType: data.projectType || "Mejora de inmueble", status: data.status || "PLANIFICACION" });
  return db.brokerProject.create({ data: { tenantId, propertyId: strictProperty.id, legacyRecordId: record.id, ...normalized, metadata: { source: "broker_record", demo: Boolean(data.demo) } } });
}

async function brokerProjectContext(req, record) {
  const project = await prisma.$transaction((db) => ensureBrokerProject(db, { tenantId: req.tenantId, record }));
  const propertyId = text(dataOf(record).propertyId);
  const milestones = propertyId ? await prisma.industryRecord.findMany({ where: brokerWhere(req, { recordType: "project_milestone" }), orderBy: { updatedAt: "desc" }, take: 200 }).then((items) => items.filter((item) => text(dataOf(item).propertyId) === propertyId)) : [];
  const stages = BROKER_MAINTENANCE_OPTIONS.projectStatuses.filter((stage) => stage !== "CANCELADO");
  const index = Math.max(0, stages.indexOf(project.status));
  const nextStage = stages[index + 1] || null;
  return { record, project, milestones, nextStage, readiness: nextStage ? brokerProjectReadiness({ targetStage: nextStage, project }) : { requirements: [], ready: true, missing: [] } };
}

function brokerProjectPayload(context) {
  return { ...context, options: BROKER_MAINTENANCE_OPTIONS };
}

const POST_SALE_RECORD_KINDS = Object.freeze({
  property_inspection: "inspection",
  property_handover: "handover",
  post_sale_case: "case",
  warranty_case: "warranty",
});

function postSaleKind(record) {
  return POST_SALE_RECORD_KINDS[record?.recordType] || null;
}

function postSaleStageFromLegacy(kind, record, data) {
  const requested = text(data.workflowStage || data.stage).toUpperCase();
  if (postSaleStages(kind).includes(requested)) return requested;
  const legacy = text(record.status).toUpperCase();
  const maps = {
    inspection: { SCHEDULED: "PROGRAMACION", IN_PROGRESS: "INSPECCION", REQUIRES_ACTION: "CORRECCIONES", COMPLETED: "CERRADA" },
    handover: { SCHEDULED: "PROGRAMACION", PENDING_SIGNATURE: "FIRMA", OBSERVED: "INVENTARIO", COMPLETED: "CERRADA" },
    case: { OPEN: "INGRESO", IN_PROGRESS: "GESTION", WAITING_PROVIDER: "GESTION", RESOLVED: "RESOLUCION", CLOSED: "CERRADA" },
    warranty: { OPEN: "INGRESO", UNDER_REVIEW: "REVISION_COBERTURA", APPROVED: "RECLAMO", REJECTED: "RESOLUCION", RESOLVED: "CERRADA" },
  };
  return maps[kind]?.[legacy] || postSaleStages(kind)[0];
}

function legacyStatusForPostSale(kind, stage) {
  const maps = {
    inspection: { PROGRAMACION: "SCHEDULED", INSPECCION: "IN_PROGRESS", CORRECCIONES: "REQUIRES_ACTION", RECEPCION: "IN_PROGRESS", CERRADA: "COMPLETED" },
    handover: { PROGRAMACION: "SCHEDULED", INVENTARIO: "OBSERVED", FIRMA: "PENDING_SIGNATURE", ENTREGA: "IN_PROGRESS", CERRADA: "COMPLETED" },
    case: { INGRESO: "OPEN", DIAGNOSTICO: "IN_PROGRESS", GESTION: "WAITING_PROVIDER", RESOLUCION: "RESOLVED", CERRADA: "CLOSED" },
    warranty: { INGRESO: "OPEN", REVISION_COBERTURA: "UNDER_REVIEW", RECLAMO: "APPROVED", RESOLUCION: "UNDER_REVIEW", CERRADA: "RESOLVED" },
  };
  return maps[kind]?.[stage] || "OPEN";
}

function postSaleCheckpoints(kind) {
  return ({ inspection: ["inspeccion", "recepcion"], handover: ["inventario", "firma", "entrega"], case: ["diagnostico", "resolucion"], warranty: ["cobertura", "reclamo", "recepcion"] })[kind] || [];
}

function postSaleModel(kind) {
  return ({ inspection: "brokerInspection", handover: "brokerHandover", case: "brokerPostSaleCase", warranty: "brokerWarrantyCase" })[kind] || null;
}

function normalizePostSaleEntity(kind, input) {
  if (kind === "inspection") return normalizeBrokerInspection(input);
  if (kind === "handover") return normalizeBrokerHandover(input);
  if (kind === "case") return normalizeBrokerPostSaleCase(input);
  return normalizeBrokerWarrantyCase(input);
}

async function ensureBrokerPostSaleEntity(db, { tenantId, record }) {
  const kind = postSaleKind(record);
  const model = postSaleModel(kind);
  if (!kind || !model) throw new Error("El registro no corresponde a un control de postventa.");
  const existing = await db[model].findUnique({ where: { legacyRecordId: record.id } });
  if (existing) return { kind, entity: existing };
  const data = dataOf(record);
  const propertyId = text(data.propertyId);
  if (!propertyId) throw new Error("El control de postventa debe tener una propiedad asociada.");
  const property = await db.industryRecord.findFirst({ where: { id: propertyId, tenantId, recordType: "property" } });
  if (!property) throw new Error("El control de postventa no tiene una propiedad válida.");
  const strictProperty = await ensureBrokerCaptureProperty(db, { tenantId, property, propertyData: dataOf(property) });
  const workflowStage = postSaleStageFromLegacy(kind, record, data);
  const normalized = normalizePostSaleEntity(kind, { ...data, title: record.title, workflowStage, status: workflowStage });
  const base = { tenantId, propertyId: strictProperty.id, legacyRecordId: record.id, ...normalized, evidence: data.evidence && typeof data.evidence === "object" ? data.evidence : { source: "broker_record", demo: Boolean(data.demo) }, checkpoints: data.checkpoints && typeof data.checkpoints === "object" ? data.checkpoints : {} };
  if (kind === "inspection") return { kind, entity: await db.brokerInspection.create({ data: { ...base, checklist: data.checklist && typeof data.checklist === "object" ? data.checklist : { detalle: text(data.checklist) || "Pendiente" } } }) };
  if (kind === "handover") return { kind, entity: await db.brokerHandover.create({ data: base }) };
  if (kind === "case") return { kind, entity: await db.brokerPostSaleCase.create({ data: base }) };
  const relatedLegacyId = text(data.postSaleRecordId);
  const related = relatedLegacyId ? await db.brokerPostSaleCase.findUnique({ where: { legacyRecordId: relatedLegacyId } }) : null;
  return { kind, entity: await db.brokerWarrantyCase.create({ data: { ...base, postSaleCaseId: related?.id || null } }) };
}

async function brokerPostSaleContext(req, record) {
  const current = await prisma.$transaction((db) => ensureBrokerPostSaleEntity(db, { tenantId: req.tenantId, record }));
  const propertyId = text(dataOf(record).propertyId);
  const relatedRecords = propertyId ? await prisma.industryRecord.findMany({ where: brokerWhere(req, { recordType: { in: ["property_inspection", "property_handover", "post_sale_case", "warranty_case"] } }), orderBy: { updatedAt: "desc" }, take: 100 }).then((items) => items.filter((item) => text(dataOf(item).propertyId) === propertyId)) : [];
  const stages = postSaleStages(current.kind);
  const index = Math.max(0, stages.indexOf(current.entity.workflowStage));
  const nextStage = stages[index + 1] || null;
  return { record, kind: current.kind, entity: current.entity, relatedRecords, nextStage, readiness: nextStage ? brokerPostSaleReadiness({ kind: current.kind, targetStage: nextStage, entity: current.entity }) : { requirements: [], ready: true, missing: [] } };
}

function brokerPostSalePayload(context) {
  return { ...context, options: BROKER_POST_SALE_OPTIONS, checkpoints: postSaleCheckpoints(context.kind) };
}

async function updateBrokerPostSaleEntity(kind, id, data) {
  const model = postSaleModel(kind);
  return prisma[model].update({ where: { id }, data });
}

function postSaleRecordData(kind, record, entity) {
  const previous = dataOf(record);
  const common = { ...previous, workflowStage: entity.workflowStage, priority: entity.priority || previous.priority || "MEDIA", evidence: entity.evidence || previous.evidence || null };
  if (kind === "inspection") return { ...common, inspectionDate: entity.scheduledAt?.toISOString?.() || "", inspectorName: entity.inspectorName || "", conditionSummary: entity.conditionSummary || "", checklist: entity.checklist || {}, requiresAction: entity.requiresAction, actionPlan: entity.actionPlan || "", actionDueAt: entity.actionDueAt?.toISOString?.() || "" };
  if (kind === "handover") return { ...common, handoverDate: entity.scheduledAt?.toISOString?.() || "", recipientName: entity.recipientName || "", inventoryReference: entity.inventoryReference || "", actaReference: entity.actaReference || "" };
  if (kind === "case") return { ...common, description: entity.description, openedAt: entity.openedAt?.toISOString?.() || "", responsibleName: entity.responsibleName || "", diagnosis: entity.diagnosis || "", actionPlan: entity.actionPlan || "", responseDueAt: entity.responseDueAt?.toISOString?.() || "", resolution: entity.resolution || "" };
  return { ...common, description: entity.description, providerName: entity.providerName || "", warrantyUntil: entity.warrantyUntil?.toISOString?.() || "", coverageType: entity.coverageType, claimReference: entity.claimReference || "", resolution: entity.resolution || "" };
}

brokerRouter.post("/broker/captures", requireRole(ROLE_GROUPS.STAFF), requireBrokerAction("commercial", "CREATE"), async (req, res) => {
  try {
    const input = dataOf({ data: req.body });
    const title = text(input.title);
    if (!title) return res.status(400).json({ error: "Indica un nombre para la propiedad." });
    if (!text(input.ownerName) || !text(input.address) || !text(input.comuna || input.commune) || !text(input.propertyType)) {
      return res.status(400).json({ error: "La ficha requiere propietario, dirección, comuna y tipo de propiedad." });
    }
    const validation = validateBrokerCapture(input);
    if (!validation.ok) return res.status(422).json({ error: validation.errors.join(" ") });
    const preliminaryCapture = normalizeBrokerCapture(input);
    const property = await prisma.industryRecord.create({
      data: {
        tenantId: req.tenantId,
        recordType: "property",
        title,
        status: "ACTIVE",
        assignedToId: text(input.assignedToId || preliminaryCapture.captureBrokerId) || null,
        data: { ...input, captureStatus: preliminaryCapture.status, source: text(input.source, "captacion_broker") }
      }
    });
    const saved = await persistBrokerCapture(req, { property, rawInput: input, created: true });
    res.status(201).json(saved);
  } catch (error) {
    console.error("Create broker capture error:", error);
    res.status(422).json({ error: error?.message || "No se pudo crear la captación." });
  }
});

brokerRouter.put("/broker/properties/:propertyId/capture", requireRole(ROLE_GROUPS.STAFF), requireBrokerAction("commercial", "EDIT"), async (req, res) => {
  try {
    const property = await assertRelatedProperty(req, req.params.propertyId);
    const saved = await persistBrokerCapture(req, { property, rawInput: dataOf({ data: req.body }) });
    res.json(saved);
  } catch (error) {
    if (error?.message?.includes("propiedad relacionada")) return res.status(404).json({ error: "Propiedad no encontrada." });
    console.error("Update broker capture error:", error);
    res.status(422).json({ error: error?.message || "No se pudo actualizar la captación." });
  }
});

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
    if (["SALE", "RENTAL"].includes(operationType) && !propertyId) return res.status(400).json({ error: `Para iniciar un${operationType === "SALE" ? "a venta" : " arriendo"} asocia la propiedad que se comercializará.` });
    await assertRelatedProperty(req, propertyId);
    const requestedAssignment = text(req.body?.assignedToId);
    const assignedToId = requestedAssignment || (Array.isArray(req.brokerAccess?.scopeUserIds) ? req.user?.id : null);
    if (requestedAssignment && requestedAssignment !== req.user?.id && !canBrokerAction(req.brokerAccess, "operations", "ASSIGN")) return res.status(403).json({ error: "No puedes asignar esta operación a otro usuario." });
    await assertAssignedUser(req, assignedToId);
    const stages = stagesForBrokerOperation(operationType);
    const stage = normalizeBrokerStage(operationType, text(req.body?.stage, stages[0]));
    if (!stages.includes(stage)) return res.status(400).json({ error: "La etapa inicial no pertenece a este flujo." });
    const now = new Date().toISOString();
    const record = await prisma.$transaction(async (db) => {
      const created = await db.industryRecord.create({
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
      if (operationType === "SALE") {
        const property = await db.industryRecord.findUnique({ where: { id: propertyId } });
        await ensureBrokerSaleCase(db, { tenantId: req.tenantId, operation: created, property, buyerId: text(req.body?.buyerId), buyerName: text(dataOf({ data: req.body?.data }).clientName) });
      }
      if (operationType === "RENTAL") {
        const property = await db.industryRecord.findUnique({ where: { id: propertyId } });
        await ensureBrokerRentalCase(db, { tenantId: req.tenantId, operation: created, property, leaseTenantId: text(req.body?.leaseTenantId), tenantName: text(dataOf({ data: req.body?.data }).clientName), input: dataOf({ data: req.body?.data }) });
      }
      return created;
    });
    await recordAuditLog(req, "BROKER_OPERATION_CREATED", "broker_operation", record.id, { operationType, stage, propertyId: propertyId || null });
    res.status(201).json(operationPayload(record));
  } catch (error) {
    if (error?.message?.includes("propiedad relacionada") || error?.message?.includes("usuario asignado")) return res.status(400).json({ error: error.message });
    console.error("Create broker operation error:", error);
    res.status(500).json({ error: "No se pudo crear la operación." });
  }
});

brokerRouter.get("/broker/sales/:operationId", requireBrokerAction("operations", "VIEW"), async (req, res) => {
  try {
    const operation = await prisma.industryRecord.findFirst({ where: brokerWhere(req, { id: req.params.operationId, recordType: "broker_operation" }) });
    if (!operation) return res.status(404).json({ error: "Operación no encontrada." });
    if ((normalizeBrokerOperationType(dataOf(operation).operationType) || "SALE") !== "SALE") return res.status(422).json({ error: "La operación seleccionada no corresponde a una venta." });
    res.json(brokerSalePayload(await brokerSaleContext(req, operation)));
  } catch (error) {
    if (error?.message?.includes("propiedad asociada") || error?.message?.includes("propiedad relacionada")) return res.status(422).json({ error: error.message });
    console.error("Get broker sale case error:", error);
    res.status(500).json({ error: "No se pudo abrir el expediente de venta." });
  }
});

brokerRouter.put("/broker/sales/:operationId", requireRole(ROLE_GROUPS.STAFF), requireBrokerAction("operations", "EDIT"), async (req, res) => {
  try {
    const operation = await prisma.industryRecord.findFirst({ where: brokerWhere(req, { id: req.params.operationId, recordType: "broker_operation" }) });
    if (!operation) return res.status(404).json({ error: "Operación no encontrada." });
    if ((normalizeBrokerOperationType(dataOf(operation).operationType) || "SALE") !== "SALE") return res.status(422).json({ error: "La operación seleccionada no corresponde a una venta." });
    const context = await brokerSaleContext(req, operation);
    const incoming = dataOf({ data: req.body });
    const normalized = normalizeBrokerSaleCase({ ...context.saleCase, ...incoming });
    const buyer = await ensureBrokerSaleBuyer(prisma, { tenantId: req.tenantId, buyerId: normalized.buyerId, buyerName: normalized.buyerName });
    const saved = await prisma.brokerSaleCase.update({
      where: { id: context.saleCase.id },
      data: { ...normalized, buyerId: buyer?.id || null, reviewedById: context.saleCase.reviewedById || null, metadata: { ...(context.saleCase.metadata && typeof context.saleCase.metadata === "object" ? context.saleCase.metadata : {}), lastUpdatedBy: req.user?.id || null } },
    });
    await prisma.industryRecord.update({
      where: { id: operation.id },
      data: { data: { ...dataOf(operation), clientName: saved.buyerName || dataOf(operation).clientName || "", buyerId: saved.buyerId || dataOf(operation).buyerId || null } },
    });
    await recordAuditLog(req, "BROKER_SALE_CASE_UPDATED", "broker_sale_case", saved.id, { operationId: operation.id, stage: saved.currentStage });
    const refreshed = await brokerSaleContext(req, await prisma.industryRecord.findUnique({ where: { id: operation.id } }));
    res.json(brokerSalePayload(refreshed));
  } catch (error) {
    console.error("Update broker sale case error:", error);
    res.status(500).json({ error: "No se pudo actualizar el expediente de venta." });
  }
});

brokerRouter.post("/broker/sales/:operationId/confirmations", requireRole(ROLE_GROUPS.STAFF), requireBrokerAction("operations", "EDIT"), async (req, res) => {
  try {
    const operation = await prisma.industryRecord.findFirst({ where: brokerWhere(req, { id: req.params.operationId, recordType: "broker_operation" }) });
    if (!operation) return res.status(404).json({ error: "Operación no encontrada." });
    if ((normalizeBrokerOperationType(dataOf(operation).operationType) || "SALE") !== "SALE") return res.status(422).json({ error: "La operación seleccionada no corresponde a una venta." });
    const context = await brokerSaleContext(req, operation);
    const checkpoint = text(req.body?.checkpoint).toLowerCase();
    const allowedCheckpoints = new Set(["oferta", "promesa", "titulos", "escritura", "inscripcion", "entrega"]);
    if (!allowedCheckpoints.has(checkpoint)) return res.status(400).json({ error: "Hito de confirmación inválido." });
    const note = text(req.body?.note);
    const checkpoints = context.saleCase.checkpoints && typeof context.saleCase.checkpoints === "object" && !Array.isArray(context.saleCase.checkpoints) ? context.saleCase.checkpoints : {};
    const updated = await prisma.brokerSaleCase.update({
      where: { id: context.saleCase.id },
      data: {
        checkpoints: { ...checkpoints, [checkpoint]: { confirmedAt: new Date().toISOString(), confirmedBy: req.user?.name || req.user?.email || "Usuario autorizado", note } },
        reviewedById: req.user?.id || null,
        ...(checkpoint === "titulos" ? { titleStudyReviewedAt: new Date() } : {}),
      }
    });
    await recordAuditLog(req, "BROKER_SALE_CHECKPOINT_CONFIRMED", "broker_sale_case", updated.id, { operationId: operation.id, checkpoint, note });
    const refreshed = await brokerSaleContext(req, operation);
    res.json(brokerSalePayload(refreshed));
  } catch (error) {
    console.error("Confirm broker sale checkpoint error:", error);
    res.status(500).json({ error: "No se pudo confirmar el hito de venta." });
  }
});

brokerRouter.get("/broker/rentals/:operationId", requireBrokerAction("operations", "VIEW"), async (req, res) => {
  try {
    const operation = await prisma.industryRecord.findFirst({ where: brokerWhere(req, { id: req.params.operationId, recordType: "broker_operation" }) });
    if (!operation) return res.status(404).json({ error: "Operación no encontrada." });
    if ((normalizeBrokerOperationType(dataOf(operation).operationType) || "SALE") !== "RENTAL") return res.status(422).json({ error: "La operación seleccionada no corresponde a un arriendo." });
    res.json(brokerRentalPayload(await brokerRentalContext(req, operation)));
  } catch (error) {
    if (error?.message?.includes("propiedad asociada") || error?.message?.includes("propiedad relacionada")) return res.status(422).json({ error: error.message });
    console.error("Get broker rental case error:", error);
    res.status(500).json({ error: "No se pudo abrir el expediente de arriendo." });
  }
});

brokerRouter.put("/broker/rentals/:operationId", requireRole(ROLE_GROUPS.STAFF), requireBrokerAction("operations", "EDIT"), async (req, res) => {
  try {
    const operation = await prisma.industryRecord.findFirst({ where: brokerWhere(req, { id: req.params.operationId, recordType: "broker_operation" }) });
    if (!operation) return res.status(404).json({ error: "Operación no encontrada." });
    if ((normalizeBrokerOperationType(dataOf(operation).operationType) || "SALE") !== "RENTAL") return res.status(422).json({ error: "La operación seleccionada no corresponde a un arriendo." });
    const context = await brokerRentalContext(req, operation);
    const incoming = dataOf({ data: req.body });
    const normalized = normalizeBrokerRentalCase({ ...context.rentalCase, ...incoming });
    const leaseTenant = await ensureBrokerLeaseTenant(prisma, { tenantId: req.tenantId, leaseTenantId: normalized.leaseTenantId, tenantName: normalized.tenantName, input: normalized });
    const saved = await prisma.brokerRentalCase.update({
      where: { id: context.rentalCase.id },
      data: { ...normalized, leaseTenantId: leaseTenant?.id || null, reviewedById: context.rentalCase.reviewedById || null, metadata: { ...(context.rentalCase.metadata && typeof context.rentalCase.metadata === "object" ? context.rentalCase.metadata : {}), lastUpdatedBy: req.user?.id || null } },
    });
    await prisma.industryRecord.update({
      where: { id: operation.id },
      data: { data: { ...dataOf(operation), clientName: saved.tenantName || dataOf(operation).clientName || "", leaseTenantId: saved.leaseTenantId || dataOf(operation).leaseTenantId || null } },
    });
    await recordAuditLog(req, "BROKER_RENTAL_CASE_UPDATED", "broker_rental_case", saved.id, { operationId: operation.id, stage: saved.currentStage });
    const refreshed = await brokerRentalContext(req, await prisma.industryRecord.findUnique({ where: { id: operation.id } }));
    res.json(brokerRentalPayload(refreshed));
  } catch (error) {
    console.error("Update broker rental case error:", error);
    res.status(500).json({ error: "No se pudo actualizar el expediente de arriendo." });
  }
});

brokerRouter.post("/broker/rentals/:operationId/confirmations", requireRole(ROLE_GROUPS.STAFF), requireBrokerAction("operations", "EDIT"), async (req, res) => {
  try {
    const operation = await prisma.industryRecord.findFirst({ where: brokerWhere(req, { id: req.params.operationId, recordType: "broker_operation" }) });
    if (!operation) return res.status(404).json({ error: "Operación no encontrada." });
    if ((normalizeBrokerOperationType(dataOf(operation).operationType) || "SALE") !== "RENTAL") return res.status(422).json({ error: "La operación seleccionada no corresponde a un arriendo." });
    const context = await brokerRentalContext(req, operation);
    const checkpoint = text(req.body?.checkpoint).toLowerCase();
    const allowedCheckpoints = new Set(["evaluacion", "reserva", "contrato", "pago_inicial", "entrega"]);
    if (!allowedCheckpoints.has(checkpoint)) return res.status(400).json({ error: "Hito de confirmación inválido." });
    const note = text(req.body?.note);
    const checkpoints = context.rentalCase.checkpoints && typeof context.rentalCase.checkpoints === "object" && !Array.isArray(context.rentalCase.checkpoints) ? context.rentalCase.checkpoints : {};
    const updated = await prisma.brokerRentalCase.update({
      where: { id: context.rentalCase.id },
      data: {
        checkpoints: { ...checkpoints, [checkpoint]: { confirmedAt: new Date().toISOString(), confirmedBy: req.user?.name || req.user?.email || "Usuario autorizado", note } },
        reviewedById: req.user?.id || null,
        ...(checkpoint === "evaluacion" ? { applicationReviewedAt: new Date() } : {}),
      }
    });
    await recordAuditLog(req, "BROKER_RENTAL_CHECKPOINT_CONFIRMED", "broker_rental_case", updated.id, { operationId: operation.id, checkpoint, note });
    res.json(brokerRentalPayload(await brokerRentalContext(req, operation)));
  } catch (error) {
    console.error("Confirm broker rental checkpoint error:", error);
    res.status(500).json({ error: "No se pudo confirmar el hito de arriendo." });
  }
});

brokerRouter.get("/broker/maintenance/:recordId/workspace", requireBrokerAction("maintenance", "VIEW"), async (req, res) => {
  try {
    const record = await prisma.industryRecord.findFirst({ where: brokerWhere(req, { id: req.params.recordId, recordType: "maintenance_ticket" }) });
    if (!record) return res.status(404).json({ error: "Solicitud de mantención no encontrada." });
    res.json(brokerMaintenancePayload(await brokerMaintenanceContext(req, record)));
  } catch (error) {
    console.error("Get broker maintenance workspace error:", error);
    res.status(500).json({ error: error?.message || "No se pudo abrir el control de mantención." });
  }
});

brokerRouter.put("/broker/maintenance/:recordId/workspace", requireRole(ROLE_GROUPS.STAFF), requireBrokerAction("maintenance", "EDIT"), async (req, res) => {
  try {
    const record = await prisma.industryRecord.findFirst({ where: brokerWhere(req, { id: req.params.recordId, recordType: "maintenance_ticket" }) });
    if (!record) return res.status(404).json({ error: "Solicitud de mantención no encontrada." });
    const context = await brokerMaintenanceContext(req, record);
    const incoming = dataOf({ data: req.body });
    const normalized = normalizeBrokerMaintenance({ ...context.maintenance, ...incoming });
    const provider = await ensureBrokerProvider(prisma, { tenantId: req.tenantId, providerId: text(incoming.providerId), providerName: text(incoming.providerName) });
    const saved = await prisma.brokerMaintenance.update({ where: { id: context.maintenance.id }, data: { ...normalized, ...(provider ? { providerId: provider.id } : {}), evidence: context.maintenance.evidence || {}, } });
    const previous = dataOf(record);
    await prisma.industryRecord.update({ where: { id: record.id }, data: { status: saved.workflowStage === "CERRADA" ? "COMPLETED" : saved.workflowStage === "EJECUCION" ? "IN_PROGRESS" : previous.status, data: { ...previous, category: saved.category, description: saved.description, priority: saved.priority, providerId: provider?.id || previous.providerId || null, providerName: provider?.name || previous.providerName || "", workflowStage: saved.workflowStage, estimatedCost: saved.estimatedCost, actualCost: saved.actualCost } } });
    await recordAuditLog(req, "BROKER_MAINTENANCE_UPDATED", "broker_maintenance", saved.id, { recordId: record.id, stage: saved.workflowStage });
    res.json(brokerMaintenancePayload(await brokerMaintenanceContext(req, record)));
  } catch (error) {
    console.error("Update broker maintenance workspace error:", error);
    res.status(500).json({ error: error?.message || "No se pudo guardar el control de mantención." });
  }
});

brokerRouter.post("/broker/maintenance/:recordId/quotes", requireRole(ROLE_GROUPS.STAFF), requireBrokerAction("maintenance", "EDIT"), async (req, res) => {
  try {
    const record = await prisma.industryRecord.findFirst({ where: brokerWhere(req, { id: req.params.recordId, recordType: "maintenance_ticket" }) });
    if (!record) return res.status(404).json({ error: "Solicitud de mantención no encontrada." });
    const context = await brokerMaintenanceContext(req, record);
    const quote = normalizeBrokerMaintenanceQuote(dataOf({ data: req.body }));
    if (!quote.reference || quote.amount === null) return res.status(422).json({ error: "Indica referencia y monto de la cotización." });
    const provider = await ensureBrokerProvider(prisma, { tenantId: req.tenantId, providerId: quote.providerId, providerName: quote.providerName });
    if (!provider) return res.status(422).json({ error: "Indica el proveedor de la cotización." });
    const saved = await prisma.brokerMaintenanceQuote.create({ data: { tenantId: req.tenantId, maintenanceId: context.maintenance.id, providerId: provider.id, reference: quote.reference, scope: quote.scope, amount: quote.amount, currency: quote.currency, validUntil: quote.validUntil, status: quote.status } });
    await recordAuditLog(req, "BROKER_MAINTENANCE_QUOTE_CREATED", "broker_maintenance_quote", saved.id, { recordId: record.id, providerId: provider.id, amount: quote.amount });
    res.status(201).json(brokerMaintenancePayload(await brokerMaintenanceContext(req, record)));
  } catch (error) {
    console.error("Create broker maintenance quote error:", error);
    res.status(500).json({ error: error?.message || "No se pudo registrar la cotización." });
  }
});

brokerRouter.post("/broker/maintenance/:recordId/quotes/:quoteId/select", requireRole(ROLE_GROUPS.STAFF), requireBrokerAction("maintenance", "EDIT"), async (req, res) => {
  try {
    const record = await prisma.industryRecord.findFirst({ where: brokerWhere(req, { id: req.params.recordId, recordType: "maintenance_ticket" }) });
    if (!record) return res.status(404).json({ error: "Solicitud de mantención no encontrada." });
    const context = await brokerMaintenanceContext(req, record);
    const quote = await prisma.brokerMaintenanceQuote.findFirst({ where: { id: req.params.quoteId, tenantId: req.tenantId, maintenanceId: context.maintenance.id } });
    if (!quote) return res.status(404).json({ error: "Cotización no encontrada." });
    await prisma.$transaction([
      prisma.brokerMaintenanceQuote.updateMany({ where: { maintenanceId: context.maintenance.id, status: "SELECCIONADA" }, data: { status: "RECIBIDA", selectedAt: null } }),
      prisma.brokerMaintenanceQuote.update({ where: { id: quote.id }, data: { status: "SELECCIONADA", selectedAt: new Date() } }),
      prisma.brokerMaintenance.update({ where: { id: context.maintenance.id }, data: { providerId: quote.providerId || null, estimatedCost: quote.amount } }),
    ]);
    await recordAuditLog(req, "BROKER_MAINTENANCE_QUOTE_SELECTED", "broker_maintenance_quote", quote.id, { recordId: record.id });
    res.json(brokerMaintenancePayload(await brokerMaintenanceContext(req, record)));
  } catch (error) {
    console.error("Select broker maintenance quote error:", error);
    res.status(500).json({ error: "No se pudo seleccionar la cotización." });
  }
});

brokerRouter.post("/broker/maintenance/:recordId/confirmations", requireRole(ROLE_GROUPS.STAFF), requireBrokerAction("maintenance", "EDIT"), async (req, res) => {
  try {
    const record = await prisma.industryRecord.findFirst({ where: brokerWhere(req, { id: req.params.recordId, recordType: "maintenance_ticket" }) });
    if (!record) return res.status(404).json({ error: "Solicitud de mantención no encontrada." });
    const context = await brokerMaintenanceContext(req, record);
    const checkpoint = text(req.body?.checkpoint).toLowerCase();
    if (!new Set(["diagnostico", "aprobacion", "recepcion"]).has(checkpoint)) return res.status(400).json({ error: "Hito de confirmación inválido." });
    const checkpoints = context.maintenance.checkpoints && typeof context.maintenance.checkpoints === "object" && !Array.isArray(context.maintenance.checkpoints) ? context.maintenance.checkpoints : {};
    const saved = await prisma.brokerMaintenance.update({ where: { id: context.maintenance.id }, data: { checkpoints: { ...checkpoints, [checkpoint]: { confirmedAt: new Date().toISOString(), confirmedBy: req.user?.name || req.user?.email || "Usuario autorizado", note: text(req.body?.note) } }, ...(checkpoint === "aprobacion" ? { approvalStatus: "APROBADA", approvedAt: new Date() } : {}), ...(checkpoint === "recepcion" ? { acceptedAt: new Date() } : {}) } });
    await recordAuditLog(req, "BROKER_MAINTENANCE_CHECKPOINT_CONFIRMED", "broker_maintenance", saved.id, { recordId: record.id, checkpoint });
    res.json(brokerMaintenancePayload(await brokerMaintenanceContext(req, record)));
  } catch (error) {
    console.error("Confirm broker maintenance checkpoint error:", error);
    res.status(500).json({ error: "No se pudo confirmar el hito de mantención." });
  }
});

brokerRouter.patch("/broker/maintenance/:recordId/stage", requireRole(ROLE_GROUPS.STAFF), requireBrokerAction("maintenance", "EDIT"), async (req, res) => {
  try {
    const record = await prisma.industryRecord.findFirst({ where: brokerWhere(req, { id: req.params.recordId, recordType: "maintenance_ticket" }) });
    if (!record) return res.status(404).json({ error: "Solicitud de mantención no encontrada." });
    const context = await brokerMaintenanceContext(req, record);
    const target = text(req.body?.stage).toUpperCase();
    const stages = BROKER_MAINTENANCE_OPTIONS.stages;
    if (!stages.includes(target) || stages.indexOf(target) !== stages.indexOf(context.maintenance.workflowStage) + 1) return res.status(422).json({ error: "Solo puedes avanzar a la etapa siguiente de la mantención." });
    const readiness = brokerMaintenanceReadiness({ targetStage: target, maintenance: context.maintenance, quotes: context.quotes });
    if (!readiness.ready) return res.status(422).json({ error: `Antes de avanzar debes completar: ${readiness.missing.join(", ")}.`, missing: readiness.missing, requirements: readiness.requirements });
    const saved = await prisma.brokerMaintenance.update({ where: { id: context.maintenance.id }, data: { workflowStage: target, status: target === "CERRADA" ? "CERRADA" : target, ...(target === "RECEPCION" ? { resolvedAt: new Date() } : {}) } });
    await recordAuditLog(req, "BROKER_MAINTENANCE_STAGE_CHANGED", "broker_maintenance", saved.id, { recordId: record.id, stage: target });
    res.json(brokerMaintenancePayload(await brokerMaintenanceContext(req, record)));
  } catch (error) {
    console.error("Advance broker maintenance stage error:", error);
    res.status(500).json({ error: error?.message || "No se pudo avanzar la mantención." });
  }
});

brokerRouter.get("/broker/projects/:recordId/workspace", requireBrokerAction("projects", "VIEW"), async (req, res) => {
  try {
    const record = await prisma.industryRecord.findFirst({ where: brokerWhere(req, { id: req.params.recordId, recordType: "remodeling_project" }) });
    if (!record) return res.status(404).json({ error: "Proyecto no encontrado." });
    res.json(brokerProjectPayload(await brokerProjectContext(req, record)));
  } catch (error) {
    console.error("Get broker project workspace error:", error);
    res.status(500).json({ error: error?.message || "No se pudo abrir el control del proyecto." });
  }
});

brokerRouter.put("/broker/projects/:recordId/workspace", requireRole(ROLE_GROUPS.STAFF), requireBrokerAction("projects", "EDIT"), async (req, res) => {
  try {
    const record = await prisma.industryRecord.findFirst({ where: brokerWhere(req, { id: req.params.recordId, recordType: "remodeling_project" }) });
    if (!record) return res.status(404).json({ error: "Proyecto no encontrado." });
    const context = await brokerProjectContext(req, record);
    const saved = await prisma.brokerProject.update({ where: { id: context.project.id }, data: normalizeBrokerProject({ ...context.project, ...dataOf({ data: req.body }) }) });
    await prisma.industryRecord.update({ where: { id: record.id }, data: { status: saved.status === "CERRADO" ? "COMPLETED" : saved.status, data: { ...dataOf(record), name: saved.name, projectType: saved.projectType, budget: saved.budget, approvedBudget: saved.approvedBudget, status: saved.status, scope: saved.scope } } });
    await recordAuditLog(req, "BROKER_PROJECT_UPDATED", "broker_project", saved.id, { recordId: record.id, stage: saved.status });
    res.json(brokerProjectPayload(await brokerProjectContext(req, record)));
  } catch (error) {
    console.error("Update broker project workspace error:", error);
    res.status(500).json({ error: error?.message || "No se pudo guardar el control del proyecto." });
  }
});

brokerRouter.post("/broker/projects/:recordId/confirmations", requireRole(ROLE_GROUPS.STAFF), requireBrokerAction("projects", "EDIT"), async (req, res) => {
  try {
    const record = await prisma.industryRecord.findFirst({ where: brokerWhere(req, { id: req.params.recordId, recordType: "remodeling_project" }) });
    if (!record) return res.status(404).json({ error: "Proyecto no encontrado." });
    const context = await brokerProjectContext(req, record);
    const checkpoint = text(req.body?.checkpoint).toLowerCase();
    if (!new Set(["aprobacion", "ejecucion", "recepcion"]).has(checkpoint)) return res.status(400).json({ error: "Hito de confirmación inválido." });
    const checkpoints = context.project.checkpoints && typeof context.project.checkpoints === "object" && !Array.isArray(context.project.checkpoints) ? context.project.checkpoints : {};
    await prisma.brokerProject.update({ where: { id: context.project.id }, data: { checkpoints: { ...checkpoints, [checkpoint]: { confirmedAt: new Date().toISOString(), confirmedBy: req.user?.name || req.user?.email || "Usuario autorizado", note: text(req.body?.note) } } } });
    res.json(brokerProjectPayload(await brokerProjectContext(req, record)));
  } catch (error) {
    console.error("Confirm broker project checkpoint error:", error);
    res.status(500).json({ error: "No se pudo confirmar el hito del proyecto." });
  }
});

brokerRouter.patch("/broker/projects/:recordId/stage", requireRole(ROLE_GROUPS.STAFF), requireBrokerAction("projects", "EDIT"), async (req, res) => {
  try {
    const record = await prisma.industryRecord.findFirst({ where: brokerWhere(req, { id: req.params.recordId, recordType: "remodeling_project" }) });
    if (!record) return res.status(404).json({ error: "Proyecto no encontrado." });
    const context = await brokerProjectContext(req, record);
    const target = text(req.body?.stage).toUpperCase();
    const stages = BROKER_MAINTENANCE_OPTIONS.projectStatuses.filter((stage) => stage !== "CANCELADO");
    if (!stages.includes(target) || stages.indexOf(target) !== stages.indexOf(context.project.status) + 1) return res.status(422).json({ error: "Solo puedes avanzar a la etapa siguiente del proyecto." });
    const readiness = brokerProjectReadiness({ targetStage: target, project: context.project });
    if (!readiness.ready) return res.status(422).json({ error: `Antes de avanzar debes completar: ${readiness.missing.join(", ")}.`, missing: readiness.missing, requirements: readiness.requirements });
    const saved = await prisma.brokerProject.update({ where: { id: context.project.id }, data: { status: target } });
    await recordAuditLog(req, "BROKER_PROJECT_STAGE_CHANGED", "broker_project", saved.id, { recordId: record.id, stage: target });
    res.json(brokerProjectPayload(await brokerProjectContext(req, record)));
  } catch (error) {
    console.error("Advance broker project stage error:", error);
    res.status(500).json({ error: error?.message || "No se pudo avanzar el proyecto." });
  }
});

brokerRouter.get("/broker/post-sale/:recordId/workspace", requireBrokerAction("post_sale", "VIEW"), async (req, res) => {
  try {
    const record = await prisma.industryRecord.findFirst({ where: brokerWhere(req, { id: req.params.recordId, recordType: { in: Object.keys(POST_SALE_RECORD_KINDS) } }) });
    if (!record) return res.status(404).json({ error: "Control de postventa no encontrado." });
    res.json(brokerPostSalePayload(await brokerPostSaleContext(req, record)));
  } catch (error) {
    console.error("Get broker post-sale workspace error:", error);
    res.status(500).json({ error: error?.message || "No se pudo abrir el control de postventa." });
  }
});

brokerRouter.put("/broker/post-sale/:recordId/workspace", requireRole(ROLE_GROUPS.STAFF), requireBrokerAction("post_sale", "EDIT"), async (req, res) => {
  try {
    const record = await prisma.industryRecord.findFirst({ where: brokerWhere(req, { id: req.params.recordId, recordType: { in: Object.keys(POST_SALE_RECORD_KINDS) } }) });
    if (!record) return res.status(404).json({ error: "Control de postventa no encontrado." });
    const context = await brokerPostSaleContext(req, record);
    const incoming = dataOf({ data: req.body });
    const normalized = normalizePostSaleEntity(context.kind, { ...context.entity, ...incoming });
    const saved = await updateBrokerPostSaleEntity(context.kind, context.entity.id, {
      ...normalized,
      ...(context.kind === "inspection" ? { checklist: text(incoming.checklist) ? { detalle: text(incoming.checklist) } : context.entity.checklist || {} } : {}),
      evidence: context.entity.evidence || {},
      checkpoints: context.entity.checkpoints || {}
    });
    await prisma.industryRecord.update({ where: { id: record.id }, data: { ...(context.kind === "case" ? { title: saved.title } : {}), status: legacyStatusForPostSale(context.kind, saved.workflowStage), data: postSaleRecordData(context.kind, record, saved) } });
    await recordAuditLog(req, "BROKER_POST_SALE_UPDATED", `broker_${context.kind}`, saved.id, { recordId: record.id, kind: context.kind, stage: saved.workflowStage });
    res.json(brokerPostSalePayload(await brokerPostSaleContext(req, record)));
  } catch (error) {
    console.error("Update broker post-sale workspace error:", error);
    res.status(500).json({ error: error?.message || "No se pudo guardar el control de postventa." });
  }
});

brokerRouter.post("/broker/post-sale/:recordId/confirmations", requireRole(ROLE_GROUPS.STAFF), requireBrokerAction("post_sale", "EDIT"), async (req, res) => {
  try {
    const record = await prisma.industryRecord.findFirst({ where: brokerWhere(req, { id: req.params.recordId, recordType: { in: Object.keys(POST_SALE_RECORD_KINDS) } }) });
    if (!record) return res.status(404).json({ error: "Control de postventa no encontrado." });
    const context = await brokerPostSaleContext(req, record);
    const checkpoint = text(req.body?.checkpoint).toLowerCase();
    if (!postSaleCheckpoints(context.kind).includes(checkpoint)) return res.status(400).json({ error: "Hito de confirmación inválido." });
    const checkpoints = context.entity.checkpoints && typeof context.entity.checkpoints === "object" && !Array.isArray(context.entity.checkpoints) ? context.entity.checkpoints : {};
    const now = new Date();
    const sideEffects = context.kind === "inspection" && checkpoint === "inspeccion" ? { inspectedAt: context.entity.inspectedAt || now }
      : context.kind === "inspection" && checkpoint === "recepcion" ? { completedAt: context.entity.completedAt || now }
        : context.kind === "handover" && checkpoint === "entrega" ? { acceptedAt: context.entity.acceptedAt || now }
          : context.kind === "case" && checkpoint === "resolucion" ? { resolvedAt: context.entity.resolvedAt || now }
            : context.kind === "warranty" && checkpoint === "cobertura" ? { reviewedAt: context.entity.reviewedAt || now }
              : {};
    const saved = await updateBrokerPostSaleEntity(context.kind, context.entity.id, { ...sideEffects, checkpoints: { ...checkpoints, [checkpoint]: { confirmedAt: now.toISOString(), confirmedBy: req.user?.name || req.user?.email || "Usuario autorizado", note: text(req.body?.note) } } });
    await recordAuditLog(req, "BROKER_POST_SALE_CHECKPOINT_CONFIRMED", `broker_${context.kind}`, saved.id, { recordId: record.id, kind: context.kind, checkpoint });
    res.json(brokerPostSalePayload(await brokerPostSaleContext(req, record)));
  } catch (error) {
    console.error("Confirm broker post-sale checkpoint error:", error);
    res.status(500).json({ error: error?.message || "No se pudo confirmar el hito de postventa." });
  }
});

brokerRouter.patch("/broker/post-sale/:recordId/stage", requireRole(ROLE_GROUPS.STAFF), requireBrokerAction("post_sale", "EDIT"), async (req, res) => {
  try {
    const record = await prisma.industryRecord.findFirst({ where: brokerWhere(req, { id: req.params.recordId, recordType: { in: Object.keys(POST_SALE_RECORD_KINDS) } }) });
    if (!record) return res.status(404).json({ error: "Control de postventa no encontrado." });
    const context = await brokerPostSaleContext(req, record);
    const target = text(req.body?.stage).toUpperCase();
    const stages = postSaleStages(context.kind);
    if (!stages.includes(target) || stages.indexOf(target) !== stages.indexOf(context.entity.workflowStage) + 1) return res.status(422).json({ error: "Solo puedes avanzar a la etapa siguiente del control de postventa." });
    const readiness = brokerPostSaleReadiness({ kind: context.kind, targetStage: target, entity: context.entity });
    if (!readiness.ready) return res.status(422).json({ error: `Antes de avanzar debes completar: ${readiness.missing.join(", ")}.`, missing: readiness.missing, requirements: readiness.requirements });
    const saved = await updateBrokerPostSaleEntity(context.kind, context.entity.id, { workflowStage: target, status: target, ...(context.kind === "case" && target === "CERRADA" ? { closedAt: new Date() } : {}) });
    await prisma.industryRecord.update({ where: { id: record.id }, data: { status: legacyStatusForPostSale(context.kind, target), data: postSaleRecordData(context.kind, record, saved) } });
    await recordAuditLog(req, "BROKER_POST_SALE_STAGE_CHANGED", `broker_${context.kind}`, saved.id, { recordId: record.id, kind: context.kind, stage: target });
    res.json(brokerPostSalePayload(await brokerPostSaleContext(req, record)));
  } catch (error) {
    console.error("Advance broker post-sale stage error:", error);
    res.status(500).json({ error: error?.message || "No se pudo avanzar el control de postventa." });
  }
});

brokerRouter.patch("/broker/operations/:id/stage", requireRole(ROLE_GROUPS.STAFF), requireBrokerAction("operations", "EDIT"), async (req, res) => {
  try {
    const existing = await prisma.industryRecord.findFirst({ where: brokerWhere(req, { id: req.params.id, recordType: "broker_operation" }) });
    if (!existing) return res.status(404).json({ error: "Operación no encontrada." });
    const current = operationPayload(existing);
    const transition = validateBrokerStageTransition({ operationType: current.data.operationType, currentStage: current.data.stage, nextStage: req.body?.stage });
    if (!transition.ok) return res.status(422).json({ error: transition.error });
    if (current.data.operationType === "SALE" && transition.next !== transition.current && !["CANCELADA", "PERDIDA"].includes(transition.next)) {
      const context = await brokerSaleContext(req, existing);
      const readiness = brokerSaleReadiness({ targetStage: transition.next, saleCase: context.saleCase, capture: context.capture, relatedRecords: context.relatedRecords });
      if (!readiness.ready) return res.status(422).json({ error: `Antes de avanzar debes completar: ${readiness.missing.join(", ")}.`, missing: readiness.missing, requirements: readiness.requirements });
    }
    if (current.data.operationType === "RENTAL" && transition.next !== transition.current && !["CANCELADA", "PERDIDA"].includes(transition.next)) {
      const context = await brokerRentalContext(req, existing);
      const readiness = brokerRentalReadiness({ targetStage: transition.next, rentalCase: context.rentalCase, capture: context.capture, relatedRecords: context.relatedRecords });
      if (!readiness.ready) return res.status(422).json({ error: `Antes de avanzar debes completar: ${readiness.missing.join(", ")}.`, missing: readiness.missing, requirements: readiness.requirements });
    }
    const now = new Date().toISOString();
    const timeline = [...current.data.timeline, { at: now, type: "STAGE_CHANGED", from: transition.current, stage: transition.next, note: text(req.body?.note, `Etapa cambiada a ${transition.next}`) }];
    const record = await prisma.industryRecord.update({
      where: { id: existing.id },
      data: { status: transition.terminal ? "COMPLETED" : "ACTIVE", data: { ...current.data, stage: transition.next, checklist: brokerStageChecklist(current.data.operationType, transition.next), timeline } }
    });
    if (current.data.operationType === "SALE") {
      const saleCase = await prisma.brokerSaleCase.findUnique({ where: { operationId: existing.id } });
      if (saleCase) await prisma.brokerSaleCase.update({ where: { id: saleCase.id }, data: { currentStage: transition.next, status: transition.terminal ? (transition.next === "ENTREGA_Y_POSTVENTA" ? "CERRADA" : "CANCELADA") : "ACTIVA" } });
    }
    if (current.data.operationType === "RENTAL") {
      const rentalCase = await prisma.brokerRentalCase.findUnique({ where: { operationId: existing.id } });
      if (rentalCase) await prisma.brokerRentalCase.update({ where: { id: rentalCase.id }, data: { currentStage: transition.next, status: transition.terminal ? (transition.next === "ENTREGA_LLAVES" ? "CERRADA" : "CANCELADA") : "ACTIVA" } });
    }
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
