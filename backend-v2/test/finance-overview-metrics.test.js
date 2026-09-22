import test from "node:test";
import assert from "node:assert/strict";
import { overviewReconciliationMetrics, overviewCollectionSchedule, overviewMetricsCsv, isOverviewCustomerInvoice } from "../src/services/finance-overview-metrics.service.js";
import { getFinanceOverview, getInvoiceFinancialState } from "../src/services/finance.service.js";
import { financeAccountKey } from "../src/services/finance-context.service.js";
const invoice = (id, data = {}, status = "OPEN") => ({ id, recordType: "finance_invoice", status, data: { amount: 100, balance: 100, issueDate: "2026-01-01", dueDate: "2026-01-02", ...data } });
const movement = (id, recId, status = "MATCHED", extra = {}) => ({ id, recordType: "bank_movement", status, data: { transactionDate: "2026-01-02", reconciliationId: recId, ...extra } });
const rec = (id, movementId, status = "APPROVED") => ({ id, recordType: "finance_reconciliation", status, data: { movementId } });
const now = new Date("2026-01-02T12:00:00Z");
test("conciliación solo cuenta vínculos vigentes y aparta excluidos", () => {
  const result = overviewReconciliationMetrics([movement("m1", "r1"), movement("m2", "r2"), movement("m3", "r3"), movement("m4", null, "PENDING"), movement("m5", null, "EXCLUDED"), movement("m6", null, "PENDING", { transactionDate: "2026-01-99" })], [rec("r1", "m1"), rec("r2", "m2", "REVERSED"), rec("r3", "other")]);
  assert.deepEqual(result, { totalMovements: 4, matchedMovements: 1, pendingMovements: 3, excludedMovements: 1, invalidDateMovements: 1, inconsistentMovements: 2, rate: 25 });
});
test("sin movimientos no se inventa cobertura ni tasa positiva", () => {
  assert.equal(overviewReconciliationMetrics([], []).rate, 0);
});
test("calendario agrupa saldos, no importes originales ni pagos seguros", () => {
  const result = overviewCollectionSchedule([invoice("today", { balance: 20 }), invoice("week2", { dueDate: "2026-01-09", balance: 50 }), invoice("day30", { dueDate: "2026-02-01" }), invoice("overdue", { dueDate: "2026-01-01" }), invoice("invalid", { dueDate: "2026-02-30" }), invoice("paid", { balance: 0 }, "PAID")], now, getInvoiceFinancialState);
  assert.equal(result.next30Days, 70); assert.equal(result.weeks[0].amount, 20); assert.equal(result.weeks[1].amount, 50);
  assert.equal(result.weeks[4].amount, 100); assert.equal(result.undatedDocuments, 1);
  assert.match(result.basis, /No es predicción/);
});
test("calendario usa día de Chile al cruzar medianoche UTC", () => {
  const result = overviewCollectionSchedule([], new Date("2026-01-02T01:00:00Z"), getInvoiceFinancialState);
  assert.equal(result.asOf, "2026-01-01"); assert.ok(result.weeks.every((w) => w.amount === 0));
});
test("proveedores y facturas anuladas no se convierten en cobros a clientes", () => {
  for (const record of [invoice("x", { supplierName: "Proveedor" }), invoice("x", { documentSide: "SUPPLIER" }), invoice("x", { direction: "EGRESO" }), invoice("x", {}, "ANNULLED")]) assert.equal(isOverviewCustomerInvoice(record), false);
  assert.equal(isOverviewCustomerInvoice(invoice("c", { clientName: "Cliente" })), true);
});
function dbFor(records) { return { industryRecord: { findMany: async (q) => { assert.equal(q.where.tenantId, "tenant"); const start = q.cursor ? records.findIndex((r) => r.id === q.cursor.id) + 1 : 0; return records.slice(start, start + q.take); } } }; }
test("resumen mantiene empresa cuenta período moneda y lotes antiguos", async () => {
  const account = { bankKey: "santander", accountLast4: "1234" };
  const records = [invoice("c"), invoice("supplier", { supplierName: "Proveedor" }), invoice("usd", { currency: "USD" }), invoice("old", { issueDate: "2025-12-01" }), { id: "b", recordType: "bank_statement", data: { account } }, movement("m", "r", "MATCHED", { sourceBatchId: "b" }), rec("r", "m"), movement("outside", null, "PENDING", { bankKey: "otro" })];
  const overview = await getFinanceOverview({ tenantId: "tenant", now, db: dbFor(records), context: { currency: "CLP", period: "2026-01", accountKey: financeAccountKey(account) } });
  assert.equal(overview.invoices.total, 1); assert.equal(overview.reconciliation.totalMovements, 1); assert.equal(overview.reconciliation.rate, 0); // Minimal legacy link lacks payment evidence.
  assert.equal(overview.schedule.next30Days, 100); assert.equal(overview.collection.dsoSampleSize, 0);
  assert.match(overviewMetricsCsv(overview, "tenant"), /Confirmados \/ activos/);
});
test("lectura completa no recorta 1248 documentos ni su calendario", async () => {
  const records = Array.from({ length: 1248 }, (_, i) => invoice(String(i)));
  const result = await getFinanceOverview({ tenantId: "tenant", db: dbFor(records), now, context: { period: "2026-01" } });
  assert.equal(result.invoices.total, 1248); assert.equal(result.schedule.next30Days, 124800);
});
test("CSV no interpreta etiquetas del contexto como fórmulas", async () => {
  const result = await getFinanceOverview({ tenantId: "tenant", db: dbFor([]), now });
  assert.match(overviewMetricsCsv(result, '=HYPERLINK("x")'), /'=HYPERLINK/);
  assert.match(overviewMetricsCsv(result, "tenant"), /Sin evidencia/);
});
