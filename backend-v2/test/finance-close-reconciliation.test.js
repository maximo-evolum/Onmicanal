import test from "node:test";
import assert from "node:assert/strict";
import { buildFinanceMonthlyClosePreview, getFinanceMonthlyClosePreview } from "../src/services/finance-monthly-close.service.js";
import { filterFinanceContext } from "../src/services/finance-context.service.js";

function evidence() {
  const row = (id, recordType, status, data) => ({ id, tenantId: "a", recordType, status, title: id, createdAt: "2026-09-15", data });
  return [
    row("m", "bank_movement", "MATCHED", { amount: 100, direction: "CREDIT", transactionDate: "2026-01-05", reconciliationId: "r" }),
    row("r", "finance_reconciliation", "APPROVED", { movementId: "m", amount: 100, currency: "CLP", invoiceIds: ["i"], invoiceId: "i", allocations: [{ invoiceId: "i", amount: 100 }] }),
    row("i", "finance_invoice", "PARTIAL", { amount: 200, balance: 100, currency: "CLP", issueDate: "2025-12-01" }),
    row("p", "finance_invoice_receipt", "RECONCILED", { invoiceId: "i", movementId: "m", reconciliationId: "r", amount: 100, paymentDate: "2026-01-05", source: "bank_reconciliation" })
  ];
}
const preview = (rows, period = "2026-01") => buildFinanceMonthlyClosePreview(rows, period);

test("acepta evidencia completa con factura histórica y estado RECONCILED", () => {
  const rows = evidence(); rows[0].status = "RECONCILED";
  const original = structuredClone(rows), result = preview(rows);
  assert.equal(result.status, "READY_TO_CLOSE"); assert.equal(result.metrics.reconciliations, 1);
  assert.equal(result.metrics.unreconciledMovements, 0); assert.deepEqual(rows, original);
  assert.equal(result.rows.length, 1); // Receipt is evidence, not a second cash movement.
});

const invalidCases = [
  ["falta vínculo de movimiento", (r) => delete r[0].data.reconciliationId],
  ["conciliación inexistente", (r) => { r[0].data.reconciliationId = "missing"; }],
  ["vínculo a registro de otro tipo", (r) => { r[1].recordType = "finance_exception"; }],
  ["vínculo inverso incorrecto", (r) => { r[1].data.movementId = "other"; }],
  ["reversa", (r) => { r[1].status = "REVERSED"; }],
  ["reversa inconsistente con estado aprobado", (r) => { r[1].data.reversedAt = "2026-01-09"; }],
  ["sugerencia no aprobada", (r) => { r[1].status = "SUGGESTED"; }],
  ["estado CLOSED sin significado de conciliación", (r) => { r[0].status = "CLOSED"; }],
  ["movimiento pendiente con aprobación", (r) => { r[0].status = "PENDING"; }],
  ["otra empresa", (r) => { r[1].tenantId = "b"; }],
  ["dos aprobaciones", (r) => r.push({ ...structuredClone(r[1]), id: "r2" })],
  ["monto aprobado distinto", (r) => { r[1].data.amount = 101; }],
  ["moneda distinta", (r) => { r[1].data.currency = "USD"; }],
  ["cargo presentado como cobro", (r) => { r[0].data.direction = "DEBIT"; }],
  ["sin distribución documental", (r) => delete r[1].data.allocations],
  ["asignaciones no cuadran", (r) => { r[1].data.allocations[0].amount = 90; }],
  ["asignación duplicada", (r) => r[1].data.allocations.push({ invoiceId: "i", amount: 0 })],
  ["lista documental no coincide", (r) => { r[1].data.invoiceIds = ["other"]; }],
  ["factura principal no coincide", (r) => { r[1].data.invoiceId = "other"; }],
  ["factura inexistente", (r) => r.splice(2, 1)],
  ["factura anulada", (r) => { r[2].status = "ANNULLED"; }],
  ["factura de otra empresa", (r) => { r[2].tenantId = "b"; }],
  ["falta comprobante", (r) => r.pop()],
  ["comprobante revertido", (r) => { r[3].status = "REVERSED"; }],
  ["comprobante marcado con reversa", (r) => { r[3].data.reversedAt = "2026-01-09"; }],
  ["comprobante por otro monto", (r) => { r[3].data.amount = 99; }],
  ["comprobante por otra factura", (r) => { r[3].data.invoiceId = "other"; }],
  ["comprobante por otro movimiento", (r) => { r[3].data.movementId = "other"; }],
  ["comprobante por otra conciliación", (r) => { r[3].data.reconciliationId = "other"; }],
  ["comprobante duplicado", (r) => r.push({ ...structuredClone(r[3]), id: "p2" })],
  ["comprobante de otra empresa", (r) => { r[3].tenantId = "b"; }],
  ["otro cobro activo sobre el mismo movimiento", (r) => r.push({ ...structuredClone(r[3]), id: "p2", data: { ...r[3].data, reconciliationId: "old" } })]
];
for (const [name, mutate] of invalidCases) {
  test(`bloquea cierre: ${name}`, () => {
    const rows = evidence(); mutate(rows);
    const result = preview(rows);
    assert.equal(result.status, "REQUIRES_REVIEW"); assert.equal(result.metrics.reconciliations, 0);
    assert.equal(result.metrics.unreconciledMovements, 1);
    assert.ok(result.blockers.some((b) => b.type === "CONCILIACION_INCONSISTENTE"));
    assert.equal(result.rows.find((r) => r.documento === "m").estado, "REQUIRES_REVIEW");
  });
}

test("aprobaciones sin movimiento ni fecha operativa bloquean sin usar la fecha de carga", () => {
  const rows = evidence().filter((r) => r.id !== "m");
  const result = preview(rows);
  assert.ok(result.blockers.some((b) => b.id === "approval-r" && /fecha operativa/.test(b.title)));
  assert.equal(result.metrics.reconciliations, 0);
});
test("aprobación huérfana fechada en otro período no bloquea enero", () => {
  const rows = evidence();
  rows.push({ id: "other", tenantId: "a", recordType: "finance_reconciliation", status: "APPROVED", data: { transactionDate: "2026-02-05", movementId: "absent" } });
  assert.equal(preview(rows).status, "READY_TO_CLOSE");
  assert.ok(preview(rows, "2026-02").blockers.some((b) => b.id === "approval-other"));
});
test("una fecha inválida no permite ocultar una aprobación huérfana", () => {
  for (const transactionDate of ["sin fecha", "2026-02-30", "2026-13-01"]) {
    const rows = evidence();
    rows.push({ id: "bad-date", tenantId: "a", recordType: "finance_reconciliation", status: "APPROVED", data: { transactionDate, movementId: "missing" } });
    assert.ok(preview(rows).blockers.some((b) => b.id === "approval-bad-date"));
  }
});
test("una reversa antigua con comprobante revertido no bloquea una nueva conciliación válida", () => {
  const rows = evidence();
  rows.push({ ...structuredClone(rows[1]), id: "old", status: "REVERSED" });
  rows.push({ ...structuredClone(rows[3]), id: "old-p", status: "REVERSED", data: { ...rows[3].data, reconciliationId: "old" } });
  assert.equal(preview(rows).status, "READY_TO_CLOSE");
});
test("excluidos no cuentan como conciliados ni alteran flujo; una aprobación activa sobre ellos sí bloquea", () => {
  const rows = evidence();
  rows.push({ id: "excluded", tenantId: "a", recordType: "bank_movement", status: "EXCLUDED", data: { transactionDate: "2026-01-05", amount: 900, direction: "CREDIT" } });
  let result = preview(rows);
  assert.equal(result.status, "READY_TO_CLOSE"); assert.equal(result.metrics.incoming, 100);
  assert.equal(result.metrics.excludedMovements, 1); assert.equal(result.metrics.reconciliations, 1);
  rows[0].status = "DELETED";
  result = preview(rows);
  assert.equal(result.status, "REQUIRES_REVIEW"); assert.equal(result.metrics.reconciliations, 0);
  assert.ok(result.blockers.some((b) => b.type === "CONCILIACION_SIN_RESPALDO"));
});
test("cobro bancario huérfano no desaparece, pero un cobro manual sin vínculo no se inventa como conciliación", () => {
  const rows = evidence();
  rows.push({ id: "orphan", tenantId: "a", recordType: "finance_invoice_receipt", status: "RECONCILED", data: { paymentDate: "2026-01-06", reconciliationId: "missing", source: "bank_reconciliation" } });
  assert.ok(preview(rows).blockers.some((b) => b.id === "receipt-orphan"));
  rows.at(-1).data = { paymentDate: "2026-01-06", source: "manual" };
  assert.equal(preview(rows).status, "READY_TO_CLOSE");
});
test("consulta carga comprobantes y documentos históricos paginados de la empresa", async () => {
  const rows = [...Array.from({ length: 1001 }, (_, i) => ({ id: `dummy-${i}`, tenantId: "a", recordType: "finance_invoice_receipt", status: "REVERSED", data: {} })), ...evidence()];
  let pages = 0;
  const db = { industryRecord: { findMany: async (q) => {
    assert.equal(q.where.tenantId, "a"); assert.ok(q.where.recordType.in.includes("finance_invoice_receipt"));
    const start = q.cursor ? rows.findIndex((r) => r.id === q.cursor.id) + q.skip : 0;
    pages++; return rows.slice(start, start + q.take);
  } }, financeBankImportJob: { findMany: async (q) => { assert.equal(q.where.tenantId, "a"); return []; } } };
  const result = await getFinanceMonthlyClosePreview({ tenantId: "a", period: "2026-01", db });
  assert.equal(pages, 3); assert.equal(result.status, "READY_TO_CLOSE"); assert.equal(result.metrics.reconciliations, 1);
});

test("no oculta evidencia de moneda incorrecta ni mezcla aprobaciones USD ajenas al cierre CLP", () => {
  const rows = evidence();
  rows.push({ id: "usd", tenantId: "a", recordType: "finance_reconciliation", status: "APPROVED", data: { currency: "USD", transactionDate: "2026-01-05", movementId: "usd-missing" } });
  const check = () => buildFinanceMonthlyClosePreview(filterFinanceContext(rows, { currency: "CLP", accountKey: "", period: "" }), "2026-01", new Date(), rows);
  assert.equal(check().status, "READY_TO_CLOSE");
  rows.push({ ...structuredClone(rows[3]), id: "bad-usd", data: { ...rows[3].data, currency: "USD" } });
  assert.equal(check().status, "REQUIRES_REVIEW"); assert.equal(check().metrics.reconciliations, 0);
  assert.equal(check().metrics.incoming, 100);
});
