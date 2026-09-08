import { createHash } from "node:crypto";
import { FinanceOperationError, findAllFinanceRecords } from "./finance-integrity.service.js";

const dataOf = (record) => record?.data && typeof record.data === "object" ? record.data : {};
const text = (value) => String(value ?? "").trim();
const normalized = (value) => text(value).normalize("NFKC").toLowerCase();
export const FINANCE_CONTEXT_TYPES = ["bank_statement", "bank_movement", "finance_invoice", "finance_payable", "finance_exception", "finance_reconciliation", "finance_collection_case"];

export function parseFinanceContext(input = {}) {
  // The tenant is always supplied by authentication, never by a query parameter.
  const period = text(input.period);
  const accountKey = text(input.accountKey);
  const currency = text(input.currency || "CLP").toUpperCase();
  if (period && !/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) throw new FinanceOperationError(400, "Selecciona un período válido (AAAA-MM).");
  if (accountKey && !/^[a-f0-9]{24}$/.test(accountKey)) throw new FinanceOperationError(400, "La cuenta bancaria seleccionada no es válida.");
  if (!["CLP", "USD", "EUR", "UF"].includes(currency)) throw new FinanceOperationError(400, "La moneda seleccionada no está admitida.");
  return { period, accountKey, currency };
}

export function financeAccountKey(account) {
  if (!account?.bankKey) return "";
  // Legacy records contain a masked account, not its full number. Keep aliases
  // distinct and expose identification as partial instead of asserting a bank ID.
  const identity = [account.bankKey, account.accountLast4, account.accountAlias, account.accountType].map(normalized);
  return createHash("sha256").update(identity.join("|" )).digest("hex").slice(0, 24);
}

export function financeRecordAccount(record, index = new Map(), visited = new Set()) {
  if (!record || visited.has(record.id)) return null;
  visited.add(record.id);
  const data = dataOf(record);
  if (data.account?.bankKey) return data.account;
  if (data.bankKey) return data;
  if (data.movement?.bankKey) return data.movement;
  const related = index.get(data.movementId) || index.get(data.importBatchId);
  return related ? financeRecordAccount(related, index, visited) : null;
}

export function financeOperationalDate(record, index = new Map(), visited = new Set()) {
  if (!record || visited.has(record.id)) return "";
  visited.add(record.id);
  const data = dataOf(record);
  const related = index.get(data.movementId);
  if (related) return financeOperationalDate(related, index, visited);
  const administrativeDate = record.recordType === "finance_exception" && !data.importBatchId && !data.movementId && !data.movement ? record.createdAt : null;
  const value = data.transactionDate || data.operatingDate || data.movement?.transactionDate || data.movement?.date || data.issueDate || data.date || data.paymentDate || administrativeDate;
  if (!value) return "";
  const date = value instanceof Date ? value.toISOString().slice(0, 10) : text(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : "";
}

export function financeRecordMatchesContext(record, context, index = new Map(), { documentMode = "period" } = {}) {
  const data = dataOf(record);
  if (text(data.currency || "CLP").toUpperCase() !== context.currency) return false;
  const document = ["finance_invoice", "finance_payable", "finance_collection_case"].includes(record.recordType);
  if (context.accountKey && !document && financeAccountKey(financeRecordAccount(record, index)) !== context.accountKey) return false;
  if (!context.period) return true;
  const date = financeOperationalDate(record, index);
  // Unknown dates must remain reachable for human review, not disappear from
  // the very screen needed to clear a close-period blocker.
  if (record.recordType === "finance_exception" && !date) return true;
  if (record.recordType === "bank_statement") {
    const from = text(data.coverage?.from);
    const to = text(data.coverage?.to);
    if (from && to) return from.slice(0, 7) <= context.period && to.slice(0, 7) >= context.period;
    // Legacy statements are linked using their movements, not their upload date.
    return [...index.values()].some((item) => dataOf(item).importBatchId === record.id && financeOperationalDate(item, index).startsWith(context.period + "-"));
  }
  if (document && documentMode === "outstanding") return Boolean(date && date.slice(0, 7) <= context.period);
  return date.startsWith(context.period + "-");
}

export function filterFinanceContext(records, context, options) {
  if (!context) return records;
  const index = new Map(records.map((record) => [record.id, record]));
  return records.filter((record) => financeRecordMatchesContext(record, context, index, options));
}

export function buildFinanceContextCoverage(records, context) {
  const index = new Map(records.map((record) => [record.id, record]));
  const accounts = new Map();
  for (const record of records) {
    const account = financeRecordAccount(record, index);
    const key = financeAccountKey(account);
    if (key && !accounts.has(key)) accounts.set(key, {
      key, bank: text(account.bank || account.bankKey), alias: text(account.accountAlias || "Cuenta sin nombre"),
      last4: text(account.accountLast4), identification: "partial"
    });
  }
  if (context.accountKey && !accounts.has(context.accountKey)) throw new FinanceOperationError(404, "La cuenta seleccionada no pertenece a la empresa actual o ya no está disponible.");
  const selected = filterFinanceContext(records, context);
  const supplierDocument = (record) => {
    const data = dataOf(record);
    if (record.recordType === "finance_payable") return true;
    if ((data.supplierName || data.supplier || data.providerName) && !(data.clientName || data.customerName || data.customer)) return true;
    return [data.documentSide, data.direction, data.kind].some((value) => ["SUPPLIER", "PURCHASE", "PAYABLE"].includes(text(value).toUpperCase()));
  };
  const source = (type) => {
    const rows = selected.filter((record) => type === "bank_movement" ? record.recordType === type
      : ["finance_invoice", "finance_payable"].includes(record.recordType) && supplierDocument(record) === (type === "finance_payable"));
    const dates = rows.map((record) => financeOperationalDate(record, index)).filter(Boolean).sort();
    return { count: rows.length, from: dates[0] || null, to: dates.at(-1) || null, status: rows.length ? "PRESENT_NOT_VERIFIED" : "NO_DATA" };
  };
  const statements = selected.filter((record) => record.recordType === "bank_statement" && !["DELETED", "REPROCESSED"].includes(record.status));
  const movements = source("bank_movement");
  const customers = source("finance_invoice");
  const suppliers = source("finance_payable");
  const undatedMovements = records.filter((record) => record.recordType === "bank_movement" && !financeOperationalDate(record, index)).length;
  const warnings = [];
  if (!movements.count) warnings.push("No hay movimientos para esta cuenta, moneda y período. Esto no acredita que el banco no tuvo actividad.");
  if (!customers.count) warnings.push("No hay facturas de clientes emitidas en este período. Revisa la fuente documental; las facturas anteriores pueden seguir pendientes de pago.");
  if (!suppliers.count) warnings.push("No hay documentos de proveedores emitidos en este período. Una cartola no sustituye esos documentos.");
  if (undatedMovements) warnings.push(`${undatedMovements} movimiento(s) de la empresa no tienen fecha operativa y requieren revisión.`);
  warnings.push("La presencia de registros y sus fechas no acredita cobertura completa. No se infieren días faltantes a partir de días sin movimientos.");
  return { context, accounts: [...accounts.values()].sort((a, b) => (a.bank + a.alias).localeCompare(b.bank + b.alias)), statements: statements.length,
    sources: { movements, customers, suppliers }, warnings, complete: false,
    documentScope: "Los documentos pertenecen a la empresa; el filtro de cuenta aplica a los movimientos bancarios." };
}

export async function loadFinanceContextRecords(db, tenantId) {
  if (!tenantId) throw new FinanceOperationError(401, "Se requiere una empresa autenticada.");
  return findAllFinanceRecords(db, { where: { tenantId, recordType: { in: FINANCE_CONTEXT_TYPES } }, orderBy: { updatedAt: "desc" } });
}

export function restrictFinanceCoverage(coverage, access) {
  const hidden = { count: 0, from: null, to: null, status: "NO_ACCESS" };
  return { ...coverage, accounts: access.movements ? coverage.accounts : [], statements: access.movements ? coverage.statements : 0,
    sources: Object.fromEntries(Object.entries(coverage.sources).map(([key, value]) => [key, access[key] ? value : hidden])),
    warnings: Object.values(access).every(Boolean) ? coverage.warnings : ["La cobertura sólo incluye las fuentes habilitadas para esta cuenta. Las fuentes sin acceso no se consideran vacías ni verificadas.", "La presencia de registros no acredita cobertura completa del período."] };
}
