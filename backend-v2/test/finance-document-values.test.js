import test from "node:test";
import assert from "node:assert/strict";
import { financeDocumentSide, financeDocumentState, financeDocumentAmounts, summarizeFinanceDocuments, financeDocumentDate } from "../src/services/finance-document-values.service.js";
import { getFinanceOverview } from "../src/services/finance.service.js";
import { buildFinanceMonthlyClosePreview } from "../src/services/finance-monthly-close.service.js";
import { filterFinanceContext } from "../src/services/finance-context.service.js";

const now = new Date("2026-02-05T12:00:00Z");
const doc = (id, data = {}, status = "OPEN", recordType = "finance_invoice") => ({ id, tenantId: "t", title: id, recordType, status, data: { amount: 100, issueDate: "2026-01-02", dueDate: "2026-02-01", currency: "CLP", ...data } });
const context = { period: "2026-01", currency: "CLP", accountKey: "" };
function dbFor(records) { return { industryRecord: { findMany: async (q) => {
  assert.equal(q.where.tenantId, "t");
  const found = records.filter((r) => r.tenantId === "t" && q.where.recordType.in.includes(r.recordType));
  const start = q.cursor ? found.findIndex((r) => r.id === q.cursor.id) + q.skip : 0;
  return found.slice(start, start + q.take);
} } }; }

test("un mismo documento conserva NC, ND, saldo y pago sin restar ajustes dos veces", () => {
  for (const recordType of ["finance_invoice", "finance_payable"]) {
    const s = financeDocumentState(doc("d", { amount: 1000, creditNotesTotal: 200, debitNotesTotal: 50, balance: 550, paidAmount: 300 }, "PARTIAL", recordType), now);
    assert.equal(s.originalAmount, 1000); assert.equal(s.amount, 850); assert.equal(s.balance, 550); assert.equal(s.paidAmount, 300);
    assert.equal(s.included, true);
  }
});
test("si falta saldo usa pagos registrados, pero no inventa pagos desde una etiqueta PAID", () => {
  const s = financeDocumentState(doc("d", { amount: 500, paidAmount: 125 }), now);
  assert.equal(s.balance, 375); assert.equal(s.paidAmount, 125);
  const missing = financeDocumentState(doc("d", {}, "PAID"), now);
  assert.equal(missing.status, "REQUIRES_REVIEW"); assert.equal(missing.included, false);
});
test("una NC que extingue la deuda no es un pago", () => {
  const s = financeDocumentState(doc("d", { amount: 100, creditNotesTotal: 100, balance: 0 }), now);
  assert.equal(s.amount, 0); assert.equal(s.balance, 0); assert.equal(s.paidAmount, 0); assert.equal(s.included, true);
});
test("anulaciones se conservan y no se suman como pagadas", () => {
  for (const status of ["ANNULLED", "CANCELLED", "CANCELED", "VOID", "ANULADA", "ANULADO", "REJECTED", "DELETED", "EXCLUDED"]) {
    const r = doc("d", { balance: 0 }, status), s = financeDocumentState(r, now);
    assert.equal(s.included, false); assert.equal(s.paidAmount, 0); assert.notEqual(s.status, "PAID");
    assert.equal(summarizeFinanceDocuments([r], now).customers.issued, 0);
  }
});
test("notas independientes no duplican ajustes ya vinculados a una factura", () => {
  for (const data of [{ documentTypeCode: "61" }, { documentTypeCode: 56 }, { documentType: "Nota de crédito" }, { documentType: "Nota débito" }]) {
    const s = financeDocumentState(doc("d", data), now);
    assert.equal(s.adjustment, true); assert.equal(s.included, false); assert.equal(s.paidAmount, 0);
  }
});
test("proveedores legados y campos contradictorios no terminan en cuentas por cobrar", () => {
  for (const data of [{ supplierName: "Proveedor", documentSide: "CUSTOMER" }, { clientName: "Proveedor importado", documentSide: "SUPPLIER" }, { documentSide: "CUSTOMER", direction: "PURCHASE" }, { documentFlow: "RECEIVED" }]) assert.equal(financeDocumentSide(doc("d", data)), "SUPPLIER");
  assert.equal(financeDocumentSide(doc("d", { clientName: "Cliente" })), "CUSTOMER");
  assert.equal(financeDocumentSide(doc("d", { documentSide: "CUSTOMER" }, "OPEN", "finance_payable")), "SUPPLIER");
});
test("montos y saldos inconsistentes se excluyen de indicadores y bloquean el cierre", () => {
  for (const data of [{ amount: "abc" }, { amount: null }, { balance: -1 }, { balance: 101 }, { balance: 40, paidAmount: 10 }, { amount: 100, creditNotesTotal: 120 }, { amount: Infinity }, { amount: true }]) {
    const record = doc("bad", data), state = financeDocumentState(record, now);
    assert.equal(state.included, false); assert.ok(state.qualityIssues.length);
    const close = buildFinanceMonthlyClosePreview([record], context.period, now);
    assert.equal(close.metrics.issued, 0); assert.ok(close.blockers.some((b) => b.type === "DOCUMENTO_SALDO_INCONSISTENTE"));
  }
});
test("se usa emisión real y no creación para agrupar documentos", () => {
  const r = doc("d", { issueDate: "2025-12-01", transactionDate: "2026-01-02" });
  assert.equal(filterFinanceContext([r], context).length, 0);
  assert.equal(buildFinanceMonthlyClosePreview([r], context.period, now).metrics.issued, 0);
  assert.equal(financeDocumentDate({ ...r, createdAt: "2026-01-05", data: {} }), "");
  assert.equal(financeDocumentDate(doc("bad", { issueDate: "2026-02-30" })), "");
});

test("Dashboard, proyección del portal y cierre entregan los mismos totales del mismo alcance", async () => {
  const records = [
    doc("c1", { amount: 1000, creditNotesTotal: 200, debitNotesTotal: 50, balance: 550, paidAmount: 300 }),
    doc("c2", { amount: 500, paidAmount: 125 }), doc("c3", { balance: 0 }, "PAID"),
    doc("legacy-supplier", { supplierName: "Proveedor", amount: 1000, creditNotesTotal: 100, balance: 600, paidAmount: 300 }),
    doc("supplier", { amount: 300, debitNotesTotal: 50, balance: 150, paidAmount: 200 }, "PARTIAL", "finance_payable"),
    doc("cancelled", { amount: 999, balance: 999 }, "ANNULLED"), doc("note", { amount: 200, documentTypeCode: "61" }),
    doc("bad", { balance: 150 }), doc("old", { amount: 500, issueDate: "2025-01-01" }), doc("usd", { amount: 600, currency: "USD" }),
    { ...doc("other-tenant", { amount: 100000 }), tenantId: "other" }
  ];
  const scoped = filterFinanceContext(records.filter((r) => r.tenantId === "t"), context);
  const portal = scoped.map((r) => ({ side: financeDocumentSide(r), ...financeDocumentAmounts(r, now) }));
  const sum = (side, key) => portal.filter((r) => r.side === side && r.includedInTotals).reduce((s, r) => s + r[key], 0);
  const overview = await getFinanceOverview({ tenantId: "t", db: dbFor(records), now, context });
  const close = buildFinanceMonthlyClosePreview(scoped, context.period, now);
  assert.equal(sum("CUSTOMER", "amount"), 1450); assert.equal(sum("CUSTOMER", "paidAmount"), 525); assert.equal(sum("CUSTOMER", "balance"), 925);
  assert.equal(overview.invoices.issued, sum("CUSTOMER", "amount")); assert.equal(close.metrics.issued, overview.invoices.issued);
  assert.equal(overview.invoices.paid, sum("CUSTOMER", "paidAmount")); assert.equal(close.metrics.collected, overview.invoices.paid);
  assert.equal(overview.invoices.pendingAmount, close.documentSummary.customers.pendingAmount);
  assert.equal(close.metrics.registeredPayables, 1250); assert.equal(close.metrics.paidPayables, 500);
  assert.equal(close.metrics.registeredPayables, sum("SUPPLIER", "amount")); assert.equal(close.metrics.paidPayables, sum("SUPPLIER", "paidAmount"));
  assert.deepEqual(overview.documentQuality, { inactive: 1, adjustments: 1, invalid: 1 });
  assert.equal(close.status, "REQUIRES_REVIEW");
});

test("Dashboard y cierre verifican el mismo respaldo de conciliación y reversa", async () => {
  const records = [doc("i", { balance: 0 }, "PAID"),
    { id: "m", tenantId: "t", recordType: "bank_movement", status: "MATCHED", data: { transactionDate: "2026-01-05", direction: "CREDIT", amount: 100, reconciliationId: "r" } },
    { id: "r", tenantId: "t", recordType: "finance_reconciliation", status: "APPROVED", data: { movementId: "m", amount: 100, allocations: [{ invoiceId: "i", amount: 100 }] } },
    { id: "p", tenantId: "t", recordType: "finance_invoice_receipt", status: "RECONCILED", data: { invoiceId: "i", movementId: "m", reconciliationId: "r", amount: 100 } }
  ];
  for (const reverse of [false, true]) {
    if (reverse) records[2].status = "REVERSED";
    const overview = await getFinanceOverview({ tenantId: "t", db: dbFor(records), now, context });
    const close = buildFinanceMonthlyClosePreview(records, context.period, now);
    assert.equal(overview.reconciliation.matchedMovements, reverse ? 0 : 1);
    assert.equal(close.metrics.reconciliations, overview.reconciliation.matchedMovements);
  }
});
