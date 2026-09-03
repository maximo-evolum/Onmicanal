import test from "node:test";
import assert from "node:assert/strict";
import { buildFinanceMonthlyClosePreview, validFinancePeriod } from "../src/services/finance-monthly-close.service.js";

const base = { tenantId: "tenant-demo", createdAt: "2026-09-05T12:00:00.000Z" };

test("consolida un período conciliado y lo deja listo para cierre", () => {
  const preview = buildFinanceMonthlyClosePreview([
    { ...base, id: "invoice", recordType: "finance_invoice", status: "PAID", data: { issueDate: "2026-09-02", invoiceNumber: "F-100", clientName: "Comercial Andes", amount: 1500000, balance: 0 } },
    { ...base, id: "payable", recordType: "finance_payable", status: "PAID", data: { issueDate: "2026-09-03", documentNumber: "P-44", supplierName: "Proveedor Norte", category: "Servicios", amount: 300000, balance: 0 } },
    { ...base, id: "movement", recordType: "bank_movement", status: "MATCHED", data: { transactionDate: "2026-09-04", description: "Transferencia Comercial Andes", direction: "CREDIT", amount: 1500000, reference: "F-100" } },
    { ...base, id: "reconciliation", recordType: "finance_reconciliation", status: "APPROVED", data: { createdAt: "2026-09-04" } }
  ], "2026-09");

  assert.equal(preview.status, "READY_TO_CLOSE");
  assert.equal(preview.metrics.issued, 1500000);
  assert.equal(preview.metrics.paidPayables, 300000);
  assert.equal(preview.metrics.netBankFlow, 1500000);
  assert.equal(preview.blockers.length, 0);
  assert.equal(preview.rows.length, 3);
});

test("bloquea el cierre si quedan movimientos sin conciliar o excepciones abiertas", () => {
  const preview = buildFinanceMonthlyClosePreview([
    { ...base, id: "movement", recordType: "bank_movement", status: "PENDING", data: { transactionDate: "2026-09-04", direction: "CREDIT", amount: 250000, description: "Abono por identificar" } },
    { ...base, id: "exception", recordType: "finance_exception", status: "OPEN", data: { createdAt: "2026-09-04", detail: "Diferencia de monto" } }
  ], "2026-09");

  assert.equal(preview.status, "REQUIRES_REVIEW");
  assert.equal(preview.metrics.unreconciledMovements, 1);
  assert.equal(preview.metrics.openExceptions, 1);
  assert.equal(preview.blockers.length, 2);
  assert.equal(validFinancePeriod("2026-13"), false);
});
