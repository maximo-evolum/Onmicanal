/** Archivo: Proyecta el tablero ejecutivo y el tracker de ventas de Broker OS desde la misma operación protegida. */
import { BROKER_JOURNEY_CATALOG } from "./broker-operation-contract.service.js";
import { brokerStageChecklist, normalizeBrokerStage, stagesForBrokerOperation } from "./broker-workflows.service.js";

const text = (value, fallback = "") => String(value ?? "").trim() || fallback;
const dataOf = (record) => record?.data && typeof record.data === "object" && !Array.isArray(record.data) ? record.data : {};
const number = (value) => {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

export const BROKER_FORECAST_STAGES = Object.freeze(BROKER_JOURNEY_CATALOG.commercial.map((item) => item.key));
export const BROKER_FORECAST_DEFAULT_ASSUMPTIONS = Object.freeze({
  CAPTACION: 10,
  TASACION: 20,
  PUBLICACION: 35,
  INTERESADOS: 50,
  NEGOCIACION: 70,
  CIERRE_LEGAL: 85,
});

export const BROKER_TRACKER_ACTORS = Object.freeze(["PROPIETARIO", "COMPRADOR", "CORREDOR", "GERENCIA"]);

export function normalizeBrokerForecastAssumptions(input = {}) {
  const raw = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const probabilities = {};
  for (const stage of BROKER_FORECAST_STAGES) {
    const value = raw[stage] ?? raw.probabilities?.[stage] ?? BROKER_FORECAST_DEFAULT_ASSUMPTIONS[stage];
    const parsed = Number(value);
    probabilities[stage] = Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : BROKER_FORECAST_DEFAULT_ASSUMPTIONS[stage];
  }
  return probabilities;
}

export function validateBrokerForecastAssumptions(input = {}) {
  const probabilities = normalizeBrokerForecastAssumptions(input);
  let previous = -1;
  for (const stage of BROKER_FORECAST_STAGES) {
    const value = probabilities[stage];
    if (value < 0 || value > 100) return { ok: false, error: `La probabilidad de ${stage} debe estar entre 0 y 100%.` };
    if (value < previous) return { ok: false, error: "Las probabilidades deben aumentar o mantenerse a medida que avanza el proceso comercial." };
    previous = value;
  }
  return { ok: true, probabilities };
}

function operationEstimatedAmount(operation, propertiesByLegacyId = new Map()) {
  const data = dataOf(operation);
  const direct = number(data.agreedAmount || data.offerAmount || data.estimatedValue || data.publicationPrice || data.amount);
  if (direct > 0) return direct;
  return number(propertiesByLegacyId.get(text(data.propertyId))?.data?.price);
}

function daysBetween(start, end) {
  const first = start ? new Date(start) : null;
  const last = end ? new Date(end) : null;
  if (!first || !last || Number.isNaN(first.getTime()) || Number.isNaN(last.getTime())) return null;
  return Math.max(0, Math.round((last.getTime() - first.getTime()) / 86_400_000));
}

function terminalDate(operation) {
  const events = Array.isArray(dataOf(operation).timeline) ? dataOf(operation).timeline : [];
  const result = [...events].reverse().find((event) => ["ENTREGA_Y_POSTVENTA", "CANCELADA", "PERDIDA", "CERRADA"].includes(text(event?.stage).toUpperCase()));
  return result?.at || operation.updatedAt || null;
}

function parseCampaignContext(campaign) {
  const raw = typeof campaign?.template === "string" ? campaign.template : campaign?.template;
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    return parsed?.brokerContext && typeof parsed.brokerContext === "object" ? parsed.brokerContext : {};
  } catch {
    return {};
  }
}

/**
 * El tablero no guarda sus propios totales: recibe la misma lectura de
 * operaciones ya utilizada por el resumen operativo y expone el cálculo para
 * auditoría. Los importes son proyecciones, no ingresos reconocidos.
 */
export function buildBrokerExecutiveDashboard({ readModel, operations = [], properties = [], teamMembers = [], campaigns = [], assumptions = BROKER_FORECAST_DEFAULT_ASSUMPTIONS, now = new Date() } = {}) {
  const probabilities = normalizeBrokerForecastAssumptions(assumptions);
  const propertiesByLegacyId = new Map(properties.map((property) => [String(property.id), property]));
  const namesById = new Map(teamMembers.map((member) => [String(member.id), text(member.name || member.email, "Responsable autorizado")]));
  const insights = readModel?.pipeline?.operations || [];
  const insightById = new Map(insights.map((item) => [item.operationId, item]));
  const active = insights.filter((item) => !item.terminal);
  const terminal = insights.filter((item) => item.terminal);
  const advanced = active.filter((item) => ["QUALIFIED", "VISIT_SCHEDULED", "OFFER", "NEGOTIATION", "CLOSING", "POSTSALE"].includes(item.pipelineKey));
  const closedWithDate = terminal.map((item) => {
    const operation = operations.find((candidate) => candidate.id === item.operationId);
    return daysBetween(operation?.createdAt, terminalDate(operation));
  }).filter((item) => item !== null);

  const forecastLines = active.map((insight) => {
    const operation = operations.find((candidate) => candidate.id === insight.operationId);
    const commercialStage = operation?.journey?.commercial?.key || "CAPTACION";
    const probabilityPct = probabilities[commercialStage] ?? 0;
    const amount = operationEstimatedAmount(operation, propertiesByLegacyId);
    const commission = number(insight.projectedCommission || dataOf(operation).estimatedCommission);
    return {
      operationId: insight.operationId,
      title: insight.title,
      commercialStage,
      probabilityPct,
      amount,
      weightedAmount: Math.round(amount * probabilityPct) / 100,
      projectedCommission: commission,
      weightedCommission: Math.round(commission * probabilityPct) / 100,
      responsible: namesById.get(String(insight.assignedToId)) || "Sin responsable",
      health: insight.health,
      stageAgeDays: insight.stageAgeDays
    };
  });

  const totalProjected = forecastLines.reduce((sum, item) => sum + item.amount, 0);
  const weightedForecast = forecastLines.reduce((sum, item) => sum + item.weightedAmount, 0);
  const weightedCommission = forecastLines.reduce((sum, item) => sum + item.weightedCommission, 0);
  const closeTimeDays = closedWithDate.length ? Math.round(closedWithDate.reduce((sum, value) => sum + value, 0) / closedWithDate.length) : null;
  const dimensions = (dimension) => {
    const rows = new Map();
    for (const operation of operations) {
      const insight = insightById.get(operation.id);
      if (!insight) continue;
      const property = propertiesByLegacyId.get(String(dataOf(operation).propertyId));
      const key = dimension === "commune"
        ? text(property?.data?.comuna || property?.data?.commune, "Sin comuna")
        : namesById.get(String(insight.assignedToId)) || "Sin responsable";
      const item = rows.get(key) || { label: key, total: 0, advanced: 0, closed: 0, projected: 0 };
      item.total += 1;
      if (["QUALIFIED", "VISIT_SCHEDULED", "OFFER", "NEGOTIATION", "CLOSING", "POSTSALE"].includes(insight.pipelineKey)) item.advanced += 1;
      if (insight.terminal) item.closed += 1;
      item.projected += operationEstimatedAmount(operation, propertiesByLegacyId);
      rows.set(key, item);
    }
    return [...rows.values()].map((item) => ({ ...item, conversionPct: item.total ? Math.round((item.advanced / item.total) * 100) : 0 })).sort((left, right) => right.total - left.total || right.conversionPct - left.conversionPct);
  };
  const campaignRoi = campaigns.map((campaign) => {
    const context = parseCampaignContext(campaign);
    const investment = number(context.investment);
    const expectedRevenue = number(context.expectedRevenue);
    const expectedLeads = number(context.expectedLeads);
    return {
      id: campaign.id,
      name: text(campaign.name, "Campaña sin nombre"),
      status: text(campaign.status, "DRAFT"),
      investment,
      expectedRevenue,
      expectedLeads,
      costPerLead: expectedLeads > 0 ? Math.round(investment / expectedLeads) : null,
      potentialRoiPct: investment > 0 ? Math.round(((expectedRevenue - investment) / investment) * 100) : null,
      source: context.predicted ? "PROYECCION_INTERNA" : "SIN_PROYECCION"
    };
  }).sort((left, right) => right.expectedRevenue - left.expectedRevenue || left.investment - right.investment);

  return {
    generatedAt: new Date(now).toISOString(),
    scope: readModel?.scope || { level: "AUTHORIZED", description: "Solo se muestran registros dentro de tu alcance autorizado." },
    kpis: {
      effectivenessPct: active.length ? Math.round((advanced.length / active.length) * 100) : 0,
      activeOperations: active.length,
      closedOperations: terminal.length,
      projectedRevenue: totalProjected,
      weightedForecast,
      weightedCommission,
      averageCloseTimeDays: closeTimeDays,
    },
    forecast: {
      notice: "Proyección ponderada según probabilidades configurables por empresa. No equivale a ingreso, comisión devengada ni cierre garantizado.",
      assumptions: probabilities,
      lines: forecastLines.sort((left, right) => right.weightedAmount - left.weightedAmount).slice(0, 50)
    },
    bottlenecks: readModel?.pipeline?.bottlenecks || [],
    risks: insights.filter((item) => item.health === "RISK").map((item) => ({ operationId: item.operationId, title: item.title, detail: item.detail, stage: item.pipelineLabel, responsible: namesById.get(String(item.assignedToId)) || "Sin responsable" })),
    conversion: { byCommune: dimensions("commune"), byBroker: dimensions("broker") },
    teamRanking: (readModel?.team || []).map((member) => ({ ...member, conversionPct: (() => {
      const own = insights.filter((item) => String(item.assignedToId) === String(member.userId));
      return own.length ? Math.round((own.filter((item) => ["QUALIFIED", "VISIT_SCHEDULED", "OFFER", "NEGOTIATION", "CLOSING", "POSTSALE"].includes(item.pipelineKey)).length / own.length) * 100) : 0;
    })() })),
    campaigns: campaignRoi,
    recommendations: readModel?.priorities?.filter((item) => ["OPERATION_HEALTH", "OPERATION_NEXT_STAGE", "PROPERTY_COMPLETENESS"].includes(item.source)).slice(0, 8) || []
  };
}

function trackerEvents(operation) {
  return Array.isArray(dataOf(operation).timeline) ? dataOf(operation).timeline : [];
}

function trackerChecks(operation) {
  const value = dataOf(operation).trackerChecklist;
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function eventFor(events, type, trackerKey) {
  return [...events].reverse().find((event) => text(event?.type).toUpperCase() === type && text(event?.trackerKey).toUpperCase() === trackerKey) || null;
}

function validDate(value) {
  const result = value ? new Date(value) : null;
  return result && !Number.isNaN(result.getTime()) ? result : null;
}

function trackerStageStartedAt(operation, stage, events) {
  const event = [...events].reverse().find((item) => (
    ["STAGE_CHANGED", "OPERATION_CREATED"].includes(text(item?.type).toUpperCase())
    && text(item?.stage) === stage
    && validDate(item?.at)
  ));
  return event?.at || operation?.updatedAt || operation?.createdAt || null;
}

function documentSummary(documents) {
  const allowed = Array.isArray(documents) ? documents : [];
  const completedStatuses = new Set(["AVAILABLE", "APPROVED", "SIGNED", "GRANTED"]);
  const items = allowed.map((document) => ({
    id: document.id,
    title: text(document.title, "Documento sin nombre"),
    type: text(document.recordType),
    status: text(document.status, "PENDIENTE").toUpperCase(),
    updatedAt: document.updatedAt?.toISOString?.() || document.updatedAt || null
  }));
  return {
    total: items.length,
    completed: items.filter((item) => completedStatuses.has(item.status)).length,
    pending: items.filter((item) => !completedStatuses.has(item.status)).length,
    items: items.slice(0, 12)
  };
}

export function buildBrokerOperationTracker({ operation, saleCase = null, documents = [], actor = "", now = new Date() } = {}) {
  if (!operation || text(dataOf(operation).operationType).toUpperCase() !== "SALE") return null;
  const journey = operation.journey || {};
  const currentTrackerKey = journey?.tracker?.key || null;
  const currentSourceStage = normalizeBrokerStage("SALE", dataOf(operation).stage);
  const events = trackerEvents(operation);
  const checks = trackerChecks(operation);
  const checklist = brokerStageChecklist("SALE", currentSourceStage);
  const requestedActor = text(actor).toUpperCase();
  const currentIndex = BROKER_JOURNEY_CATALOG.tracker.findIndex((item) => item.key === currentTrackerKey);
  const startedAt = trackerStageStartedAt(operation, currentSourceStage, events);
  const stageAgeDays = daysBetween(startedAt, now) ?? 0;
  const responsible = text(operation.assignedToName || dataOf(operation).assignedToName || operation.assignedToId, "Sin responsable asignado");
  const operationalRisk = !operation.assignedToId
    ? { level: "ALTO", detail: "La operación no tiene una persona responsable asignada." }
    : stageAgeDays >= 30
      ? { level: "ALTO", detail: `La etapa actual lleva ${stageAgeDays} días sin cambio de etapa.` }
      : stageAgeDays >= 14
        ? { level: "MEDIO", detail: `La etapa actual lleva ${stageAgeDays} días y requiere seguimiento.` }
        : { level: "CONTROLADO", detail: "La etapa se encuentra dentro del umbral operativo de seguimiento." };
  const nextTracker = BROKER_JOURNEY_CATALOG.tracker[currentIndex + 1] || null;
  const currentDocumentSummary = documentSummary(documents);
  const milestones = BROKER_JOURNEY_CATALOG.tracker.map((item, index) => {
    const completion = eventFor(events, "TRACKER_STAGE_COMPLETED", item.key);
    const isCurrent = item.key === currentTrackerKey;
    const entries = isCurrent ? checklist.map((label, itemIndex) => {
      const key = `${currentSourceStage}:${itemIndex}`;
      const saved = checks[key] && typeof checks[key] === "object" ? checks[key] : {};
      return { key, label, completed: Boolean(saved.completedAt), completedAt: saved.completedAt || null, completedBy: saved.completedBy || null, note: saved.note || null };
    }) : [];
    return {
      key: item.key,
      label: item.label,
      status: completion ? "COMPLETADA" : isCurrent ? (stageAgeDays >= 14 ? "ATRASADA" : "ACTUAL") : index < currentIndex ? "SIN_EVIDENCIA" : "PENDIENTE",
      isCurrent,
      completedAt: completion?.at || null,
      checklist: entries,
      allChecklistComplete: isCurrent ? entries.every((entry) => entry.completed) : false,
      summary: completion ? "Hito completado con evento trazable." : isCurrent ? "Completa el checklist de la etapa actual antes de avanzar." : index < currentIndex ? "La posición histórica no acredita que este hito esté completado." : "Pendiente de alcanzar en el proceso comercial."
    };
  });
  const actorView = BROKER_TRACKER_ACTORS.includes(requestedActor) ? {
    actor: requestedActor,
    visibilityNotice: "Vista simulada de portal. No reemplaza autenticación ni permisos reales de un tercero.",
    operation: { title: operation.title, currentStage: journey?.tracker?.label || "En preparación", property: saleCase?.propertyTitle || null },
    timeline: milestones.map((milestone) => ({ key: milestone.key, label: milestone.label, status: milestone.status, completedAt: milestone.completedAt, visibleDetail: milestone.isCurrent ? "En gestión por el equipo responsable." : milestone.status === "COMPLETADA" ? "Hito registrado." : "Pendiente." }))
  } : null;
  return {
    operationId: operation.id,
    source: { operationStage: currentSourceStage, commercialStage: journey?.commercial || null, pipelineStage: journey?.pipeline || null, trackerStage: journey?.tracker || null, evidencePolicy: journey?.evidencePolicy || "POSITION_IS_NOT_COMPLETION" },
    notice: "El tracker usa la misma operación y línea de tiempo del negocio. No crea una copia de etapas ni ejecuta comunicaciones externas.",
    saleCase: saleCase ? { buyerName: saleCase.buyerName || null, offerStatus: saleCase.offerStatus, promiseStatus: saleCase.promiseStatus, titleStudyStatus: saleCase.titleStudyStatus, deedStatus: saleCase.deedStatus, cbrStatus: saleCase.cbrStatus } : null,
    context: {
      responsible,
      stageStartedAt: validDate(startedAt)?.toISOString?.() || null,
      stageAgeDays,
      risk: operationalRisk,
      nextStep: nextTracker ? `Completar los controles de “${BROKER_JOURNEY_CATALOG.tracker[currentIndex]?.label || "la etapa actual"}” para habilitar “${nextTracker.label}”.` : "Verifica la inscripción y registra la entrega o postventa en el flujo operativo general.",
      documents: currentDocumentSummary
    },
    milestones,
    current: milestones.find((item) => item.isCurrent) || null,
    actorView,
    commercialMapping: [
      { commercial: "Captación", tracker: "Estudio de título inicial" },
      { commercial: "Tasación", tracker: "Evaluación comercial y tasación" },
      { commercial: "Publicación", tracker: "Publicación y seguimiento" },
      { commercial: "Interesados", tracker: "Filtro de compradores" },
      { commercial: "Negociación", tracker: "Oferta de compra" },
      { commercial: "Cierre legal", tracker: "Promesa, estudio definitivo, escritura e inscripción" }
    ]
  };
}

export function trackerChecklistUpdate({ operation, checklistKey, completed, note, actor }) {
  const tracker = buildBrokerOperationTracker({ operation });
  const current = tracker?.current;
  if (!current) return { ok: false, error: "La operación no tiene una etapa de tracker válida para actualizar." };
  const item = current.checklist.find((entry) => entry.key === checklistKey);
  if (!item) return { ok: false, error: "El punto de checklist no pertenece a la etapa actual." };
  const currentChecks = trackerChecks(operation);
  const checks = { ...currentChecks, [checklistKey]: completed ? { completedAt: new Date().toISOString(), completedBy: text(actor, "Usuario autorizado"), note: text(note) || null } : { completedAt: null, completedBy: null, note: text(note) || null } };
  return { ok: true, checks, trackerKey: current.key };
}

export function trackerAdvanceReadiness(operation) {
  const tracker = buildBrokerOperationTracker({ operation });
  if (!tracker?.current) return { ok: false, error: "La operación no tiene una etapa de tracker válida para completar." };
  const missing = tracker.current.checklist.filter((item) => !item.completed).map((item) => item.label);
  return missing.length ? { ok: false, error: "Completa el checklist del tracker antes de avanzar.", missing } : { ok: true, tracker };
}
