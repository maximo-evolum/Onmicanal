/** Archivo: Normaliza alertas y trazabilidad de gobierno para la administración de Broker OS. */

const SENSITIVE_KEY = /(?:pass(?:word)?|secret|token|authorization|cookie|credential|api[_-]?key|bearer|session)/i;
const MAX_TEXT = 500;

function text(value, fallback = "") {
  const result = String(value ?? "").trim();
  return result || fallback;
}

function iso(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function recordData(record) {
  return record?.data && typeof record.data === "object" && !Array.isArray(record.data) ? record.data : {};
}

/**
 * Conserva solo información de contexto segura para mostrar en el panel.
 * La bitácora original nunca se modifica; esta vista elimina secretos y
 * limita profundidad/tamaño para que los metadatos no se vuelvan una fuga
 * accidental ni una respuesta excesiva de la API.
 */
export function sanitizeBrokerAuditMetadata(value, depth = 0) {
  if (depth > 3 || value === null || value === undefined) return null;
  if (typeof value === "string") return value.slice(0, MAX_TEXT);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.slice(0, 12).map((item) => sanitizeBrokerAuditMetadata(item, depth + 1));
  if (typeof value !== "object") return String(value).slice(0, MAX_TEXT);

  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !SENSITIVE_KEY.test(key))
    .slice(0, 24)
    .map(([key, item]) => [key, sanitizeBrokerAuditMetadata(item, depth + 1)]));
}

export function normalizeBrokerAlertResolution(input = {}) {
  const note = text(input.note);
  if (note.length < 3) return { ok: false, error: "Indica una resolución de al menos 3 caracteres para cerrar la alerta." };
  if (note.length > 1500) return { ok: false, error: "La resolución no puede superar 1.500 caracteres." };
  return { ok: true, note };
}

export function buildBrokerGovernanceSummary({ alerts = [], auditLogs = [], users = [], now = new Date() } = {}) {
  const usersById = new Map(users.map((user) => [String(user.id), user]));
  const thirtyDaysAgo = new Date(now);
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const normalizedAlerts = alerts.map((alert) => {
    const data = recordData(alert);
    const resolution = data.resolution && typeof data.resolution === "object" ? data.resolution : {};
    return {
      id: alert.id,
      title: text(alert.title, "Alerta sin título"),
      status: text(alert.status, "OPEN").toUpperCase(),
      priority: text(data.priority, "MEDIUM").toUpperCase(),
      area: text(data.area, "overview"),
      detail: text(data.detail, "Sin detalle adicional."),
      propertyId: text(data.propertyId) || null,
      operationId: text(data.operationId) || null,
      requiresHumanApproval: Boolean(data.requiresHumanApproval),
      createdAt: iso(alert.createdAt),
      updatedAt: iso(alert.updatedAt),
      resolvedAt: iso(resolution.resolvedAt),
      resolvedBy: text(resolution.resolvedBy) || null,
      resolutionNote: text(resolution.note) || null
    };
  });

  const recentActivity = auditLogs.map((log) => {
    const actor = log.actorUserId ? usersById.get(String(log.actorUserId)) : null;
    return {
      id: log.id,
      action: text(log.action, "SIN_ACCIÓN"),
      entity: text(log.entity, "registro"),
      entityId: text(log.entityId) || null,
      createdAt: iso(log.createdAt),
      actor: actor ? { id: actor.id, name: text(actor.name, actor.email), email: text(actor.email) } : null,
      metadata: sanitizeBrokerAuditMetadata(log.metadata)
    };
  });

  const openAlerts = normalizedAlerts.filter((alert) => alert.status !== "RESOLVED");
  const recentlyResolved = normalizedAlerts.filter((alert) => alert.status === "RESOLVED" && alert.resolvedAt && new Date(alert.resolvedAt) >= thirtyDaysAgo);
  const activityLast30Days = recentActivity.filter((item) => item.createdAt && new Date(item.createdAt) >= thirtyDaysAgo).length;
  const actionCounts = Object.entries(recentActivity.reduce((accumulator, item) => {
    accumulator[item.action] = (accumulator[item.action] || 0) + 1;
    return accumulator;
  }, {})).slice(0, 8).map(([action, total]) => ({ action, total }));

  return {
    summary: {
      openAlerts: openAlerts.length,
      highPriorityAlerts: openAlerts.filter((alert) => alert.priority === "HIGH").length,
      resolvedLast30Days: recentlyResolved.length,
      activityLast30Days,
      totalAuditedEvents: recentActivity.length
    },
    alerts: normalizedAlerts,
    recentActivity,
    actionCounts
  };
}
