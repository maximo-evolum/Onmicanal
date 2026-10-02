import test from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import express from "express";
import { validateFileSelection, fileSelectionChanged } from "../src/services/finance-file-selection.service.js";
import { readBankStatementFile, inspectBankStatementLayout, detectBankStatementInstitution } from "../src/services/finance-bank-statements.service.js";
import { normalizeBankReviewRows, validateBankReviewConfig } from "../src/services/finance-bank-review.service.js";
import { prisma } from "../src/lib/db.js";
import { financeRouter } from "../src/routes/finance.routes.js";
const csv = (text) => ({ originalname: "cartola.csv", buffer: Buffer.from(text) });
const account = { bankKey: "santander_chile" };
async function workbook() {
  const book = new ExcelJS.Workbook();
  const cover = book.addWorksheet("Portada"); cover.addRow(["Titular", "Empresa de prueba"]); cover.addRow(["Mes", "Enero"]);
  const sheet = book.addWorksheet("Movimientos enero");
  sheet.getRow(3).values = ["Fecha", "Descripción", "Monto", "Cargo/Abono"];
  sheet.getRow(5).values = [new Date("2026-01-02T00:00:00Z"), "Pago cliente", 1200, "A"];
  sheet.getRow(7).values = ["03/01/2026", "Comisión banco", 200, "C"];
  sheet.getRow(9).values = ["Total", "Control", 1000, ""];
  book.addWorksheet("Vacía");
  return { originalname: "enero.xlsx", buffer: Buffer.from(await book.xlsx.writeBuffer()) };
}

test("valida selección sin coerciones ni opciones desconocidas", () => {
  for (const input of [[], null, { headerRow: 0 }, { endRow: -1 }, { headerRow: "3" }, { sheet: 9 }, { delimiter: ":" }, { headerRow: 4, endRow: 4 }, { headerRow: 100001 }, { injected: true }]) assert.throws(() => validateFileSelection(input), (e) => e.status === 400);
  assert.deepEqual(validateFileSelection({ sheet: "", headerRow: "", endRow: null, delimiter: "" }), {});
  assert.equal(fileSelectionChanged({ sheet: "Enero", headerRow: 2 }, { headerRow: 2, sheet: "Enero" }), false);
});

test("elige hoja correcta, encabezado real y final sin importar portada ni totales", async () => {
  const file = await workbook(), original = Buffer.from(file.buffer);
  const rows = await readBankStatementFile(file, { selection: { sheet: "Movimientos enero", headerRow: 3, endRow: 7 } });
  assert.equal(rows.length, 2);
  const normalized = normalizeBankReviewRows(rows, account);
  assert.deepEqual(normalized.map((r) => r.rowNumber), [5, 7]);
  assert.deepEqual(normalized.map((r) => r.direction), ["CREDIT", "DEBIT"]);
  assert.equal(normalized[0].transactionDate, "2026-01-02"); assert.equal(normalized[0].amount, 1200);
  assert.equal(normalized[1].amount, 200); assert.deepEqual(file.buffer, original);
});

test("el banco de otra hoja o del nombre del libro no contamina la tabla elegida", async () => {
  const book = new ExcelJS.Workbook(); book.addWorksheet("Santander").addRow(["Banco Santander Chile"]);
  book.addWorksheet("Otra cuenta").addRow(["Banco de Chile"]);
  const file = { originalname: "santander.xlsx", buffer: Buffer.from(await book.xlsx.writeBuffer()) };
  const result = await detectBankStatementInstitution(file, [], { sheet: "Otra cuenta" });
  assert.equal(result.institution.key, "banco_de_chile");
});

test("vista del original lista todas las hojas y conserva carátulas y filas reales", async () => {
  const file = await workbook(), r = await inspectBankStatementLayout(file, { sheet: "Movimientos enero" });
  assert.equal(r.supported, true); assert.equal(r.sheets.length, 3); assert.equal(r.detectedHeaderRow, 3);
  assert.deepEqual(r.rows.map((r) => r.number), [3, 5, 7, 9]); assert.equal(r.lastRow, 9);
  assert.equal((await inspectBankStatementLayout(file, { sheet: "Vacía" })).sheets.length, 3);
});

test("una hoja inexistente o un encabezado vacío nunca vuelve silenciosamente a otra tabla", async () => {
  const file = await workbook();
  for (const selection of [{ sheet: "Otra" }, { sheet: "Movimientos enero", headerRow: 4 }, { sheet: "Movimientos enero", headerRow: 3, endRow: 99 }, { sheet: "Movimientos enero", endRow: 2 }, { delimiter: ";" }]) await assert.rejects(readBankStatementFile(file, { selection }), (e) => e.status === 400);
});

test("CSV con coma y campo multilínea conserva número de registro y separador explícito", async () => {
  const file = csv('Portada\n\nFecha,Descripción,Monto\n02/01/2026,"Pago\ncliente",100\nTotal,Control,100');
  const rows = await readBankStatementFile(file, { selection: { delimiter: ",", headerRow: 3, endRow: 4 } });
  assert.equal(rows.length, 1); assert.equal(rows[0].__financeOrigin.row, 4); assert.equal(rows[0]["Descripción"], "Pago\ncliente");
  const layout = await inspectBankStatementLayout(file, { delimiter: "," });
  assert.equal(layout.lastRow, 5); assert.equal(layout.kind, "csv-record");
});

test("TXT con barra vertical se reconoce por contenido y admite corrección", async () => {
  const rows = await readBankStatementFile(csv("Fecha|Descripción|Monto\n02/01/2026|Abono|150"), { selection: { delimiter: "|", headerRow: 1 } });
  assert.equal(normalizeBankReviewRows(rows, account)[0].amount, 150);
});

test("rechaza texto mal cerrado, hoja en CSV y rangos que no existen", async () => {
  await assert.rejects(readBankStatementFile(csv('Fecha;Descripción;Monto\n02/01/2026;"Pago;100')), /comillas/);
  for (const selection of [{ sheet: "Hoja1" }, { headerRow: 99 }, { headerRow: 1, endRow: 99 }]) await assert.rejects(readBankStatementFile(csv("Fecha;Monto\n02/01/2026;100"), { selection }), (e) => e.status === 400);
});

test("HTML disfrazado de Excel no simula soporte de selección", async () => {
  const file = { originalname: "cartola.xlsx", buffer: Buffer.from("<table><tr><th>Fecha</th><th>Monto</th></tr><tr><td>02/01/2026</td><td>100</td></tr></table>") };
  assert.equal((await inspectBankStatementLayout(file)).supported, false);
  await assert.rejects(readBankStatementFile(file, { selection: { headerRow: 1 } }), /no admite/);
});

test("la vista original pagina hasta el último registro y no trunca una revisión financiera", async () => {
  const file = csv("Fecha;Descripción;Monto\n" + Array.from({ length: 1001 }, (_, i) => `02/01/2026;Pago ${i};100`).join("\n"));
  const last = await inspectBankStatementLayout(file, { page: 41 });
  assert.equal(last.total, 1002); assert.equal(last.rows.at(-1).number, 1002);
  const rows = await readBankStatementFile(file, { selection: { headerRow: 1 } });
  assert.equal(normalizeBankReviewRows(rows, account).length, 1001);
  await assert.rejects(inspectBankStatementLayout(file, { page: -1 }), (e) => e.status === 400);
});

test("seleccionar una tabla no permite saltarse el límite de cinco mil movimientos", async () => {
  const rows = await readBankStatementFile(csv("Fecha;Descripción;Monto\n" + Array.from({ length: 5001 }, () => "02/01/2026;Pago;100").join("\n")), { selection: { headerRow: 1 } });
  assert.throws(() => normalizeBankReviewRows(rows, account), /límite/);
});

test("exclusión de varias filas conserva selección, originales y motivos", () => {
  const config = { mapping: {}, selection: { headerRow: 3 }, excludedRows: [{ dataRow: 1, reason: "Total de control" }, { dataRow: 3, reason: "Total de control" }] };
  const rows = Array.from({ length: 4 }, () => ({ fecha: "02/01/2026", descripcion: "Pago", monto: 100 }));
  assert.deepEqual(validateBankReviewConfig(config, Object.keys(rows[0]), 4), config);
  const normalized = normalizeBankReviewRows(rows, account, config);
  assert.equal(normalized.filter((r) => r.excluded).length, 2); assert.deepEqual(normalized[0].source, rows[0]);
});

test("HTTP de origen respeta empresa, permisos, módulo e integridad y no cambia la carga", async (t) => {
  const file = await workbook();
  const job = { id: "job", tenantId: "a", revision: 3, status: "FAILED", sourceFile: file.originalname, original: { content: file.buffer, sha256: createHash("sha256").update(file.buffer).digest("hex") } };
  const read = prisma.financeBankImportJob.findFirst, modules = prisma.tenantModule.findMany;
  let enabled = true;
  prisma.financeBankImportJob.findFirst = async ({ where }) => where.tenantId === "a" && where.id === "job" ? job : null;
  prisma.tenantModule.findMany = async ({ where }) => where.module.in.map((module) => ({ module, enabled, source: "MANUAL" }));
  t.after(() => { prisma.financeBankImportJob.findFirst = read; prisma.tenantModule.findMany = modules; });
const app = express(); app.use((req, _res, next) => { req.tenantId = req.headers["x-tenant"] || "a"; req.tenant = { id: req.tenantId, industry: "FINANCE" }; req.user = { tenantId: req.tenantId, id: "admin", role: req.headers["x-role"] || "SUPER_ADMIN" }; next(); }); app.use(financeRouter);
  const server = createServer(app); await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve)); t.after(() => { server.closeAllConnections(); server.close(); });
  const get = (headers = {}) => fetch(`http://127.0.0.1:${server.address().port}/finance/bank-import-jobs/job/layout?sheet=Movimientos%20enero`, { headers, signal: AbortSignal.timeout(5000) });
  let res = await get(); assert.equal(res.status, 200); assert.equal((await res.json()).revision, 3); assert.equal(job.status, "FAILED");
  assert.equal((await get({ "x-role": "VIEWER" })).status, 403);
  assert.equal((await get({ "x-tenant": "b" })).status, 404);
  enabled = false; assert.equal((await get({ "x-role": "ADMIN" })).status, 403);
  job.original.sha256 = "alterado"; assert.equal((await get()).status, 409);
});
