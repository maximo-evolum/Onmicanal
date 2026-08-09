import assert from "node:assert/strict";
import test from "node:test";
import { filterModulesForIndustry, isModuleAllowedForIndustry } from "../src/lib/industry-module-access.js";
import { createRequireModule } from "../src/middleware/tenant-access.js";
import { getVerticalProductForIndustry } from "../src/lib/vertical-products.js";

test("la API bloquea un módulo vertical aunque haya quedado habilitado por error en el plan", async () => {
  const guard = createRequireModule("properties", {
    hasTenantModule: async () => true,
    ensureTenantModuleEligibility: async () => true,
    getTenantModules: async () => ["properties", "inbox"],
    findTenant: async () => ({ id: "tenant-gastro", industry: "GASTRONOMY" })
  });
  const req = { tenantId: "tenant-gastro", user: { id: "u-1", tenantId: "tenant-gastro", role: "ADMIN" } };
  const result = { status: null, body: null };
  const res = {
    status(code) { result.status = code; return this; },
    json(body) { result.body = body; return this; }
  };
  let calledNext = false;

  await guard(req, res, () => { calledNext = true; });

  assert.equal(calledNext, false);
  assert.equal(result.status, 403);
  assert.equal(result.body.module, "properties");
  assert.equal(result.body.industry, "GASTRONOMY");
});

test("super administrador conserva el acceso global de plataforma", async () => {
  const guard = createRequireModule("properties", {
    hasTenantModule: async () => false,
    ensureTenantModuleEligibility: async () => false,
    getTenantModules: async () => [],
    findTenant: async () => ({ id: "tenant-gastro", industry: "GASTRONOMY" })
  });
  const req = { tenantId: "tenant-gastro", user: { id: "u-1", tenantId: "tenant-gastro", role: "SUPER_ADMIN" } };
  let calledNext = false;

  await guard(req, {}, () => { calledNext = true; });

  assert.equal(calledNext, true);
});

test("módulos de vertical: inmobiliaria no recibe capacidades de taller ni pacientes", () => {
  const modules = filterModulesForIndustry([
    "inbox", "properties", "vehicle_owners", "patients", "realty_clients", "analytics"
  ], "INMOBILIARIA");

  assert.deepEqual(modules, ["inbox", "properties", "realty_clients", "analytics"]);
  assert.equal(isModuleAllowedForIndustry("vehicle_owners", "REAL_ESTATE"), false);
});

test("Inmobiliaria y Finanzas exponen contratos de producto separados", () => {
  const realty = getVerticalProductForIndustry("INMOBILIARIA");
  const finance = getVerticalProductForIndustry("CONTABILIDAD");

  assert.equal(realty?.workspace, "/realty");
  assert.equal(realty?.modules.has("properties"), true);
  assert.equal(realty?.modules.has("finance_invoices"), false);

  assert.equal(finance?.workspace, "/finance");
  assert.equal(finance?.modules.has("finance_invoices"), true);
  assert.equal(finance?.modules.has("properties"), false);
});

test("módulos clínicos se comparten solo entre salud, dental y veterinaria", () => {
  assert.equal(isModuleAllowedForIndustry("patients", "HEALTH"), true);
  assert.equal(isModuleAllowedForIndustry("patients", "DENTAL"), true);
  assert.equal(isModuleAllowedForIndustry("exams", "VETERINARY"), true);
  assert.equal(isModuleAllowedForIndustry("patients", "AUTOMOTIVE"), false);
});

test("operaciones especializadas no se mezclan entre gastronomÃ­a y clÃ­nicas", () => {
  assert.equal(isModuleAllowedForIndustry("gastronomy_operations", "GASTRONOMY"), true);
  assert.equal(isModuleAllowedForIndustry("gastronomy_operations", "DENTAL"), false);
  assert.equal(isModuleAllowedForIndustry("dental_care", "DENTAL"), true);
  assert.equal(isModuleAllowedForIndustry("dental_care", "HEALTH"), false);
  assert.equal(isModuleAllowedForIndustry("health_care", "HEALTH"), true);
  assert.equal(isModuleAllowedForIndustry("health_care", "VETERINARY"), false);
  assert.equal(isModuleAllowedForIndustry("veterinary_care", "VETERINARY"), true);
  assert.equal(isModuleAllowedForIndustry("veterinary_care", "DENTAL"), false);
});
