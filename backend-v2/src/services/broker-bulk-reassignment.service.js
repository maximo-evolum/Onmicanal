/** Archivo: Normaliza y valida previsualizaciones de reasignación masiva de cartera Broker. */

export const BROKER_BULK_REASSIGNMENT_TYPES = Object.freeze({
  property: { label: "Propiedades", resource: "commercial" },
  broker_operation: { label: "Operaciones", resource: "operations" }
});

function text(value, fallback = "") {
  const result = String(value ?? "").trim();
  return result || fallback;
}

function uniqueIds(values = []) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => text(value)).filter(Boolean))];
}

function timestamp(value) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

export function brokerBulkReassignmentDefinition(recordType) {
  return BROKER_BULK_REASSIGNMENT_TYPES[text(recordType).toLowerCase()] || null;
}

export function normalizeBrokerBulkReassignment(input = {}) {
  const recordType = text(input.recordType).toLowerCase();
  const definition = brokerBulkReassignmentDefinition(recordType);
  const recordIds = uniqueIds(input.recordIds);
  const assignedToId = text(input.assignedToId);
  const reason = text(input.reason);
  if (!definition) return { ok: false, error: "Selecciona propiedades u operaciones para la reasignación masiva." };
  if (!recordIds.length) return { ok: false, error: "Selecciona al menos un registro para reasignar." };
  if (recordIds.length > 100) return { ok: false, error: "Una reasignación masiva admite hasta 100 registros por confirmación." };
  if (!assignedToId) return { ok: false, error: "Selecciona una persona responsable para continuar." };
  if (reason.length < 5 || reason.length > 1200) return { ok: false, error: "El motivo de la reasignación debe tener entre 5 y 1200 caracteres." };
  return { ok: true, data: { recordType, recordIds, assignedToId, reason }, definition };
}

export function normalizeBrokerBulkSnapshot(input, recordIds = []) {
  const rows = Array.isArray(input) ? input : [];
  const expected = new Map();
  for (const row of rows) {
    const id = text(row?.id);
    const updatedAt = timestamp(row?.updatedAt);
    if (id && updatedAt) expected.set(id, updatedAt);
  }
  const requiredIds = uniqueIds(recordIds);
  if (requiredIds.some((id) => !expected.has(id))) return { ok: false, error: "La vista previa está incompleta o venció. Genera una nueva antes de confirmar." };
  return { ok: true, expected };
}

export function brokerBulkReassignmentPreview({ records = [], definition, assignee, reason }) {
  const targetId = text(assignee?.id);
  const items = records.map((record) => {
    const unchanged = String(record.assignedToId || "") === targetId;
    return {
      id: String(record.id),
      title: text(record.title, definition?.label === "Propiedades" ? "Propiedad sin título" : "Operación sin título"),
      status: text(record.status, "ACTIVE"),
      previousAssignee: record.assignedTo ? { id: String(record.assignedTo.id), name: text(record.assignedTo.name, record.assignedTo.email || "Responsable actual") } : null,
      previousAssigneeId: record.assignedToId || null,
      updatedAt: new Date(record.updatedAt).toISOString(),
      unchanged
    };
  });
  const changes = items.filter((item) => !item.unchanged);
  return {
    recordType: definition ? Object.entries(BROKER_BULK_REASSIGNMENT_TYPES).find(([, value]) => value === definition)?.[0] || null : null,
    label: definition?.label || "Registros",
    resource: definition?.resource || null,
    reason: text(reason),
    assignee: { id: targetId, name: text(assignee?.name, assignee?.email || "Responsable seleccionado"), score: Number(assignee?.workload?.score || 0) },
    requestedCount: items.length,
    changeCount: changes.length,
    unchangedCount: items.length - changes.length,
    items,
    snapshot: items.map((item) => ({ id: item.id, updatedAt: item.updatedAt }))
  };
}

export function staleBrokerBulkReassignmentRecords(records = [], expected = new Map()) {
  return records.filter((record) => expected.get(String(record.id)) !== new Date(record.updatedAt).toISOString()).map((record) => ({ id: String(record.id), title: text(record.title, "Registro sin título") }));
}

export function brokerBulkReassignmentEvent({ record, assignedToId, reason, actor, at = new Date().toISOString() }) {
  return {
    at,
    type: "BULK_ASSIGNMENT_CHANGED",
    fromAssigneeId: record.assignedToId || null,
    toAssigneeId: assignedToId,
    reason,
    by: text(actor, "Jefatura autorizada"),
    method: "bulk_reassignment_confirmed"
  };
}
