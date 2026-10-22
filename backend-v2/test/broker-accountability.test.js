/** Archivo: Verifica que los controles operativos de Broker OS nunca queden sin responsable. */
import test from "node:test";
import assert from "node:assert/strict";
import { BROKER_ACCOUNTABILITY_RECORD_TYPES, requiresBrokerAccountableOwner, resolveBrokerAccountableAssignee } from "../src/services/broker-accountability.service.js";

test("los controles de fase 3 requieren responsable operativo", () => {
  for (const recordType of ["maintenance_ticket", "remodeling_project", "property_inspection", "property_handover", "post_sale_case", "warranty_case"]) {
    assert.equal(requiresBrokerAccountableOwner(recordType), true, recordType);
  }
  assert.equal(BROKER_ACCOUNTABILITY_RECORD_TYPES.length, 6);
  assert.equal(requiresBrokerAccountableOwner("property_offer"), false);
});

test("la resolución de responsable conserva alcance y corrige legados sin dueño", () => {
  assert.equal(resolveBrokerAccountableAssignee({ recordType: "maintenance_ticket", actorId: "u1" }), "u1");
  assert.equal(resolveBrokerAccountableAssignee({ recordType: "post_sale_case", requestedAssigneeId: "u2", actorId: "u1" }), "u2");
  assert.equal(resolveBrokerAccountableAssignee({ recordType: "property_offer", existingAssigneeId: "u3", actorId: "u1" }), "u3");
  assert.equal(resolveBrokerAccountableAssignee({ recordType: "property_offer", actorId: "u1", restrictToActor: true }), "u1");
});
