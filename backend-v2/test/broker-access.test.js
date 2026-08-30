import test from "node:test";
import assert from "node:assert/strict";
import { brokerFinancingActionForStage, brokerRecordWhere, canBrokerAction, defaultBrokerBusinessRole, normalizeBrokerAccessProfile, profileRecordData } from "../src/services/broker-access.service.js";

test("Broker OS separa el rol de negocio del rol técnico", () => {
  assert.equal(defaultBrokerBusinessRole({ role: "SELLER", jobTitle: "Corredor inmobiliario" }), "CORREDOR");
  assert.equal(defaultBrokerBusinessRole({ role: "AGENT", jobTitle: "Tasador" }), "TASADOR");
  assert.equal(defaultBrokerBusinessRole({ role: "ADMIN" }), "CEO");
});

test("Corredor solo recibe acciones operativas dentro de su alcance", () => {
  const access = normalizeBrokerAccessProfile({ businessRole: "CORREDOR", accessScope: "ASSIGNED" }, { role: "SELLER" });
  assert.equal(access.accessScope, "ASSIGNED");
  assert.equal(canBrokerAction(access, "operations", "EDIT"), true);
  assert.equal(canBrokerAction(access, "configuration", "CONFIGURE"), false);
  assert.equal(canBrokerAction(access, "financing", "APPROVE"), false);
});

test("Finanzas puede aprobar su flujo, pero no configurar Broker OS", () => {
  const access = normalizeBrokerAccessProfile({ businessRole: "FINANZAS", accessScope: "COMPANY" }, { role: "AGENT" });
  assert.equal(canBrokerAction(access, "financing", "APPROVE"), true);
  assert.equal(canBrokerAction(access, "configuration", "CONFIGURE"), false);
});

test("Las etapas financieras sensibles exigen aprobación o rechazo explícito", () => {
  assert.equal(brokerFinancingActionForStage("EVALUACION"), "EDIT");
  assert.equal(brokerFinancingActionForStage("APROBACION"), "APPROVE");
  assert.equal(brokerFinancingActionForStage("DESEMBOLSO"), "APPROVE");
  assert.equal(brokerFinancingActionForStage("RECHAZADO"), "REJECT");
  assert.equal(brokerFinancingActionForStage("CANCELADO"), "REJECT");
});

test("Holding no se concede a un usuario de tenant sin gobierno multiempresa", () => {
  const access = normalizeBrokerAccessProfile({ businessRole: "GERENTE_COMERCIAL", accessScope: "HOLDING" }, { role: "AGENT" });
  assert.equal(access.requestedScope, "HOLDING");
  assert.equal(access.accessScope, "COMPANY");
});

test("El perfil persistido conserva negocio, scope y agrupación", () => {
  const profile = profileRecordData("usuario-1", { businessRole: "COORDINADOR_COMERCIAL", accessScope: "TEAM", teamKey: "ventas-norte", branchKey: "santiago" }, { role: "AGENT" });
  assert.deepEqual(profile, { userId: "usuario-1", businessRole: "COORDINADOR_COMERCIAL", accessScope: "TEAM", teamKey: "ventas-norte", branchKey: "santiago", version: 1 });
});

test("El alcance asignado filtra los registros antes de consultar la cartera", () => {
  assert.deepEqual(
    brokerRecordWhere({ tenantId: "tenant-1", brokerAccess: { scopeUserIds: ["u-1", "u-2"] } }, { recordType: "property" }),
    { tenantId: "tenant-1", recordType: "property", assignedToId: { in: ["u-1", "u-2"] } },
  );
});
