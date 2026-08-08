import assert from "node:assert/strict";
import test from "node:test";
import { INDUSTRY_TEMPLATES } from "../src/lib/industries.js";
import { filterModulesForIndustry, isModuleAllowedForIndustry } from "../src/lib/industry-module-access.js";

test("cada plantilla vertical solo publica capacidades compatibles con su rubro", () => {
  for (const template of Object.values(INDUSTRY_TEMPLATES)) {
    const declared = template.modules.map((item) => item.key);
    assert.deepEqual(
      filterModulesForIndustry(declared, template.code),
      [...new Set(declared)],
      `${template.code} contiene un m\u00f3dulo incompatible con su propia vertical`
    );
  }
});

test("un tenant no puede mezclar los flujos operativos de verticales distintas", () => {
  const realEstate = filterModulesForIndustry([
    "properties", "realty_clients", "finance_invoices", "gastronomy_operations", "vehicle_owners", "patients"
  ], "REAL_ESTATE");
  const finance = filterModulesForIndustry([
    "finance_invoices", "finance_bank_sync", "properties", "patients", "vehicle_owners"
  ], "FINANCE");
  const veterinary = filterModulesForIndustry([
    "veterinary_care", "patients", "exams", "dental_care", "health_care", "gastronomy_operations"
  ], "VETERINARY");

  assert.deepEqual(realEstate, ["properties", "realty_clients"]);
  assert.deepEqual(finance, ["finance_invoices", "finance_bank_sync"]);
  assert.deepEqual(veterinary, ["veterinary_care", "patients", "exams"]);
  assert.equal(isModuleAllowedForIndustry("finance_collections", "GASTRONOMY"), false);
});
