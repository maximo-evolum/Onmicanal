import test from "node:test";
import assert from "node:assert/strict";
import {
  BROKER_AGENT_CATALOG,
  BROKER_RECORD_AREAS,
  RENTAL_STAGES,
  SALE_STAGES,
  isBrokerRecordArea,
  stagesForBrokerOperation,
  validateBrokerRecord,
  validateBrokerStageTransition
} from "../src/services/broker-workflows.service.js";

test("Broker OS expone los flujos oficiales de venta y arriendo", () => {
  assert.equal(SALE_STAGES[0], "CAPTACION");
  assert.equal(SALE_STAGES.at(-1), "POSTVENTA");
  assert.equal(RENTAL_STAGES.includes("CONTRATO"), true);
  assert.equal(stagesForBrokerOperation("RENTAL")[0], "CAPTACION");
});

test("Broker OS no permite saltar etapas de una operacion", () => {
  const rejected = validateBrokerStageTransition({ operationType: "SALE", currentStage: "CAPTACION", nextStage: "PUBLICACION" });
  const accepted = validateBrokerStageTransition({ operationType: "SALE", currentStage: "CAPTACION", nextStage: "TASACION" });
  assert.equal(rejected.ok, false);
  assert.equal(accepted.ok, true);
});

test("Broker OS conoce las areas de expediente operativas", () => {
  assert.equal(isBrokerRecordArea("rentals"), true);
  assert.equal(isBrokerRecordArea("financing"), true);
  assert.equal(isBrokerRecordArea("maintenance"), true);
  assert.equal(isBrokerRecordArea("anything_else"), false);
  assert.equal(BROKER_RECORD_AREAS.documents.includes("property_document"), true);
  assert.equal(BROKER_RECORD_AREAS.financing.includes("operation_financing"), true);
});

test("Broker OS valida las fichas segun el proceso que representan", () => {
  const missing = validateBrokerRecord({ recordType: "property_mandate", data: { propertyId: "property-1" }, status: "DRAFT" });
  const complete = validateBrokerRecord({
    recordType: "property_mandate",
    data: { propertyId: "property-1", ownerName: "Maria Perez", startDate: "2026-08-14" },
    status: "PENDING_SIGNATURE"
  });
  assert.equal(missing.ok, false);
  assert.equal(complete.ok, true);
  assert.equal(complete.status, "PENDING_SIGNATURE");
});

test("Broker OS expone agentes con estado real de disponibilidad", () => {
  assert.equal(BROKER_AGENT_CATALOG.length, 13);
  assert.equal(BROKER_AGENT_CATALOG.some((agent) => agent.key === "commercial" && agent.status === "AVAILABLE"), true);
  assert.equal(BROKER_AGENT_CATALOG.some((agent) => agent.key === "legal" && agent.status === "PLANNED"), true);
});
