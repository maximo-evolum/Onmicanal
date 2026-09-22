import { createHash } from "node:crypto";
import { financeDocumentDate, financeDocumentSide, financeDocumentState } from "./finance-document-values.service.js";
import { financeOperationalDate, financeRecordAccount } from "./finance-context.service.js";
import { classifyFinanceMovement } from "./finance-movement-classification.service.js";

export const HISTORICAL_TYPES = ["finance_invoice", "finance_payable", "bank_movement", "bank_statement", "finance_exception"];
const text = (v) => String(v ?? "").trim();
const has = (v) => v !== undefined && v !== null && v !== "";
export const historicalDay = (v) => { const s = text(v).slice(0, 10); return /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s ? s : ""; };
export const historicalVersion = (r) => createHash("sha256").update(JSON.stringify([r.id, r.recordType, r.status, r.updatedAt, r.data])).digest("hex");
export function historicalTarget(record) {
  if (record.recordType !== "finance_exception") return HISTORICAL_TYPES.includes(record.recordType) ? record.recordType : null;
  if (record.data?.type === "BANK_STATEMENT_IMPORT_REVIEW") return "bank_movement";
  if (record.data?.type === "MIGRATION_REVIEW") return financeDocumentSide(record) === "SUPPLIER" ? "finance_payable" : "finance_invoice";
  return null;
}
export function analyzeHistoricalRecord(record, index = new Map()) {
  const target = historicalTarget(record), original = record.data || {};
  if (!target || ["DELETED", "EXCLUDED", "REPROCESSED", "CANCELLED", "ANNULLED", "VOID", "REJECTED"].includes(record.status) || original.excluded || (record.recordType === "finance_exception" && ["CLOSED", "RESOLVED"].includes(record.status))) return null;
  const d = record.recordType === "finance_exception" && target === "bank_movement" ? { ...original.movement, importBatchId: original.importBatchId, sourceFile: original.sourceFile } : original;
  const effective = { ...record, recordType: target, data: d };
  const document = ["finance_invoice", "finance_payable"].includes(target), statement = target === "bank_statement";
  const issues = [];
  const add = (code, label, blocking = true) => issues.push({ code, label, blocking });
  const date = statement ? "" : historicalDay(document ? financeDocumentDate(effective) : financeOperationalDate(effective, index));
  if (!statement && !date) add("DATE", "Fecha de origen ausente o inválida; no se usa la fecha de carga.");
  if (!statement && !text(d.currency)) add("CURRENCY", "Moneda no informada; debe confirmarse con el original.");
  if (document) {
    const state = financeDocumentState(effective);
    for (const label of state.qualityIssues) add("AMOUNT", label);
    if (!has(d.balance) && !has(d.paidAmount)) add("BALANCE", "No se conoce el saldo ni el pago acumulado del documento.");
    if (!text(d.documentNumber || d.invoiceNumber || d.number)) add("NUMBER", "Falta el folio o identificador del documento.");
    const supplier = financeDocumentSide(effective) === "SUPPLIER";
    if (!text(supplier ? d.supplierName || d.supplier || d.providerName : d.customerName || d.customer || d.clientName)) add("PARTY", "Falta identificar al cliente o proveedor.");
    if (!historicalDay(d.dueDate)) add("DUE_DATE", "Vencimiento no informado o inválido: no se debe inferir mora.", false);
  } else {
    const account = financeRecordAccount(effective, index);
    if (!account?.bankKey || !(text(account.accountLast4) || (text(account.accountAlias) && text(account.accountAlias).toLowerCase() !== "cuenta sin nombre"))) add("ACCOUNT", "Falta identificar banco y cuenta.");
    if (!statement) {
      const movement = classifyFinanceMovement(d);
      if (movement.amount === null || movement.amount <= 0) add("AMOUNT", "Monto del movimiento ausente, inválido o cero.");
      if (movement.direction === "UNKNOWN") add("DIRECTION", "No se sabe si es un abono o un cargo.");
      if (!text(d.description) || text(d.description) === "Movimiento sin descripción") add("DESCRIPTION", "Falta la descripción original del movimiento.");
    }
  }
  if (record.recordType === "finance_exception") add("IMPORT_REVIEW", "Fila importada pendiente: completar y convertir en registro operativo.");
  return { target, document, statement, date, issues, data: d };
}

export function historicalCoverageBlockers(records, period) {
  const index = new Map(records.map((r) => [r.id, r]));
  return records.flatMap((r) => {
    const a = analyzeHistoricalRecord(r, index);
    if (!a || a.statement || (a.date && !a.date.startsWith(period + "-")) || (text(a.data.currency) && text(a.data.currency).toUpperCase() !== "CLP")) return [];
    const issues = a.issues.filter((i) => i.blocking);
    return issues.length ? [{ id: `historical-${r.id}`, type: "HISTORICO_INCOMPLETO", title: `${r.title || r.id}: ${issues.map((i) => i.label).join(" ")}` }] : [];
  });
}
