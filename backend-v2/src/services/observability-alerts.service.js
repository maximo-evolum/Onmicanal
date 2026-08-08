const lastNotificationAt = new Map();

function webhookUrl() {
  const value = String(process.env.OBSERVABILITY_WEBHOOK_URL || "").trim();
  return /^https:\/\//i.test(value) ? value : "";
}

function cooldownMs() {
  const configured = Number(process.env.OBSERVABILITY_ALERT_COOLDOWN_MS || 15 * 60_000);
  return Number.isFinite(configured) ? Math.max(60_000, Math.min(86_400_000, configured)) : 15 * 60_000;
}

/**
 * Entrega alertas a un webhook compatible con Slack, Teams, Discord o un
 * puente propio. No se envían secretos, URLs de clientes, tenant IDs ni trazas.
 * Si no hay webhook configurado, el monitor sigue funcionando de forma local.
 */
export async function publishObservabilityAlerts(snapshot, { now = Date.now(), send = fetch } = {}) {
  const url = webhookUrl();
  const alerts = Array.isArray(snapshot?.alerts) ? snapshot.alerts : [];
  if (!url || !alerts.length) return { sent: false, reason: url ? "no_alerts" : "not_configured" };

  const key = alerts.map((alert) => `${alert.severity}:${alert.code}`).sort().join("|");
  const previous = lastNotificationAt.get(key) || 0;
  if (now - previous < cooldownMs()) return { sent: false, reason: "cooldown" };

  const payload = {
    text: `EVOLUM: ${alerts.length} alerta${alerts.length === 1 ? "" : "s"} de operación`,
    service: "onmicanal-backend-v2",
    generatedAt: snapshot.generatedAt,
    alerts: alerts.map((alert) => ({ severity: alert.severity, code: alert.code, message: alert.message }))
  };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 7_000);
  try {
    const response = await send(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`Webhook respondió ${response.status}`);
    lastNotificationAt.set(key, now);
    return { sent: true, alertCount: alerts.length };
  } catch (error) {
    console.warn("[OBSERVABILITY_WEBHOOK_UNAVAILABLE]", error instanceof Error ? error.message : "Error desconocido");
    return { sent: false, reason: "delivery_failed" };
  } finally {
    clearTimeout(timeout);
  }
}

export function resetObservabilityAlertState() {
  lastNotificationAt.clear();
}
