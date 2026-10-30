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
import { BROKER_JOURNEY_CATALOG } from "./broker-operation-contract.service.js";

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

function validDate(value) {
  if (!value) return null;
  const result = new Date(value);
  return Number.isNaN(result.getTime()) ? null : result;
}

function daysBetween(older, newer) {
  const start = validDate(older);
  const end = validDate(newer);
  if (!start || !end) return 0;
  return Math.max(0, Math.floor((end.getTime() - start.getTime()) / 86_400_000));
}

function pipelineStage(operation) {
  const journey = operation?.journey || {};
  const data = dataOf(operation);
  return text(journey?.pipeline?.key || data.pipelineStage);
}

function pipelineStageLabel(key) {
  return BROKER_JOURNEY_CATALOG.pipeline.find((item) => item.key === key)?.label || text(key, "Sin etapa");
}

function stageStartedAt(operation) {
  const data = dataOf(operation);
  const stage = text(data.stage);
  const timeline = Array.isArray(data.timeline) ? data.timeline : [];
  const event = [...timeline].reverse().find((item) => (
    ["STAGE_CHANGED", "OPERATION_CREATED"].includes(text(item?.type).toUpperCase())
    && text(item?.stage) === stage
    && validDate(item?.at)
  ));
  return event?.at || operation?.updatedAt || operation?.createdAt || null;
}

function operationAmount(data) {
  return numeric(data.agreedAmount || data.offerAmount || data.estimatedValue || data.publicationPrice || data.amount || data.monthlyRent);
}

/**
 * Proyección explicable del pipeline. La edad, la salud y el cuello de
 * botella se calculan una vez en el backend y la interfaz solo los presenta.
 */
export function buildBrokerOperationInsights({ operations = [], now = new Date() } = {}) {
  return operations.map((operation) => {
    const data = dataOf(operation);
    const journey = operation?.journey || {};
    const stageAt = stageStartedAt(operation);
    const stageAgeDays = daysBetween(stageAt, now);
    const ageDays = daysBetween(operation?.createdAt || stageAt, now);
    const terminal = Boolean(journey.outcome) || TERMINAL_STAGES.has(text(data.stage));
    const responsibleUserId = text(operation?.assignedToId) || null;
    let health = "HEALTHY";
    let bottleneck = null;
    let detail = "La operación está dentro del tiempo de seguimiento esperado.";
    if (!terminal && !responsibleUserId) {
      health = "RISK";
      bottleneck = "SIN_RESPONSABLE";
      detail = "No tiene una persona responsable asignada dentro del alcance autorizado.";
    } else if (!terminal && stageAgeDays >= 30) {
      health = "RISK";
      bottleneck = "ETAPA_ESTANCADA";
      detail = `Permanece ${stageAgeDays} días en la etapa actual.`;
    } else if (!terminal && stageAgeDays >= 14) {
      health = "ATTENTION";
      bottleneck = "SEGUIMIENTO_REQUERIDO";
      detail = `Lleva ${stageAgeDays} días en la etapa actual y requiere seguimiento.`;
    } else if (terminal) {
      health = "TERMINAL";
      detail = "La operación alcanzó una etapa terminal del flujo.";
    }
    return {
      operationId: operation.id,
      title: operation.title,
      propertyId: text(data.propertyId) || null,
      operationType: normalizeBrokerOperationType(data.operationType) || "SALE",
      stage: text(data.stage, "SIN_ETAPA"),
      pipelineKey: pipelineStage(operation),
      pipelineLabel: pipelineStageLabel(pipelineStage(operation)),
      assignedToId: responsibleUserId,
      amount: operationAmount(data),
      projectedCommission: numeric(data.estimatedCommission),
      createdAt: operation?.createdAt?.toISOString?.() || operation?.createdAt || null,
      updatedAt: operation?.updatedAt?.toISOString?.() || operation?.updatedAt || null,
      stageStartedAt: validDate(stageAt)?.toISOString?.() || null,
      ageDays,
      stageAgeDays,
      health,
      bottleneck,
      detail,
      terminal
    };
  });
}

function isCompletedDocument(record) {
  return ["AVAILABLE", "APPROVED", "SIGNED", "GRANTED"].includes(text(record?.status).toUpperCase());
}

function isDocumentRecord(record) {
  return ["property_document", "legal_document", "digital_signature"].includes(record?.recordType);
}

function isCollectionOpen(record) {
  return ["rental_payment", "utility_monitoring"].includes(record?.recordType)
    && ["PENDING", "OVERDUE", "UNDER_REVIEW"].includes(text(record?.status).toUpperCase());
}

/**
 * Devuelve las prioridades internas con una forma estable para toda la
 * vertical. No desencadena correos, publicaciones ni modificaciones: son
 * propuestas que requieren confirmación humana cuando corresponde.
 */
export function buildBrokerOperationalPriorities({
  properties = [],
  operations = [],
  evaluations = [],
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

  const insights = buildBrokerOperationInsights({ operations, now });
  for (const insight of insights.filter((item) => !item.terminal && item.health !== "HEALTHY")) {
    add({
      id: `operation-health-${insight.operationId}`,
      source: "OPERATION_HEALTH",
      priority: insight.health === "RISK" ? "HIGH" : "MEDIUM",
      area: "operations",
      entityType: "broker_operation",
      entityId: insight.operationId,
      title: `Seguimiento: ${insight.title}`,
      detail: `${insight.detail} Etapa comercial: ${insight.pipelineLabel}.`,
      impact: "SALUD_DEL_PIPELINE",
      propertyId: insight.propertyId || undefined,
      operationId: insight.operationId,
      responsibleUserId: insight.assignedToId || undefined,
      requiresApproval: insight.bottleneck === "SIN_RESPONSABLE"
    });
  }

  const relatedDocuments = new Map();
  for (const record of brokerRecords.filter(isDocumentRecord)) {
    const propertyId = text(dataOf(record).propertyId);
    if (!propertyId) continue;
    const current = relatedDocuments.get(propertyId) || [];
    current.push(record);
    relatedDocuments.set(propertyId, current);
  }
  for (const insight of insights.filter((item) => !item.terminal && item.propertyId)) {
    const documents = relatedDocuments.get(insight.propertyId) || [];
    if (documents.some(isCompletedDocument)) continue;
    add({
      id: `operation-documents-${insight.operationId}`,
      source: "OPERATION_DOCUMENT_READINESS",
      priority: "MEDIUM",
      area: "documents",
      entityType: "broker_operation",
      entityId: insight.operationId,
      title: `Antecedentes por revisar: ${insight.title}`,
      detail: "La operación no registra antecedentes documentales aprobados o disponibles para su propiedad asociada. Revisa el expediente antes de avanzar.",
      impact: "CONTROL_DOCUMENTAL",
      propertyId: insight.propertyId,
      operationId: insight.operationId,
      responsibleUserId: insight.assignedToId || undefined,
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

  for (const record of brokerRecords.filter(isCollectionOpen)) {
    const dueDate = recordDueDate(record);
    const status = text(record.status).toUpperCase();
    const overdue = status === "OVERDUE" || Boolean(dueDate && dueDate < today);
    const data = dataOf(record);
    add({
      id: `collection-${record.id}`,
      source: "COLLECTION_CONTROL",
      priority: overdue ? "HIGH" : "MEDIUM",
      area: "rentals",
      entityType: record.recordType,
      entityId: record.id,
      title: `${overdue ? "Cobro vencido" : "Cobro pendiente"}: ${record.title}`,
      detail: `${BROKER_RECORD_DEFINITIONS[record.recordType]?.label || "Cobro"} por ${numeric(data.amount).toLocaleString("es-CL")} CLP. Revisa evidencia y confirma cualquier gestión fuera de la plataforma.`,
      impact: "COBRANZA_Y_ADMINISTRACION",
      propertyId: text(data.propertyId) || undefined,
      responsibleUserId: record.assignedToId || undefined,
      dueAt: dueDate?.toISOString?.() || null,
      requiresApproval: true
    });
  }

  for (const evaluation of evaluations) {
    const decision = text(dataOf(evaluation).decision, "PENDING_REVIEW").toUpperCase();
    if (decision !== "PENDING_REVIEW") continue;
    add({
      id: `ai-evaluation-${evaluation.id}`,
      source: "AI_EVALUATION_PENDING",
      priority: "MEDIUM",
      area: "ai",
      entityType: "broker_agent_evaluation",
      entityId: evaluation.id,
      title: `Revisión humana de IA: ${evaluation.title}`,
      detail: "La sugerencia fue registrada para revisión. No ejecutará cambios, comunicaciones ni acciones externas sin confirmación humana.",
      impact: "GOBIERNO_DE_IA",
      responsibleUserId: evaluation.assignedToId || undefined,
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
  teamMembers = [],
  scope = null,
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
    evaluations,
    now
  });
  const insights = buildBrokerOperationInsights({ operations, now });
  const normalizedOperations = operations.map((operation) => dataOf(operation));
  const pipelineByStage = normalizedOperations.reduce((result, operation) => {
    const type = normalizeBrokerOperationType(operation.operationType) || "SALE";
    const stage = text(operation.stage, "SIN_ETAPA");
    const key = `${type}:${stage}`;
    result[key] = (result[key] || 0) + 1;
    return result;
  }, {});
  const activeOperations = insights.filter((operation) => !operation.terminal).length;
  const pipelineColumns = BROKER_JOURNEY_CATALOG.pipeline.map((stage) => {
    const items = insights.filter((item) => item.pipelineKey === stage.key);
    const attention = items.filter((item) => item.health === "ATTENTION").length;
    const risk = items.filter((item) => item.health === "RISK").length;
    return {
      key: stage.key,
      label: stage.label,
      count: items.length,
      attention,
      risk,
      averageStageAgeDays: items.length ? Math.round(items.reduce((sum, item) => sum + item.stageAgeDays, 0) / items.length) : 0
    };
  });
  const activeInsights = insights.filter((item) => !item.terminal);
  const openDocuments = brokerRecords.filter((record) => isDocumentRecord(record) && !isCompletedDocument(record));
  const openCollections = brokerRecords.filter(isCollectionOpen);
  const pendingAiApprovals = evaluations.filter((item) => text(dataOf(item).decision, "PENDING_REVIEW").toUpperCase() === "PENDING_REVIEW");
  const membersById = new Map(teamMembers.map((member) => [String(member.id), member]));
  const team = [...new Set(activeInsights.map((item) => item.assignedToId).filter(Boolean))]
    .map((userId) => {
      const member = membersById.get(String(userId));
      const assigned = activeInsights.filter((item) => item.assignedToId === userId);
      return {
        userId,
        name: text(member?.name || member?.email, "Responsable autorizado"),
        activeOperations: assigned.length,
        attentionOperations: assigned.filter((item) => item.health === "ATTENTION").length,
        riskOperations: assigned.filter((item) => item.health === "RISK").length,
        projectedCommission: assigned.reduce((sum, item) => sum + item.projectedCommission, 0)
      };
    })
    .sort((left, right) => right.activeOperations - left.activeOperations || right.riskOperations - left.riskOperations || left.name.localeCompare(right.name))
    .slice(0, 8);
  const onboardingChecklist = [
    { key: "captacion", label: "Registrar la primera captación", done: properties.length > 0, href: "/realty?view=operations" },
    { key: "responsable", label: "Asignar responsable a la cartera", done: properties.length > 0 && properties.every((property) => Boolean(property.assignedToId)), href: "/realty?view=brokers" },
    { key: "negocio", label: "Abrir el primer negocio", done: operations.length > 0, href: "/realty?view=broker_os&tab=operations" },
    { key: "expediente", label: "Incorporar un antecedente al expediente", done: brokerRecords.some((record) => isDocumentRecord(record) && isCompletedDocument(record)), href: "/realty?view=broker_os&area=documents" }
  ];

  return {
    version: "BROKER_OPERATIONAL_READ_MODEL_V2",
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
    scope: {
      level: text(scope?.level, "AUTHORIZED"),
      description: text(scope?.description, "Solo se muestran registros dentro de tu alcance autorizado.")
    },
    onboarding: {
      isFirstUse: properties.length === 0 && operations.length === 0 && brokerRecords.length === 0,
      completed: onboardingChecklist.filter((item) => item.done).length,
      total: onboardingChecklist.length,
      checklist: onboardingChecklist
    },
    operationalCenter: {
      risks: activeInsights.filter((item) => item.health === "RISK").length,
      deadlines: priorities.filter((item) => item.dueAt).length,
      documentsPending: openDocuments.length,
      collectionsPending: openCollections.length,
      aiApprovalsPending: pendingAiApprovals.length
    },
    activity: {
      updatedLast7Days: operations.filter((operation) => daysBetween(operation.updatedAt || operation.createdAt, now) <= 7).length,
      updatedLast30Days: operations.filter((operation) => daysBetween(operation.updatedAt || operation.createdAt, now) <= 30).length,
      lastUpdatedAt: operations.map((operation) => validDate(operation.updatedAt || operation.createdAt)).filter(Boolean).sort((left, right) => right - left)[0]?.toISOString?.() || null
    },
    team,
    pipeline: {
      total: insights.length,
      active: activeOperations,
      terminal: insights.length - activeOperations,
      byStage: pipelineByStage,
      columns: pipelineColumns,
      bottlenecks: pipelineColumns.filter((item) => item.risk || item.attention).map((item) => ({ ...item, kind: item.risk ? "RISK" : "ATTENTION" })),
      operations: insights
    }
  };
}
