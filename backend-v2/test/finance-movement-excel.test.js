import test from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { movementLedgerExcel } from "../src/services/finance-movement-excel.service.js";
const row = { id: "m1", date: "2025-01-01", description: '=HYPERLINK("bad")', amount: 1234, currency: "CLP", direction: "CREDIT", status: "PENDING", reference: "+cmd", rut: "00123-4", last4: "0012" };
const result = (records) => ({ records, total: records.length, summary: { credits: records.length * 1234, debits: 0, unclassified: 0 } });
test("Excel contiene más de mil movimientos y sus totales", async () => {
  const records = Array.from({ length: 1248 }, (_, i) => ({ ...row, id: String(i) }));
  const book = new ExcelJS.Workbook(); await book.xlsx.load(await movementLedgerExcel(result(records), { period: "2025-01", status: "PENDING" }));
  assert.equal(book.getWorksheet("Movimientos").rowCount, 1249);
  assert.equal(book.getWorksheet("Contexto y totales").getCell("B3").value, 1248);
});
test("texto no se transforma en fórmulas y monto conserva tipo numérico", async () => {
  const book = new ExcelJS.Workbook(); await book.xlsx.load(await movementLedgerExcel(result([row]), { search: '=SUM(1,2)' }));
  const sheet = book.getWorksheet("Movimientos");
  assert.equal(sheet.getCell("B2").value, row.description); assert.equal(sheet.getCell("B2").type, ExcelJS.ValueType.String);
  assert.equal(sheet.getCell("C2").value, 1234); assert.equal(sheet.getCell("C2").type, ExcelJS.ValueType.Number);
  assert.equal(sheet.getCell("L2").value, "0012"); assert.equal(sheet.getCell("E2").value, "Abono");
  for (const worksheet of book.worksheets) worksheet.eachRow((r) => r.eachCell((c) => assert.notEqual(c.type, ExcelJS.ValueType.Formula)));
});
test("rechaza página parcial y tamaño excesivo sin generar archivo incompleto", async () => {
  await assert.rejects(movementLedgerExcel({ ...result([row]), total: 50 }), /todos los resultados/);
  const records = Array(100001).fill(row); await assert.rejects(movementLedgerExcel(result(records)), /100.000/);
});
test("sin resultados conserva encabezados y contexto", async () => {
  const book = new ExcelJS.Workbook(); await book.xlsx.load(await movementLedgerExcel(result([]), { currency: "CLP" }));
  assert.equal(book.getWorksheet("Movimientos").rowCount, 1); assert.equal(book.worksheets.length, 2);
});

test("exportación sin fecha no atribuye el total al mes seleccionado", async () => {
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(await movementLedgerExcel({ ...result([{ ...row, date: "" }]), dateScope: "UNDATED", scopeNotice: "Sin fecha válida; no pertenecen al mes activo." }, { period: "2025-01" }));
  const values = [];
  book.getWorksheet("Contexto y totales").eachRow((r) => values.push(r.values));
  assert.ok(JSON.stringify(values).includes("Período activo (no aplicado)"));
  assert.ok(JSON.stringify(values).includes("no pertenecen al mes activo"));
  assert.equal(book.getWorksheet("Movimientos").getCell("A2").value, "");
});

test("Excel conserva revisión y puntaje sin convertirlo en probabilidad", async () => {
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(await movementLedgerExcel(result([{ ...row, importRevision: "0", confidenceLabel: "95 / 100" }]), { importRevision: "0", confidence: "HIGH" }));
  assert.equal(book.getWorksheet("Movimientos").getCell("Q2").value, "0");
  assert.equal(book.getWorksheet("Movimientos").getCell("R2").value, "95 / 100");
  const values = []; book.getWorksheet("Contexto y totales").eachRow((r) => values.push(r.values));
  assert.match(JSON.stringify(values), /No es probabilidad/);
  assert.match(JSON.stringify(values), /Alto: 95 a 100/);
});
