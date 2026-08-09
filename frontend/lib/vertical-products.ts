import type { ModuleAccessKey } from "@/lib/module-access";

/**
 * Catálogo de productos verticales de EVOLUM.
 * Cada producto tiene una única puerta de entrada en el menú EV y concentra
 * su navegación dentro de su propio workspace.
 */
export type VerticalProductCode = "REAL_ESTATE" | "FINANCE";

export type VerticalProductDefinition = {
  code: VerticalProductCode;
  label: string;
  href: string;
  entryModule: ModuleAccessKey;
  gatewayModules: ModuleAccessKey[];
  description: string;
  sharedModuleKeys: ModuleAccessKey[];
};

export const VERTICAL_PRODUCTS: Record<VerticalProductCode, VerticalProductDefinition> = {
  REAL_ESTATE: {
    code: "REAL_ESTATE",
    label: "Inmobiliaria",
    href: "/realty",
    entryModule: "properties",
    gatewayModules: [
      "realty_loads", "properties", "realty_activity", "broker_portal",
      "brokers", "realty_clients", "property_assignments"
    ],
    description: "Propiedades, cargas, corredores, visitas y compradores",
    sharedModuleKeys: ["integrations", "onboarding", "saas"]
  },
  FINANCE: {
    code: "FINANCE",
    label: "Finanzas",
    href: "/finance",
    entryModule: "finance_analytics",
    gatewayModules: [
      "finance_invoices", "finance_bank_sync", "finance_reconciliation",
      "finance_exceptions", "finance_collections", "finance_analytics"
    ],
    description: "Facturas, cartolas, conciliación y cobranza IA",
    sharedModuleKeys: ["integrations", "onboarding", "saas"]
  }
};

export function normalizeVerticalProductCode(industry?: string | null): VerticalProductCode | null {
  const value = String(industry || "").trim().toUpperCase();
  if (value.includes("REAL_ESTATE") || value.includes("INMOBIL") || value.includes("CORRETAJE")) return "REAL_ESTATE";
  if (value.includes("FINANCE") || value.includes("FINANZ") || value.includes("CONTABLE") || value.includes("CONTABIL")) return "FINANCE";
  return null;
}

export function getVerticalProduct(industry?: string | null) {
  const code = normalizeVerticalProductCode(industry);
  return code ? VERTICAL_PRODUCTS[code] : null;
}
