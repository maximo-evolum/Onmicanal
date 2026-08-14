import { MODULES } from "./modules.js";
import { normalizeIndustryCode } from "./industries.js";

/**
 * Contrato de producto vertical.
 *
 * La operación se agrupa por producto, no por una mezcla de módulos del CRM.
 * Este contrato es consumido por la autorización y sirve como única fuente de
 * verdad cuando un endpoint nuevo necesite pertenecer a una vertical.
 */
export const VERTICAL_PRODUCT_DEFINITIONS = Object.freeze({
  REAL_ESTATE: Object.freeze({
    code: "REAL_ESTATE",
    label: "Inmobiliaria",
    workspace: "/realty",
    modules: new Set([
      MODULES.PROPERTIES,
      MODULES.PROPERTY_ASSIGNMENTS,
      MODULES.REALTY_LOADS,
      MODULES.REALTY_ACTIVITY,
      MODULES.BROKER_PORTAL,
      MODULES.BROKERS,
      MODULES.REALTY_CLIENTS
    ]),
    recordTypes: new Set([
      "property", "property_import", "property_training", "owner",
      "broker_profile", "seller_assignment", "visit", "realty_alert",
      "broker_followup", "customer"
    ])
  }),
  FINANCE: Object.freeze({
    code: "FINANCE",
    label: "Finanzas",
    workspace: "/finance",
    modules: new Set([
      MODULES.FINANCE_INVOICES,
      MODULES.FINANCE_BANK_SYNC,
      MODULES.FINANCE_RECONCILIATION,
      MODULES.FINANCE_EXCEPTIONS,
      MODULES.FINANCE_COLLECTIONS,
      MODULES.FINANCE_ANALYTICS,
      MODULES.FINANCE_PAYABLES,
      MODULES.FINANCE_MIGRATION
    ]),
    recordTypes: new Set([
      "finance_invoice", "bank_statement", "bank_movement",
      "finance_reconciliation", "finance_exception", "finance_collection_case",
      "finance_payable", "finance_payable_payment", "finance_migration_batch"
    ])
  })
});

export function getVerticalProductForIndustry(industry) {
  return VERTICAL_PRODUCT_DEFINITIONS[normalizeIndustryCode(industry)] || null;
}

export function allowedIndustriesForVerticalModule(module) {
  const normalized = String(module || "").trim().toLowerCase().replace(/\s+/g, "_");
  const industries = Object.entries(VERTICAL_PRODUCT_DEFINITIONS)
    .filter(([, product]) => product.modules.has(normalized))
    .map(([industry]) => industry);
  return industries.length ? industries : null;
}
