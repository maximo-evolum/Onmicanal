/** Archivo: Verifica límites, simulación y reglas personalizadas de Gobierno IA Broker. */
import test from "node:test";
import assert from "node:assert/strict";
import { BROKER_AGENT_CATALOG } from "../src/services/broker-workflows.service.js";
import { BROKER_AI_AGENT_STATUSES, buildBrokerAiGovernanceSnapshot, normalizeBrokerAiCustomRule } from "../src/services/broker-ai-governance.service.js";

const readModel = {
  generatedAt: "2026-11-04T12:00:00.000Z",
  scope: { level: "COMPANY", description: "Toda la empresa" },
  priorities: [
    { id: "property-1", source: "PROPERTY_COMPLETENESS", title: "Ficha sin imagen", detail: "Falta la imagen principal.", priority: "HIGH", propertyId: "property-1" },
    { id: "operation-1", source: "OPERATION_HEALTH", title: "Negociación sin avance", detail: "Requiere seguimiento.", priority: "MEDIUM", operationId: "operation-1" },
  ],
};

test("Gobierno IA normaliza reglas personalizadas sin aceptar automatismos externos", () => {
  const result = normalizeBrokerAiCustomRule({
    title: "Priorizar fichas incompletas",
    description: "Control comercial interno",
    conditionKey: "PROPERTY_INCOMPLETE",
    isActive: true,
    externalContact: "ALLOW",
    autonomy: "AUTONOMOUS",
  });
  assert.equal(result.ok, true);
  assert.equal(result.value.externalContact, "BLOCKED");
  assert.equal(result.value.autonomy, "HUMAN_APPROVAL");
  assert.equal(result.value.simulator, "NO_SEND");
  assert.equal(result.value.internalAction, "PREPARE_INTERNAL_ALERT");
});

test("Gobierno IA evalúa reglas sobre el modelo autorizado sin crear acciones reales", () => {
  const snapshot = buildBrokerAiGovernanceSnapshot({
    readModel,
    customRules: [{ id: "custom-1", title: "Regla QA", status: "ACTIVE", data: { key: "qa", title: "Regla QA", conditionKey: "OPERATION_STALLED", isActive: true } }],
    alerts: [{ id: "alert-1", title: "Alerta interna", status: "OPEN", data: { priority: "HIGH", detail: "Control interno", propertyId: "property-1" } }],
  });
  assert.equal(snapshot.summary.officialRules, 5);
  assert.equal(snapshot.summary.customRules, 1);
  assert.equal(snapshot.simulation.mode, "NO_SEND");
  assert.equal(snapshot.simulation.executions.every((item) => item.externalContact === false && item.stateChanges === false), true);
  assert.equal(snapshot.triggeredAlerts[0].href.includes("propertyId=property-1"), true);
  assert.equal(snapshot.rules.find((rule) => rule.id === "custom-1")?.matched, 1);
});

test("los trece agentes declaran un estado reconocido y sin contacto externo", () => {
  const snapshot = buildBrokerAiGovernanceSnapshot({ readModel });
  assert.equal(snapshot.agents.length, 13);
  assert.equal(snapshot.agents.every((agent) => Object.hasOwn(BROKER_AI_AGENT_STATUSES, agent.status)), true);
  assert.equal(snapshot.agents.every((agent) => agent.externalContact === "BLOCKED" && agent.autonomousActions === false), true);
  assert.equal(BROKER_AGENT_CATALOG.every((agent) => agent.status !== "PLANNED"), true);
});

test("las rutas de Gobierno IA exigen permiso y mantienen el simulador sin mutación", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const dirname = path.dirname(fileURLToPath(import.meta.url));
  const source = fs.readFileSync(path.resolve(dirname, "../src/routes/broker.routes.js"), "utf8");
  assert.match(source, /brokerRouter\.get\("\/broker\/ai-governance", requireBrokerAction\("ai", "VIEW"\)/);
  assert.match(source, /brokerRouter\.post\("\/broker\/ai-governance\/simulate", requireBrokerAction\("ai", "VIEW"\)/);
  assert.match(source, /brokerRouter\.post\("\/broker\/ai-governance\/rules", requireRole\(ROLE_GROUPS\.STAFF\), requireBrokerAction\("ai", "APPROVE"\)/);
  assert.match(source, /BROKER_AI_RULE_CREATED/);
  assert.match(source, /BROKER_AI_RULE_UPDATED/);
});
