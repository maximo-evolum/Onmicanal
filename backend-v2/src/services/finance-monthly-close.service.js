import { prisma } from "../lib/db.js";
import { financeRecordData, getInvoiceFinancialState } from "./finance.service.js";

function numberOf(value) {
  const parsed = Number(String(value ?? "").replace(/[^0-9,.-]/g, "").replace(/\.(?=.*\.)/g, "").replace(",", "."));
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

function cleanText(value, fallback = "") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

export function validFinancePeriod(period) {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(String(period || ""));
}

function recordDate(record) {
  const data = financeRecordData(record);
  return cleanText(data.transactionDate || data.date || data.issueDate || data.paymentDate || data.createdAt || record.createdAt).slice(0, 10);
}

function samePeriod(record, period) {
  return recordDate(record).startsWith(`${period}-`);
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
  const periodRecords = records.filter((record) => samePeriod(record, period));
  const invoices = periodRecords.filter((record) => record.recordType === "finance_invoice");
  const payables = periodRecords.filter((record) => record.recordType === "finance_payable");
  const movements = periodRecords.filter((record) => record.recordType === "bank_movement");
  const reconciliations = periodRecords.filter((record) => record.recordType === "finance_reconciliation" && String(record.status || "").toUpperCase() === "APPROVED");
  const exceptions = records.filter((record) => record.recordType === "finance_exception" && isOpenException(record) && samePeriod(record, period));
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

export async function getFinanceMonthlyClosePreview({ tenantId, period }) {
  const records = await prisma.industryRecord.findMany({
    where: { tenantId, recordType: { in: ["finance_invoice", "finance_payable", "bank_movement", "finance_reconciliation", "finance_exception"] } },
    orderBy: { createdAt: "desc" },
    take: 10000
  });
  return buildFinanceMonthlyClosePreview(records, period);
}
