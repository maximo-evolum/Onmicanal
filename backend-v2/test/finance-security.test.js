import test from "node:test";
import assert from "node:assert/strict";
import { canPerformFinanceAction, FINANCE_ACTIONS, financeRoleCapabilities } from "../src/services/finance-security.service.js";

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
