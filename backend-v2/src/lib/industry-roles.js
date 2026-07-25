import { normalizeIndustryCode } from "./industries.js";

// El rol del workspace controla permisos. El cargo operacional describe la
// funcion visible del usuario dentro de su vertical, sin forzar migraciones de
// enum para cada nueva industria que se agregue a EVOLUM.
export const INDUSTRY_ROLE_OPTIONS = Object.freeze({
  GENERAL: [
    { key: "GENERAL_ADMIN", label: "Administrador", workspaceRole: "ADMIN" },
    { key: "GENERAL_AGENT", label: "Agente operativo", workspaceRole: "AGENT" },
    { key: "GENERAL_SELLER", label: "Vendedor", workspaceRole: "SELLER" },
    { key: "GENERAL_VIEWER", label: "Solo lectura", workspaceRole: "VIEWER" },
  ],
  REAL_ESTATE: [
    { key: "REAL_ESTATE_ADMIN", label: "Administrador inmobiliario", workspaceRole: "ADMIN" },
    { key: "REAL_ESTATE_BROKER", label: "Corredor inmobiliario", workspaceRole: "SELLER" },
    { key: "REAL_ESTATE_COORDINATOR", label: "Coordinador comercial", workspaceRole: "AGENT" },
    { key: "REAL_ESTATE_ASSISTANT", label: "Asistente de corretaje", workspaceRole: "AGENT" },
  ],
  AUTOMOTIVE: [
    { key: "AUTOMOTIVE_ADMIN", label: "Jefe de taller", workspaceRole: "ADMIN" },
    { key: "AUTOMOTIVE_MECHANIC", label: "Mecanico", workspaceRole: "AGENT" },
    { key: "AUTOMOTIVE_WAREHOUSE", label: "Bodeguero", workspaceRole: "AGENT" },
    { key: "AUTOMOTIVE_RECEPTION", label: "Recepcionista de taller", workspaceRole: "AGENT" },
  ],
  DENTAL: [
    { key: "DENTAL_ADMIN", label: "Administrador de clinica", workspaceRole: "ADMIN" },
    { key: "DENTAL_DOCTOR", label: "Doctor", workspaceRole: "AGENT" },
    { key: "DENTAL_NURSE", label: "Enfermero/a", workspaceRole: "AGENT" },
    { key: "DENTAL_RECEPTION", label: "Recepcionista", workspaceRole: "AGENT" },
  ],
  HEALTH: [
    { key: "HEALTH_ADMIN", label: "Administrador de clinica", workspaceRole: "ADMIN" },
    { key: "HEALTH_PROFESSIONAL", label: "Profesional de salud", workspaceRole: "AGENT" },
    { key: "HEALTH_ASSISTANT", label: "Asistente clinico", workspaceRole: "AGENT" },
    { key: "HEALTH_RECEPTION", label: "Recepcionista", workspaceRole: "AGENT" },
  ],
  VETERINARY: [
    { key: "VETERINARY_ADMIN", label: "Administrador veterinario", workspaceRole: "ADMIN" },
    { key: "VETERINARY_VET", label: "Veterinario/a", workspaceRole: "AGENT" },
    { key: "VETERINARY_TECH", label: "Tecnico veterinario", workspaceRole: "AGENT" },
    { key: "VETERINARY_RECEPTION", label: "Recepcionista", workspaceRole: "AGENT" },
  ],
  GASTRONOMY: [
    { key: "GASTRONOMY_ADMIN", label: "Administrador gastronomico", workspaceRole: "ADMIN" },
    { key: "GASTRONOMY_RESERVATIONS", label: "Encargado de reservas", workspaceRole: "AGENT" },
    { key: "GASTRONOMY_SELLER", label: "Vendedor/a", workspaceRole: "SELLER" },
    { key: "GASTRONOMY_OPERATIONS", label: "Encargado operativo", workspaceRole: "AGENT" },
  ],
  FINANCE: [
    { key: "FINANCE_ADMIN", label: "Administrador financiero", workspaceRole: "ADMIN" },
    { key: "FINANCE_ACCOUNTANT", label: "Contador/a", workspaceRole: "AGENT" },
    { key: "FINANCE_TREASURY", label: "Tesoreria", workspaceRole: "AGENT" },
    { key: "FINANCE_COLLECTIONS", label: "Ejecutivo/a de cobranza", workspaceRole: "SELLER" },
    { key: "FINANCE_AUDITOR", label: "Auditor/a", workspaceRole: "VIEWER" },
  ],
});

export function getIndustryRoleOptions(industry) {
  const industryCode = normalizeIndustryCode(industry);
  return INDUSTRY_ROLE_OPTIONS[industryCode] || INDUSTRY_ROLE_OPTIONS.GENERAL;
}

export function resolveIndustryRole({ industry, operationalRole, role, jobTitle } = {}) {
  const requested = String(operationalRole || "").trim().toUpperCase();
  const selected = getIndustryRoleOptions(industry).find((option) => option.key === requested);
  const fallbackRole = String(role || "AGENT").trim().toUpperCase();

  return {
    workspaceRole: selected?.workspaceRole || fallbackRole,
    jobTitle: String(jobTitle || selected?.label || "").trim() || null,
    operationalRole: selected?.key || null,
  };
}
