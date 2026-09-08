import test from "node:test";
import assert from "node:assert/strict";
import { parseFinanceContext, financeAccountKey, filterFinanceContext, buildFinanceContextCoverage, loadFinanceContextRecords, restrictFinanceCoverage } from "../src/services/finance-context.service.js";
import { financeReconciliationBlockers } from "../src/services/finance.service.js";

const accountA = { bankKey: "santander", bank: "Santander", accountAlias: "Recaudación", accountType: "Cuenta corriente", accountLast4: "1234" };
const accountB = { ...accountA, accountAlias: "Proveedores", accountLast4: "5678" };
const context = parseFinanceContext({ period: "2026-01", accountKey: financeAccountKey(accountA) });
const movement = (id, date, account, currency = "CLP") => ({ id, recordType: "bank_movement", data: { ...account, transactionDate: date, currency, amount: 1000, direction: "CREDIT" } });
const records = [
  movement("a-jan", "2026-01-02", accountA), movement("a-feb", "2026-02-01", accountA),
  movement("b-jan", "2026-01-02", accountB), movement("a-usd", "2026-01-02", accountA, "USD"),
  { id: "invoice-old", recordType: "finance_invoice", data: { issueDate: "2025-12-10", currency: "CLP", amount: 1000, balance: 1000 } },
  { id: "invoice-jan", recordType: "finance_invoice", data: { issueDate: "2026-01-01", currency: "CLP" } },
  { id: "invoice-future", recordType: "finance_invoice", data: { issueDate: "2026-02-10", currency: "CLP" } }
];

test("la cobertura no revela cuentas ni importes de fuentes deshabilitadas", () => {
  const result = restrictFinanceCoverage(buildFinanceContextCoverage(records, context), { movements: false, customers: true, suppliers: false });
  assert.deepEqual(result.accounts, []);
  assert.equal(result.statements, 0);
  assert.equal(result.sources.movements.status, "NO_ACCESS");
  assert.equal(result.sources.suppliers.count, 0);
  assert.equal(result.sources.customers.count, 1);
});

test("el contexto valida mes, cuenta y moneda sin aceptar otra empresa desde parámetros", () => {
  assert.throws(() => parseFinanceContext({ period: "2026-13" }), /período válido/);
  assert.throws(() => parseFinanceContext({ accountKey: "otra-empresa" }), /cuenta bancaria/);
  assert.throws(() => parseFinanceContext({ currency: "XXX" }), /moneda/);
  assert.equal(parseFinanceContext({ tenantId: "tenant-ajeno" }).tenantId, undefined);
});

test("el selector usa una identidad estable sin confundir aliases de cuentas distintas", () => {
  assert.equal(financeAccountKey(accountA), financeAccountKey({ ...accountA, bankKey: "SANTANDER" }));
  assert.notEqual(financeAccountKey(accountA), financeAccountKey(accountB));
  assert.equal(financeAccountKey({}), "");
});

test("filtra por mes, cuenta y moneda pero no atribuye una factura a un banco arbitrario", () => {
  const filtered = filterFinanceContext(records, context);
  assert.deepEqual(filtered.map((record) => record.id), ["a-jan", "invoice-jan"]);
});

test("las sugerencias conservan facturas anteriores y excluyen emisiones futuras", () => {
  const filtered = filterFinanceContext(records, context, { documentMode: "outstanding" });
  assert.deepEqual(filtered.map((record) => record.id), ["a-jan", "invoice-old", "invoice-jan"]);
});

test("la excepción enlazada mantiene la cuenta y fecha de su movimiento histórico", () => {
  const exception = { id: "exception", recordType: "finance_exception", createdAt: "2026-09-08", data: { movementId: "a-jan" } };
  assert.ok(filterFinanceContext([...records, exception], context).some((record) => record.id === "exception"));
  assert.ok(!filterFinanceContext([...records, exception], { ...context, accountKey: financeAccountKey(accountB) }).some((record) => record.id === "exception"));
});

test("las cartolas antiguas usan los movimientos de origen, no el mes de subida", () => {
  const statement = { id: "statement", recordType: "bank_statement", status: "IMPORTED", createdAt: "2026-09-08", data: { account: accountA } };
  const linked = { ...records[0], data: { ...records[0].data, importBatchId: "statement" } };
  assert.ok(filterFinanceContext([statement, linked], context).some((record) => record.id === "statement"));
  assert.equal(buildFinanceContextCoverage([statement, linked], context).statements, 1);
});

test("la cobertura no acredita completitud sólo por encontrar movimientos", () => {
  const result = buildFinanceContextCoverage(records, context);
  assert.equal(result.sources.movements.count, 1);
  assert.equal(result.sources.customers.count, 1);
  assert.equal(result.sources.suppliers.status, "NO_DATA");
  assert.equal(result.complete, false);
  assert.equal(result.sources.movements.status, "PRESENT_NOT_VERIFIED");
});

test("un período vacío se distingue de uno sin actividad acreditada", () => {
  const result = buildFinanceContextCoverage(records, { ...context, period: "2025-01" });
  assert.equal(result.sources.movements.count, 0);
  assert.equal(result.complete, false);
  assert.ok(result.warnings.some((warning) => warning.includes("no acredita")));
});

test("la cobertura reconoce documentos de proveedor guardados por una migración antigua", () => {
  const supplier = { id: "legacy", recordType: "finance_invoice", data: { issueDate: "2026-01-01", supplierName: "Proveedor Sur" } };
  const result = buildFinanceContextCoverage([supplier], { ...context, accountKey: "" });
  assert.equal(result.sources.customers.count, 0);
  assert.equal(result.sources.suppliers.count, 1);
});

test("no acepta una cuenta que no está en los registros de la empresa autenticada", () => {
  assert.throws(() => buildFinanceContextCoverage([], context), (error) => error.status === 404);
});

test("una excepción de importación sin fecha sigue visible para resolverla", () => {
  const record = { id: "unknown", recordType: "finance_exception", data: { importBatchId: "unknown-batch", movement: {} } };
  assert.equal(filterFinanceContext([record], { ...context, accountKey: "" }).length, 1);
});

test("la carga del contexto exige tenant y lo aplica a todas las consultas", async () => {
  const db = { industryRecord: { findMany: async (query) => { assert.equal(query.where.tenantId, "tenant-a"); return []; } } };
  assert.deepEqual(await loadFinanceContextRecords(db, "tenant-a"), []);
  await assert.rejects(loadFinanceContextRecords(db, ""), (error) => error.status === 401);
});

test("no concilia automáticamente importes numéricamente iguales de monedas distintas", () => {
  const invoice = { id: "usd", data: { issueDate: "2026-01-01", amount: 1000, currency: "USD" } };
  assert.ok(financeReconciliationBlockers(invoice, records[0]).some((reason) => reason.includes("monedas distintas")));
});
