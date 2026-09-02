function UPPER(value) {
  return String(value || "").trim().toUpperCase();
}

function text(value) {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function date(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function allowed(value, options, fallback) {
  const normalized = UPPER(value);
  return options.includes(normalized) ? normalized : fallback;
}

function bool(value, fallback = false) {
  if (value === true || value === "true" || value === 1 || value === "1") return true;
  if (value === false || value === "false" || value === 0 || value === "0") return false;
  return fallback;
}

function checkpoint(checkpoints, key) {
  return Boolean(checkpoints && typeof checkpoints === "object" && !Array.isArray(checkpoints) && checkpoints[key]);
}

function requirement(key, label, ready) {
  return { key, label, ready: Boolean(ready) };
}

function readiness(requirements) {
  const missing = requirements.filter((item) => !item.ready).map((item) => item.label);
  return { requirements, missing, ready: missing.length === 0 };
}

export const BROKER_POST_SALE_OPTIONS = Object.freeze({
  inspectionStages: ["PROGRAMACION", "INSPECCION", "CORRECCIONES", "RECEPCION", "CERRADA"],
  handoverStages: ["PROGRAMACION", "INVENTARIO", "FIRMA", "ENTREGA", "CERRADA"],
  caseStages: ["INGRESO", "DIAGNOSTICO", "GESTION", "RESOLUCION", "CERRADA"],
  warrantyStages: ["INGRESO", "REVISION_COBERTURA", "RECLAMO", "RESOLUCION", "CERRADA"],
  priorities: ["BAJA", "MEDIA", "ALTA", "CRITICA"],
  inspectionTypes: ["PRE_ENTREGA", "ENTREGA", "RECEPCION", "POSTVENTA", "GARANTIA"],
  handoverDirections: ["ENTREGA", "RECEPCION"],
  warrantyCoverageTypes: ["CONSTRUCTORA", "PROVEEDOR", "EQUIPAMIENTO", "TERMINACIONES", "OTRA"],
});

export function postSaleStages(kind) {
  return ({ inspection: BROKER_POST_SALE_OPTIONS.inspectionStages, handover: BROKER_POST_SALE_OPTIONS.handoverStages, case: BROKER_POST_SALE_OPTIONS.caseStages, warranty: BROKER_POST_SALE_OPTIONS.warrantyStages })[kind] || [];
}

export function normalizeBrokerInspection(input = {}) {
  return {
    inspectionType: allowed(input.inspectionType, BROKER_POST_SALE_OPTIONS.inspectionTypes, "PRE_ENTREGA"),
    status: allowed(input.status || input.workflowStage, BROKER_POST_SALE_OPTIONS.inspectionStages, "PROGRAMACION"),
    workflowStage: allowed(input.workflowStage || input.status, BROKER_POST_SALE_OPTIONS.inspectionStages, "PROGRAMACION"),
    scheduledAt: date(input.scheduledAt || input.inspectionDate),
    inspectedAt: date(input.inspectedAt),
    inspectorName: text(input.inspectorName),
    conditionSummary: text(input.conditionSummary),
    observations: text(input.observations),
    requiresAction: bool(input.requiresAction, false),
    actionPlan: text(input.actionPlan),
    actionDueAt: date(input.actionDueAt),
    completedAt: date(input.completedAt),
  };
}

export function normalizeBrokerHandover(input = {}) {
  return {
    direction: allowed(input.direction, BROKER_POST_SALE_OPTIONS.handoverDirections, "ENTREGA"),
    status: allowed(input.status || input.workflowStage, BROKER_POST_SALE_OPTIONS.handoverStages, "PROGRAMACION"),
    workflowStage: allowed(input.workflowStage || input.status, BROKER_POST_SALE_OPTIONS.handoverStages, "PROGRAMACION"),
    scheduledAt: date(input.scheduledAt || input.handoverDate),
    handoverAt: date(input.handoverAt),
    recipientName: text(input.recipientName),
    recipientRole: text(input.recipientRole),
    inventoryReference: text(input.inventoryReference),
    actaReference: text(input.actaReference),
    observations: text(input.observations),
    acceptedAt: date(input.acceptedAt),
  };
}

export function normalizeBrokerPostSaleCase(input = {}) {
  return {
    title: text(input.title) || "Caso de postventa",
    caseType: text(input.caseType) || "POSTVENTA",
    priority: allowed(input.priority, BROKER_POST_SALE_OPTIONS.priorities, "MEDIA"),
    status: allowed(input.status || input.workflowStage, BROKER_POST_SALE_OPTIONS.caseStages, "INGRESO"),
    workflowStage: allowed(input.workflowStage || input.status, BROKER_POST_SALE_OPTIONS.caseStages, "INGRESO"),
    description: text(input.description) || "Sin descripción",
    openedAt: date(input.openedAt) || new Date(),
    responseDueAt: date(input.responseDueAt),
    responsibleName: text(input.responsibleName),
    diagnosis: text(input.diagnosis),
    actionPlan: text(input.actionPlan),
    resolution: text(input.resolution),
    resolvedAt: date(input.resolvedAt),
    closedAt: date(input.closedAt),
  };
}

export function normalizeBrokerWarrantyCase(input = {}) {
  return {
    coverageType: allowed(input.coverageType, BROKER_POST_SALE_OPTIONS.warrantyCoverageTypes, "OTRA"),
    providerName: text(input.providerName),
    warrantyUntil: date(input.warrantyUntil),
    description: text(input.description) || "Sin descripción",
    priority: allowed(input.priority, BROKER_POST_SALE_OPTIONS.priorities, "MEDIA"),
    status: allowed(input.status || input.workflowStage, BROKER_POST_SALE_OPTIONS.warrantyStages, "INGRESO"),
    workflowStage: allowed(input.workflowStage || input.status, BROKER_POST_SALE_OPTIONS.warrantyStages, "INGRESO"),
    claimReference: text(input.claimReference),
    submittedAt: date(input.submittedAt),
    reviewedAt: date(input.reviewedAt),
    resolution: text(input.resolution),
    resolvedAt: date(input.resolvedAt),
  };
}

export function brokerPostSaleReadiness({ kind, targetStage, entity }) {
  const target = UPPER(targetStage);
  if (kind === "inspection") {
    if (target === "INSPECCION") return readiness([requirement("agenda", "Fecha y responsable de inspección", entity.scheduledAt && entity.inspectorName)]);
    if (target === "CORRECCIONES") return readiness([requirement("inspeccion", "Inspección realizada con resumen y checklist", entity.inspectedAt && entity.conditionSummary && entity.checklist && checkpoint(entity.checkpoints, "inspeccion"))]);
    if (target === "RECEPCION") return readiness([requirement("correcciones", "Plan de corrección cuando existen observaciones", !entity.requiresAction || (entity.actionPlan && entity.actionDueAt))]);
    if (target === "CERRADA") return readiness([requirement("recepcion", "Recepción final confirmada", entity.completedAt && checkpoint(entity.checkpoints, "recepcion"))]);
  }
  if (kind === "handover") {
    if (target === "INVENTARIO") return readiness([requirement("agenda", "Fecha de entrega y receptor", entity.scheduledAt && entity.recipientName)]);
    if (target === "FIRMA") return readiness([requirement("inventario", "Inventario o respaldo de bienes", entity.inventoryReference && checkpoint(entity.checkpoints, "inventario"))]);
    if (target === "ENTREGA") return readiness([requirement("acta", "Acta de entrega y firma revisada", entity.actaReference && checkpoint(entity.checkpoints, "firma"))]);
    if (target === "CERRADA") return readiness([requirement("recepcion", "Entrega aceptada por el receptor", entity.handoverAt && entity.acceptedAt && checkpoint(entity.checkpoints, "entrega"))]);
  }
  if (kind === "case") {
    if (target === "DIAGNOSTICO") return readiness([requirement("ingreso", "Descripción, fecha y responsable", entity.description && entity.openedAt && entity.responsibleName)]);
    if (target === "GESTION") return readiness([requirement("diagnostico", "Diagnóstico confirmado por una persona", entity.diagnosis && checkpoint(entity.checkpoints, "diagnostico"))]);
    if (target === "RESOLUCION") return readiness([requirement("gestion", "Plan de acción y fecha de respuesta", entity.actionPlan && entity.responseDueAt)]);
    if (target === "CERRADA") return readiness([requirement("resolucion", "Resolución, evidencia y confirmación humana", entity.resolution && entity.resolvedAt && checkpoint(entity.checkpoints, "resolucion"))]);
  }
  if (kind === "warranty") {
    if (target === "REVISION_COBERTURA") return readiness([requirement("cobertura", "Tipo, proveedor y vigencia de la garantía", entity.coverageType && entity.providerName && entity.warrantyUntil)]);
    if (target === "RECLAMO") return readiness([requirement("revision", "Cobertura revisada por una persona", entity.reviewedAt && checkpoint(entity.checkpoints, "cobertura"))]);
    if (target === "RESOLUCION") return readiness([requirement("reclamo", "Referencia y fecha del reclamo documentado", entity.claimReference && entity.submittedAt && checkpoint(entity.checkpoints, "reclamo"))]);
    if (target === "CERRADA") return readiness([requirement("resolucion", "Resolución, evidencia y recepción confirmada", entity.resolution && entity.resolvedAt && checkpoint(entity.checkpoints, "recepcion"))]);
  }
  return readiness([]);
}
