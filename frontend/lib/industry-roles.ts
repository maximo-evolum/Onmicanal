export type IndustryRoleOption = {
  key: string;
  label: string;
  workspaceRole: "ADMIN" | "AGENT" | "SELLER" | "VIEWER";
};

const roles: Record<string, IndustryRoleOption[]> = {
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
    { key: "AUTOMOTIVE_MECHANIC", label: "Mecánico", workspaceRole: "AGENT" },
    { key: "AUTOMOTIVE_WAREHOUSE", label: "Bodeguero", workspaceRole: "AGENT" },
    { key: "AUTOMOTIVE_RECEPTION", label: "Recepcionista de taller", workspaceRole: "AGENT" },
  ],
  DENTAL: [
    { key: "DENTAL_ADMIN", label: "Administrador de clínica", workspaceRole: "ADMIN" },
    { key: "DENTAL_DOCTOR", label: "Doctor", workspaceRole: "AGENT" },
    { key: "DENTAL_NURSE", label: "Enfermero/a", workspaceRole: "AGENT" },
    { key: "DENTAL_RECEPTION", label: "Recepcionista", workspaceRole: "AGENT" },
  ],
  VETERINARY: [
    { key: "VETERINARY_ADMIN", label: "Administrador veterinario", workspaceRole: "ADMIN" },
    { key: "VETERINARY_VET", label: "Veterinario/a", workspaceRole: "AGENT" },
    { key: "VETERINARY_TECH", label: "Técnico veterinario", workspaceRole: "AGENT" },
    { key: "VETERINARY_RECEPTION", label: "Recepcionista", workspaceRole: "AGENT" },
  ],
  GASTRONOMY: [
    { key: "GASTRONOMY_ADMIN", label: "Administrador gastronómico", workspaceRole: "ADMIN" },
    { key: "GASTRONOMY_RESERVATIONS", label: "Encargado de reservas", workspaceRole: "AGENT" },
    { key: "GASTRONOMY_SELLER", label: "Vendedor/a", workspaceRole: "SELLER" },
    { key: "GASTRONOMY_OPERATIONS", label: "Encargado operativo", workspaceRole: "AGENT" },
  ],
};

function normalizedIndustry(value?: string | null) {
  const text = String(value || "").toUpperCase();
  if (text.includes("INM") || text.includes("REAL")) return "REAL_ESTATE";
  if (text.includes("AUTO") || text.includes("TALLER")) return "AUTOMOTIVE";
  if (text.includes("VETER")) return "VETERINARY";
  if (text.includes("DENTAL") || text.includes("SALUD") || text.includes("CLINIC")) return "DENTAL";
  if (text.includes("GASTRO") || text.includes("RESTAUR")) return "GASTRONOMY";
  return "GENERAL";
}

export function getIndustryRoleOptions(industry?: string | null) {
  return roles[normalizedIndustry(industry)] || roles.GENERAL;
}
