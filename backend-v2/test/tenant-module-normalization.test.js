import test from "node:test";
import assert from "node:assert/strict";
import { findIncompatibleTenantModules } from "../src/lib/tenant-module-normalization.js";

test("detecta módulos históricos de otra vertical sin tocar los módulos Core", () => {
  const incompatible = findIncompatibleTenantModules([
    {
      id: "gastro-1",
      name: "Restaurante",
      slug: "restaurante",
      industry: "GASTRONOMY",
      tenantModules: [
        { id: "properties-row", module: "properties", enabled: true, source: "PLAN" },
        { id: "agenda-row", module: "agenda", enabled: true, source: "PLAN" },
        { id: "disabled-row", module: "vehicle_owners", enabled: false, source: "MANUAL" }
      ]
    }
  ]);

  assert.deepEqual(incompatible.map((item) => item.module), ["properties"]);
  assert.equal(incompatible[0].tenantSlug, "restaurante");
});

test("mantiene módulos de la vertical correcta", () => {
  const incompatible = findIncompatibleTenantModules([
    {
      id: "finance-1",
      name: "Finanzas",
      slug: "finanzas",
      industry: "FINANCE",
      tenantModules: [
        { id: "finance-row", module: "finance_reconciliation", enabled: true, source: "MANUAL" },
        { id: "inbox-row", module: "inbox", enabled: true, source: "PLAN" }
      ]
    }
  ]);

  assert.deepEqual(incompatible, []);
});
