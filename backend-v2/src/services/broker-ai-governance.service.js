/** Archivo: Define el gobierno seguro de reglas y agentes IA de Broker OS. */
import { BROKER_AGENT_CATALOG, BROKER_AUTOMATION_RULES } from "./broker-workflows.service.js";

export const BROKER_AI_CUSTOM_RULE_TYPE = "broker_ai_custom_rule";

export const BROKER_AI_AGENT_STATUSES = Object.freeze({
  AVAILABLE: { label: "Disponible", detail: "La capacidad indicada está disponible dentro de los límites declarados." },
  LIMITED: { label: "Disponible con límites", detail: "Funciona solo para el alcance descrito y nunca ejecuta acciones externas." },
  IN_DEVELOPMENT: { label: "En desarrollo", detail: "La capacidad aún no está habilitada para uso operativo." },
  NOT_ENABLED: { label: "No habilitado", detail: "No debe presentarse como una capacidad disponible para clientes ni equipo." },
});

const CONDITION_DEFINITIONS = Object.freeze({
  PROPERTY_INCOMPLETE: {
    label: "Ficha de propiedad incompleta",
    sources: ["PROPERTY_COMPLETENESS"],
    action: "Preparar una alerta interna para completar antecedentes.",
  },
  OPERATION_STALLED: {
    label: "Operación sin avance o siguiente etapa pendiente",
    sources: ["OPERATION_HEALTH", "OPERATION_NEXT_STAGE"],
    action: "Preparar una prioridad interna de seguimiento para revisión humana.",
  },
  DOCUMENTS_PENDING: {
    label: "Antecedentes documentales pendientes",
    sources: ["OPERATION_DOCUMENT_READINESS", "DUE_DATE_CONTROL"],
    action: "Preparar una alerta interna para revisar el expediente.",
  },
  COLLECTIONS_PENDING: {
    label: "Cobro o arriendo pendiente de control",
    sources: ["COLLECTION_CONTROL"],
    action: "Preparar un recordatorio interno sin enviar comunicaciones.",
  },
  MAINTENANCE_PENDING: {
    label: "Mantención abierta o cotización por revisar",
    sources: ["MAINTENANCE_OPEN"],
    action: "Preparar una prioridad interna para revisar alcance y responsable.",
  },
  HUMAN_REVIEW_PENDING: {
    label: "Recomendación IA pendiente de revisión humana",
    sources: ["AI_EVALUATION_PENDING"],
    action: "Preparar una alerta interna para registrar una decisión humana.",
  },
});

const OFFICIAL_RULE_CONDITIONS = Object.freeze({
  ficha_incompleta: "PROPERTY_INCOMPLETE",
  documento_vencimiento: "DOCUMENTS_PENDING",
  visita_sin_seguimiento: "OPERATION_STALLED",
  cobro_arriendo: "COLLECTIONS_PENDING",
  mantencion_cotizada: "MAINTENANCE_PENDING",
});

function text(value, fallback = "") {
  const result = String(value ?? "").trim();
  return result || fallback;
}

function dataOf(record) {
  return record?.data && typeof record.data === "object" && !Array.isArray(record.data) ? record.data : {};
}

function boolean(value, fallback = false) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return ["true", "1", "yes", "si", "sí"].includes(value.trim().toLowerCase());
  return fallback;
}

function normalizeConditionKey(value) {
  const key = text(value).toUpperCase();
  return CONDITION_DEFINITIONS[key] ? key : null;
}

function slug(value) {
  return text(value, "regla")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "regla";
}

function sanitizeTitle(value) {
  const title = text(value);
  if (title.length < 4) return { ok: false, error: "Indica un nombre de al menos 4 caracteres para la regla." };
  if (title.length > 120) return { ok: false, error: "El nombre de la regla puede tener como máximo 120 caracteres." };
  return { ok: true, value: title };
}

function priorityMatches(priorities, conditionKey) {
  const condition = CONDITION_DEFINITIONS[conditionKey];
  if (!condition) return [];
  return (priorities || []).filter((priority) => condition.sources.includes(text(priority?.source).toUpperCase()));
}

function priorityEvidence(priority) {
  return {
    id: text(priority?.id),
    title: text(priority?.title, "Prioridad sin título"),
    detail: text(priority?.detail, "Sin detalle adicional."),
    priority: text(priority?.priority, "LOW").toUpperCase(),
    propertyId: priority?.propertyId || null,
    operationId: priority?.operationId || null,
  };
}

function ruleGovernance() {
  return {
    autonomy: "HUMAN_APPROVAL",
    autonomyLabel: "Solo análisis y preparación interna",
    externalContact: "BLOCKED",
    externalContactLabel: "Contacto externo bloqueado",
    simulator: "NO_SEND",
    simulatorLabel: "Simulador sin envío ni cambios reales",
    stateChanges: false,
  };
}

function officialRulePayload(rule, priorities) {
  const conditionKey = OFFICIAL_RULE_CONDITIONS[rule.key];
  const condition = CONDITION_DEFINITIONS[conditionKey];
  const matches = priorityMatches(priorities, conditionKey);
  return {
    id: `official:${rule.key}`,
    key: rule.key,
    kind: "OFFICIAL",
    editable: false,
    active: true,
    title: rule.title,
    trigger: rule.trigger,
    action: rule.action,
    approval: rule.approval,
    conditionKey,
    conditionLabel: condition?.label || "Control operacional",
    ...ruleGovernance(),
    matched: matches.length,
    evidence: matches.slice(0, 5).map(priorityEvidence),
  };
}

export function normalizeBrokerAiCustomRule(input = {}, previous = {}) {
  const titleResult = sanitizeTitle(input.title ?? previous.title);
  if (!titleResult.ok) return titleResult;
  const conditionKey = normalizeConditionKey(input.conditionKey ?? previous.conditionKey);
  if (!conditionKey) return { ok: false, error: "Selecciona una condición operativa válida para la regla." };
  const description = text(input.description ?? previous.description);
  if (description.length > 500) return { ok: false, error: "La descripción puede tener como máximo 500 caracteres." };
  return {
    ok: true,
    value: {
      key: text(previous.key) || `custom-${slug(titleResult.value)}-${Date.now().toString(36)}`,
      title: titleResult.value,
      description,
      conditionKey,
      isActive: input.isActive === undefined ? boolean(previous.isActive, true) : boolean(input.isActive, true),
      // Estos valores no son configurables por la interfaz ni por la API: el
      // catálogo personalizado jamás obtiene capacidad de enviar, publicar,
      // firmar, aprobar ni modificar registros del negocio.
      internalAction: "PREPARE_INTERNAL_ALERT",
      autonomy: "HUMAN_APPROVAL",
      externalContact: "BLOCKED",
      simulator: "NO_SEND",
      version: 1,
    }
  };
}

export function brokerAiCustomRulePayload(record, priorities = []) {
  const data = dataOf(record);
  const conditionKey = normalizeConditionKey(data.conditionKey);
  const condition = CONDITION_DEFINITIONS[conditionKey];
  const matches = priorityMatches(priorities, conditionKey);
  return {
    id: record.id,
    key: text(data.key, `custom:${record.id}`),
    kind: "CUSTOM",
    editable: true,
    active: boolean(data.isActive, true),
    title: text(data.title, record.title || "Regla personalizada"),
    description: text(data.description),
    trigger: condition?.label || "Condición sin configurar",
    action: condition?.action || "Preparar una alerta interna para revisión humana.",
    approval: "Requiere una persona autorizada antes de cualquier acción operativa.",
    conditionKey,
    conditionLabel: condition?.label || "Condición sin configurar",
    createdAt: record.createdAt || null,
    updatedAt: record.updatedAt || null,
    ...ruleGovernance(),
    matched: matches.length,
    evidence: matches.slice(0, 5).map(priorityEvidence),
  };
}

function agentPayload(agent) {
  const state = BROKER_AI_AGENT_STATUSES[agent.status] || BROKER_AI_AGENT_STATUSES.NOT_ENABLED;
  return {
    key: agent.key,
    name: agent.label,
    status: Object.hasOwn(BROKER_AI_AGENT_STATUSES, agent.status) ? agent.status : "NOT_ENABLED",
    statusLabel: state.label,
    statusDetail: state.detail,
    description: agent.scope,
    limitation: text(agent.limitation, "Requiere revisión humana y no ejecuta acciones externas."),
    externalContact: "BLOCKED",
    autonomousActions: false,
  };
}

function triggeredAlertPayload(record) {
  const data = dataOf(record);
  const operationId = data.operationId || null;
  const propertyId = data.propertyId || null;
  const area = text(data.area, "operations");
  const tab = area === "overview" ? "operations" : area;
  return {
    id: record.id,
    title: text(record.title, "Alerta interna"),
    priority: text(data.priority, "MEDIUM").toUpperCase(),
    detail: text(data.detail, "Alerta interna pendiente de revisión."),
    source: text(data.source, "broker_automation_scan"),
    requiresHumanApproval: Boolean(data.requiresHumanApproval),
    createdAt: record.createdAt || null,
    href: operationId
      ? `/realty?view=broker_os&tab=operations&operationId=${encodeURIComponent(operationId)}`
      : propertyId
        ? `/realty?view=broker_os&tab=operations&propertyId=${encodeURIComponent(propertyId)}`
        : `/realty?view=broker_os&tab=${encodeURIComponent(tab)}`,
  };
}

export function buildBrokerAiGovernanceSnapshot({ readModel, customRules = [], alerts = [], evaluations = [] } = {}) {
  if (!readModel || typeof readModel !== "object") throw new Error("Se requiere la lectura operacional de Broker para evaluar las reglas IA.");
  const priorities = Array.isArray(readModel.priorities) ? readModel.priorities : [];
  const officialRules = BROKER_AUTOMATION_RULES.map((rule) => officialRulePayload(rule, priorities));
  const personalizedRules = customRules.map((record) => brokerAiCustomRulePayload(record, priorities));
  const rules = [...officialRules, ...personalizedRules];
  const simulations = rules.filter((rule) => rule.active).map((rule) => ({
    ruleId: rule.id,
    ruleKey: rule.key,
    title: rule.title,
    matched: rule.matched,
    evidence: rule.evidence,
    wouldPrepareInternalAlert: rule.matched > 0,
    externalContact: false,
    stateChanges: false,
    notice: rule.matched > 0
      ? "Se prepararían alertas internas para revisión. No se enviará ningún mensaje ni se modificarán estados."
      : "No se detectaron coincidencias dentro del alcance autorizado.",
  }));
  const pendingEvaluations = (evaluations || []).filter((record) => text(dataOf(record).decision || record.status, "PENDING_REVIEW").toUpperCase() === "PENDING_REVIEW").length;
  const triggeredAlerts = (alerts || []).filter((alert) => text(alert.status).toUpperCase() !== "RESOLVED").map(triggeredAlertPayload);
  return {
    version: "BROKER_AI_GOVERNANCE_V1",
    generatedAt: readModel.generatedAt || new Date().toISOString(),
    scope: readModel.scope || { level: "AUTHORIZED", description: "Registros dentro de tu alcance autorizado." },
    policy: {
      notice: "Las reglas solo analizan registros visibles. Ninguna puede contactar personas, publicar inmuebles, cambiar estados, aprobar contratos, firmar ni ejecutar pagos.",
      externalContact: "BLOCKED",
      stateChanges: false,
      simulationMode: "NO_SEND",
    },
    summary: {
      officialRules: officialRules.length,
      customRules: personalizedRules.length,
      activeRules: rules.filter((rule) => rule.active).length,
      matchingRules: rules.filter((rule) => rule.active && rule.matched > 0).length,
      pendingEvaluations,
      triggeredAlerts: triggeredAlerts.length,
    },
    agents: BROKER_AGENT_CATALOG.map(agentPayload),
    conditions: Object.entries(CONDITION_DEFINITIONS).map(([key, definition]) => ({ key, label: definition.label, action: definition.action })),
    rules,
    simulation: {
      mode: "NO_SEND",
      generatedAt: readModel.generatedAt || new Date().toISOString(),
      executions: simulations,
      notice: "La simulación es de solo lectura: no crea alertas, no envía comunicaciones y no cambia registros reales.",
    },
    triggeredAlerts,
  };
}

