import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { assertWorkflowFinancialSafety } from "../src/services/finance-workflow-guard.service.js";

for (const recordType of ["finance_invoice", "finance_payable", "finance_monthly_close", "finance_exception", "bank_movement", "bank_statement"]) {
  test(`workflow no escribe directamente ${recordType}`, () => {
    for (const action of [{ type: "set_status", status: "PAID" }, { type: "set_field", field: "balance", value: 0 }, { type: "create_record", recordType }]) {
      assert.throws(() => assertWorkflowFinancialSafety([action], { recordType }), (error) => error.status === 409);
    }
  });
}
test("prevalida también una acción financiera posterior a una notificación", () => {
  assert.throws(() => assertWorkflowFinancialSafety([{ type: "create_notification" }, { type: "create_record", recordType: " FINANCE_INVOICE " }], null));
});
test("mantiene notificaciones financieras y escrituras no financieras", () => {
  assert.doesNotThrow(() => assertWorkflowFinancialSafety([{ type: "create_notification" }], { recordType: "finance_invoice" }));
  assert.doesNotThrow(() => assertWorkflowFinancialSafety([{ type: "set_field" }, { type: "create_record", recordType: "property" }], { recordType: "property" }));
});
test("la ruta llama al control antes del bucle de acciones", () => {
  const source = readFileSync(new URL("../src/routes/workflows.routes.js", import.meta.url), "utf8").split("async function applyWorkflowActions")[1];
  assert.ok(source.indexOf("assertWorkflowFinancialSafety(actions, targetRecord)") < source.indexOf("for (const action of actions)"));
});
