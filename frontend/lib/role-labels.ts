"use client";

export const ROLE_LABELS: Record<string, string> = {
  SUPER_ADMIN: "Super admin",
  OWNER: "Admin",
  ADMIN: "Admin",
  AGENT: "Agente",
  SELLER: "Corredor",
  VIEWER: "Solo lectura",
};

export const ROLE_OPTIONS = [
  { value: "ADMIN", label: "Admin" },
  { value: "AGENT", label: "Agente" },
  { value: "SELLER", label: "Corredor" },
  { value: "VIEWER", label: "Solo lectura" },
];

export function roleLabel(role?: string | null) {
  const key = String(role || "").trim().toUpperCase();
  return ROLE_LABELS[key] || role || "Usuario";
}

export function editableRoleValue(role?: string | null) {
  const key = String(role || "").trim().toUpperCase();
  return key === "OWNER" ? "ADMIN" : key || "AGENT";
}
