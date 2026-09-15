import test from "node:test";
import assert from "node:assert/strict";
import { classifyFinanceMovement } from "../src/services/finance-movement-classification.service.js";
import { movementLedger } from "../src/services/finance-movement-ledger.service.js";
import { buildFinanceMonthlyClosePreview } from "../src/services/finance-monthly-close.service.js";

const movement = (id, data) => ({ id, recordType: "bank_movement", status: "MATCHED", title: id, data: { transactionDate: "2026-01-05", ...data } });

for (const mark of ["CREDIT", "ABONO", "A", " abono "]) {
  test(`reconoce abono ${JSON.stringify(mark)}`, () => {
    assert.deepEqual(classifyFinanceMovement({ direction: mark, amount: "1234" }), { direction: "CREDIT", amount: 1234 });
  });
}
for (const mark of ["DEBIT", "CARGO", "C", " cargo "]) {
  test(`reconoce cargo ${JSON.stringify(mark)} sin perder monto negativo`, () => {
    assert.deepEqual(classifyFinanceMovement({ direction: mark, amount: -1234 }), { direction: "DEBIT", amount: 1234 });
  });
}
test("marca explícita prevalece; marca legada y signo negativo tienen respaldo", () => {
  assert.deepEqual(classifyFinanceMovement({ direction: "A", amount: -100 }), { direction: "CREDIT", amount: 100 });
  assert.deepEqual(classifyFinanceMovement({ direction: " ", movementType: "C", amount: 100 }), { direction: "DEBIT", amount: 100 });
  assert.deepEqual(classifyFinanceMovement({ amount: -100 }), { direction: "DEBIT", amount: 100 });
  assert.deepEqual(classifyFinanceMovement({ amount: 100 }), { direction: "UNKNOWN", amount: 100 });
});
test("montos inválidos no se convierten en cero ni se adivinan separadores", () => {
  for (const amount of [null, undefined, "", " ", true, [], {}, "abc", "1.234.567", NaN, Infinity, -Infinity]) {
    assert.equal(classifyFinanceMovement({ direction: "C", amount }).amount, null);
  }
  assert.deepEqual(classifyFinanceMovement({ direction: "A", amount: 0 }), { direction: "CREDIT", amount: 0 });
});
test("cierre y consulta comparten totales para todas las marcas y montos inválidos", () => {
  const data = [
    { amount: 100, direction: "A" }, { amount: 200, direction: "ABONO" }, { amount: "300", direction: "CREDIT" },
    { amount: -10, direction: "C" }, { amount: 20, direction: "CARGO" }, { amount: 30, direction: "DEBIT" },
    { amount: -40 }, { amount: 50, movementType: "C" }, { amount: 900 }, { amount: "bad", direction: "A" },
    { amount: null, direction: "C" }, { amount: 80, direction: "desconocida" }, { amount: -Infinity }
  ];
  const records = data.map((d, i) => movement(`m${i}`, d));
  const ledger = movementLedger(records, { period: "2026-01" }, { all: true });
  const preview = buildFinanceMonthlyClosePreview(records, "2026-01");
  assert.equal(preview.metrics.incoming, 600); assert.equal(preview.metrics.outgoing, 150);
  assert.equal(preview.metrics.netBankFlow, 450);
  assert.equal(preview.metrics.incoming, ledger.summary.credits);
  assert.equal(preview.metrics.outgoing, ledger.summary.debits);
  assert.equal(preview.metrics.unclassifiedMovements, ledger.summary.unclassified);
  assert.equal(preview.metrics.unclassifiedMovements, 5);
  assert.equal(preview.status, "REQUIRES_REVIEW");
  assert.equal(preview.blockers.filter((b) => b.type === "MOVIMIENTO_CLASIFICACION_PENDIENTE").length, 5);
  assert.equal(preview.rows.find((r) => r.documento === "m9").monto, null);
  assert.equal(preview.rows.find((r) => r.documento === "m8").tipo, "Movimiento bancario - por identificar");
  assert.equal(preview.rows.find((r) => r.documento === "m3").monto, 10);
});
test("la clasificación pendiente bloquea aunque el movimiento figure conciliado", () => {
  const records = [movement("m", { amount: 100 })];
  const original = structuredClone(records);
  assert.equal(buildFinanceMonthlyClosePreview(records, "2026-01").status, "REQUIRES_REVIEW");
  assert.deepEqual(records, original);
  records[0].data.direction = "A";
  const result = buildFinanceMonthlyClosePreview(records, "2026-01");
  assert.equal(result.blockers.some((b) => b.type === "MOVIMIENTO_CLASIFICACION_PENDIENTE"), false);
  assert.equal(result.status, "REQUIRES_REVIEW"); // A label alone is not reconciliation evidence.
  assert.equal(result.metrics.incoming, 100);
});
