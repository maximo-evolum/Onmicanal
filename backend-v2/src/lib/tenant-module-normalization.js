import { isModuleAllowedForIndustry } from "./industry-module-access.js";

function normalizeModule(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, "_");
}

/**
 * Identifica filas históricas que no pueden operar para el rubro actual del
 * tenant. No modifica datos: el script de mantenimiento decide si aplicar el
 * cambio y deja las filas deshabilitadas, nunca eliminadas.
 */
export function findIncompatibleTenantModules(tenants = []) {
  return tenants.flatMap((tenant) => (tenant.tenantModules || [])
    .filter((entry) => entry.enabled)
    .filter((entry) => !isModuleAllowedForIndustry(normalizeModule(entry.module), tenant.industry))
    .map((entry) => ({
      tenantId: tenant.id,
      tenantName: tenant.name,
      tenantSlug: tenant.slug,
      industry: tenant.industry || "GENERAL",
      moduleId: entry.id,
      module: normalizeModule(entry.module),
      source: entry.source || "PLAN"
    })));
}
