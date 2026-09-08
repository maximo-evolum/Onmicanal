import { prisma } from "../lib/db.js";
import { financeRecordData, getInvoiceFinancialState } from "./finance.service.js";
import { findAllFinanceRecords } from "./finance-integrity.service.js";
import { filterFinanceContext } from "./finance-context.service.js";
import { ACTIVE_IMPORT_STATUSES } from "./finance-import-jobs.service.js";

function numberOf(value) {
  const parsed = Number(String(value ?? "").replace(/[^0-9,.-]/g, "").replace(/\.(?=.*\.)/g, "").replace(",", "."));
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

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
  const data = financeRecordData(record);
  if (visited.has(record.id)) return "";
  visited.add(record.id);
  if (["finance_exception", "finance_reconciliation"].includes(record.recordType)) {
    const origin = recordsById.get(data.movementId);
    if (origin) return recordDate(origin, recordsById, visited);
    const movement = data.movement || {};
    const sourceDate = data.transactionDate || data.operatingDate || movement.transactionDate || movement.date;
    if (sourceDate) return dateText(sourceDate);
    // A missing source date is unknown, not the upload month.
    if (data.importBatchId || data.movementId) return "";
  }
  return dateText(data.transactionDate || data.date || data.issueDate || data.paymentDate || data.createdAt || record.createdAt);
}

function samePeriod(record, period, recordsById) {
  return recordDate(record, recordsById).startsWith(`${period}-`);
}

function isOpenException(record) {
  return !["RESOLVED", "CLOSED"].includes(String(record.status || "").toUpperCase());
}

function isUnreconciledMovement(record) {
  return !["MATCHED", "CLOSED"].includes(String(record.status || financeRecordData(record).status || "").toUpperCase());
}

function documentRow(record) {
  const data = financeRecordData(record);
  const invoice = record.recordType === "finance_invoice";
  const state = getInvoiceFinancialState({ ...record, data: { ...data, amount: data.amount ?? data.total, balance: data.balance } });
  const total = state.amount || numberOf(data.amount ?? data.total);
  const balance = state.balance;
  return {
    fecha: recordDate(record),
    tipo: invoice ? "Ingreso por facturación" : "Egreso por proveedor",
    documento: cleanText(data.invoiceNumber || data.documentNumber || record.title),
    contraparte: cleanText(invoice ? data.clientName : data.supplierName, "Sin contraparte"),
    categoria: cleanText(data.category, invoice ? "Ingresos por ventas" : "Gastos operacionales"),
    monto: total,
    saldo: balance,
    estado: state.status
  };
}

export function buildFinanceMonthlyClosePreview(records, period, now = new Date()) {
  if (!validFinancePeriod(period)) throw new Error("El período debe tener el formato AAAA-MM.");
  const recordsById = new Map(records.map((record) => [record.id, record]));
  const periodRecords = records.filter((record) => samePeriod(record, period, recordsById));
  const invoices = periodRecords.filter((record) => record.recordType === "finance_invoice");
  const payables = periodRecords.filter((record) => record.recordType === "finance_payable");
  const movements = periodRecords.filter((record) => record.recordType === "bank_movement");
  const reconciliations = periodRecords.filter((record) => record.recordType === "finance_reconciliation" && String(record.status || "").toUpperCase() === "APPROVED");
  const exceptions = records.filter((record) => record.recordType === "finance_exception" && isOpenException(record) && samePeriod(record, period, recordsById));
  const undatedExceptions = records.filter((record) => record.recordType === "finance_exception" && isOpenException(record) && !recordDate(record, recordsById));
  const issued = invoices.reduce((total, record) => total + documentRow(record).monto, 0);
  const collected = invoices.reduce((total, record) => {
    const row = documentRow(record);
    return total + Math.max(0, row.monto - row.saldo);
  }, 0);
  const registeredPayables = payables.reduce((total, record) => total + documentRow(record).monto, 0);
  const paidPayables = payables.reduce((total, record) => {
    const row = documentRow(record);
    return total + Math.max(0, row.monto - row.saldo);
  }, 0);
  const incoming = movements.reduce((total, record) => {
    const data = financeRecordData(record);
    return String(data.direction || "").toUpperCase() === "DEBIT" ? total : total + numberOf(data.amount);
  }, 0);
  const outgoing = movements.reduce((total, record) => {
    const data = financeRecordData(record);
    return String(data.direction || "").toUpperCase() === "DEBIT" ? total + numberOf(data.amount) : total;
  }, 0);
  const unreconciled = movements.filter(isUnreconciledMovement);
  const blockers = [
    ...(!periodRecords.length ? [{ type: "SIN_DATOS_DEL_PERIODO", title: "No hay datos que acrediten la actividad del período. Revisa las cartolas y documentos antes de cerrar.", id: `coverage-${period}` }] : []),
    ...undatedExceptions.map((record) => ({ type: "EXCEPCION_SIN_FECHA", title: `No se puede determinar el período de la excepción: ${record.title || record.id}`, id: record.id })),
    ...unreconciled.map((record) => ({ type: "MOVIMIENTO_SIN_CONCILIAR", title: record.title, id: record.id })),
    ...exceptions.map((record) => ({ type: "EXCEPCION_ABIERTA", title: record.title, id: record.id }))
  ];
  const rows = [
    ...invoices.map(documentRow),
    ...payables.map(documentRow),
    ...movements.map((record) => {
      const data = financeRecordData(record);
      const debit = String(data.direction || "").toUpperCase() === "DEBIT";
      return { fecha: recordDate(record), tipo: debit ? "Movimiento bancario - cargo" : "Movimiento bancario - abono", documento: cleanText(data.reference || record.title), contraparte: cleanText(data.counterparty || data.payerName, "Movimiento bancario"), categoria: debit ? "Egresos bancarios" : "Ingresos bancarios", monto: numberOf(data.amount), saldo: 0, estado: cleanText(record.status, "PENDIENTE") };
    })
  ].sort((left, right) => left.fecha.localeCompare(right.fecha));
  return {
    period,
    generatedAt: now.toISOString(),
    status: blockers.length ? "REQUIRES_REVIEW" : "READY_TO_CLOSE",
    metrics: {
      issued,
      collected,
      registeredPayables,
      paidPayables,
      incoming,
      outgoing,
      netBankFlow: incoming - outgoing,
      reconciliations: reconciliations.length,
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
    where: { tenantId, recordType: { in: ["finance_invoice", "finance_payable", "bank_movement", "finance_reconciliation", "finance_exception"] } },
  });
  // The current close is company-wide in CLP. Never sum foreign currencies as
  // pesos; account-specific and multicurrency closes need their own workflow.
  const jobs = await db.financeBankImportJob.findMany({ where: { tenantId, status: { in: ACTIVE_IMPORT_STATUSES } },
    select: { id: true, status: true, sourceFile: true, periodRange: true } });
  return addPendingImportsToClose(buildFinanceMonthlyClosePreview(filterFinanceContext(records, { period: "", accountKey: "", currency: "CLP" }), period), jobs);
}
