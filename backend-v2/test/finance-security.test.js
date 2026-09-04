import test from "node:test";
import assert from "node:assert/strict";
import {
  canPerformFinanceAction,
  canMutateFinanceRecord,
  FINANCE_ACTIONS,
  financeActionForRecordMutation,
  financeRoleCapabilities
} from "../src/services/finance-security.service.js";

test("Finance OS separa consulta, preparación y aprobación financiera", () => {
  assert.equal(canPerformFinanceAction("VIEWER", FINANCE_ACTIONS.VIEW), true);
  assert.equal(canPerformFinanceAction("VIEWER", FINANCE_ACTIONS.PREPARE), false);
  assert.equal(canPerformFinanceAction("AGENT", FINANCE_ACTIONS.PREPARE), true);
  assert.equal(canPerformFinanceAction("AGENT", FINANCE_ACTIONS.APPROVE_RECONCILIATION), false);
  assert.equal(canPerformFinanceAction("SELLER", FINANCE_ACTIONS.REGISTER), false);
  assert.equal(canPerformFinanceAction("ADMIN", FINANCE_ACTIONS.IMPORT_HISTORY), true);
  assert.equal(canPerformFinanceAction("SUPER_ADMIN", FINANCE_ACTIONS.CLOSE_PERIOD), true);
});

test("la matriz de capacidades no entrega aprobación a roles operativos", () => {
  assert.deepEqual(financeRoleCapabilities("AGENT"), ["VIEW", "PREPARE"]);
  assert.ok(financeRoleCapabilities("OWNER").includes(FINANCE_ACTIONS.APPROVE_RECONCILIATION));
});

test("la API genérica no permite saltar los permisos financieros por tipo de registro", () => {
  assert.equal(financeActionForRecordMutation("finance_invoice"), FINANCE_ACTIONS.REGISTER);
  assert.equal(financeActionForRecordMutation("bank_statement"), FINANCE_ACTIONS.IMPORT_HISTORY);
  assert.equal(financeActionForRecordMutation("finance_reconciliation"), FINANCE_ACTIONS.APPROVE_RECONCILIATION);
  assert.equal(financeActionForRecordMutation("finance_future_sensitive_type"), FINANCE_ACTIONS.CONFIGURE);
  assert.equal(canMutateFinanceRecord("AGENT", "finance_invoice"), false);
  assert.equal(canMutateFinanceRecord("SELLER", "bank_movement"), false);
  assert.equal(canMutateFinanceRecord("AGENT", "finance_exception"), true);
  assert.equal(canMutateFinanceRecord("ADMIN", "finance_invoice"), true);
  assert.equal(canMutateFinanceRecord("VIEWER", "finance_collection_case"), false);
});
