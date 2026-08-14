import test from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { normalizeHistoricalFinanceRows, readHistoricalFinanceFile, summarizeHistoricalFinanceRows } from "../src/services/finance-migration.service.js";

test("la migración histórica clasifica cuentas por cobrar, pagar y filas que requieren revisión", () => {
  const rows = normalizeHistoricalFinanceRows([
    { Folio: "F-100", Cliente: "Comercial Andina", Monto: "1.250.000", Saldo: "0", Estado: "Pagada" },
    { Folio: "P-200", Proveedor: "Servicios Norte", Monto: "850.000", Saldo: "850.000", Vencimiento: "01/01/2026" },
    { Cliente: "Sin folio", Monto: "100.000" }
  ], { now: new Date("2026-02-01T12:00:00.000Z") });

  assert.equal(rows[0].recordType, "finance_invoice");
  assert.equal(rows[0].amount, 1250000);
  assert.equal(rows[0].status, "PAID");
  assert.equal(rows[1].recordType, "finance_payable");
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
