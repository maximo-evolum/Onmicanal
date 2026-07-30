import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { normalizeFinanceAgentPolicy } from "../src/services/finance-agents.service.js";
import { getInvoiceFinancialState, scoreFinanceReconciliation } from "../src/services/finance.service.js";
import { isModuleAllowedForIndustry } from "../src/lib/industry-module-access.js";

const NOW = new Date("2026-07-25T12:00:00.000Z");

function parseCsv(content) {
  const [header, ...lines] = content.trim().split(/\r?\n/);
  const fields = header.split(";");
  return lines.map((line) => Object.fromEntries(fields.map((field, index) => [field, line.split(";")[index] || ""])));
}

function invoice(number, customerName, rut, amount, dueDate) {
  return { id: `invoice-${number}`, title: `Factura ${number} ${customerName}`, status: "OPEN", data: { invoiceNumber: number, customerName, rut, amount, balance: amount, dueDate } };
}

function movement(row) {
  return { id: `movement-${row.referencia}`, title: row.descripcion, status: "PENDING", data: { transactionDate: row.fecha, date: row.fecha, amount: Number(row.monto), reference: row.referencia, rut: row.rut, payerName: row.pagador } };
}

test("simulación contador: una cartola produce conciliaciones, pago parcial y revisión humana", async () => {
  const fixture = fileURLToPath(new URL("./fixtures/finance-cartola-simulation.csv", import.meta.url));
  const rows = parseCsv(await readFile(fixture, "utf8"));
  assert.equal(rows.length, 6, "la cartola de prueba debe contener seis movimientos");

  const invoices = [
    invoice("FAC-1520", "ABC Ltda", "761234567", 895000, "2026-07-05"),
    invoice("FAC-1521", "DEF SpA", "765555555", 450000, "2026-07-07"),
    invoice("FAC-1522", "GHI SpA", "769999999", 120000, "2026-07-09"),
    invoice("FAC-1523", "JKL Servicios", "768888888", 600000, "2026-07-12"),
    invoice("FAC-1524", "MNO Comercial", "767777777", 180000, "2026-07-15")
  ];
  const movements = rows.map(movement);
  const byReference = new Map(movements.map((item) => [item.data.reference, item]));

  const fullMatch = scoreFinanceReconciliation(invoices[0], byReference.get("FAC-1520"), NOW);
  assert.equal(fullMatch.confidence, 99);
  assert.equal(fullMatch.partial, false);
  assert.deepEqual(getInvoiceFinancialState(invoices[0], NOW).status, "OVERDUE");

  const partialMatch = scoreFinanceReconciliation(invoices[3], byReference.get("FAC-1523"), NOW);
  assert.equal(partialMatch.partial, true);
  assert.ok(partialMatch.confidence >= 35, "el pago parcial debe quedar disponible para revisión");
  const remainingBalance = invoices[3].data.balance - Number(byReference.get("FAC-1523").data.amount);
  assert.equal(remainingBalance, 300000, "una aprobación parcial conservaría el saldo pendiente correcto");

  const unmatched = scoreFinanceReconciliation(invoices[3], byReference.get("DEP-20260710-01"), NOW);
  assert.ok(unmatched.confidence < 35, "un depósito sin referencia no debe proponerse como conciliación automática");

  const policy = normalizeFinanceAgentPolicy();
  assert.equal(policy.autoCreateExceptions, false);
  assert.equal(policy.collectionsRequireApproval, true);
  assert.equal(policy.updateErpRequiresApproval, true);
  assert.equal(isModuleAllowedForIndustry("finance_collections", "FINANCE"), true);
  assert.equal(isModuleAllowedForIndustry("finance_collections", "REAL_ESTATE"), false);
});
