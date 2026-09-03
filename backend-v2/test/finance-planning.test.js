import test from "node:test";
import assert from "node:assert/strict";
import { buildFinancePlanning, validPlanningPeriod } from "../src/services/finance-planning.service.js";

const base = { tenantId: "tenant-demo", createdAt: "2026-09-01T12:00:00.000Z" };

test("compara presupuesto con cobros y pagos registrados", () => {
  const planning = buildFinancePlanning([
    { ...base, id: "budget-1", recordType: "finance_budget", status: "ACTIVE", data: { period: "2026-09", category: "Ingresos por ventas", plannedIncome: 2000000, plannedExpense: 0 } },
    { ...base, id: "budget-2", recordType: "finance_budget", status: "ACTIVE", data: { period: "2026-09", category: "Honorarios", plannedIncome: 0, plannedExpense: 500000 } },
    { ...base, id: "invoice", recordType: "finance_invoice", status: "PARTIAL", data: { issueDate: "2026-09-03", dueDate: "2026-10-05", category: "Ingresos por ventas", amount: 1500000, balance: 400000 } },
    { ...base, id: "payable", recordType: "finance_payable", status: "PARTIAL", data: { issueDate: "2026-09-04", dueDate: "2026-10-10", category: "Honorarios", amount: 350000, balance: 50000 } }
  ], "2026-09");

  assert.equal(planning.categories.length, 2);
  assert.deepEqual(planning.totals, { plannedIncome: 2000000, plannedExpense: 500000, actualIncome: 1100000, actualExpense: 300000 });
  assert.equal(planning.cashFlow[1].period, "2026-10");
  assert.equal(planning.cashFlow[1].expectedIncome, 400000);
  assert.equal(planning.cashFlow[1].expectedExpense, 50000);
});

test("valida el período de planificación", () => {
  assert.equal(validPlanningPeriod("2026-09"), true);
  assert.equal(validPlanningPeriod("2026-00"), false);
  assert.throws(() => buildFinancePlanning([], "septiembre"), /AAAA-MM/);
});
