import test from "node:test";
import assert from "node:assert/strict";
import { normalizeFinanceDocumentData, validateFinanceDocumentData } from "../src/services/finance-document.service.js";

test("normaliza una factura de cliente con impuestos, pago y referencia", () => {
  const document = normalizeFinanceDocumentData({
    folio: "F-1188", clientName: "Comercial Los Alerces SpA", clientRut: "76.321.654-8",
    issueDate: "2026-09-01", dueDate: "2026-09-30", netAmount: "100.000", iva: "19.000",
    totalAmount: "119.000", currency: "clp", paymentMethod: "Transferencia", paymentIntermediary: "Banco de Chile",
    commissionAmount: "0", settlementReference: "LIQ-901", referenceDocumentType: "NC", referenceDocumentNumber: "NC-24"
  }, "finance_invoice");

  assert.equal(document.documentSide, "CUSTOMER");
  assert.equal(document.partyName, "Comercial Los Alerces SpA");
  assert.equal(document.documentNumber, "F-1188");
  assert.equal(document.netAmount, 100000);
  assert.equal(document.vatAmount, 19000);
  assert.equal(document.totalAmount, 119000);
  assert.equal(document.balance, 119000);
  assert.equal(document.paymentIntermediary, "Banco de Chile");
  assert.equal(document.referenceDocumentNumber, "NC-24");
  assert.equal(validateFinanceDocumentData(document).ok, true);
});

test("normaliza una cuenta por pagar y calcula el saldo desde el monto pagado", () => {
  const document = normalizeFinanceDocumentData({
    documentNumber: "P-402", supplierName: "Servicios Cordillera Ltda.", supplierRut: "77.111.222-3",
    netAmount: 200000, vatAmount: 38000, amount: 238000, paidAmount: 100000, currency: "usd"
  }, "finance_payable", { today: "2026-09-03" });

  assert.equal(document.documentSide, "SUPPLIER");
  assert.equal(document.direction, "PURCHASE");
  assert.equal(document.supplierName, "Servicios Cordillera Ltda.");
  assert.equal(document.issueDate, "2026-09-03");
  assert.equal(document.currency, "USD");
  assert.equal(document.balance, 138000);
  assert.equal(validateFinanceDocumentData(document).ok, true);
});

test("rechaza inconsistencias tributarias y pagos superiores al documento", () => {
  const invalid = normalizeFinanceDocumentData({
    documentNumber: "F-9", clientName: "Cliente de prueba", amount: 100000, netAmount: 90000, vatAmount: 19000, paidAmount: 130000
  }, "finance_invoice");
  const validation = validateFinanceDocumentData(invalid);

  assert.equal(validation.ok, false);
  assert.match(validation.errors.join(" | "), /neto \+ IVA/i);
  assert.match(validation.errors.join(" | "), /monto pagado/i);
});
