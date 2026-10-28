/** Archivo: Unifica indicadores, prioridades y trazabilidad operativa de Broker OS. */
import {
  BROKER_OPERATION_TYPES,
  BROKER_RECORD_DEFINITIONS,
  TERMINAL_STAGES,
  calculateBrokerCommission,
  normalizeBrokerOperationType,
  propertyHealthSnapshot,
  stagesForBrokerOperation
} from "./broker-workflows.service.js";

function text(value, fallback = "") {
  const result = String(value ?? "").trim();
  return result || fallback;
}

function dataOf(record) {
  return record?.data && typeof record.data === "object" && !Array.isArray(record.data) ? record.data : {};
}

function numeric(value) {
  const result = Number(value || 0);
  return Number.isFinite(result) ? result : 0;
}

function priorityWeight(priority) {
  return priority === "HIGH" ? 3 : priority === "MEDIUM" ? 2 : 1;
}

export function brokerPropertyMissingData(property) {
  const data = dataOf(property);
  const missing = [];
  if (!text(data.price)) missing.push("precio");
  if (!text(data.address)) missing.push("dirección");
  if (!text(data.commune || data.comuna)) missing.push("comuna");
  if (!text(data.photoUrl) && !(Array.isArray(data.gallery) && data.gallery.length) && !(Array.isArray(data.photoUrls) && data.photoUrls.length)) missing.push("foto principal");
  return missing;
}

function recordDueDate(record) {
  const data = dataOf(record);
  const raw = text(data.dueDate || data.warrantyUntil || data.endDate || data.expiresAt);
  const value = raw ? new Date(raw) : null;
  return value && !Number.isNaN(value.getTime()) ? value : null;
}

/**
 * Devuelve las prioridades internas con una forma estable para toda la
 * vertical. No desencadena correos, publicaciones ni modificaciones: son
 * propuestas que requieren confirmación humana cuando corresponde.
 */
export function buildBrokerOperationalPriorities({
  properties = [],
  operations = [],
  maintenance = 0,
  postSale = 0,
  financing = 0,
  brokerRecords = [],
  now = new Date()
} = {}) {
  const priorities = [];
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const soon = new Date(today);
  soon.setDate(soon.getDate() + 30);

  const add = (priority) => priorities.push({
    impact: "CONTROL_OPERATIVO",
    responsibleUserId: undefined,
    dueAt: null,
    propertyId: undefined,
    operationId: undefined,
    source: "BROKER_RULE",
    entityType: "tenant",
    entityId: "tenant",
    ...priority
  });

  for (const property of properties) {
    const missing = brokerPropertyMissingData(property);
    if (!missing.length) continue;
    add({
      id: `property-${property.id}-completion`,
      source: "PROPERTY_COMPLETENESS",
      priority: missing.includes("foto principal") ? "MEDIUM" : "HIGH",
      area: "commercial",
      entityType: "property",
      entityId: property.id,
      title: `Completar ficha: ${property.title}`,
      detail: `Faltan ${missing.join(", ")}. La publicación y el matching serán más precisos con esa información.`,
      impact: "PUBLICACION_Y_MATCHING",
      propertyId: property.id,
      responsibleUserId: property.assignedToId || undefined,
      requiresApproval: false
    });
  }

  for (const operation of operations) {
    const data = dataOf(operation);
    const operationType = normalizeBrokerOperationType(data.operationType) || "SALE";
    const stages = stagesForBrokerOperation(operationType);
    const currentStage = text(data.stage);
    const currentIndex = stages.indexOf(currentStage);
    const nextStage = stages[currentIndex + 1];
    if (!nextStage) continue;
    add({
      id: `operation-${operation.id}-${nextStage}`,
      source: "OPERATION_NEXT_STAGE",
      priority: "MEDIUM",
      area: "commercial",
      entityType: "broker_operation",
      entityId: operation.id,
      title: `Siguiente paso: ${operation.title}`,
      detail: `La operación está en ${currentStage}. Puedes avanzar a ${nextStage} cuando el equipo confirme el hito.`,
      impact: "AVANCE_DE_NEGOCIO",
      propertyId: text(data.propertyId) || undefined,
      operationId: operation.id,
      responsibleUserId: operation.assignedToId || undefined,
      requiresApproval: true
    });
  }

  if (maintenance > 0) add({
    id: "maintenance-open",
    source: "MAINTENANCE_OPEN",
    priority: "HIGH",
    area: "maintenance",
    title: "Mantenciones pendientes",
    detail: `${maintenance} caso(s) requiere(n) revisión, proveedor o confirmación de cierre.`,
    impact: "CONTINUIDAD_OPERATIVA",
    requiresApproval: true
  });
  if (postSale > 0) add({
    id: "post-sale-open",
    source: "POST_SALE_OPEN",
    priority: "HIGH",
    area: "post_sale",
    title: "Casos de postventa abiertos",
    detail: `${postSale} caso(s) mantiene(n) una decisión o seguimiento pendiente.`,
    impact: "SERVICIO_Y_GARANTIA",
    requiresApproval: true
  });
  if (financing > 0) add({
    id: "financing-open",
    source: "FINANCING_OPEN",
    priority: "MEDIUM",
    area: "financing",
    title: "Financiamientos en seguimiento",
    detail: `${financing} solicitud(es) requiere(n) antecedentes o una revisión humana.`,
    impact: "CIERRE_DE_NEGOCIO",
    requiresApproval: true
  });

  for (const record of brokerRecords) {
    const dueDate = recordDueDate(record);
    if (!dueDate || ["PAID", "CLOSED", "RESOLVED", "ENDED", "REPLACED"].includes(String(record.status).toUpperCase())) continue;
    const isOverdue = dueDate < today;
    if (!isOverdue && dueDate > soon) continue;
    const definition = BROKER_RECORD_DEFINITIONS[record.recordType];
    const data = dataOf(record);
    add({
      id: `due-${record.id}`,
      source: "DUE_DATE_CONTROL",
      priority: isOverdue ? "HIGH" : "MEDIUM",
      area: definition?.area || "documents",
      entityType: record.recordType,
      entityId: record.id,
      title: `${isOverdue ? "Vencido" : "Próximo a vencer"}: ${record.title}`,
      detail: `${definition?.label || record.recordType} con fecha ${dueDate.toLocaleDateString("es-CL")}. Revisa y confirma la acción antes de comunicar o ejecutar cambios externos.`,
      impact: "RIESGO_DE_VENCIMIENTO",
      propertyId: text(data.propertyId) || undefined,
      responsibleUserId: record.assignedToId || undefined,
      dueAt: dueDate.toISOString(),
      requiresApproval: true
    });
  }

  return priorities
    .sort((left, right) => priorityWeight(right.priority) - priorityWeight(left.priority) || String(left.dueAt || "9999").localeCompare(String(right.dueAt || "9999")))
    .slice(0, 50);
}

/** Calcula los indicadores que deben ser idénticos en resumen, operación y panel ejecutivo. */
export function buildBrokerOperationalReporting({ properties = [], operations = [], evaluations = [], brokerRecords = [] } = {}) {
  const portfolioValue = properties.reduce((sum, property) => sum + numeric(dataOf(property).price), 0);
  const projectedFromOperations = operations.reduce((sum, operation) => {
    const data = dataOf(operation);
    return sum + numeric(data.estimatedCommission || data.monthlyManagementFee);
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

/**
 * Contrato único de lectura para los paneles de Broker OS. Mantiene los
 * registros fuente intactos y deja rastreable cuándo se calculó cada resumen.
 */
export function buildBrokerOperationalReadModel({
  properties = [],
  operations = [],
  evaluations = [],
  brokerRecords = [],
  counts = {},
  now = new Date()
} = {}) {
  const reporting = buildBrokerOperationalReporting({ properties, operations, evaluations, brokerRecords });
  const priorities = buildBrokerOperationalPriorities({
    properties,
    operations,
    maintenance: counts.openMaintenance || 0,
    postSale: counts.openPostSale || 0,
    financing: counts.activeFinancing || 0,
    brokerRecords,
    now
  });
  const normalizedOperations = operations.map((operation) => dataOf(operation));
  const pipelineByStage = normalizedOperations.reduce((result, operation) => {
    const type = normalizeBrokerOperationType(operation.operationType) || "SALE";
    const stage = text(operation.stage, "SIN_ETAPA");
    const key = `${type}:${stage}`;
    result[key] = (result[key] || 0) + 1;
    return result;
  }, {});
  const activeOperations = normalizedOperations.filter((operation) => !TERMINAL_STAGES.has(text(operation.stage))).length;

  return {
    version: "BROKER_OPERATIONAL_READ_MODEL_V1",
    generatedAt: new Date(now).toISOString(),
    kpis: {
      properties: Number.isFinite(Number(counts.properties)) ? Number(counts.properties) : properties.length,
      activeOperations,
      scheduledVisits: numeric(counts.scheduledVisits),
      openAlerts: numeric(counts.openAlerts),
      activeRentals: numeric(counts.activeRentals),
      openMaintenance: numeric(counts.openMaintenance),
      openPostSale: numeric(counts.openPostSale),
      activeFinancing: numeric(counts.activeFinancing)
    },
    reporting,
    priorities,
    pipeline: {
      total: normalizedOperations.length,
      active: activeOperations,
      terminal: normalizedOperations.length - activeOperations,
      byStage: pipelineByStage
    }
  };
}
