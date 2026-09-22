import { financeDocumentSide, financeDocumentDate, financeDocumentState } from "./finance-document-values.service.js";

export const creditData = (r) => r?.data || {};
export const creditRut = (v) => String(v || "").replace(/[.\s-]/g, "").toUpperCase();
export const creditDay = (v) => { const s = String(v || "").slice(0, 10); return /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s ? s : ""; };
export const invoiceCreditRut = (r) => creditRut(creditData(r).clientRut || creditData(r).customerRut || creditData(r).rut || creditData(r).partyRut);
export const positiveCreditAmount = (v) => Number.isSafeInteger(v) && v > 0;
export function validCreditRut(value) {
  const rut = creditRut(value); if (!/^\d{7,8}[\dK]$/.test(rut)) return false;
  let sum = 0, factor = 2;
  for (const digit of rut.slice(0, -1).split("").reverse()) { sum += Number(digit) * factor; factor = factor === 7 ? 2 : factor + 1; }
  const check = 11 - sum % 11;
  return rut.at(-1) === (check === 11 ? "0" : check === 10 ? "K" : String(check));
}

// No side effects: the same evidence is used by balances, writes and closing.
export function auditCustomerCredit(credit, records) {
  const d = creditData(credit), errors = [], index = new Map(records.map((r) => [r.id, r]));
  const movement = index.get(d.movementId), reconciliation = index.get(d.reconciliationId);
  const m = creditData(movement), rec = creditData(reconciliation);
  const sameTenant = (r) => r?.tenantId === credit?.tenantId;
  if (credit?.recordType !== "finance_customer_credit" || !["AVAILABLE", "USED"].includes(credit.status)) errors.push("Saldo a favor no vigente.");
  if (!validCreditRut(d.customerRut) || !String(d.customerName || "").trim() || d.currency !== "CLP" || !positiveCreditAmount(d.amount) || !creditDay(d.transactionDate)) errors.push("Identidad, fecha, moneda o monto del saldo incompletos.");
  if (movement?.recordType !== "bank_movement" || !sameTenant(movement) || movement.status !== "MATCHED" || m.reconciliationId !== reconciliation?.id || Number(m.amount) !== d.amount || String(m.currency || "CLP").toUpperCase() !== "CLP" || !["CREDIT", "ABONO"].includes(String(m.direction || m.movementType || "").toUpperCase()) || creditDay(m.transactionDate || m.date) !== d.transactionDate) errors.push("El abono original no respalda este saldo a favor.");
  if (reconciliation?.recordType !== "finance_reconciliation" || !sameTenant(reconciliation) || reconciliation.status !== "APPROVED" || rec.reversedAt || rec.reconciliationType !== "CUSTOMER_CREDIT" || rec.customerCreditId !== credit?.id || rec.movementId !== movement?.id || rec.amount !== d.amount) errors.push("Falta una conciliación vigente del anticipo/saldo a favor.");
  if (records.filter((r) => r.recordType === "finance_reconciliation" && r.status === "APPROVED" && creditData(r).movementId === d.movementId).length !== 1 || records.some((r) => r.recordType === "finance_invoice_receipt" && r.status !== "REVERSED" && creditData(r).movementId === d.movementId)) errors.push("El abono tiene aplicaciones bancarias adicionales incompatibles con el saldo a favor.");
  if (records.filter((r) => r.recordType === "finance_customer_credit" && r.status !== "REVERSED" && creditData(r).movementId === d.movementId).length !== 1) errors.push("El movimiento respalda más de un saldo a favor o falta su registro.");
  const applications = records.filter((r) => r.recordType === "finance_credit_application" && creditData(r).creditId === credit?.id);
  let applied = 0;
  for (const application of applications) {
    const a = creditData(application), allocations = Array.isArray(a.allocations) ? a.allocations : [];
    const receipts = records.filter((r) => r.recordType === "finance_invoice_receipt" && creditData(r).creditApplicationId === application.id);
    if (!sameTenant(application) || !["APPLIED", "REVERSED"].includes(application.status)) { errors.push("Aplicación de saldo con estado o empresa inconsistentes."); continue; }
    if (application.status === "REVERSED") {
      if (receipts.some((r) => r.status !== "REVERSED")) errors.push("Una aplicación revertida mantiene cobros activos.");
      continue;
    }
    const total = allocations.reduce((s, x) => s + (positiveCreditAmount(x?.amount) ? x.amount : 0), 0);
    if (!allocations.length || new Set(allocations.map((x) => x?.invoiceId)).size !== allocations.length || allocations.some((x) => !positiveCreditAmount(x?.amount)) || total !== a.amount || !positiveCreditAmount(total) || a.currency !== "CLP" || !creditDay(a.applicationDate) || a.applicationDate < d.transactionDate || a.reversedAt) errors.push("Distribución o fecha de aplicación inválida.");
    if (receipts.length !== allocations.length) errors.push("Faltan comprobantes de la aplicación o están duplicados.");
    for (const allocation of allocations) {
      if (!allocation?.invoiceId) { errors.push("Aplicación sin factura identificada."); continue; }
      const invoice = index.get(allocation.invoiceId);
      const evidence = receipts.filter((r) => creditData(r).invoiceId === allocation.invoiceId);
      const receipt = evidence[0], rd = creditData(receipt);
      if (invoice?.recordType !== "finance_invoice" || !sameTenant(invoice) || financeDocumentSide(invoice) !== "CUSTOMER" || invoiceCreditRut(invoice) !== creditRut(d.customerRut) || String(creditData(invoice).currency || "CLP").toUpperCase() !== "CLP" || !financeDocumentDate(invoice) || financeDocumentDate(invoice) > a.applicationDate || ["DELETED", "EXCLUDED", "ANNULLED", "CANCELLED", "REJECTED"].includes(invoice.status)) errors.push("La factura aplicada no pertenece al cliente/moneda o no está vigente.");
      if (evidence.length !== 1 || !sameTenant(receipt) || receipt.status !== "RECONCILED" || rd.reversedAt || rd.amount !== allocation.amount || rd.creditId !== credit?.id || rd.paymentDate !== a.applicationDate || rd.currency !== "CLP" || rd.movementId || rd.reconciliationId || rd.source !== "customer_credit") errors.push("El comprobante de aplicación no cuadra; no es un segundo ingreso bancario.");
      if (invoice) {
        const financial = financeDocumentState(invoice);
        const creditPayments = records.filter((r) => r.recordType === "finance_invoice_receipt" && r.status === "RECONCILED" && creditData(r).source === "customer_credit" && creditData(r).invoiceId === invoice.id).reduce((s, r) => s + Number(creditData(r).amount), 0);
        if (!financial.included || !Number.isSafeInteger(creditPayments) || financial.paidAmount < creditPayments) errors.push("Los pagos y el saldo de la factura no respaldan las aplicaciones de crédito.");
      }
    }
    applied += total;
  }
  const ids = new Set(applications.map((r) => r.id));
  if (records.some((r) => r.recordType === "finance_invoice_receipt" && r.status !== "REVERSED" && creditData(r).creditId === credit?.id && !ids.has(creditData(r).creditApplicationId))) errors.push("Hay un comprobante sin aplicación de saldo respaldada.");
  const available = d.amount - applied;
  if (!Number.isSafeInteger(applied) || !Number.isSafeInteger(available) || available < 0 || d.availableAmount !== available || (available === 0 ? credit.status !== "USED" : credit.status !== "AVAILABLE")) errors.push("El saldo disponible no coincide con el historial de aplicaciones.");
  return { valid: errors.length === 0, errors: [...new Set(errors)], available, applied, applications };
}

export function customerCreditsForClose(records, period) {
  const blockers = [], index = new Map(records.map((r) => [r.id, r])); let availableAmount = 0;
  for (const credit of records.filter((r) => r.recordType === "finance_customer_credit" && r.status !== "REVERSED")) {
    const d = creditData(credit); if (creditDay(d.transactionDate) && d.transactionDate.slice(0, 7) > period) continue;
    const ledger = auditCustomerCredit(credit, records);
    if (!ledger.valid) blockers.push({ type: "SALDO_FAVOR_INCONSISTENTE", id: `credit-${credit.id}`, title: `${credit.title}: ${ledger.errors.join(" ")}` });
    else availableAmount += d.amount - ledger.applications.filter((a) => a.status === "APPLIED" && creditData(a).applicationDate.slice(0, 7) <= period).reduce((s, a) => s + creditData(a).amount, 0);
  }
  for (const application of records.filter((r) => r.recordType === "finance_credit_application" && r.status === "APPLIED")) {
    const a = creditData(application), origin = index.get(a.creditId);
    if ((!creditDay(a.applicationDate) || a.applicationDate.slice(0, 7) <= period) && (origin?.recordType !== "finance_customer_credit" || origin.status === "REVERSED" || origin.tenantId !== application.tenantId)) blockers.push({ type: "SALDO_FAVOR_INCONSISTENTE", id: `credit-application-${application.id}`, title: "Aplicación de saldo a favor sin origen vigente en esta empresa." });
  }
  for (const receipt of records.filter((r) => r.recordType === "finance_invoice_receipt" && r.status !== "REVERSED" && creditData(r).source === "customer_credit")) {
    const d = creditData(receipt), application = index.get(d.creditApplicationId);
    if ((!creditDay(d.paymentDate) || d.paymentDate.slice(0, 7) <= period) && (application?.recordType !== "finance_credit_application" || application.status !== "APPLIED" || application.tenantId !== receipt.tenantId)) blockers.push({ type: "SALDO_FAVOR_INCONSISTENTE", id: `credit-receipt-${receipt.id}`, title: "Comprobante de saldo a favor sin aplicación vigente verificable." });
  }
  return { availableAmount, blockers };
}
