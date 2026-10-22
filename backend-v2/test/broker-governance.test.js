/** Archivo: Verifica sanitización, resolución y resumen de gobierno de Broker OS. */
import test from "node:test";
import assert from "node:assert/strict";
import { buildBrokerGovernanceSummary, normalizeBrokerAlertResolution, sanitizeBrokerAuditMetadata } from "../src/services/broker-governance.service.js";

test("Broker governance oculta secretos de los metadatos visibles", () => {
  const metadata = sanitizeBrokerAuditMetadata({ action: "ok", apiKey: "never-expose", nested: { token: "no", propertyId: "p-1" } });
  assert.deepEqual(metadata, { action: "ok", nested: { propertyId: "p-1" } });
});

test("Broker governance exige motivo antes de resolver una alerta", () => {
  assert.equal(normalizeBrokerAlertResolution({ note: "" }).ok, false);
  assert.deepEqual(normalizeBrokerAlertResolution({ note: "  Revisado con el propietario.  " }), { ok: true, note: "Revisado con el propietario." });
});

test("Broker governance resume alertas y relaciona actividad con el usuario", () => {
  const result = buildBrokerGovernanceSummary({
    now: new Date("2026-10-22T12:00:00.000Z"),
    users: [{ id: "u-1", name: "María Broker", email: "maria@broker.cl" }],
    alerts: [
      { id: "a-1", title: "Mandato pendiente", status: "OPEN", data: { priority: "HIGH", area: "commercial", detail: "Falta firma" }, createdAt: "2026-10-20T10:00:00.000Z", updatedAt: "2026-10-20T10:00:00.000Z" },
      { id: "a-2", title: "Alerta cerrada", status: "RESOLVED", data: { resolution: { resolvedAt: "2026-10-21T10:00:00.000Z", resolvedBy: "María Broker", note: "Gestionado" } }, createdAt: "2026-10-19T10:00:00.000Z", updatedAt: "2026-10-21T10:00:00.000Z" }
    ],
    auditLogs: [{ id: "l-1", actorUserId: "u-1", action: "BROKER_ALERT_RESOLVED", entity: "realty_alert", entityId: "a-2", metadata: { note: "Gestionado", authorization: "never" }, createdAt: "2026-10-21T10:00:00.000Z" }]
  });
  assert.deepEqual(result.summary, { openAlerts: 1, highPriorityAlerts: 1, resolvedLast30Days: 1, activityLast30Days: 1, totalAuditedEvents: 1 });
  assert.equal(result.recentActivity[0].actor?.name, "María Broker");
  assert.deepEqual(result.recentActivity[0].metadata, { note: "Gestionado" });
});
