import test from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import {
  bankMovementFingerprint,
  normalizeBankStatementRows,
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
  assert.equal(rows[0].amount, 1250000);
  assert.equal(rows[1].direction, "DEBIT");
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
