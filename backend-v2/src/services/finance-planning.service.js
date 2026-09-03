import { prisma } from "../lib/db.js";
import { financeRecordData, getInvoiceFinancialState } from "./finance.service.js";

function amountOf(value) {
  const parsed = Number(String(value ?? "").replace(/[^0-9,.-]/g, "").replace(/\.(?=.*\.)/g, "").replace(",", "."));
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

function text(value, fallback = "") {
  const normalized = String(value ?? "").trim();
  return normalized || fallback;
}

export function validPlanningPeriod(value) {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(String(value || ""));
}

function recordDay(record, fields = []) {
  const data = financeRecordData(record);
  for (const field of fields) {
    const value = text(data[field]);
    if (value) return value.slice(0, 10);
  }
  return String(record.createdAt || "").slice(0, 10);
}

function plusMonths(period, offset) {
  const [year, month] = period.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1 + offset, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function payableState(record) {
  const data = financeRecordData(record);
  const amount = amountOf(data.amount ?? data.total);
  const balance = data.balance === undefined || data.balance === null || data.balance === "" ? amount : Math.min(amount, amountOf(data.balance));
  return { amount, balance, paid: Math.max(0, amount - balance) };
}

export function buildFinancePlanning(records, period) {
  if (!validPlanningPeriod(period)) throw new Error("El período debe tener el formato AAAA-MM.");
  const budgets = records.filter((record) => record.recordType === "finance_budget" && text(financeRecordData(record).period) === period);
  const documents = records.filter((record) => ["finance_invoice", "finance_payable"].includes(record.recordType));
  const categoryMap = new Map();
  for (const budget of budgets) {
    const data = financeRecordData(budget);
    const category = text(data.category, "Sin categoría");
    categoryMap.set(category, {
      id: budget.id,
      category,
      plannedIncome: amountOf(data.plannedIncome),
      plannedExpense: amountOf(data.plannedExpense),
      actualIncome: 0,
      actualExpense: 0
    });
  }
  for (const record of documents) {
    const data = financeRecordData(record);
    const isInvoice = record.recordType === "finance_invoice";
    const category = text(data.category, isInvoice ? "Ingresos por ventas" : "Gastos operacionales");
    if (!categoryMap.has(category)) categoryMap.set(category, { id: null, category, plannedIncome: 0, plannedExpense: 0, actualIncome: 0, actualExpense: 0 });
    const item = categoryMap.get(category);
    const issueDate = recordDay(record, ["issueDate", "date"]);
    if (!issueDate.startsWith(`${period}-`)) continue;
    if (isInvoice) {
      const state = getInvoiceFinancialState(record);
      item.actualIncome += Math.max(0, state.amount - state.balance);
    } else {
      item.actualExpense += payableState(record).paid;
    }
  }
  const cashFlow = [0, 1, 2].map((offset) => {
    const bucketPeriod = plusMonths(period, offset);
    let expectedIncome = 0;
    let expectedExpense = 0;
    for (const record of documents) {
      const isInvoice = record.recordType === "finance_invoice";
      const dueDate = recordDay(record, ["dueDate", "issueDate", "date"]);
      if (!dueDate.startsWith(`${bucketPeriod}-`)) continue;
      if (isInvoice) expectedIncome += getInvoiceFinancialState(record).balance;
      else expectedExpense += payableState(record).balance;
    }
    return { period: bucketPeriod, expectedIncome, expectedExpense, net: expectedIncome - expectedExpense };
  });
  const categories = [...categoryMap.values()].sort((left, right) => left.category.localeCompare(right.category, "es"));
  return {
    period,
    categories: categories.map((item) => ({ ...item, incomeVariance: item.actualIncome - item.plannedIncome, expenseVariance: item.actualExpense - item.plannedExpense })),
    totals: categories.reduce((total, item) => ({ plannedIncome: total.plannedIncome + item.plannedIncome, plannedExpense: total.plannedExpense + item.plannedExpense, actualIncome: total.actualIncome + item.actualIncome, actualExpense: total.actualExpense + item.actualExpense }), { plannedIncome: 0, plannedExpense: 0, actualIncome: 0, actualExpense: 0 }),
    cashFlow
  };
}

export async function getFinancePlanning({ tenantId, period }) {
  const records = await prisma.industryRecord.findMany({
    where: { tenantId, recordType: { in: ["finance_budget", "finance_invoice", "finance_payable"] } },
    orderBy: { createdAt: "desc" }, take: 10000
  });
  return buildFinancePlanning(records, period);
}
