/** Archivo: Verifica la normalización y la concurrencia de reasignaciones masivas Broker. */
import test from "node:test";
import assert from "node:assert/strict";
import {
  brokerBulkReassignmentDefinition,
  brokerBulkReassignmentPreview,
  normalizeBrokerBulkReassignment,
  normalizeBrokerBulkSnapshot,
  staleBrokerBulkReassignmentRecords
} from "../src/services/broker-bulk-reassignment.service.js";

test("La reasignación masiva limita el lote y exige responsable y motivo", () => {
  assert.equal(normalizeBrokerBulkReassignment({ recordType: "property", recordIds: [], assignedToId: "u-2", reason: "Continuidad" }).ok, false);
  assert.equal(normalizeBrokerBulkReassignment({ recordType: "unknown", recordIds: ["p-1"], assignedToId: "u-2", reason: "Continuidad" }).ok, false);
  const valid = normalizeBrokerBulkReassignment({ recordType: "property", recordIds: ["p-1", "p-1", "p-2"], assignedToId: "u-2", reason: "Continuidad por ausencia programada." });
  assert.equal(valid.ok, true);
  assert.deepEqual(valid.data.recordIds, ["p-1", "p-2"]);
  assert.equal(valid.definition.resource, "commercial");
});

test("La vista previa separa cambios reales de registros ya asignados", () => {
  const definition = brokerBulkReassignmentDefinition("broker_operation");
  const preview = brokerBulkReassignmentPreview({
    definition,
    assignee: { id: "u-2", name: "Bárbara", workload: { score: 4 } },
    reason: "Cobertura durante licencia médica.",
    records: [
      { id: "o-1", title: "Venta Parque Norte", status: "ACTIVE", assignedToId: "u-1", assignedTo: { id: "u-1", name: "Ana" }, updatedAt: "2026-11-19T10:00:00.000Z" },
      { id: "o-2", title: "Arriendo Centro", status: "ACTIVE", assignedToId: "u-2", assignedTo: { id: "u-2", name: "Bárbara" }, updatedAt: "2026-11-19T11:00:00.000Z" }
    ]
  });
  assert.equal(preview.changeCount, 1);
  assert.equal(preview.unchangedCount, 1);
  assert.equal(preview.snapshot.length, 2);
});

test("La confirmación detecta una cartera modificada después de la vista previa", () => {
  const snapshot = normalizeBrokerBulkSnapshot([{ id: "p-1", updatedAt: "2026-11-19T10:00:00.000Z" }], ["p-1"]);
  assert.equal(snapshot.ok, true);
  const stale = staleBrokerBulkReassignmentRecords([{ id: "p-1", title: "Casa Los Castaños", updatedAt: "2026-11-19T10:00:01.000Z" }], snapshot.expected);
  assert.deepEqual(stale, [{ id: "p-1", title: "Casa Los Castaños" }]);
});
