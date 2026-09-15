import { FinanceOperationError, findAllFinanceRecords } from "./finance-integrity.service.js";
import { parseFinanceContext, financeRecordMatchesContext, financeRecordAccount, financeOperationalDate } from "./finance-context.service.js";
import { financialDate } from "./finance-manual-writes.service.js";
import { classifyFinanceMovement } from "./finance-movement-classification.service.js";
const str = (value) => String(value ?? "").trim();
const searchText = (value) => str(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
function validMovementDate(record, index) {
  const value = financeOperationalDate(record, index);
  if (!value) return "";
  try { return financialDate(value); } catch { return ""; }
}
export function movementLedger(records, query = {}, { all = false, reconciliationAccess = false } = {}) {
  records = records.map((r) => r.data?.sourceBatchId && !r.data.importBatchId ? { ...r, data: { ...r.data, importBatchId: r.data.sourceBatchId } } : r);
  const context = parseFinanceContext(query), index = new Map(records.map((r) => [r.id, r]));
  const revision = str(query.importRevision), confidenceFilter = str(query.confidence || "ALL");
  if (revision && revision !== "UNKNOWN" && (!/^\d+$/.test(revision) || !Number.isSafeInteger(Number(revision)))) throw new FinanceOperationError(400, "La revisión importada debe ser un entero no negativo o Sin versión registrada.");
  if (!["ALL", "HIGH", "MEDIUM", "LOW", "UNKNOWN"].includes(confidenceFilter)) throw new FinanceOperationError(400, "Filtro de puntaje inválido.");
  if (!reconciliationAccess && confidenceFilter !== "ALL") throw new FinanceOperationError(403, "El filtro de puntaje requiere acceso al módulo de conciliación.");
  const dateScope = str(query.dateScope || "PERIOD");
  if (!["PERIOD", "UNDATED"].includes(dateScope)) throw new FinanceOperationError(400, "Selecciona una vista de fechas válida.");
  if (dateScope === "UNDATED" && (query.from || query.to)) throw new FinanceOperationError(400, "Los movimientos sin fecha no pueden filtrarse por un rango de fechas. Limpia Desde y Hasta.");
  const scoped = records.filter((r) => r.recordType === "bank_movement" && financeRecordMatchesContext(r, { ...context, period: "" }, index));
  const undatedAvailable = scoped.filter((r) => !validMovementDate(r, index)).length;
  const from = query.from ? financialDate(query.from) : "", to = query.to ? financialDate(query.to) : "";
  if (from && to && from > to) throw new FinanceOperationError(400, "La fecha inicial no puede superar la final.");
  const min = query.min === "" || query.min == null ? 0 : Number(query.min), max = query.max === "" || query.max == null ? Infinity : Number(query.max);
  if (!Number.isFinite(min) || min < 0 || Number.isNaN(max) || max < min || (query.max && !Number.isFinite(max))) throw new FinanceOperationError(400, "Revisa el rango de montos positivos.");
  const direction = str(query.direction || "ALL"), status = str(query.status || "ALL"), sort = str(query.sort || "date_desc");
  if (!["ALL", "CREDIT", "DEBIT", "UNKNOWN"].includes(direction) || !["ALL", "MATCHED", "PENDING", "REVIEW", "EXCLUDED", "OTHER"].includes(status) || !["date_desc", "date_asc", "amount_desc", "amount_asc"].includes(sort)) throw new FinanceOperationError(400, "Filtro de movimientos inválido.");
  const owner = str(query.owner);
  if (owner.length > 160 || (owner && !/^[a-zA-Z0-9_-]+$/.test(owner))) throw new FinanceOperationError(400, "Responsable inválido.");
  const term = searchText(query.search).slice(0, 200);
  let rows = scoped.filter((r) => {
    const date = validMovementDate(r, index);
    return dateScope === "UNDATED" ? !date : Boolean(date) && (!context.period || date.startsWith(context.period + "-"));
  }).map((r) => {
    const d = r.data || {}, batch = index.get(d.importBatchId || d.sourceBatchId), account = financeRecordAccount(r, index) || {};
    const rec = reconciliationAccess && d.reconciliationId ? index.get(d.reconciliationId) : null;
    const linked = rec?.recordType === "finance_reconciliation" && rec.data?.movementId === r.id && rec.status === "APPROVED" && ["MATCHED", "RECONCILED"].includes(r.status);
    const value = linked ? rec.data.confidence : null;
    const confidenceScore = typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100 ? value : null;
    const confidenceBand = confidenceScore === null ? "UNKNOWN" : confidenceScore >= 95 ? "HIGH" : confidenceScore >= 80 ? "MEDIUM" : "LOW";
    const importedRevision = batch?.recordType === "bank_statement" ? batch.data?.importRevision : null;
    const importRevision = Number.isSafeInteger(importedRevision) && importedRevision >= 0 ? String(importedRevision) : "";
    const { amount, direction: type } = classifyFinanceMovement(d);
    const rawStatus = str(r.status).toUpperCase();
    const state = d.excluded || ["EXCLUDED", "DELETED"].includes(rawStatus) ? "EXCLUDED" : rawStatus === "MATCHED" || rawStatus === "RECONCILED" ? "MATCHED" : d.needsReview || ["REQUIRES_REVIEW", "REVIEW", "EXCEPTION"].includes(rawStatus) ? "REVIEW" : ["PENDING", "NEW", "VALID", "UNMATCHED"].includes(rawStatus) ? "PENDING" : "OTHER";
    return { id: r.id, version: r.updatedAt ? new Date(r.updatedAt).toISOString() : "", date: validMovementDate(r, index), description: str(d.description || r.title), amount, direction: type, status: state,
      reference: str(d.reference), rut: str(d.rut), payer: str(d.payerName), bank: str(account.bank || account.bankKey), account: str(account.accountAlias), last4: str(account.accountLast4).replace(/\D/g, "").slice(-4),
      assignedToId: str(r.assignedToId),
      importRevision, confidenceScore, confidenceBand, confidenceLabel: !reconciliationAccess ? "Acceso restringido" : confidenceScore === null ? "Sin puntaje vigente" : `${confidenceScore} / 100`,
      sourceFile: str(d.sourceFile || batch?.data?.sourceFile || batch?.title), batchId: str(d.importBatchId || d.sourceBatchId),
      sourceRow: str(d.origin?.row || d.importRow || d.dataRow || (typeof d.sourceRow === "number" ? d.sourceRow : "")), sourceSheet: str(d.origin?.sheet), reconciliationId: str(d.reconciliationId),
      reasons: Array.isArray(d.reviewReasons) ? d.reviewReasons.map(str) : [], currency: context.currency };
  }).filter((r) => (!from || r.date >= from) && (!to || !!r.date && r.date <= to) && (direction === "ALL" || r.direction === direction) && (status === "ALL" || r.status === status) && (r.amount === null ? min === 0 && max === Infinity : r.amount >= min && r.amount <= max) && (!term || searchText([r.description, r.reference, r.rut, r.payer, r.bank, r.account, r.sourceFile].join(" ")).includes(term)));
  rows = rows.filter((r) => (!owner || (owner === "NONE" ? !r.assignedToId : owner === "ASSIGNED" ? !!r.assignedToId : r.assignedToId === owner)) && (!revision || (revision === "UNKNOWN" ? !r.importRevision : r.importRevision === String(Number(revision)))) && (confidenceFilter === "ALL" || r.confidenceBand === confidenceFilter));
  rows.sort((a, b) => {
    const result = sort.startsWith("amount") ? (a.amount ?? -1) - (b.amount ?? -1) : a.date.localeCompare(b.date);
    return (sort.endsWith("desc") ? -result : result) || a.id.localeCompare(b.id);
  });
  const summary = rows.reduce((sum, r) => { if (r.amount === null || r.direction === "UNKNOWN") sum.unclassified++; else if (r.direction === "CREDIT") sum.credits += r.amount; else sum.debits += r.amount; return sum; }, { credits: 0, debits: 0, unclassified: 0 });
  const pageSize = [10, 25, 50, 100].includes(Number(query.pageSize)) ? Number(query.pageSize) : 25;
  const pages = Math.max(1, Math.ceil(rows.length / pageSize)), page = Math.min(pages, Math.max(1, Math.trunc(Number(query.page) || 1)));
  return { page, pages, pageSize, total: rows.length, summary, dateScope, undatedAvailable, reconciliationAccess,
    scopeNotice: dateScope === "UNDATED" ? "Movimientos sin fecha válida de la cuenta y moneda seleccionadas, de cualquier período. No se atribuyen al mes activo." : "Movimientos con fecha válida del período seleccionado.",
    records: all ? rows : rows.slice((page - 1) * pageSize, page * pageSize) };
}
export async function readMovementLedger(db, tenantId, query, options = {}) {
  const records = await findAllFinanceRecords(db, { where: { tenantId, recordType: { in: ["bank_movement", "bank_statement", ...(options.reconciliationAccess ? ["finance_reconciliation"] : [])] } } });
  return movementLedger(records, query, options);
}
export function movementLedgerCsv(result) {
  const cell = (value) => { const text = str(value); return `"${(/^[\s]*[=+@-]/.test(text) ? "'" : "") + text.replace(/"/g, '""')}"`; };
  const labels = { CREDIT: "Abono", DEBIT: "Cargo", UNKNOWN: "Por identificar", MATCHED: "Conciliado", PENDING: "Pendiente", REVIEW: "En revisión", EXCLUDED: "Excluido", OTHER: "Otro estado" };
return "\uFEFF" + [["Fecha", "Descripción", "Monto", "Moneda", "Tipo", "Estado", "Referencia", "RUT", "Contraparte", "Banco", "Cuenta", "Últimos 4 dígitos", "Cartola", "Fila origen", "Alcance de fechas", "Revisión importada", "Puntaje de conciliación vigente (no probabilidad)", "Responsable (ID)"], ...result.records.map((r) => [r.date, r.description, r.amount, r.currency, labels[r.direction], labels[r.status], r.reference, r.rut, r.payer, r.bank, r.account, r.last4, r.sourceFile, r.sourceRow, result.scopeNotice || "", r.importRevision, r.confidenceLabel, r.assignedToId])].map((r) => r.map(cell).join(";")).join("\r\n");
}
