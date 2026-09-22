import test from "node:test";
import assert from "node:assert/strict";
import { analyzeHistoricalRecord, historicalCoverageBlockers, historicalVersion } from "../src/services/finance-historical-quality.service.js";
import { listHistoricalReview, correctHistoricalRecord } from "../src/services/finance-historical-review.service.js";
import { financeDocumentState } from "../src/services/finance-document-values.service.js";
import { updateFinanceExceptionCase } from "../src/services/finance-case-actions.service.js";
import { financeActionForRecordMutation, FINANCE_ACTIONS } from "../src/services/finance-security.service.js";

const access = { customers: true, suppliers: true, bank: true, exceptions: true };
const row = (id = "old", recordType = "finance_invoice", data = {}) => ({ id, tenantId: "t", recordType, status: "OPEN", title: "Registro histórico", createdAt: "2026-09-17T00:00:00Z", updatedAt: "v0", data });
const document = { issueDate: "2025-01-05", dueDate: "2025-02-05", documentNumber: "F-100", partyName: "Cliente de prueba", customerName: "Cliente de prueba", amount: 100, balance: 40, paidAmount: 60, creditNotesTotal: 0, debitNotesTotal: 0, currency: "CLP" };
const movement = { transactionDate: "2025-01-05", amount: 100, currency: "CLP", direction: "CREDIT", description: "Transferencia según original", bankKey: "santander_chile", accountAlias: "Operaciones", accountLast4: "1234", accountType: "Cuenta corriente", reference: "ABC123" };
function database(initial = [row()]) {
  let rows = structuredClone(initial), controls = [], audits = [], seq = 0, tail = Promise.resolve();
  const match = (r, where = {}) => Object.entries(where).every(([k, v]) => v?.in ? v.in.includes(r[k]) : r[k] === v);
  const db = { get rows() { return rows; }, get controls() { return controls; }, get audits() { return audits; },
    $transaction: (fn, opts) => { assert.equal(opts.isolationLevel, "Serializable"); const result = tail.then(async () => { const before = structuredClone({ rows, controls, audits }); try { return await fn(db); } catch (e) { ({ rows, controls, audits } = before); throw e; } }); tail = result.catch(() => {}); return result; },
    financePeriodControl: {
      findFirst: async ({ where }) => structuredClone(controls.find((r) => match(r, where)) || null),
      upsert: async ({ where, create }) => { let c = controls.find((r) => match(r, where.tenantId_period)); if (!c) { c = structuredClone(create); controls.push(c); } else c.lockVersion++; return structuredClone(c); }
    },
    industryRecord: {
      findFirst: async ({ where }) => structuredClone(rows.find((r) => match(r, where)) || null),
      findMany: async ({ where, cursor, skip = 0, take }) => { const found = rows.filter((r) => match(r, where)); const start = cursor ? found.findIndex((r) => r.id === cursor.id) + skip : 0; return structuredClone(found.slice(start, start + take)); },
      create: async ({ data }) => { const r = { id: `created-${++seq}`, updatedAt: `v${seq}`, ...structuredClone(data) }; rows.push(r); return structuredClone(r); },
      update: async ({ where, data }) => { const r = rows.find((r) => match(r, where)); assert.ok(r); Object.assign(r, structuredClone(data), { updatedAt: `v${++seq}` }); return structuredClone(r); }
    }, tenantAuditLog: { create: async ({ data }) => { audits.push(data); } }
  }; return db;
}
const docPatch = () => Object.fromEntries(Object.entries(document).filter(([key]) => key !== "customerName"));
const args = (db, extra = {}) => ({ tenantId: "t", userId: "admin", id: "old", version: historicalVersion(db.rows.find((r) => r.id === "old")), patch: docPatch(), reason: "Se recuperó el reporte histórico original", evidence: "Reporte ERP enero 2025, factura F-100 y saldo confirmado", confirmation: "CORREGIR", access, ...extra });

test("detecta desconocidos y no usa createdAt como fecha de emisión", () => {
  const a = analyzeHistoricalRecord(row()); assert.equal(a.date, "");
  for (const code of ["DATE", "CURRENCY", "BALANCE", "NUMBER", "PARTY"]) assert.ok(a.issues.some((i) => i.code === code));
  assert.ok(historicalCoverageBlockers([row()], "2025-01").length); assert.ok(historicalCoverageBlockers([row()], "2026-09").length);
});
test("un saldo ausente no equivale a cero pagado ni cartera íntegra", () => {
  const s = financeDocumentState(row("i", "finance_invoice", { amount: 100 })); assert.equal(s.included, false); assert.ok(s.qualityIssues.some((x) => /saldo ni el pago/.test(x)));
});
test("vencimiento desconocido no inventa mora y se identifica como advertencia", () => {
  const a = analyzeHistoricalRecord(row("i", "finance_invoice", { ...document, dueDate: null }));
  assert.equal(a.issues.length, 1); assert.equal(a.issues[0].blocking, false);
  assert.equal(historicalCoverageBlockers([row("i", "finance_invoice", { ...document, dueDate: null })], "2025-01").length, 0);
});

test("vencimiento imposible no se normaliza a otro día ni inventa mora", () => {
  const s = financeDocumentState(row("i", "finance_invoice", { ...document, dueDate: "2025-02-30" }));
  assert.equal(s.dueDate, null); assert.notEqual(s.status, "OVERDUE");
});
test("lista sin filtro mensual y paginada consulta más de mil registros", async () => {
  const db = database(Array.from({ length: 1001 }, (_, i) => row(`d-${String(i).padStart(4, "0")}`)));
  const result = await listHistoricalReview(db, { tenantId: "t", access, page: 41 }); assert.equal(result.total, 1001); assert.equal(result.records.length, 1);
});
test("respeta tenant y módulos, también proveedores guardados como facturas genéricas", async () => {
  const db = database([row(), row("p", "finance_invoice", { documentSide: "SUPPLIER" }), { ...row("other"), tenantId: "another" }]);
  const result = await listHistoricalReview(db, { tenantId: "t", access: { ...access, suppliers: false } }); assert.equal(result.total, 1); assert.equal(result.records[0].id, "old");
  await assert.rejects(correctHistoricalRecord(db, args(db, { tenantId: "another" })), /no disponible/);
});
test("corrección preserva datos y copia original inmutable con auditoría", async () => {
  const db = database([row("old", "finance_invoice", { sourceRow: { monto: "ilegible" }, sourceFile: "cartera.csv", custom: "conservar" })]); const before = structuredClone(db.rows[0]);
  await correctHistoricalRecord(db, args(db));
  assert.equal(db.rows[0].data.issueDate, "2025-01-05"); assert.equal(db.rows[0].data.balance, 40); assert.equal(db.rows[0].data.custom, "conservar"); assert.deepEqual(db.rows[0].data.sourceRow, before.data.sourceRow);
  const correction = db.rows.find((r) => r.recordType === "finance_historical_correction"); assert.deepEqual(correction.data.before.data, before.data); assert.equal(db.audits.length, 1);
  assert.equal(db.rows.some((r) => r.recordType === "finance_invoice_receipt"), false);
});
test("movimiento de cartola recupera fecha, descripción, cuenta y abono sin tocar archivo", async () => {
  const db = database([row("old", "bank_movement", { importBatchId: "batch", sourceRow: { original: "dato" } })]);
  await correctHistoricalRecord(db, args(db, { patch: movement }));
  const data = db.rows[0].data; assert.equal(data.direction, "CREDIT"); assert.equal(data.transactionDate, "2025-01-05"); assert.equal(data.importBatchId, "batch"); assert.deepEqual(data.sourceRow, { original: "dato" }); assert.ok(data.fingerprint);
});
test("fila de migración se convierte una vez y pago previo es saldo inicial, no conciliación", async () => {
  const db = database([row("old", "finance_exception", { type: "MIGRATION_REVIEW", documentSide: "CUSTOMER", sourceFile: "old.csv", sourceRow: { original: "fila" }, migrationBatchId: "mb" })]); const input = args(db);
  const result = await correctHistoricalRecord(db, input); assert.equal(db.rows[0].status, "RESOLVED"); assert.equal(db.rows[0].data.correctedRecordId, result.recordId);
  const created = db.rows.find((r) => r.id === result.recordId); assert.equal(created.recordType, "finance_invoice"); assert.equal(created.data.balance, 40);
  assert.equal(db.rows.find((r) => r.recordType === "finance_opening_balance").data.amount, 60);
  await assert.rejects(correctHistoricalRecord(db, input), /ya fue/); assert.equal(db.rows.filter((r) => r.recordType === "finance_invoice").length, 1);
});
test("fila de cartola pendiente crea movimiento y resuelve excepción conservando original", async () => {
  const db = database([row("old", "finance_exception", { type: "BANK_STATEMENT_IMPORT_REVIEW", movement: { source: { fecha: "?" } }, importBatchId: "b" })]);
  const result = await correctHistoricalRecord(db, args(db, { patch: movement })); assert.equal(db.rows.find((r) => r.id === result.recordId).recordType, "bank_movement"); assert.equal(db.rows[0].data.movement.source.fecha, "?");
});
test("no permite cambiar de empresa ni columnas internas en una corrección", async () => {
  const db = database(); for (const patch of [{ ...docPatch(), tenantId: "x" }, { ...docPatch(), reconciliationId: "fake" }, { ...docPatch(), sourceRow: {} }]) await assert.rejects(correctHistoricalRecord(db, args(db, { patch })), /no permitidos/);
  assert.equal(db.rows.length, 1);
});
test("rechaza datos fabricados, fechas inválidas, saldo incongruente y conversión de moneda", async () => {
  for (const patch of [{ ...docPatch(), issueDate: "2025-02-30" }, { ...docPatch(), balance: 500 }, { ...docPatch(), paidAmount: "" }, { ...docPatch(), dueDate: "2024-01-01" }, { ...docPatch(), amount: -1 }, { ...docPatch(), currency: "USD" }]) { const db = database(); await assert.rejects(correctHistoricalRecord(db, args(db, { patch }))); assert.equal(db.rows.length, 1); }
  const db = database([row("old", "finance_invoice", { currency: "USD" })]); await assert.rejects(correctHistoricalRecord(db, args(db)), /extranjera/);
});
test("fecha desconocida con cierres vigentes no permite saltar al mes abierto", async () => {
  const db = database(); db.controls.push({ tenantId: "t", period: "2024-01", status: "CLOSED" }); await assert.rejects(correctHistoricalRecord(db, args(db)), /original es desconocido/);
});
test("protege tanto mes anterior como nuevo y conserva todo al fallar", async () => {
  for (const period of ["2024-12", "2025-01"]) { const db = database([row("old", "finance_invoice", { issueDate: "2024-12-01" })]); db.controls.push({ tenantId: "t", period, status: "CLOSED" }); await assert.rejects(correctHistoricalRecord(db, args(db)), /cerrado/); assert.equal(db.audits.length, 0); }
});
test("no altera conciliaciones, asignaciones ni pagos existentes", async () => {
  for (const linked of [row("link", "finance_invoice_receipt", { invoiceId: "old" }), row("link", "finance_reconciliation", { allocations: [{ invoiceId: "old", amount: 50 }] }), row("link", "finance_opening_balance", { invoiceId: "old" })]) { const db = database([row(), linked]); await assert.rejects(correctHistoricalRecord(db, args(db)), /asociados/); }
});
test("datos obsoletos y doble clic concurrente no sobrescriben ni duplican", async () => {
  const db = database(); const input = args(db); const results = await Promise.allSettled([correctHistoricalRecord(db, input), correctHistoricalRecord(db, input)]); assert.equal(results.filter((r) => r.status === "fulfilled").length, 1); assert.equal(db.audits.length, 1);
});
test("falla de auditoría revierte registro, evento y controles", async () => {
  const db = database(); const before = structuredClone(db.rows); db.tenantAuditLog.create = async () => { throw Error("audit down"); };
  await assert.rejects(correctHistoricalRecord(db, args(db)), /audit down/); assert.deepEqual(db.rows, before); assert.equal(db.controls.length, 0);
});
test("rechaza duplicado de factura y de movimiento", async () => {
  const db = database([row(), row("existing", "finance_invoice", document)]); await assert.rejects(correctHistoricalRecord(db, args(db)), /coincide/);
  const bankDb = database([row("old", "bank_movement"), row("existing", "bank_movement", movement)]); await assert.rejects(correctHistoricalRecord(bankDb, args(bankDb, { patch: movement })), /coincide/);
});
test("sin confirmación o respaldo suficiente no modifica datos", async () => {
  const db = database(); for (const extra of [{ confirmation: "" }, { evidence: "ok" }, { reason: "ok" }, { userId: null }, { access: {} }]) await assert.rejects(correctHistoricalRecord(db, args(db, extra))); assert.equal(db.rows.length, 1);
});
test("no se oculta una fila de importación cambiando estado a resuelta", async () => {
  const db = database([row("old", "finance_exception", { type: "MIGRATION_REVIEW", workflowVersion: 0 })]);
  await assert.rejects(updateFinanceExceptionCase(db, { tenantId: "t", userId: "admin", id: "old", input: { expectedVersion: 0, status: "RESOLVED", resolution: "Se considera terminada sin documento" } }), /Revisión histórica/);
});
test("la nueva evidencia exige permisos de importación histórica", () => { assert.equal(financeActionForRecordMutation("finance_historical_correction"), FINANCE_ACTIONS.IMPORT_HISTORY); });

test("corregir cuenta de cartola no altera movimientos hijos ya conciliados", async () => {
  const child = { ...row("m", "bank_movement", { ...movement, importBatchId: "old" }), status: "MATCHED" };
  const db = database([row("old", "bank_statement"), child]);
  await assert.rejects(correctHistoricalRecord(db, args(db, { patch: { bankKey: "santander_chile", accountAlias: "Operaciones" } })), /conciliaciones/);
  assert.equal(db.audits.length, 0);
});
