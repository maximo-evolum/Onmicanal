/** Archivo: Valida y describe acciones internas derivadas del matching de Broker OS. */

const ACTIONS = Object.freeze({
  PREPARE_PROFILE: { status: "PREPARED", label: "Ficha preparada" },
  REQUEST_VISIT: { status: "PENDING_CONFIRMATION", label: "Solicitud de visita pendiente" },
  DISCARD_MATCH: { status: "DISCARDED", label: "Coincidencia descartada" }
});

function text(value, fallback = "") {
  const result = String(value ?? "").trim();
  return result || fallback;
}

export const BROKER_MATCH_ACTIONS = Object.freeze(Object.keys(ACTIONS));

/**
 * Una solicitud de visita solo documenta que el equipo debe revisar el caso.
 * No crea una visita confirmada ni ejecuta ningún contacto externo.
 */
export function validateBrokerMatchAction(input = {}, match = {}) {
  const action = text(input.action).toUpperCase();
  const reason = text(input.reason);
  if (!ACTIONS[action]) return { ok: false, error: "La acción de matching no es válida." };
  if (!text(input.leadId) || !text(input.propertyId)) return { ok: false, error: "Selecciona un comprador y una propiedad del mismo matching." };
  if (reason.length > 1200) return { ok: false, error: "La observación no puede superar 1.200 caracteres." };
  if (action === "DISCARD_MATCH" && reason.length < 5) return { ok: false, error: "Explica brevemente por qué se descarta esta coincidencia." };
  if (action === "REQUEST_VISIT" && match?.compatibility?.operationCompatible === false) {
    return { ok: false, error: "No se puede solicitar visita: la operación buscada no es compatible con la propiedad." };
  }
  if (action === "REQUEST_VISIT" && match?.compatibility?.propertyAvailable === false) {
    return { ok: false, error: "No se puede solicitar visita: la propiedad no está disponible." };
  }
  return { ok: true, action, reason, status: ACTIONS[action].status, label: ACTIONS[action].label };
}

export function buildBrokerMatchActionData({ leadId, propertyId, validation, match, userId }) {
  return {
    version: "BROKER_MATCH_ACTION_V1",
    leadId: String(leadId),
    propertyId: String(propertyId),
    action: validation.action,
    reason: validation.reason || null,
    score: Number(match?.score || 0),
    reasonsFor: Array.isArray(match?.reasons) ? match.reasons : [],
    reasonsAgainst: Array.isArray(match?.cautions) ? match.cautions : [],
    warnings: Array.isArray(match?.warnings) ? match.warnings : [],
    compatibility: match?.compatibility || null,
    requestedByUserId: userId || null,
    // Salvaguardas explícitas: una acción Broker no equivale a envío ni visita.
    externalContactExecuted: false,
    visitConfirmed: false,
    createdFrom: "broker_matching"
  };
}

export function brokerMatchActionPayload(record) {
  const data = record?.data && typeof record.data === "object" && !Array.isArray(record.data) ? record.data : {};
  return {
    id: record.id,
    leadId: text(data.leadId),
    propertyId: text(data.propertyId),
    action: text(data.action),
    status: text(record.status),
    label: ACTIONS[text(data.action)]?.label || "Gestión de matching",
    reason: text(data.reason) || null,
    score: Number(data.score || 0),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    createdByUserId: record.assignedToId || text(data.requestedByUserId) || null,
    externalContactExecuted: false,
    visitConfirmed: false
  };
}
