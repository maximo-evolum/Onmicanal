import { financeDocumentState } from "./finance-document-values.service.js";
import { creditDay, invoiceCreditRut } from "./finance-customer-credit-ledger.service.js";
import { classifyFinanceMovement } from "./finance-movement-classification.service.js";
const data = (r) => r?.data || {};
const positive = (n) => Number.isSafeInteger(n) && n > 0;
export function auditFinanceGroup(group, records) {
  const errors = [], d = data(group), index = new Map(records.map((r) => [r.id, r]));
  const cells = Array.isArray(d.allocations) ? d.allocations : [], ids = Array.isArray(d.reconciliationIds) ? d.reconciliationIds : [];
  const shape = cells.length > 0 && cells.length <= 200 && cells.every((a) => typeof a?.movementId === "string" && typeof a?.invoiceId === "string" && positive(a.amount));
  if (group?.recordType !== "finance_reconciliation_group" || group.status !== "APPROVED" || d.reversedAt || d.currency !== "CLP" || !d.approvedAt || !d.approvedById || String(d.reason || "").trim().length < 10 || !shape) errors.push("Falta un grupo vigente con distribución, motivo y aprobación verificables.");
  if (!shape) return { valid: false, errors };
  if (new Set(cells.map((a) => JSON.stringify([a.movementId, a.invoiceId]))).size !== cells.length) errors.push("Hay cruces duplicados en el grupo.");
  const movementIds = [...new Set(cells.map((a) => a.movementId))], invoiceIds = [...new Set(cells.map((a) => a.invoiceId))];
  const total = cells.reduce((sum, a) => sum + a.amount, 0);
  if (!positive(total) || total !== d.amount || ids.length !== movementIds.length || new Set(ids).size !== ids.length) errors.push("El total o los comprobantes del grupo no cuadran.");
  const children = records.filter((r) => r.recordType === "finance_reconciliation" && data(r).groupId === group.id);
  if (children.length !== ids.length || children.some((r) => !ids.includes(r.id))) errors.push("Hay conciliaciones vinculadas que no pertenecen a la distribución aprobada.");
  const periods = [...new Set(movementIds.map((id) => creditDay(data(index.get(id)).transactionDate || data(index.get(id)).date).slice(0, 7)))].sort();
  if (!Array.isArray(d.periods) || JSON.stringify([...d.periods].sort()) !== JSON.stringify(periods)) errors.push("Los períodos declarados no coinciden con las fechas de los abonos.");
  for (const movementId of movementIds) {
    const m = index.get(movementId), md = data(m), rec = index.get(md.reconciliationId), rd = data(rec), expected = cells.filter((a) => a.movementId === movementId);
    if (classifyFinanceMovement(md).direction !== "CREDIT") errors.push("El grupo requiere abonos bancarios identificados, no cargos.");
    if (m?.recordType !== "bank_movement" || m.tenantId !== group.tenantId || m.status !== "MATCHED" || md.excluded || md.currency !== "CLP" || !creditDay(md.transactionDate || md.date)) errors.push("Abono del grupo ausente, excluido, sin fecha o con estado incompatible.");
    if (rec?.recordType !== "finance_reconciliation" || rec.tenantId !== group.tenantId || rec.status !== "APPROVED" || rd.reversedAt || rd.groupId !== group.id || !ids.includes(rec.id) || rd.movementId !== movementId || rd.reconciliationType !== "GROUPED_BATCH" || rd.amount !== md.amount || md.amount !== expected.reduce((s, a) => s + a.amount, 0)) errors.push("Falta el vínculo completo entre grupo, abono y conciliación.");
    const actual = Array.isArray(rd.allocations) ? rd.allocations : [];
    const movementDay = creditDay(md.transactionDate || md.date);
    if (rd.currency !== "CLP" || creditDay(rd.transactionDate) !== movementDay) errors.push("La fecha o moneda del comprobante no coincide con el abono original.");
    if (actual.length !== expected.length || expected.some((a) => actual.filter((b) => b?.invoiceId === a.invoiceId && b.amount === a.amount).length !== 1)) errors.push("La distribución del abono difiere de la distribución aprobada del grupo.");
    const live = records.filter((r) => r.recordType === "finance_reconciliation" && r.status === "APPROVED" && data(r).movementId === movementId);
    if (live.length !== 1 || live[0]?.id !== rec?.id) errors.push("El abono tiene más de una aprobación o perdió su conciliación.");
    const receipts = records.filter((r) => r.recordType === "finance_invoice_receipt" && r.status !== "REVERSED" && data(r).movementId === movementId);
    if (receipts.some((r) => (data(r).currency || "CLP") !== "CLP" || creditDay(data(r).paymentDate) !== movementDay)) errors.push("La fecha o moneda de un cobro difiere de su movimiento bancario.");
    if (receipts.length !== expected.length || expected.some((a) => receipts.filter((r) => r.tenantId === group.tenantId && r.status === "RECONCILED" && !data(r).reversedAt && data(r).reconciliationId === rec?.id && data(r).invoiceId === a.invoiceId && data(r).amount === a.amount).length !== 1)) errors.push("Los cobros del grupo están incompletos, duplicados o alterados.");
  }
  for (const id of invoiceIds) {
    const invoice = index.get(id);
    if (!invoice) { errors.push("Falta una factura del grupo."); continue; }
    const s = financeDocumentState(invoice), allocated = cells.filter((a) => a.invoiceId === id).reduce((sum, a) => sum + a.amount, 0);
    const liveReceipts = records.filter((r) => r.recordType === "finance_invoice_receipt" && r.status === "RECONCILED" && !data(r).reversedAt && data(r).invoiceId === id);
    const receiptTotal = liveReceipts.reduce((sum, r) => sum + data(r).amount, 0);
    if (liveReceipts.some((r) => !positive(data(r).amount)) || !Number.isSafeInteger(receiptTotal) || receiptTotal > s.paidAmount) errors.push("El saldo pagado no respalda la suma de los cobros bancarios vigentes de la factura.");
    if (invoice?.recordType !== "finance_invoice" || invoice.tenantId !== group.tenantId || data(invoice).currency !== "CLP" || invoiceCreditRut(invoice) !== d.customerRut || !s.included || s.paidAmount < allocated) errors.push("La factura, el cliente o su saldo ya no respaldan el grupo.");
  }
  return { valid: !errors.length, errors: [...new Set(errors)] };
}
export function financeGroupCloseBlockers(records, period) {
  return records.filter((r) => r.recordType === "finance_reconciliation_group" && r.status === "APPROVED").flatMap((group) => {
    const d = data(group), periods = Array.isArray(d.periods) ? d.periods : [];
    const related = records.filter((r) => r.recordType === "finance_reconciliation" && data(r).groupId === group.id);
    if (periods.length && !periods.includes(period) && !related.some((r) => String(data(r).transactionDate || "").startsWith(period + "-"))) return [];
    const audit = auditFinanceGroup(group, records);
    return audit.valid ? [] : [{ type: "GRUPO_CONCILIACION_INCONSISTENTE", id: group.id, title: `${group.title}: ${audit.errors.join(" ")}` }];
  });
}
