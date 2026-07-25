import assert from "node:assert/strict";
import test from "node:test";
import { filterModulesForIndustry, isModuleAllowedForIndustry } from "../src/lib/industry-module-access.js";

test("Finance OS se mantiene aislado de las verticales operativas", () => {
  const modules = filterModulesForIndustry([
    "analytics", "finance_invoices", "finance_reconciliation", "properties", "patients"
  ], "FINANCE");

  assert.deepEqual(modules, ["analytics", "finance_invoices", "finance_reconciliation"]);
  assert.equal(isModuleAllowedForIndustry("finance_collections", "REAL_ESTATE"), false);
  assert.equal(isModuleAllowedForIndustry("finance_collections", "FINANCE"), true);
});
