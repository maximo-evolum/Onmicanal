import test from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import express from "express";
import { createServer } from "node:http";
import { buildFinanceProcessReport, readFinanceProcessReport, processReportQuery } from "../src/services/finance-process-reports.service.js";
import { financeProcessReportExcel, financeProcessReportPdf } from "../src/lib/finance-process-report-files.js";
import { financeAccountKey } from "../src/services/finance-context.service.js";
import { prisma } from "../src/lib/db.js";
import { financeRouter } from "../src/routes/finance.routes.js";

const account = { bankKey: "santander", accountAlias: "Operaciones", accountLast4: "1234", currency: "CLP" };
const row = (id, recordType, data, status = "PENDING") => ({ id, tenantId: "a", recordType, title: id, status, data });
function evidence() {
  return [row("m", "bank_movement", { ...account, amount: 100, direction: "CREDIT", transactionDate: "2026-01-05", reconciliationId: "r", description: "Cobro de factura histórica" }, "MATCHED"),
    row("r", "finance_reconciliation", { movementId: "m", amount: 100, currency: "CLP", invoiceIds: ["i"], allocations: [{ invoiceId: "i", amount: 100 }], approvedById: "admin", approvedAt: "2026-01-06T12:00:00Z" }, "APPROVED"),
    row("i", "finance_invoice", { amount: 200, balance: 100, currency: "CLP", issueDate: "2025-12-01" }, "PARTIAL"),
    row("p", "finance_invoice_receipt", { invoiceId: "i", movementId: "m", reconciliationId: "r", amount: 100, paymentDate: "2026-01-05" }, "RECONCILED")];
}
const make = (records = evidence(), input = {}) => buildFinanceProcessReport(records, { tenantId: "a", companyName: "Empresa de prueba", input: { period: "2026-01", ...input }, now: new Date("2026-09-24T12:00:00Z") });
function database(rows) {
  const calls = [];
  const db = { industryRecord: { findMany: async (args) => {
    calls.push(args); const result = rows.filter((r) => r.tenantId === args.where.tenantId && args.where.recordType.in.includes(r.recordType)).sort((a, b) => a.id.localeCompare(b.id));
    const start = args.cursor ? result.findIndex((r) => r.id === args.cursor.id) + 1 : 0; return structuredClone(result.slice(start, start + args.take));
  } }, $transaction: async (fn, opts) => { assert.equal(opts.isolationLevel, "RepeatableRead"); return fn(db); } };
  return { db, calls };
}
test("reporte: prueba evidencia completa y factura histórica sin duplicar comprobantes", () => {
  const input = evidence(), original = structuredClone(input), report = make(input);
  assert.equal(report.summary.total, 1); assert.equal(report.summary.credits, 100); assert.equal(report.summary.counts.VERIFIED.count, 1);
  assert.match(report.rows[0].documents, /i: 100 CLP/); assert.equal(report.rows[0].approvedBy, "admin"); assert.deepEqual(input, original);
});
for (const [name, mutate] of [["sin comprobante", (r) => r.pop()], ["reversa", (r) => r[1].status = "REVERSED"], ["documento de otra empresa", (r) => r[2].tenantId = "b"], ["suma incorrecta", (r) => r[1].data.amount = 200]]) {
  test(`reporte: ${name} no se presenta como conciliación verificada`, () => { const r = evidence(); mutate(r); const out = make(r); assert.equal(out.summary.counts.VERIFIED.count, 0); assert.equal(out.summary.counts.INCONSISTENT.count, 1); assert.ok(out.issues.length); });
}
test("reporte: filtros de cuenta, período, moneda y empresa son independientes", () => {
  const r = evidence(); r.push(row("other-month", "bank_movement", { ...account, amount: 20, transactionDate: "2025-01-01", direction: "CREDIT" }), row("usd", "bank_movement", { ...account, currency: "USD", amount: 20.15, transactionDate: "2026-01-01", direction: "CREDIT" }), { ...r[0], id: "foreign", tenantId: "b" });
  assert.equal(make(r, { accountKey: financeAccountKey(account) }).summary.total, 1);
  const usd = make(r, { currency: "USD" }); assert.equal(usd.summary.total, 1); assert.equal(usd.summary.credits, 20.15); assert.equal(usd.rows[0].status, "PENDING");
  assert.throws(() => make(r, { accountKey: "a".repeat(24) }), (e) => e.status === 404);
});
test("reporte: estado y búsqueda filtran detalle/totales, sin ocultar controles del contexto", () => {
  const r = evidence(); r.pop(); r.push(row("pending", "bank_movement", { ...account, amount: 50, direction: "CREDIT", transactionDate: "2026-01-07", description: "Pago de María" }));
  const out = make(r, { status: "PENDING", search: "maría" }); assert.equal(out.summary.total, 1); assert.equal(out.summary.credits, 50); assert.ok(out.issues.length);
});
test("reporte: cargos, excluidos e importes inválidos no se confunden con cobros", () => {
  const r = [row("debit", "bank_movement", { amount: -30, transactionDate: "2026-01-05" }), row("excluded", "bank_movement", { amount: 1000, direction: "CREDIT", transactionDate: "2026-01-05" }, "EXCLUDED"), row("invalid", "bank_movement", { amount: "texto", direction: "CREDIT", transactionDate: "2026-01-05" })];
  const out = make(r); assert.equal(out.summary.debits, 30); assert.equal(out.summary.credits, 0); assert.equal(out.summary.withoutAmount, 1); assert.equal(out.summary.counts.EXCLUDED.count, 1);
});
test("reporte: excepciones sin fecha siguen visibles sin sumar dos veces el movimiento", () => {
  const r = evidence(); r.push(row("e1", "finance_exception", { movementId: "m", detail: "Revisar ingreso", type: "MANUAL_REVIEW" }, "OPEN"), row("e2", "finance_exception", { movementId: "m", resolution: "Resuelto con respaldo", resolvedById: "admin" }, "RESOLVED"), row("e3", "finance_exception", { movementId: "missing" }, "OPEN"));
  const out = make(r, { kind: "exceptions" }); assert.equal(out.summary.total, 3); assert.equal(out.summary.undated, 1); assert.equal(out.summary.credits, null); assert.equal(out.rows.find((x) => x.id === "e2").resolution, "Resuelto con respaldo");
});
test("reporte: la instantánea cambia ante modificaciones y no ante el reloj", () => {
  const r = evidence(), original = make(r); assert.equal(original.fingerprint, make(r).fingerprint); r[0].data.description = "Corrección"; assert.notEqual(original.fingerprint, make(r).fingerprint);
});
test("reporte: fechas imposibles no se atribuyen al mes y las aprobaciones huérfanas se advierten", () => {
  const rows = evidence(); rows[0].data.transactionDate = "2026-01-32";
  const result = make(rows); assert.equal(result.summary.total, 0); assert.ok(result.issues.some((i) => i.id === "approval-r")); assert.ok(result.notices.some((n) => n.startsWith("1 movimiento")));
});
test("reporte: conserva origen heredado y cuenta enmascarada sin exportar secretos", () => {
  const rows = evidence(); rows[0].data.sourceBatchId = "batch"; rows[0].data.accountLast4 = "123456789"; rows[0].data.secret = "NO_EXPORTAR";
  rows.push(row("batch", "bank_statement", { sourceFile: "enero.xlsx" }));
  const out = make(rows); assert.equal(out.rows[0].sourceFile, "enero.xlsx"); assert.equal(out.rows[0].last4, "6789"); assert.ok(!JSON.stringify(out).includes("NO_EXPORTAR"));
});
test("reporte: límites de precisión no producen un total financiero incorrecto", () => {
  const rows = [1, 2].map((i) => row(`m${i}`, "bank_movement", { amount: Number.MAX_SAFE_INTEGER, direction: "CREDIT", transactionDate: "2026-01-01" }));
  assert.throws(() => make(rows), (e) => e.status === 422);
});
test("reporte: cero registros no se presenta como período cerrado o completo", () => {
  const result = make([]); assert.equal(result.summary.total, 0); assert.ok(result.notices.some((n) => n.includes("no certificación")));
});
test("reporte: paginación lee más de mil registros dentro de una instantánea", async () => {
  const rows = Array.from({ length: 1001 }, (_, i) => row(`m${String(i).padStart(5, "0")}`, "bank_movement", { amount: 1, direction: "CREDIT", transactionDate: "2026-01-01" }));
  const { db, calls } = database(rows); const out = await readFinanceProcessReport(db, { tenantId: "a", input: { period: "2026-01" } });
  assert.equal(out.summary.total, 1001); assert.equal(out.summary.credits, 1001); assert.equal(calls.length, 3);
});
test("reporte: valida parámetros y autenticación antes de consultar", async () => {
  for (const input of [{}, { period: "2026-13" }, { period: "2026-01", kind: "__proto__" }, { period: "2026-01", status: "PAID" }, { period: "2026-01", search: "a".repeat(121) }]) assert.throws(() => processReportQuery(input), (e) => e.status === 400);
  await assert.rejects(readFinanceProcessReport({}, { input: { period: "2026-01" } }), (e) => e.status === 401);
});
test("reporte Excel: detalle completo, números tipados y texto no ejecutable", async () => {
  const r = evidence(); r[0].data.description = '=HYPERLINK("https://example.invalid","prueba")';
  const out = make(r), bytes = await financeProcessReportExcel(out), book = new ExcelJS.Workbook(); await book.xlsx.load(bytes);
  const sheet = book.getWorksheet("Detalle"); assert.equal(sheet.rowCount, 2); assert.equal(sheet.getCell("F2").value, 100); assert.equal(sheet.getCell("C2").value, r[0].data.description); assert.equal(sheet.getCell("C2").type, ExcelJS.ValueType.String); assert.equal(sheet.views[0].ySplit, 1);
  assert.equal(book.worksheets.length, 3); assert.equal(book.getWorksheet("Resumen").getCell("B12").value, 1);
  assert.equal(sheet.getCell("U2").value, "Sin registro");
});
test("reporte PDF: paginación, texto español y última fila sin truncar", () => {
  const rows = Array.from({ length: 100 }, (_, i) => row(`registro-${i}`, "bank_movement", { amount: 1, direction: "CREDIT", transactionDate: "2026-01-01", description: "Conciliación de José (documento)" }));
  const bytes = financeProcessReportPdf(make(rows)), pdf = bytes.toString("latin1");
  assert.ok(pdf.startsWith("%PDF-1.4")); assert.match(pdf, /registro-99/); assert.match(pdf, /Conciliación de José/); assert.ok((pdf.match(/\/Type \/Page\b/g) || []).length > 1); assert.match(pdf, /%%EOF/);
});
test("HTTP reportes: permisos por módulo, tenant autenticado, descarga y vista previa obsoleta", async (t) => {
  const { db } = database(evidence()), oldTx = prisma.$transaction, oldModules = prisma.tenantModule.findMany;
  let enabled = true; prisma.$transaction = db.$transaction;
  prisma.tenantModule.findMany = async ({ where }) => where.module.in.map((module) => ({ module, enabled, source: "MANUAL" }));
  t.after(() => { prisma.$transaction = oldTx; prisma.tenantModule.findMany = oldModules; });
const app = express(); app.use((req, _res, next) => { req.tenantId = req.headers["x-test-tenant"] || "a"; req.tenant = { id: req.tenantId, name: "Prueba", industry: "FINANCE" }; req.user = { tenantId: req.tenantId, id: "user", role: req.headers["x-test-role"] || "SUPER_ADMIN" }; next(); }); app.use(financeRouter);
  const server = createServer(app); await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve)); t.after(() => { server.closeAllConnections(); server.close(); });
  const call = (query = "", headers = {}) => fetch(`http://127.0.0.1:${server.address().port}/finance/process-reports?period=2026-01${query}`, { headers, signal: AbortSignal.timeout(5000) });
  enabled = false; assert.equal((await call("", { "x-test-role": "ADMIN" })).status, 403); enabled = true;
  const preview = await call(); assert.equal(preview.headers.get("cache-control"), "no-store"); const json = await preview.json(); assert.equal(json.summary.total, 1);
  assert.equal((await call("&tenantId=b")).status, 200); assert.equal((await (await call("", { "x-test-tenant": "b" })).json()).summary.total, 0);
  assert.equal((await call("&format=pdf&fingerprint=old")).status, 409);
  const pdf = await call(`&format=pdf&fingerprint=${json.fingerprint}`); assert.equal(pdf.status, 200); assert.equal(pdf.headers.get("content-type"), "application/pdf"); assert.ok((await pdf.arrayBuffer()).byteLength > 1000);
  const xlsx = await call("&format=xlsx"); assert.equal(xlsx.status, 200); assert.match(xlsx.headers.get("content-disposition"), /2026-01.xlsx/);
  assert.equal((await call("&format=exe")).status, 400);
});
