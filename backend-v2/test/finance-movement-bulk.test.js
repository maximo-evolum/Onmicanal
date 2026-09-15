import test from "node:test";
import assert from "node:assert/strict";
import { reviewMovementBatch } from "../src/services/finance-movement-bulk.service.js";
import { FinanceOperationError } from "../src/services/finance-integrity.service.js";
const input = { tenantId: "a", userId: "u", items: [{ id: "one", version: "2026-01-20T00:00:00.000Z" }], reason: "Revisar referencia bancaria", operationKey: "batch-operation-0001" };
test("rechaza tamaño duplicados motivo y versiones antes de escribir", async () => {
  for (const change of [{ items: [] }, { items: [...input.items, ...input.items] }, { items: Array.from({ length: 26 }, (_, n) => ({ ...input.items[0], id: String(n) })) }, { reason: "x" }, { operationKey: "x" }, { items: [{ id: "a", version: "bad" }] }]) {
    let called = false; await assert.rejects(reviewMovementBatch({}, { ...input, ...change }, async () => { called = true; })); assert.equal(called, false);
  }
});
test("conserva resultado individual y no oculta fallos parciales", async () => {
  const items = ["ok", "closed", "unknown", "replayed"].map((id) => ({ ...input.items[0], id }));
  const result = await reviewMovementBatch({}, { ...input, items }, async (_db, args) => {
    assert.equal(args.tenantId, "a"); assert.equal(args.userId, "u"); assert.equal(args.operationKey, input.operationKey);
    if (args.movementId === "closed") throw new FinanceOperationError(409, "Período cerrado");
    if (args.movementId === "unknown") throw new Error("secret database error");
    return { replayed: args.movementId === "replayed" };
  });
  assert.deepEqual(result.results.map((r) => r.status), ["APPLIED", "BLOCKED", "UNKNOWN", "ALREADY_APPLIED"]);
  assert.equal(JSON.stringify(result).includes("secret"), false);
});
