import { createHash } from "node:crypto";
import { FinanceOperationError, findAllFinanceRecords } from "./finance-integrity.service.js";
import { FINANCE_CONTEXT_TYPES, parseFinanceContext, filterFinanceContext, financeOperationalDate, financeRecordAccount, buildFinanceContextCoverage, financeRecordMatchesContext } from "./finance-context.service.js";
import { auditCloseReconciliations, excludedCloseMovement } from "./finance-close-reconciliation.service.js";
import { classifyFinanceMovement } from "./finance-movement-classification.service.js";

const data = (r) => r?.data && typeof r.data === "object" ? r.data : {};
const text = (v) => typeof v === "string" || typeof v === "number" ? String(v) : "";
export const REPORT_TYPES = [...FINANCE_CONTEXT_TYPES, "finance_invoice_receipt", "finance_payable_payment"];
export const REPORT_STATUSES = {
  reconciliation: { VERIFIED: "Conciliado con evidencia", PENDING: "Pendiente", INCONSISTENT: "Evidencia inconsistente", EXCLUDED: "Excluido" },
  exceptions: { OPEN: "Abierta", IN_REVIEW: "En revisión", RESOLVED: "Resuelta", CLOSED: "Cerrada", OTHER: "Estado sin clasificar" }
};
const typeLabels = { BANK_STATEMENT_IMPORT_REVIEW: "Revisión de cartola", MIGRATION_REVIEW: "Revisión histórica", MANUAL_REVIEW: "Revisión administrativa", UNKNOWN_TRANSFER: "Transferencia desconocida", PARTIAL_PAYMENT: "Pago parcial", AMOUNT_DIFFERENCE: "Diferencia de monto", DUPLICATE_PAYMENT: "Pago duplicado" };
export function processReportQuery(input = {}) {
  const context = parseFinanceContext(input);
  if (!context.period) throw new FinanceOperationError(400, "Selecciona el período del reporte.");
  const kind = text(input.kind || "reconciliation");
  if (!Object.hasOwn(REPORT_STATUSES, kind)) throw new FinanceOperationError(400, "Tipo de reporte no válido.");
  const status = text(input.status), search = text(input.search).trim();
  if (status && !Object.hasOwn(REPORT_STATUSES[kind], status)) throw new FinanceOperationError(400, "Estado de reporte no válido.");
  if (search.length > 120) throw new FinanceOperationError(400, "La búsqueda admite hasta 120 caracteres.");
  return { ...context, kind, status, search };
}

export function buildFinanceProcessReport(records, { tenantId, companyName, input, now = new Date() }) {
  if (!tenantId) throw new FinanceOperationError(401, "Se requiere una empresa autenticada.");
  const query = processReportQuery(input);
  // Defense in depth: no foreign records may participate in evidence or exports.
  records = records.filter((r) => r.tenantId === tenantId).map((r) => data(r).sourceBatchId && !data(r).importBatchId ? { ...r, data: { ...data(r), importBatchId: data(r).sourceBatchId } } : r);
  const index = new Map(records.map((r) => [r.id, r]));
  const dateOf = (r) => {
    const date = financeOperationalDate(r, index);
    return date && Number.isFinite(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date ? date : "";
  };
  const accountScope = records.filter((r) => financeRecordMatchesContext(r, { ...query, period: "" }, index));
  const scoped = filterFinanceContext(records, query).filter((r) => r.recordType !== "bank_movement" || dateOf(r));
  buildFinanceContextCoverage(records, query); // Validate account ownership; do not expose unrelated source statistics.
  const movements = scoped.filter((r) => r.recordType === "bank_movement");
  const undatedEvidence = accountScope.filter((r) => ["finance_reconciliation", "finance_invoice_receipt"].includes(r.recordType) && !dateOf(r));
  const audit = query.kind === "reconciliation" ? auditCloseReconciliations(records, movements, query.period, dateOf, [...scoped, ...undatedEvidence]) : null;
  const source = query.kind === "reconciliation" ? movements : accountScope.filter((r) => r.recordType === "finance_exception" && (!dateOf(r) || dateOf(r).startsWith(query.period + "-")));
  const rows = source.map((r) => {
    const d = data(r), movement = query.kind === "reconciliation" ? r : index.get(d.movementId);
    const md = movement ? data(movement) : data({ data: d.movement });
    const originalAccount = financeRecordAccount(r, index);
    const account = data(index.get(originalAccount?.bankAccountId)).bankKey ? data(index.get(originalAccount.bankAccountId)) : originalAccount;
    const batch = index.get(d.importBatchId || md.importBatchId);
    const classification = classifyFinanceMovement(md);
    const amount = classification.amount;
    const decimals = query.currency === "CLP" ? 0 : query.currency === "UF" ? 4 : 2;
    const units = amount === null ? NaN : amount * 10 ** decimals;
    const validAmount = Number.isSafeInteger(Math.round(units)) && Math.abs(units - Math.round(units)) < 0.00001;
    const status = query.kind === "reconciliation" ? excludedCloseMovement(r) ? "EXCLUDED" : audit.validIds.has(r.id) ? "VERIFIED" : audit.inconsistentIds.has(r.id) ? "INCONSISTENT" : "PENDING" : Object.hasOwn(REPORT_STATUSES.exceptions, r.status) ? r.status : "OTHER";
    const rec = query.kind === "reconciliation" ? index.get(d.reconciliationId) : null;
    const rd = data(rec);
    return {
      id: r.id, date: dateOf(r), description: text(d.description || r.title) || "Sin descripción",
      status, statusLabel: REPORT_STATUSES[query.kind][status], currency: query.currency,
      direction: classification.direction === "CREDIT" ? "Abono" : classification.direction === "DEBIT" ? "Cargo" : "Sin clasificar",
      amount: validAmount ? amount : null, bank: text(account?.bank || account?.bankName || account?.bankKey) || "Sin identificar",
      account: text(account?.accountAlias) || "Sin identificar", last4: text(account?.accountLast4).replace(/\D/g, "").slice(-4),
      sourceFile: text(d.sourceFile || md.sourceFile || data(batch).sourceFile || data(batch).fileName || batch?.title),
      sourceRow: text(d.sourceRow || md.sourceRow || d.rowNumber), sourceSheet: text(d.sourceSheet || md.sourceSheet),
      movementId: movement?.id || text(d.movementId), batchId: batch?.id || text(d.importBatchId || md.importBatchId),
      reference: text(md.reference), reconciliationId: rec?.id || "",
      documents: Array.isArray(rd.allocations) ? rd.allocations.map((a) => `${index.get(a.invoiceId)?.title || a.invoiceId}: ${a.amount} ${query.currency}`).join("; ") : "",
      approvedBy: text(rd.approvedById || rd.approvedBy), approvedAt: text(rd.approvedAt),
      detail: query.kind === "reconciliation" ? audit.blockers.filter((b) => b.id === `reconciliation-${r.id}`).map((b) => b.title).join(" ") : text(d.detail || d.reason),
      category: query.kind === "exceptions" ? typeLabels[d.type] || (/^[A-Z_]+$/.test(text(d.type)) ? "Otra excepción" : text(d.type)) : "",
      resolution: query.kind === "exceptions" ? text(d.resolution) : "",
      resolvedBy: query.kind === "exceptions" ? text(d.resolvedById) : "",
      resolvedAt: query.kind === "exceptions" ? text(d.resolvedAt) : ""
    };
  }).filter((r) => (!query.status || r.status === query.status) && (!query.search || [r.id, r.description, r.reference, r.sourceFile, r.detail, r.documents].join(" ").toLocaleLowerCase("es").includes(query.search.toLocaleLowerCase("es"))))
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  if (rows.length > 20000) throw new FinanceOperationError(422, "El reporte supera 20.000 registros. Filtra una cuenta o estado; no se exportó un resultado parcial.");
  const counts = Object.fromEntries(Object.entries(REPORT_STATUSES[query.kind]).map(([key, label]) => [key, { label, count: rows.filter((r) => r.status === key).length }]));
  const decimals = query.currency === "CLP" ? 0 : query.currency === "UF" ? 4 : 2;
  function sum(direction) {
    // Exceptions can refer to the same bank movement: never sum their amounts.
    if (query.kind !== "reconciliation") return null;
    const units = rows.filter((r) => r.status !== "EXCLUDED" && r.direction === direction && r.amount !== null).reduce((n, r) => n + BigInt(Math.round(r.amount * 10 ** decimals)), 0n);
    if (units > BigInt(Number.MAX_SAFE_INTEGER)) throw new FinanceOperationError(422, "Los totales exceden la precisión admitida. Acota el reporte por cuenta.");
    return Number(units) / 10 ** decimals;
  }
  const report = {
    title: query.kind === "reconciliation" ? "Reporte de conciliación bancaria" : "Reporte de excepciones",
    company: { id: tenantId, name: text(companyName) || tenantId }, query, rows,
    summary: { total: rows.length, counts, credits: sum("Abono"), debits: sum("Cargo"), undated: rows.filter((r) => !r.date).length, withoutAmount: rows.filter((r) => r.amount === null).length },
    // Full-scope blockers stay visible even when a status/search filter hides rows.
    issues: audit?.blockers || [],
    notices: ["Instantánea de los registros disponibles, no certificación de cierre ni de cobertura completa del período.", "Los filtros se aplican al detalle y sus totales. Las observaciones de evidencia abarcan toda la cuenta y período seleccionados.", "Los excluidos no suman abonos ni cargos. Los importes sin validar se informan, no se convierten en cero.", `${accountScope.filter((r) => r.recordType === "bank_movement" && !dateOf(r)).length} movimiento(s) de la cuenta y moneda sin fecha válida no se atribuyen a este período; consulta su revisión en Cartolas.`, ...(query.kind === "exceptions" ? ["Los montos de excepciones son referencias: pueden repetirse entre casos y no representan una deuda total.", "Los casos sin fecha operativa se incluyen para revisión, sin atribuirlos al mes seleccionado."] : []), ...(query.currency !== "CLP" ? ["Consulta en moneda original, sin conversión. La verificación operativa de conciliaciones admite actualmente CLP."] : [])]
  };
  const fingerprint = createHash("sha256").update(JSON.stringify(report)).digest("hex");
  return { ...report, fingerprint, generatedAt: now.toISOString() };
}

export async function readFinanceProcessReport(db, options) {
  processReportQuery(options.input);
  if (!options.tenantId) throw new FinanceOperationError(401, "Se requiere una empresa autenticada.");
  return db.$transaction(async (tx) => {
    const records = await findAllFinanceRecords(tx, { where: { tenantId: options.tenantId, recordType: { in: REPORT_TYPES } } });
    return buildFinanceProcessReport(records, options);
  }, { isolationLevel: "RepeatableRead", maxWait: 10000, timeout: 30000 });
}
