import test from "node:test";
import assert from "node:assert/strict";
import { financeAgingSegment, getInvoiceFinancialState, scoreFinanceReconciliation } from "../src/services/finance.service.js";

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

test("usa los campos reales de cliente importados desde DTE y reconoce un abono mayor como diferencia", () => {
  const invoice = {
    id: "invoice-3", title: "Factura 1050", status: "OPEN",
    data: { invoiceNumber: "1050", clientName: "Comercial Los Andes SpA", clientRut: "77.111.222-3", amount: 100000, balance: 100000 }
  };
  const movement = { id: "movement-3", title: "Abono Comercial Los Andes", data: { amount: 120000, reference: "Pago 1050", rut: "77.111.222-3", payerName: "Comercial Los Andes SpA" } };
  const result = scoreFinanceReconciliation(invoice, movement, NOW);
  assert.equal(result.overpayment, true);
  assert.ok(result.reasons.includes("RUT coincidente"));
  assert.ok(result.reasons.includes("Cliente o razon social coincidente"));
});

test("segmenta la cobranza por antigüedad sin mezclar monitoreo y mora", () => {
  assert.equal(financeAgingSegment(new Date("2026-07-30T00:00:00.000Z"), NOW).code, "POR_VENCER");
  assert.equal(financeAgingSegment(new Date("2026-07-21T00:00:00.000Z"), NOW).code, "1_7");
  assert.equal(financeAgingSegment(new Date("2026-06-10T00:00:00.000Z"), NOW).code, "31_60");
  assert.equal(financeAgingSegment(new Date("2026-03-01T00:00:00.000Z"), NOW).code, "MAS_90");
});
