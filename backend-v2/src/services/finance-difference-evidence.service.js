import { createHash } from "node:crypto";
import { financeDocumentState } from "./finance-document-values.service.js";
export const DIFFERENCE_CATEGORIES = Object.freeze({ BANK_FEE: "Comisión bancaria o del intermediario", WITHHOLDING: "Retención respaldada", DISCOUNT: "Descuento comercial respaldado", ROUNDING: "Redondeo" });
export const differenceData = (r) => r?.data || {};
export const differenceFingerprint = (r) => createHash("sha256").update(JSON.stringify([r.id, r.status, r.updatedAt, r.data])).digest("hex");
export function auditDifference(difference, records) {
  const d = differenceData(difference), index = new Map(records.map((r) => [r.id, r])), errors = [];
  const movement = index.get(d.movementId), invoice = index.get(d.invoiceId), rec = index.get(d.reconciliationId), receipt = index.get(d.receiptId);
  const m = differenceData(movement), r = differenceData(rec), p = differenceData(receipt);
  const positive = (n) => Number.isSafeInteger(n) && n > 0;
  if (difference?.recordType !== "finance_reconciliation_difference" || difference.status !== "APPROVED" || d.reversedAt || !DIFFERENCE_CATEGORIES[d.category] || !positive(d.amount) || !positive(d.bankAmount) || !positive(d.settlementAmount) || d.bankAmount + d.amount !== d.settlementAmount || d.currency !== "CLP" || !d.approvedById || !d.approvedAt || String(d.reason || "").trim().length < 10 || String(d.evidence || "").trim().length < 10) errors.push("Falta una diferencia aprobada, clasificada y respaldada con montos consistentes.");
  const sameTenant = (record) => record?.tenantId === difference?.tenantId;
  if (movement?.recordType !== "bank_movement" || !sameTenant(movement) || movement.status !== "MATCHED" || m.reconciliationId !== rec?.id || m.amount !== d.bankAmount || String(m.transactionDate || m.date).slice(0, 10) !== d.transactionDate) errors.push("La diferencia no coincide con el abono original.");
  if (rec?.recordType !== "finance_reconciliation" || !sameTenant(rec) || rec.status !== "APPROVED" || r.differenceId !== difference?.id || r.movementId !== movement?.id || r.invoiceId !== invoice?.id || r.amount !== d.bankAmount || r.differenceAmount !== d.amount || r.settlementAmount !== d.settlementAmount || r.reconciliationType !== "JUSTIFIED_DIFFERENCE") errors.push("La conciliación no respalda la diferencia autorizada.");
  if (receipt?.recordType !== "finance_invoice_receipt" || !sameTenant(receipt) || receipt.status !== "RECONCILED" || p.reversedAt || p.invoiceId !== invoice?.id || p.movementId !== movement?.id || p.reconciliationId !== rec?.id || p.differenceId !== difference?.id || p.amount !== d.bankAmount) errors.push("El cobro no coincide con el dinero real del banco.");
  if (invoice?.recordType !== "finance_invoice" || !sameTenant(invoice)) errors.push("No está disponible la factura de esta empresa.");
  else {
    const s = financeDocumentState(invoice);
    const authorized = records.filter((a) => a.recordType === "finance_reconciliation_difference" && a.status === "APPROVED" && a.tenantId === invoice.tenantId && differenceData(a).invoiceId === invoice.id).reduce((total, a) => total + Number(differenceData(a).amount), 0);
    const payments = records.filter((a) => a.recordType === "finance_invoice_receipt" && a.status === "RECONCILED" && a.tenantId === invoice.tenantId && differenceData(a).invoiceId === invoice.id && differenceData(a).differenceId).reduce((total, a) => total + Number(differenceData(a).amount), 0);
    if (!s.included || !Number.isSafeInteger(authorized) || authorized !== s.justifiedDifference || s.paidAmount < payments) errors.push("Los pagos, diferencias y saldo de la factura no coinciden con su evidencia.");
  }
  return { valid: !errors.length, errors };
}
export function differencesForClose(records, period) {
  const blockers = [], byCategory = Object.fromEntries(Object.keys(DIFFERENCE_CATEGORIES).map((key) => [key, 0]));
  for (const difference of records.filter((r) => r.recordType === "finance_reconciliation_difference")) {
    const d = differenceData(difference), inPeriod = String(d.transactionDate || "").startsWith(period + "-");
    if (difference.status === "PROPOSED" && (inPeriod || !d.transactionDate)) blockers.push({ type: "DIFERENCIA_PENDIENTE", id: difference.id, title: `${difference.title}: aprobar o rechazar la justificación antes del cierre.` });
    if (difference.status === "APPROVED" && (inPeriod || !d.transactionDate)) {
      const evidence = auditDifference(difference, records);
      if (!evidence.valid) blockers.push({ type: "DIFERENCIA_INCONSISTENTE", id: difference.id, title: evidence.errors.join(" ") });
      else byCategory[d.category] += d.amount;
    }
  }
  for (const invoice of records.filter((r) => r.recordType === "finance_invoice" && Number(differenceData(r).justifiedDifferenceTotal) > 0)) {
    const sum = records.filter((r) => r.recordType === "finance_reconciliation_difference" && r.status === "APPROVED" && r.tenantId === invoice.tenantId && differenceData(r).invoiceId === invoice.id).reduce((s, r) => s + Number(differenceData(r).amount), 0);
    if (sum !== Number(differenceData(invoice).justifiedDifferenceTotal)) blockers.push({ type: "DIFERENCIA_INCONSISTENTE", id: `difference-invoice-${invoice.id}`, title: `${invoice.title}: diferencia descontada del saldo sin aprobación verificable.` });
  }
  return { blockers, byCategory, total: Object.values(byCategory).reduce((s, n) => s + n, 0) };
}
