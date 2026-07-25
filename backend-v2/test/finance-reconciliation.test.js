import test from "node:test";
import assert from "node:assert/strict";
import { getInvoiceFinancialState, scoreFinanceReconciliation } from "../src/services/finance.service.js";

const NOW = new Date("2026-07-25T12:00:00.000Z");

test("Finance OS prioriza una coincidencia con monto, referencia, RUT y fecha", () => {
  const invoice = {
    id: "invoice-1",
    title: "Factura FAC-1520 ABC Ltda.",
    status: "OPEN",
    data: { invoiceNumber: "FAC-1520", customerName: "ABC Ltda.", rut: "76.123.456-7", amount: 895000, balance: 895000, dueDate: "2026-07-22" }
  };
  const movement = {
    id: "movement-1",
    title: "Abono ABC",
    status: "PENDING",
    data: { amount: 895000, date: "2026-07-24", reference: "Pago FAC-1520", rut: "76.123.456-7", payerName: "ABC Ltda." }
  };

  const result = scoreFinanceReconciliation(invoice, movement, NOW);
  assert.equal(result.confidence, 99);
  assert.equal(result.partial, false);
  assert.ok(result.reasons.includes("Monto exacto"));
  assert.ok(result.reasons.includes("Referencia de factura"));
});

test("Finance OS identifica pagos parciales y facturas vencidas", () => {
  const invoice = {
    id: "invoice-2",
    title: "Factura FAC-1521",
    status: "OPEN",
    data: { invoiceNumber: "FAC-1521", amount: 450000, balance: 450000, dueDate: "2026-06-20" }
  };
  const movement = { id: "movement-2", title: "Pago FAC-1521", data: { amount: 120000, reference: "FAC-1521" } };
  const state = getInvoiceFinancialState(invoice, NOW);
  const result = scoreFinanceReconciliation(invoice, movement, NOW);

  assert.equal(state.status, "OVERDUE");
  assert.equal(result.partial, true);
  assert.ok(result.reasons.includes("Posible pago parcial"));
});
