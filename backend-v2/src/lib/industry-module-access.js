import { MODULES } from "./modules.js";
import { normalizeIndustryCode } from "./industries.js";

// Estos son los únicos módulos cuyo significado depende de una vertical.
// El resto pertenece al Core EVOLUM y puede compartirse entre rubros.
const VERTICAL_MODULES = Object.freeze({
  REAL_ESTATE: new Set([
    MODULES.PROPERTIES,
    MODULES.PROPERTY_ASSIGNMENTS,
    MODULES.REALTY_LOADS,
    MODULES.REALTY_ACTIVITY,
    MODULES.BROKER_PORTAL,
    MODULES.BROKERS,
    MODULES.REALTY_CLIENTS
  ]),
  AUTOMOTIVE: new Set([
    MODULES.VEHICLES,
    MODULES.VEHICLE_OWNERS,
    MODULES.PARTS_INVENTORY,
    MODULES.MECHANIC_ASSIGNMENTS,
    MODULES.READY_NOTIFICATIONS
  ]),
  HEALTH: new Set([MODULES.PATIENTS, MODULES.EXAMS]),
  DENTAL: new Set([MODULES.PATIENTS, MODULES.EXAMS]),
  VETERINARY: new Set([MODULES.PATIENTS, MODULES.EXAMS]),
  FINANCE: new Set([
    MODULES.FINANCE_INVOICES,
    MODULES.FINANCE_BANK_SYNC,
    MODULES.FINANCE_RECONCILIATION,
    MODULES.FINANCE_EXCEPTIONS,
    MODULES.FINANCE_COLLECTIONS,
    MODULES.FINANCE_ANALYTICS
  ])
});

function normalizeModule(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, "_");
}

export function allowedIndustriesForModule(module) {
  const normalized = normalizeModule(module);
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
