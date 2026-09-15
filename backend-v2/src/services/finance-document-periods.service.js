import { financialDate } from "./finance-manual-writes.service.js";
import { assertFinancePeriodOpen } from "./finance-period-control.service.js";
import { FinanceOperationError, findAllFinanceRecords } from "./finance-integrity.service.js";
import { getInvoiceFinancialState } from "./finance.service.js";

const dataOf = (row) => row?.data || row || {};
const rut = (value) => String(value || "").replace(/[^0-9kK]/g, "").toUpperCase();
const adjustments = (rows) => rows.filter((row) => ["56", "61"].includes(String(dataOf(row).documentTypeCode)) && !row.needsReview);
export function dteTargetCandidates(note, documents) {
  const n = dataOf(note);
  if (!n.referenceDocumentNumber || !n.referenceDocumentType || !n.emitterRut || !n.receiverRut) return [];
  return documents.filter((document) => {
    const d = dataOf(document); const side = n.documentSide || n.side;
    return (document.recordType ? document.recordType === (side === "SUPPLIER" ? "finance_payable" : "finance_invoice") : d.side === side && !["56", "61"].includes(String(d.documentTypeCode)))
      && String(d.documentNumber || d.invoiceNumber) === String(n.referenceDocumentNumber)
      && String(d.documentTypeCode) === String(n.referenceDocumentType)
      && rut(d.emitterRut) === rut(n.emitterRut) && rut(d.receiverRut) === rut(n.receiverRut);
  });
}
export function documentImportPeriods(rows, targets = [], kind = "MIGRATION") {
  const periods = new Set(); const invalidRows = [];
  for (const [index, row] of [...rows, ...targets].entries()) {
    const d = dataOf(row);
    if (kind === "MIGRATION" && d.invalidPaymentDate) invalidRows.push(d.rowNumber || index + 1);
    const values = [d.issueDate];
    if (kind === "MIGRATION" && Number(d.paidAmount) > 0 && d.paymentDate) values.push(d.paymentDate);
    for (const value of values) {
      try { periods.add(financialDate(value).slice(0, 7)); }
      catch { invalidRows.push(d.rowNumber || row.id || d.sourceFile || index + 1); }
    }
  }
  return { periods: [...periods].sort(), invalidRows: [...new Set(invalidRows)] };
}
export async function documentImportRestrictions(db, tenantId, rows, kind = "MIGRATION") {
  let targets = [];
  if (kind === "DTE" && adjustments(rows).length) {
    const docs = await findAllFinanceRecords(db, { where: { tenantId, recordType: { in: ["finance_invoice", "finance_payable"] } } });
    targets = adjustments(rows).flatMap((note) => { const matches = dteTargetCandidates(note, docs); return matches.length === 1 ? matches : []; });
  }
  const impact = documentImportPeriods(rows, targets, kind);
  const closed = impact.periods.length ? await db.financePeriodControl.findMany({ where: { tenantId, period: { in: impact.periods }, status: "CLOSED" }, select: { period: true } }) : [];
  const closedPeriods = closed.map((row) => row.period).sort();
  const messages = [];
  if (impact.invalidRows.length) messages.push(`Hay ${impact.invalidRows.length} registro(s) sin fecha válida de origen. Corrige el archivo antes de importar.`);
  if (closedPeriods.length) messages.push(`Períodos cerrados: ${closedPeriods.join(", ")}. Requieren reapertura autorizada.`);
  return { ...impact, closedPeriods, blocked: Boolean(messages.length), message: messages.join(" ") };
}
export async function lockDocumentImportPeriods(tx, tenantId, rows, targets = [], kind = "MIGRATION") {
  const impact = documentImportPeriods(rows, targets, kind);
  if (impact.invalidRows.length) throw new FinanceOperationError(422, "El lote tiene fechas de origen desconocidas o inválidas. No se importó ningún registro.", { invalidRows: impact.invalidRows.slice(0, 30) });
  for (const period of impact.periods) await assertFinancePeriodOpen(tx, tenantId, period);
  return impact.periods;
}

export async function applyImportedDteAdjustments(tx, tenantId, batchId, importedAt) {
  const documents = await findAllFinanceRecords(tx, { where: { tenantId, recordType: { in: ["finance_invoice", "finance_payable"] } } });
  const notes = await findAllFinanceRecords(tx, { where: { tenantId, recordType: "finance_document_adjustment", data: { path: ["siiImportBatchId"], equals: batchId } } });
  let pending = 0;
  for (const note of notes) {
    const d = dataOf(note); const candidates = dteTargetCandidates(note, documents);
    const target = candidates.length === 1 ? candidates[0] : null;
    let reason = target ? "" : "Referencia ausente, ambigua o sin coincidencia exacta de tipo, folio, emisor y receptor.";
    const state = target ? getInvoiceFinancialState(target) : null;
    const credit = d.adjustmentType === "CREDIT_NOTE"; const amount = Number(d.amount);
    if (target && (["CANCELLED", "VOID", "DELETED", "REJECTED"].includes(target.status) || !Number.isSafeInteger(amount) || amount <= 0 || !Number.isSafeInteger(state.balance) || (credit && amount > state.balance))) reason = "El ajuste requiere revisión: documento anulado, monto no válido o crédito superior al saldo. No se compensó ni descartó la diferencia.";
    if (reason) {
      pending++;
      await tx.industryRecord.update({ where: { id: note.id }, data: { status: "PENDING_REVIEW", data: { ...d, linkReviewReason: reason } } });
      await tx.industryRecord.create({ data: { tenantId, recordType: "finance_exception", title: `Revisar nota ${d.documentNumber}`, status: "OPEN", data: { type: "SII_ADJUSTMENT_LINK_REVIEW", issueDate: d.issueDate, adjustmentId: note.id, siiImportBatchId: batchId, detail: reason, source: "sii_dte_xml" } } });
      continue;
    }
    const old = dataOf(target); const balance = state.balance + (credit ? -amount : amount);
    const status = balance === 0 ? "PAID" : Number(old.paidAmount || 0) > 0 ? "PARTIAL" : "OPEN";
    const updated = await tx.industryRecord.update({ where: { id: target.id }, data: { status, data: { ...old, status, balance, creditNotesTotal: Number(old.creditNotesTotal || 0) + (credit ? amount : 0), debitNotesTotal: Number(old.debitNotesTotal || 0) + (credit ? 0 : amount), lastAdjustmentId: note.id } } });
    Object.assign(target, updated); // Next note uses the new balance, not the original snapshot.
    await tx.industryRecord.update({ where: { id: note.id }, data: { status: "APPLIED", data: { ...d, [target.recordType === "finance_payable" ? "payableId" : "invoiceId"]: target.id, appliedAt: importedAt } } });
  }
  return pending;
}
