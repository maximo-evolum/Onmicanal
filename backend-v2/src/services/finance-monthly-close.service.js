import { prisma } from "../lib/db.js";
import { financeRecordData, getInvoiceFinancialState } from "./finance.service.js";
import { findAllFinanceRecords } from "./finance-integrity.service.js";
import { filterFinanceContext } from "./finance-context.service.js";
import { ACTIVE_IMPORT_STATUSES } from "./finance-import-jobs.service.js";
import { classifyFinanceMovement } from "./finance-movement-classification.service.js";
import { auditCloseReconciliations } from "./finance-close-reconciliation.service.js";
import { financeDocumentDate, financeParty, summarizeFinanceDocuments } from "./finance-document-values.service.js";
import { buildPeriodCoverage, applyPeriodCoverage } from "./finance-period-coverage.service.js";
import { customerCreditsForClose } from "./finance-customer-credit-ledger.service.js";

function cleanText(value, fallback = "") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function dateText(value) {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? "" : value.toISOString().slice(0, 10);
  return cleanText(value).slice(0, 10);
}

export function validFinancePeriod(period) {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(String(period || ""));
}

function recordDate(record, recordsById = new Map(), visited = new Set()) {
  if (record.recordType === "finance_credit_application") return dateText(financeRecordData(record).applicationDate);
  if (["finance_invoice", "finance_payable"].includes(record.recordType)) return financeDocumentDate(record);
  const data = financeRecordData(record);
  if (visited.has(record.id)) return "";
  visited.add(record.id);
  if (["finance_exception", "finance_reconciliation", "finance_invoice_receipt"].includes(record.recordType)) {
    const origin = recordsById.get(data.movementId);
    if (origin?.recordType === "bank_movement") return recordDate(origin, recordsById, visited);
    const movement = data.movement || {};
    const sourceDate = data.transactionDate || data.operatingDate || data.paymentDate || movement.transactionDate || movement.date;
    if (sourceDate) return dateText(sourceDate);
    // A missing source date is unknown, not the upload month.
    if (data.importBatchId || data.movementId || record.recordType === "finance_reconciliation" || record.recordType === "finance_invoice_receipt") return "";
  }
  return dateText(data.transactionDate || data.date || data.issueDate || data.paymentDate || data.createdAt || record.createdAt);
}

function samePeriod(record, period, recordsById) {
  return recordDate(record, recordsById).startsWith(`${period}-`);
}

function isOpenException(record) {
  return !["RESOLVED", "CLOSED"].includes(String(record.status || "").toUpperCase());
}

function documentRow(record, now) {
  const data = financeRecordData(record);
  const party = financeParty(record), invoice = party.side === "CUSTOMER";
  const state = getInvoiceFinancialState(record, now);
  const total = state.amount;
  const balance = state.balance;
  return {
    fecha: recordDate(record),
    tipo: invoice ? "Ingreso por facturación" : "Egreso por proveedor",
    documento: cleanText(data.invoiceNumber || data.documentNumber || record.title),
    contraparte: party.name,
    categoria: cleanText(data.category, invoice ? "Ingresos por ventas" : "Gastos operacionales"),
    monto: total,
    saldo: balance,
    estado: state.status
  };
}

export function buildFinanceMonthlyClosePreview(records, period, now = new Date(), evidenceRecords = records) {
  if (!validFinancePeriod(period)) throw new Error("El período debe tener el formato AAAA-MM.");
  const recordsById = new Map(evidenceRecords.map((record) => [record.id, record]));
  const periodRecords = records.filter((record) => samePeriod(record, period, recordsById));
  const documents = summarizeFinanceDocuments(periodRecords, now);
  const invoices = documents.entries.filter((e) => e.side === "CUSTOMER" && e.state.included).map((e) => e.record);
  const payables = documents.entries.filter((e) => e.side === "SUPPLIER" && e.state.included).map((e) => e.record);
  const audit = auditCloseReconciliations(evidenceRecords, periodRecords.filter((record) => record.recordType === "bank_movement"), period, (record) => recordDate(record, recordsById), records);
  const movements = audit.movements;
  const exceptions = records.filter((record) => record.recordType === "finance_exception" && isOpenException(record) && samePeriod(record, period, recordsById));
  const undatedExceptions = records.filter((record) => record.recordType === "finance_exception" && isOpenException(record) && !recordDate(record, recordsById));
  const issued = documents.customers.issued, collected = documents.customers.paid;
  const registeredPayables = documents.suppliers.issued, paidPayables = documents.suppliers.paid;
  const classifiedMovements = movements.map((record) => ({ record, ...classifyFinanceMovement(financeRecordData(record)) }));
  const incoming = classifiedMovements.reduce((total, item) => item.direction === "CREDIT" && item.amount !== null ? total + item.amount : total, 0);
  const outgoing = classifiedMovements.reduce((total, item) => item.direction === "DEBIT" && item.amount !== null ? total + item.amount : total, 0);
  const unclassified = classifiedMovements.filter((item) => item.amount === null || item.direction === "UNKNOWN");
  const unreconciled = audit.unreconciled;
  const customerCredits = customerCreditsForClose(evidenceRecords, period);
  const blockers = [
    ...customerCredits.blockers,
    ...documents.issues.map((item) => ({ type: "DOCUMENTO_SALDO_INCONSISTENTE", id: `document-${item.id}`, title: item.title })),
    ...audit.blockers,
    ...unclassified.map(({ record, amount }) => ({ type: "MOVIMIENTO_CLASIFICACION_PENDIENTE", title: `${amount === null ? "Monto inválido o ausente" : "Tipo abono/cargo sin identificar"}: ${record.title || record.id}. Revisa el movimiento antes de cerrar.`, id: `classification-${record.id}` })),
    ...(!periodRecords.length ? [{ type: "SIN_DATOS_DEL_PERIODO", title: "No hay datos que acrediten la actividad del período. Revisa las cartolas y documentos antes de cerrar.", id: `coverage-${period}` }] : []),
    ...undatedExceptions.map((record) => ({ type: "EXCEPCION_SIN_FECHA", title: `No se puede determinar el período de la excepción: ${record.title || record.id}`, id: record.id })),
    ...unreconciled.filter((record) => !audit.inconsistentIds.has(record.id)).map((record) => ({ type: "MOVIMIENTO_SIN_CONCILIAR", title: record.title || record.id, id: record.id })),
    ...exceptions.map((record) => ({ type: "EXCEPCION_ABIERTA", title: record.title, id: record.id }))
  ];
  const rows = [
    ...invoices.map((record) => documentRow(record, now)),
    ...payables.map((record) => documentRow(record, now)),
    ...classifiedMovements.map(({ record, amount, direction }) => {
      const data = financeRecordData(record);
      const debit = direction === "DEBIT", unknown = direction === "UNKNOWN";
      return { fecha: recordDate(record), tipo: unknown ? "Movimiento bancario - por identificar" : debit ? "Movimiento bancario - cargo" : "Movimiento bancario - abono", documento: cleanText(data.reference || record.title), contraparte: cleanText(data.counterparty || data.payerName, "Movimiento bancario"), categoria: unknown ? "Sin clasificación" : debit ? "Egresos bancarios" : "Ingresos bancarios", monto: amount, saldo: 0, estado: amount === null || unknown || audit.inconsistentIds.has(record.id) ? "REQUIRES_REVIEW" : cleanText(record.status, "PENDIENTE") };
    })
  ].sort((left, right) => left.fecha.localeCompare(right.fecha));
  return {
    period,
    generatedAt: now.toISOString(),
    status: blockers.length ? "REQUIRES_REVIEW" : "READY_TO_CLOSE",
    documentSummary: { customers: documents.customers, suppliers: documents.suppliers, excluded: documents.excluded },
    metrics: {
      issued,
      customerCreditAvailable: customerCredits.availableAmount,
      collected,
      registeredPayables,
      paidPayables,
      incoming,
      outgoing,
      netBankFlow: incoming - outgoing,
      unclassifiedMovements: unclassified.length,
      reconciliations: audit.validIds.size,
      inconsistentReconciliations: audit.inconsistentMovements,
      excludedMovements: audit.excludedMovements,
      unreconciledMovements: unreconciled.length,
      openExceptions: exceptions.length
    },
    blockers,
    rows
  };
}

export function addPendingImportsToClose(preview, jobs) {
  const pending = jobs.filter((job) => {
    if (!ACTIVE_IMPORT_STATUSES.includes(job.status)) return false;
    // A failed/interrupted analysis has no trustworthy period: resolve it first.
    const range = job.status === "READY" ? job.periodRange : null;
    return !range?.from || !range?.to || (range.from.slice(0, 7) <= preview.period && range.to.slice(0, 7) >= preview.period);
  });
  if (!pending.length) return preview;
  return { ...preview, status: "REQUIRES_REVIEW", blockers: [...preview.blockers,
    ...pending.map((job) => ({ type: "IMPORTACION_PENDIENTE", id: job.id, title: `Incorpora o cancela la carga pendiente: ${job.sourceFile}` }))] };
}

export async function getFinanceMonthlyClosePreview({ tenantId, period, db = prisma }) {
  const records = await findAllFinanceRecords(db, {
    where: { tenantId, recordType: { in: ["finance_invoice", "finance_payable", "bank_statement", "bank_movement", "finance_reconciliation", "finance_invoice_receipt", "finance_exception", "finance_period_coverage", "finance_period_reopening", "finance_open_banking_consent", "finance_customer_credit", "finance_credit_application"] } },
  });
  // The current close is company-wide in CLP. Never sum foreign currencies as
  // pesos; account-specific and multicurrency closes need their own workflow.
  const jobs = await db.financeBankImportJob.findMany({ where: { tenantId, status: { in: ACTIVE_IMPORT_STATUSES } },
    select: { id: true, status: true, sourceFile: true, periodRange: true } });
  const channels = await db.tenantChannelConfig.findMany({ where: { tenantId, channel: { in: ["finance_bank_statements", "finance_open_banking"] } }, select: { metadata: true } });
  const accounts = channels.flatMap((c) => Array.isArray(c.metadata?.bankAccounts) ? c.metadata.bankAccounts : []).map((a) => ({ bankKey: a.bankKey, bank: a.bank, accountAlias: a.accountAlias || a.alias, accountLast4: a.accountLast4, accountType: a.accountType }));
  // Keep foreign-currency evidence available for detecting invalid links, but
  // never include its amounts or unrelated approvals in this CLP close.
  const now = new Date();
  const preview = addPendingImportsToClose(buildFinanceMonthlyClosePreview(filterFinanceContext(records.filter((r) => !["bank_statement", "finance_period_coverage", "finance_period_reopening", "finance_open_banking_consent"].includes(r.recordType)), { period: "", accountKey: "", currency: "CLP" }), period, now, records), jobs);
  return applyPeriodCoverage(preview, buildPeriodCoverage({ tenantId, period, records, jobs, accounts, now }));
}
