/** Archivo: Define reglas reutilizables para la responsabilidad operativa de Broker OS. */

export const BROKER_ACCOUNTABILITY_RECORD_TYPES = Object.freeze([
  "maintenance_ticket",
  "remodeling_project",
  "property_inspection",
  "property_handover",
  "post_sale_case",
  "warranty_case",
]);

function text(value) {
  return String(value ?? "").trim();
}

export function requiresBrokerAccountableOwner(recordType) {
  return BROKER_ACCOUNTABILITY_RECORD_TYPES.includes(text(recordType).toLowerCase());
}

// Al crear controles de alcance restringido se conserva el autor como dueño.
// Para procesos operativos siempre se exige dueño, incluso si el registro viene
// de datos históricos que originalmente no lo tenían.
export function resolveBrokerAccountableAssignee({ recordType, requestedAssigneeId, existingAssigneeId, actorId, restrictToActor = false } = {}) {
  const requested = text(requestedAssigneeId);
  if (requested) return requested;
  if (requiresBrokerAccountableOwner(recordType) || restrictToActor) return text(actorId);
  return text(existingAssigneeId);
}
