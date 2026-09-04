import test from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { assessHistoricalFinanceQuality, historicalFinanceFingerprint, normalizeHistoricalFinanceRows, readHistoricalFinanceFile, summarizeHistoricalFinanceRows } from "../src/services/finance-migration.service.js";

test("la migración histórica clasifica cuentas por cobrar, pagar y filas que requieren revisión", () => {
  const rows = normalizeHistoricalFinanceRows([
    { Folio: "F-100", Cliente: "Comercial Andina", Monto: "1.250.000", Saldo: "0", Estado: "Pagada", "Fecha emisión": "02/01/2026" },
    { Folio: "P-200", Proveedor: "Servicios Norte", Monto: "850.000", Saldo: "850.000", Vencimiento: "01/01/2026", "Fecha emisión": "02/12/2025" },
    { Cliente: "Sin folio", Monto: "100.000" }
  ], { now: new Date("2026-02-01T12:00:00.000Z") });

  assert.equal(rows[0].recordType, "finance_invoice");
  assert.equal(rows[0].documentSide, "CUSTOMER");
  assert.equal(rows[0].amount, 1250000);
  assert.equal(rows[0].status, "PAID");
  assert.equal(rows[1].recordType, "finance_payable");
  assert.equal(rows[1].documentSide, "SUPPLIER");
  assert.equal(rows[1].status, "OVERDUE");
  assert.equal(rows[2].needsReview, true);

  const summary = summarizeHistoricalFinanceRows(rows);
  assert.equal(summary.byKind.RECEIVABLE, 2);
  assert.equal(summary.byKind.PAYABLE, 1);
  assert.equal(summary.reviewRows, 1);
  assert.equal(summary.openPayables, 850000);
});

test("lee un Excel histórico antes de normalizarlo", async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Historial");
  sheet.addRow(["Folio", "Proveedor", "Monto", "Saldo", "Vencimiento"]);
  sheet.addRow(["P-300", "Servicios Sur", 450000, 450000, "15/08/2026"]);
  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
  const rows = await readHistoricalFinanceFile({ originalname: "cartera.xlsx", buffer });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].Proveedor, "Servicios Sur");
  assert.equal(normalizeHistoricalFinanceRows(rows)[0].recordType, "finance_payable");
});

test("mantiene una huella estable para impedir duplicar documentos históricos", () => {
  const first = historicalFinanceFingerprint({ kind: "RECEIVABLE", documentNumber: "F-100", rut: "76.111.222-3", amount: 1250000, issueDate: "2026-01-02", partyName: "Comercial Andina" });
  const second = historicalFinanceFingerprint({ kind: "receivable", documentNumber: " f-100 ", rut: "76.111.222-3", amount: "1250000", issueDate: "2026-01-02", partyName: "COMERCIAL ANDINA" });
  assert.equal(first, second);
});

test("conserva impuestos, pago y referencias al normalizar una migración histórica", () => {
  const [row] = normalizeHistoricalFinanceRows([{
    Folio: "F-501", Cliente: "Inversiones Río Claro SpA", RUT: "76.123.456-0", "Fecha emisión": "01/08/2026",
    "Monto neto": "100.000", IVA: "19.000", Total: "119.000", Pagado: "20.000", Moneda: "CLP",
    "Medio de pago": "Transferencia", Intermediario: "Webpay", Comisión: "1.200", "Referencia liquidación": "LQ-99",
    "Tipo documento referencia": "Nota de crédito", "Folio referencia": "NC-12", "Fecha documento referencia": "02/08/2026"
  }]);
  assert.equal(row.needsReview, false);
  assert.equal(row.netAmount, 100000);
  assert.equal(row.vatAmount, 19000);
  assert.equal(row.balance, 99000);
  assert.equal(row.paymentMethod, "Transferencia");
  assert.equal(row.paymentIntermediary, "Webpay");
  assert.equal(row.referenceDocumentNumber, "NC-12");
});

test("detecta calidad, inconsistencias y duplicados antes de importar un historial", () => {
  const rows = normalizeHistoricalFinanceRows([
    { Folio: "F-601", Cliente: "Comercial Viento Sur", RUT: "76.123.456-0", "Fecha emisión": "01/08/2026", Vencimiento: "15/08/2026", Monto: "119.000", Saldo: "119.000", Estado: "Pendiente" },
    { Folio: "F-601", Cliente: "Comercial Viento Sur", RUT: "76.123.456-0", "Fecha emisión": "01/08/2026", Vencimiento: "15/08/2026", Monto: "119.000", Saldo: "119.000", Estado: "Pendiente" },
    { Folio: "F-602", Cliente: "Cliente con datos dudosos", RUT: "76.123.456-7", "Fecha emisión": "20/08/2026", Vencimiento: "01/08/2026", Monto: "100.000", Saldo: "50.000", Pagado: "10.000", Estado: "Pagada" }
  ]);

  assert.equal(rows[0].needsReview, false);
  assert.equal(rows[0].quality.status, "READY");
  assert.equal(rows[1].duplicateInSource, true);
  assert.deepEqual(rows[1].duplicateOfRows, [2]);
  assert.equal(rows[2].needsReview, true);
  assert.match(rows[2].reviewReasons.join(" | "), /RUT|vencimiento|saldo|pagado/i);

  const summary = summarizeHistoricalFinanceRows(rows);
  assert.equal(summary.duplicateRows, 1);
  assert.equal(summary.readyRows, 1);
  assert.ok(summary.averageQualityScore < 100);
  assert.equal(assessHistoricalFinanceQuality(rows)[1].duplicateInSource, true);
});
