import test from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { normalizeBankReviewRows, validateBankReviewConfig, bankReviewColumns, bankReviewPage, exportBankReviewCsv } from "../src/services/finance-bank-review.service.js";
import { readBankStatementFile } from "../src/services/finance-bank-statements.service.js";
const account = { bankKey: "santander_chile", accountLast4: "1234" };
const source = [{ Día: "02/01/2026", ConceptoBanco: "Transferencia cliente", ValorNeto: "125.000", Marca: "A", ComprobanteBanco: "F-12" }];
const config = { mapping: { date: "Día", description: "ConceptoBanco", amount: "ValorNeto", direction: "Marca", reference: "ComprobanteBanco" }, excludedRows: [] };
test("el mapeo reconoce columnas particulares y conserva valores originales", () => {
  const rows = normalizeBankReviewRows(source, account, config);
  assert.equal(rows[0].transactionDate, "2026-01-02"); assert.equal(rows[0].amount, 125000);
  assert.equal(rows[0].direction, "CREDIT"); assert.equal(rows[0].reference, "F-12");
  assert.equal(rows[0].needsReview, false); assert.deepEqual(rows[0].source, source[0]);
  assert.equal(rows[0].dataRow, 1);
});
test("un mapeo manual reemplaza los alias automáticos en vez de mezclarlos", () => {
  const row = { ...source[0], fecha: "01/01/2000", monto: "999", descripcion: "Incorrecta" };
  const [result] = normalizeBankReviewRows([row], account, config);
  assert.equal(result.amount, 125000); assert.equal(result.description, "Transferencia cliente");
  assert.equal(result.transactionDate, "2026-01-02"); assert.equal(result.source.monto, "999");
});
test("no usar un dato impide que vuelva a entrar por detección automática", () => {
  const [result] = normalizeBankReviewRows([{ fecha: "02/01/2026", descripcion: "Pago", monto: "100", referencia: "ignorar" }], account, { mapping: { reference: "__IGNORE__" }, excludedRows: [] });
  assert.equal(result.reference, ""); assert.equal(result.source.referencia, "ignorar");
});
test("columnas de cargo con cero no ocultan un abono válido", () => {
  const [result] = normalizeBankReviewRows([{ fecha: "02/01/2026", descripcion: "Pago", cargo: "0", abono: "100" }], account);
  assert.equal(result.amount, 100); assert.equal(result.direction, "CREDIT"); assert.equal(result.needsReview, false);
});
test("rechaza columnas inexistentes, reutilizadas y campos de mapeo desconocidos", () => {
  for (const mapping of [{ date: "Otra" }, { date: "Día", description: "Día" }, { secreto: "Día" }]) {
    assert.throws(() => validateBankReviewConfig({ mapping }, bankReviewColumns(source)), (e) => e.status === 400);
  }
});
test("excluir requiere fila existente y motivo; no modifica ni elimina el original", () => {
  const [result] = normalizeBankReviewRows(source, account, { ...config, excludedRows: [{ dataRow: 1, reason: "Registro de prueba" }] });
  assert.equal(result.excluded, true); assert.equal(result.exclusionReason, "Registro de prueba"); assert.deepEqual(result.source, source[0]);
  for (const excludedRows of [[{ dataRow: 2, reason: "No existe" }], [{ dataRow: 1, reason: "" }], [{ dataRow: 1, reason: "Prueba" }, { dataRow: 1, reason: "Prueba" }]]) {
    assert.throws(() => normalizeBankReviewRows(source, account, { ...config, excludedRows }), (e) => e.status === 400);
  }
});
test("página 3 permite consultar el último movimiento de una revisión de 61 filas", () => {
  const normalizedRows = Array.from({ length: 61 }, (_, i) => ({ dataRow: i + 1, description: `Pago ${i + 1}`, direction: "CREDIT" }));
  const page = bankReviewPage({ revision: 2, normalizedRows }, { revision: 2, page: 3 });
  assert.equal(page.total, 61); assert.equal(page.pages, 3); assert.equal(page.rows.length, 11); assert.equal(page.rows.at(-1).dataRow, 61);
  assert.throws(() => bankReviewPage({ revision: 2, normalizedRows }, { revision: 1 }), (e) => e.status === 409);
});
test("combina búsqueda y filtros sin ocultar el conteo total del archivo", () => {
  const normalizedRows = [
    { dataRow: 1, description: "Pago José", direction: "CREDIT", duplicate: true },
    { dataRow: 2, description: "Pago José", direction: "DEBIT", excluded: true },
    { dataRow: 3, description: "Otro", direction: "CREDIT", needsReview: true }
  ];
  const result = bankReviewPage({ revision: 1, normalizedRows }, { revision: 1, filter: "duplicate", search: "jose" });
  assert.equal(result.total, 1); assert.equal(result.totalSourceRows, 3); assert.equal(result.rows[0].dataRow, 1);
});
test("exporta todas las filas filtradas y neutraliza fórmulas en texto CSV", () => {
  const rows = Array.from({ length: 61 }, (_, i) => ({ dataRow: i + 1, description: i === 60 ? '=HYPERLINK("malicioso")' : "Pago", amount: 10, reviewReasons: [] }));
  const csv = exportBankReviewCsv({ revision: 1, normalizedRows: rows }, { revision: 1 });
  assert.equal(csv.split("\r\n").length, 62); assert.ok(csv.includes("'="));
});
test("Excel con carátula y filas vacías conserva hoja y número de fila reales", async () => {
  const workbook = new ExcelJS.Workbook(); const sheet = workbook.addWorksheet("Enero");
  sheet.getCell("A1").value = "Cartola Banco Santander";
  sheet.getRow(5).values = ["fecha", "descripcion", "monto"];
  sheet.getRow(8).values = ["02/01/2026", "Transferencia", 100];
  const rows = await readBankStatementFile({ originalname: "Enero.xlsx", buffer: Buffer.from(await workbook.xlsx.writeBuffer()) });
  const [result] = normalizeBankReviewRows(rows, account);
  assert.equal(result.origin.sheet, "Enero"); assert.equal(result.origin.row, 8); assert.equal(result.rowNumber, 8); assert.equal(result.dataRow, 1);
});
test("CSV conserva el índice de registro incluso con líneas vacías y carátula", async () => {
  const rows = await readBankStatementFile({ originalname: "Enero.csv", buffer: Buffer.from("Cartola Santander\n\nfecha;descripcion;monto\n\n02/01/2026;Pago;100\n") });
  const [result] = normalizeBankReviewRows(rows, account);
  assert.equal(result.origin.kind, "csv-record"); assert.equal(result.origin.row, 5);
});
test("encabezados repetidos reciben nombres distinguibles sin pisar sus valores", async () => {
  const rows = await readBankStatementFile({ originalname: "Enero.csv", buffer: Buffer.from("fecha;descripcion;monto;monto\n02/01/2026;Pago;100;200") });
  assert.ok(bankReviewColumns(rows).includes("monto [4]"));
  const [result] = normalizeBankReviewRows(rows, account, { mapping: { amount: "monto [4]" } });
  assert.equal(result.amount, 200);
});
