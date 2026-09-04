import test from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import {
  bankMovementFingerprint,
  detectBankStatementInstitution,
  detectBankStatementFileFormat,
  normalizeBankStatementRows,
  parsePdfBankStatementText,
  readBankStatementFile,
  summarizeBankStatementRows,
  withBankStatementNet
} from "../src/services/finance-bank-statements.service.js";

test("normaliza una cartola bancaria chilena con cargos, abonos y saldo", () => {
  const rows = normalizeBankStatementRows([
    { Fecha: "01/08/2026", Glosa: "Abono cliente Comercial Andes", Abono: "1.250.000", Referencia: "TRX-001", Saldo: "1.250.000" },
    { Fecha: "02/08/2026", Descripción: "Pago proveedor", Cargo: "450.000", Referencia: "TRX-002", Saldo: "800.000" }
  ], { bankKey: "bancoestado", accountAlias: "Recaudación", accountLast4: "1234" });

  assert.equal(rows.length, 2);
  assert.equal(rows[0].bank, "BancoEstado");
  assert.equal(rows[0].cmfCode, "012");
  assert.equal(rows[0].direction, "CREDIT");
  assert.equal(rows[0].movementType, "ABONO");
  assert.equal(rows[0].directionSource, "Columna Abono");
  assert.equal(rows[0].amount, 1250000);
  assert.equal(rows[1].direction, "DEBIT");
  assert.equal(rows[1].movementType, "CARGO");
  assert.equal(rows[1].directionSource, "Columna Cargo");
  assert.equal(rows[1].signedAmount, -450000);
  assert.equal(rows[1].balance, 800000);
  assert.equal(rows[0].needsReview, false);

  const summary = withBankStatementNet(summarizeBankStatementRows(rows));
  assert.deepEqual(summary, { totalRows: 2, reviewRows: 0, credits: 1250000, debits: 450000, net: 800000 });
});

test("marca filas incompletas para revisión sin impedir que se revise el resto de la cartola", () => {
  const [row] = normalizeBankStatementRows([{ Fecha: "", Glosa: "Movimiento sin monto" }], { bankKey: "santander_chile" });
  assert.equal(row.needsReview, true);
  assert.deepEqual(row.reviewReasons, ["fecha del movimiento", "monto"]);
});

test("lee una cartola Excel y mantiene una huella estable para evitar duplicados", async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Cartola");
  sheet.addRow(["Fecha movimiento", "Detalle", "Monto", "Comprobante"]);
  sheet.addRow(["05/08/2026", "Transferencia recibida", "350.000", "ABC-100"]);
  const sourceRows = await readBankStatementFile({ originalname: "cartola.xlsx", buffer: Buffer.from(await workbook.xlsx.writeBuffer()) });
  const [row] = normalizeBankStatementRows(sourceRows, { bankKey: "bci", accountAlias: "Operación", accountLast4: "9876" });
  assert.equal(row.transactionDate, "2026-08-05");
  assert.equal(row.amount, 350000);
  assert.equal(row.fingerprint, bankMovementFingerprint(row));
});

test("reconoce la plantilla Santander con carátula previa y marca Cargo/Abono", async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Cartola Santander");
  sheet.addRow(["Cartolas históricas de Cuentas Corrientes"]);
  sheet.addRow(["Empresa:", "Transportes Ejemplo Ltda."]);
  sheet.addRow(["RUT empresa:", "77.111.222-3"]);
  sheet.addRow(["Número cartola:", "42"]);
  sheet.addRow([]);
  sheet.addRow(["Detalle movimientos"]);
  sheet.addRow(["MONTO", "DESCRIPCIÓN MOVIMIENTO", "FECHA", "N° DOCUMENTO", "SUCURSAL", "CARGO/ABONO"]);
  sheet.addRow(["1.250.000", "PAGO CLIENTE FACTURA 105", "02/01/2026", "105", "Principal", "A"]);
  sheet.addRow(["450.000", "PAGO PROVEEDOR", "03/01/2026", "200", "Principal", "C"]);

  const sourceRows = await readBankStatementFile({ originalname: "santander.xlsx", buffer: Buffer.from(await workbook.xlsx.writeBuffer()) });
  const rows = normalizeBankStatementRows(sourceRows, { bankKey: "santander_chile", accountAlias: "Cuenta principal", accountLast4: "8304" });

  assert.equal(sourceRows.length, 2);
  assert.equal(rows[0].description, "PAGO CLIENTE FACTURA 105");
  assert.equal(rows[0].reference, "105");
  assert.equal(rows[0].direction, "CREDIT");
  assert.equal(rows[0].movementType, "ABONO");
  assert.equal(rows[0].directionSource, "Marca Cargo/Abono");
  assert.equal(rows[0].movementKind, "INCOME");
  assert.equal(rows[1].direction, "DEBIT");
  assert.equal(rows[1].signedAmount, -450000);
  assert.equal(rows[1].branch, "Principal");
});

test("identifica automáticamente Banco Santander desde la carátula de un Excel", async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Cartola");
  sheet.addRow(["Banco Santander Chile"]);
  sheet.addRow(["Cuenta corriente", "000-1234567-8"]);
  sheet.addRow([]);
  sheet.addRow(["Fecha", "Descripción", "Monto", "Cargo/Abono"]);
  sheet.addRow(["03/09/2026", "Abono cliente", "450.000", "A"]);
  const file = { originalname: "Cartola septiembre.xlsx", buffer: Buffer.from(await workbook.xlsx.writeBuffer()) };
  const sourceRows = await readBankStatementFile(file);
  const detection = await detectBankStatementInstitution(file, sourceRows);

  assert.equal(detection.institution?.key, "santander_chile");
  assert.equal(detection.method, "CARTOLA");
});

test("deja una cartola sin marca bancaria en revisión sin inventar su banco", () => {
  const [row] = normalizeBankStatementRows([{ Fecha: "03/09/2026", Descripción: "Abono cliente", Monto: "450.000", "Cargo/Abono": "A" }]);
  assert.equal(row.bank, "Banco por identificar");
  assert.equal(row.needsReview, true);
  assert.ok(row.reviewReasons.includes("banco de origen"));
});

test("reconoce descripción y cargo/abono aunque el encabezado Santander venga con codificación dañada", () => {
  const [row] = normalizeBankStatementRows([
    { Fecha: "01/01/2026", "DESCRIPCI_N MOVIMIENTO": "PAGO PROVEEDOR LOGÍSTICA", Monto: "405.683", "CARGO/ABONO": "C" },
    { Fecha: "02/01/2026", "DESCRIPCI_N MOVIMIENTO": "TRANSFERENCIA CLIENTE FACTURA 105", Monto: "1.250.000", "CARGO/ABONO": "A" }
  ], { bankKey: "santander_chile", accountAlias: "Cuenta principal" });

  assert.equal(row.description, "PAGO PROVEEDOR LOGÍSTICA");
  assert.equal(row.direction, "DEBIT");
  assert.equal(row.movementType, "CARGO");
  assert.equal(row.needsReview, false);
});

test("conserva encabezados Santander codificados en Windows-1252", async () => {
  const csv = "MONTO;DESCRIPCIÓN MOVIMIENTO;FECHA;N° DOCUMENTO;CARGO/ABONO\n515.000;PAGO CLIENTE FACTURA 300;06/01/2026;300;A";
  const sourceRows = await readBankStatementFile({ originalname: "cartola-santander.csv", buffer: Buffer.from(csv, "latin1") });
  const [row] = normalizeBankStatementRows(sourceRows, { bankKey: "santander_chile" });

  assert.equal(row.description, "PAGO CLIENTE FACTURA 300");
  assert.equal(row.reference, "300");
  assert.equal(row.direction, "CREDIT");
  assert.equal(row.needsReview, false);
});

test("recupera una cartola XLSX con metadatos de libro incompletos", async () => {
  const zip = new JSZip();
  zip.file("xl/worksheets/sheet1.xml", `<?xml version="1.0" encoding="UTF-8"?>
    <worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>
      <row r="1"><c r="A1" t="inlineStr"><is><t>Fecha</t></is></c><c r="B1" t="inlineStr"><is><t>Descripción</t></is></c><c r="C1" t="inlineStr"><is><t>Abono</t></is></c></row>
      <row r="2"><c r="A2" t="inlineStr"><is><t>01/09/2026</t></is></c><c r="B2" t="inlineStr"><is><t>Pago cliente</t></is></c><c r="C2"><v>125000</v></c></row>
    </sheetData></worksheet>`);
  const sourceRows = await readBankStatementFile({ originalname: "cartola-exportada.xlsx", buffer: await zip.generateAsync({ type: "nodebuffer" }) });
  const [row] = normalizeBankStatementRows(sourceRows, { bankKey: "santander_chile" });

  assert.equal(sourceRows.length, 1);
  assert.equal(row.transactionDate, "2026-09-01");
  assert.equal(row.description, "Pago cliente");
  assert.equal(row.amount, 125000);
  assert.equal(row.direction, "CREDIT");
});

test("recupera una exportación XML bancaria con extensión Excel", async () => {
  const legacyXml = `<?xml version="1.0" encoding="utf-8"?>
    <Workbook xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Worksheet><Table>
      <Row><Cell><Data>Fecha</Data></Cell><Cell><Data>Glosa</Data></Cell><Cell><Data>Cargo/Abono</Data></Cell><Cell><Data>Monto</Data></Cell></Row>
      <Row><Cell><Data>04/09/2026</Data></Cell><Cell><Data>Transferencia recibida</Data></Cell><Cell><Data>A</Data></Cell><Cell><Data>425.000</Data></Cell></Row>
    </Table></Worksheet></Workbook>`;
  const sourceRows = await readBankStatementFile({ originalname: "cartola-banco.xlsx", buffer: Buffer.from(legacyXml, "utf8") });
  const [row] = normalizeBankStatementRows(sourceRows, { bankKey: "bancoestado" });

  assert.equal(sourceRows.length, 1);
  assert.equal(row.transactionDate, "2026-09-04");
  assert.equal(row.direction, "CREDIT");
  assert.equal(row.amount, 425000);
});

test("detecta el contenido real aunque la extensión de la cartola sea engañosa", () => {
  const xml = detectBankStatementFileFormat({ originalname: "cartola-abril.xlsx", buffer: Buffer.from("<?xml version=\"1.0\"?><Workbook><Table /></Workbook>") });
  const text = detectBankStatementFileFormat({ originalname: "cartola.txt", buffer: Buffer.from("Fecha;Glosa;Monto\n01/09/2026;Pago cliente;250.000") });
  const pdf = detectBankStatementFileFormat({ originalname: "cartola.pdf", buffer: Buffer.from("%PDF-1.7\n") });

  assert.equal(xml.key, "LEGACY_SPREADSHEET");
  assert.equal(text.key, "DELIMITED_TEXT");
  assert.equal(pdf.key, "PDF");
});

test("lee texto delimitado aunque el banco lo haya nombrado como Excel", async () => {
  const sourceRows = await readBankStatementFile({
    originalname: "cartola-renombrada.xlsx",
    buffer: Buffer.from("Fecha;Glosa;Monto;Cargo/Abono\n05/09/2026;Pago cliente;620.000;A", "utf8")
  });
  const [row] = normalizeBankStatementRows(sourceRows, { bankKey: "bancoestado" });

  assert.equal(sourceRows.length, 1);
  assert.equal(row.transactionDate, "2026-09-05");
  assert.equal(row.direction, "CREDIT");
  assert.equal(row.amount, 620000);
});

test("convierte texto de una cartola PDF en movimientos revisables", () => {
  const rows = parsePdfBankStatementText(`Cartola cuenta corriente\n02/09/2026 Transferencia cliente factura 145 ABONO $ 1.250.000\n03/09/2026 Pago proveedor logística CARGO $ 450.000`);
  const normalized = normalizeBankStatementRows(rows, { bankKey: "bancoestado", accountAlias: "Recaudación" });

  assert.equal(rows.length, 2);
  assert.equal(normalized[0].transactionDate, "2026-09-02");
  assert.equal(normalized[0].direction, "CREDIT");
  assert.equal(normalized[0].amount, 1250000);
  assert.equal(normalized[1].direction, "DEBIT");
  assert.equal(normalized[1].amount, 450000);
});
