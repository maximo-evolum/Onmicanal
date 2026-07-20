import assert from "node:assert/strict";
import test from "node:test";
import { filterModulesForIndustry, isModuleAllowedForIndustry } from "../src/lib/industry-module-access.js";

test("módulos de vertical: inmobiliaria no recibe capacidades de taller ni pacientes", () => {
  const modules = filterModulesForIndustry([
    "inbox", "properties", "vehicle_owners", "patients", "realty_clients", "analytics"
  ], "INMOBILIARIA");

  assert.deepEqual(modules, ["inbox", "properties", "realty_clients", "analytics"]);
  assert.equal(isModuleAllowedForIndustry("vehicle_owners", "REAL_ESTATE"), false);
});

test("módulos clínicos se comparten solo entre salud, dental y veterinaria", () => {
  assert.equal(isModuleAllowedForIndustry("patients", "HEALTH"), true);
  assert.equal(isModuleAllowedForIndustry("patients", "DENTAL"), true);
  assert.equal(isModuleAllowedForIndustry("exams", "VETERINARY"), true);
  assert.equal(isModuleAllowedForIndustry("patients", "AUTOMOTIVE"), false);
});
