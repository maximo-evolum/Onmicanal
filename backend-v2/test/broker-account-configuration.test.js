/** Archivo: Verifica perfiles restrictivos, reparto supervisado y continuidad de la cuenta Broker. */
import test from "node:test";
import assert from "node:assert/strict";
import {
  canBrokerAction,
  normalizeBrokerAccessProfile,
  normalizeBrokerCustomProfile,
  profileRecordData
} from "../src/services/broker-access.service.js";
import { buildBrokerAccountSnapshot, buildBrokerTeamWorkload } from "../src/services/broker-account-configuration.service.js";

test("Un perfil personalizado solo conserva las áreas seleccionadas", () => {
  const normalized = normalizeBrokerCustomProfile({
    name: "Corredor de cartera",
    description: "Opera únicamente cartera y comercial.",
    baseRole: "CORREDOR",
    accessScope: "ASSIGNED",
    workspaceKeys: ["CARTERA"],
    agentKeys: ["commercial"]
  });
  assert.equal(normalized.ok, true);
  const access = normalizeBrokerAccessProfile({ customProfileId: "perfil-1" }, { role: "AGENT" }, normalized.data);
  assert.equal(access.profileKind, "CUSTOM");
  assert.equal(canBrokerAction(access, "commercial", "EDIT"), true);
  assert.equal(canBrokerAction(access, "operations", "EDIT"), true);
  assert.equal(canBrokerAction(access, "documents", "EDIT"), false);
  assert.equal(canBrokerAction(access, "financing", "VIEW"), false);
  assert.deepEqual(profileRecordData("u-1", { customProfileId: "perfil-1" }, { role: "AGENT" }, normalized.data).customProfileId, "perfil-1");
});

test("La carga muestra pendientes y propone solo una persona activa autorizada", () => {
  const coordinator = normalizeBrokerAccessProfile({ businessRole: "COORDINADOR_COMERCIAL", accessScope: "TEAM", teamKey: "norte" }, { role: "AGENT" });
  const reader = normalizeBrokerAccessProfile({ businessRole: "LECTURA", accessScope: "ASSIGNED" }, { role: "VIEWER" });
  const workload = buildBrokerTeamWorkload({
    users: [
      { id: "u-1", name: "Ana", email: "ana@demo.cl", role: "AGENT", isActive: true },
      { id: "u-2", name: "Beto", email: "beto@demo.cl", role: "VIEWER", isActive: true },
      { id: "u-3", name: "Carla", email: "carla@demo.cl", role: "AGENT", isActive: false }
    ],
    records: [
      { id: "p-1", recordType: "property", title: "Departamento sin responsable", assignedToId: null, status: "ACTIVE" },
      { id: "p-2", recordType: "property", title: "Casa asignada", assignedToId: "u-1", status: "ACTIVE" },
      { id: "o-1", recordType: "broker_operation", title: "Venta en curso", assignedToId: "u-1", status: "ACTIVE" }
    ],
    profilesByUser: new Map([["u-1", coordinator], ["u-2", reader], ["u-3", coordinator]]),
    canOperate: (profile) => canBrokerAction(profile, "operations", "EDIT")
  });
  assert.equal(workload.summary.unassigned.properties, 1);
  assert.equal(workload.unassignedProperties[0].id, "p-1");
  assert.equal(workload.suggestedAssignee.id, "u-1");
  assert.equal(workload.members.find((member) => member.id === "u-2").canReceivePortfolio, false);
});

test("La cuenta informa módulos inactivos sin prometer eliminación de datos", () => {
  const snapshot = buildBrokerAccountSnapshot({
    tenant: { id: "tenant-1", name: "Broker Demo", slug: "broker-demo", plan: "BUSINESS" },
    plan: { code: "BUSINESS", name: "Business", description: "Plan de prueba" },
    limits: { users: 5, messagesMonthly: 3000 },
    modules: [{ module: "properties", enabled: true, source: "PLAN" }, { module: "documents", enabled: false, source: "MANUAL" }],
    users: [{ id: "u-1", isActive: true }, { id: "u-2", isActive: false }]
  });
  assert.equal(snapshot.account.team.active, 1);
  assert.equal(snapshot.account.team.remaining, 4);
  assert.deepEqual(snapshot.modules.inactive.map((module) => module.module), ["documents"]);
  assert.equal(snapshot.modules.retention.dataPreserved, true);
  assert.match(snapshot.modules.retention.message, /no elimina/i);
});
