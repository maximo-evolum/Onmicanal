import { normalizeIndustryCode } from "./industries.js";
import { allowedIndustriesForVerticalModule, VERTICAL_PRODUCT_DEFINITIONS } from "./vertical-products.js";

// Estos son los únicos módulos cuyo significado depende de una vertical.
// El resto pertenece al Core EVOLUM y puede compartirse entre rubros.
const VERTICAL_MODULES = Object.freeze({
  ...Object.fromEntries(Object.entries(VERTICAL_PRODUCT_DEFINITIONS).map(([industry, product]) => [industry, product.modules])),
  AUTOMOTIVE: new Set(["vehicles", "vehicle_owners", "parts_inventory", "mechanic_assignments", "ready_notifications"]),
  GASTRONOMY: new Set(["gastronomy_operations", "shift_management"]),
  HEALTH: new Set(["health_care", "patients", "exams", "shift_management"]),
  DENTAL: new Set(["dental_care", "patients", "exams", "shift_management"]),
  VETERINARY: new Set(["veterinary_care", "patients", "exams", "shift_management"])
});

function normalizeModule(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, "_");
}

export function allowedIndustriesForModule(module) {
  const normalized = normalizeModule(module);
  const productIndustries = allowedIndustriesForVerticalModule(normalized);
  if (productIndustries) return productIndustries;
  const allowed = Object.entries(VERTICAL_MODULES)
    .filter(([, modules]) => modules.has(normalized))
    .map(([industry]) => industry);
  return allowed.length ? allowed : null;
}

export function isModuleAllowedForIndustry(module, industry) {
  const allowed = allowedIndustriesForModule(module);
  return !allowed || allowed.includes(normalizeIndustryCode(industry));
}

export function filterModulesForIndustry(modules = [], industry) {
  return [...new Set(modules.map(normalizeModule).filter(Boolean))]
    .filter((module) => isModuleAllowedForIndustry(module, industry));
}
