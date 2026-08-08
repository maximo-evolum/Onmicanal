import test from "node:test";
import assert from "node:assert/strict";
import { publishObservabilityAlerts, resetObservabilityAlertState } from "../src/services/observability-alerts.service.js";

test("las alertas no intentan salir si no hay webhook configurado", async () => {
  const previous = process.env.OBSERVABILITY_WEBHOOK_URL;
  try {
    delete process.env.OBSERVABILITY_WEBHOOK_URL;
    resetObservabilityAlertState();
    const result = await publishObservabilityAlerts({ alerts: [{ severity: "critical", code: "DATABASE_UNAVAILABLE" }] });
    assert.deepEqual(result, { sent: false, reason: "not_configured" });
  } finally {
    if (previous === undefined) delete process.env.OBSERVABILITY_WEBHOOK_URL; else process.env.OBSERVABILITY_WEBHOOK_URL = previous;
  }
});

test("las alertas envían información operativa sin secretos y respetan cooldown", async () => {
  const previous = process.env.OBSERVABILITY_WEBHOOK_URL;
  const previousCooldown = process.env.OBSERVABILITY_ALERT_COOLDOWN_MS;
  const payloads = [];
  try {
    process.env.OBSERVABILITY_WEBHOOK_URL = "https://monitor.example.test/evolum";
    process.env.OBSERVABILITY_ALERT_COOLDOWN_MS = "60000";
    resetObservabilityAlertState();
    const send = async (_url, init) => {
      payloads.push(JSON.parse(init.body));
      return { ok: true, status: 202 };
    };
    const snapshot = {
      generatedAt: "2026-08-08T18:00:00.000Z",
      alerts: [{ severity: "warning", code: "HIGH_LATENCY", message: "Latencia alta" }]
    };
    const first = await publishObservabilityAlerts(snapshot, { now: 1_000_000, send });
    const second = await publishObservabilityAlerts(snapshot, { now: 1_010_000, send });
    assert.equal(first.sent, true);
    assert.deepEqual(second, { sent: false, reason: "cooldown" });
    assert.equal(payloads.length, 1);
    assert.deepEqual(payloads[0].alerts, [{ severity: "warning", code: "HIGH_LATENCY", message: "Latencia alta" }]);
  } finally {
    if (previous === undefined) delete process.env.OBSERVABILITY_WEBHOOK_URL; else process.env.OBSERVABILITY_WEBHOOK_URL = previous;
    if (previousCooldown === undefined) delete process.env.OBSERVABILITY_ALERT_COOLDOWN_MS; else process.env.OBSERVABILITY_ALERT_COOLDOWN_MS = previousCooldown;
    resetObservabilityAlertState();
  }
});
