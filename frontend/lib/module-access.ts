"use client";

import { useEffect, useMemo, useState } from "react";
import { getMyModules } from "./api";
import { getStoredSession } from "./auth";

export type ModuleAccessKey =
  | "crm"
  | "inbox"
  | "agenda"
  | "pipeline"
  | "campaigns"
  | "payments"
  | "onboarding"
  | "saas"
  | "dashboard"
  | "ai_ops"
  | "admin"
  | "bot_lab"
  | "properties"
  | "property_assignments"
  | "realty_loads"
  | "realty_activity"
  | "broker_portal"
  | "brokers"
  | "customers"
  | "revenue"
  | "vehicles"
  | "parts_inventory"
  | "mechanic_assignments"
  | "ready_notifications"
  | "documents"
  | "workflows"
  | "integrations"
  | "gmail"
  | "email_imap"
  | "google_drive"
  | "sharepoint"
  | "backup_provider"
  | "offline_sync"
  | "security_replica";

const moduleAliases: Record<ModuleAccessKey, string[]> = {
  crm: ["crm", "crm_principal"],
  inbox: ["inbox"],
  agenda: ["agenda", "bookings"],
  pipeline: ["pipeline", "sales"],
  campaigns: ["campaigns", "marketing"],
  payments: ["payments"],
  onboarding: ["onboarding", "knowledge", "configuracion_agente"],
  saas: ["saas", "plans", "planes", "users"],
  dashboard: ["dashboard", "analytics"],
  ai_ops: ["ai_ops", "ai-ops", "followups", "sales"],
  admin: ["admin", "developer", "desarrollador"],
  bot_lab: ["bot_lab", "bot-lab"],
  properties: ["properties", "propiedades"],
  property_assignments: ["property_assignments", "seller_assignments", "asignacion_ventas"],
  realty_loads: ["realty_loads", "cargas_inmobiliarias", "cargas"],
  realty_activity: ["realty_activity", "actividad_inmobiliaria"],
  broker_portal: ["broker_portal", "portal_corredor"],
  brokers: ["brokers", "corredores"],
  customers: ["customers", "clientes", "pacientes"],
  revenue: ["revenue", "ganancias", "ingresos"],
  vehicles: ["vehicles", "vehiculos"],
  parts_inventory: ["parts_inventory", "repuestos", "inventario_repuestos"],
  mechanic_assignments: ["mechanic_assignments", "asignacion_mecanicos"],
  ready_notifications: ["ready_notifications", "avisos_retiro"],
  documents: ["documents", "documentos", "archivos"],
  workflows: ["workflows", "workflow", "automatizaciones"],
  integrations: ["integrations", "integraciones", "conectores"],
  gmail: ["gmail", "google_workspace", "correo_gmail", "correo"],
  email_imap: ["email_imap", "imap", "smtp", "correo_imap", "correo_smtp"],
  google_drive: ["google_drive", "drive", "gdrive"],
  sharepoint: ["sharepoint", "onedrive", "microsoft_drive"],
  backup_provider: ["backup_provider", "backups", "respaldo", "proveedor_respaldo"],
  offline_sync: ["offline_sync", "offline", "sync_offline", "modo_offline"],
  security_replica: ["security_replica", "replica", "replica_seguridad", "drp"],
};

const alwaysAllowed = new Set<ModuleAccessKey>(["crm", "saas"]);

const roleModuleAllowlist: Partial<Record<string, Set<ModuleAccessKey>>> = {
  SELLER: new Set(["crm", "inbox", "agenda", "dashboard", "pipeline", "ai_ops", "properties", "broker_portal"]),
};

function normalizeModule(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, "_");
}

function isDeveloperRole(role?: string | null) {
  return String(role || "").toUpperCase() === "SUPER_ADMIN";
}

export function moduleAllowed(moduleKey: ModuleAccessKey, modules: string[], role?: string | null) {
  if (isDeveloperRole(role)) return true;
  if (alwaysAllowed.has(moduleKey)) return true;
  const roleAllowlist = roleModuleAllowlist[String(role || "").toUpperCase()];
  if (roleAllowlist && !roleAllowlist.has(moduleKey)) return false;
  const normalized = new Set(modules.map(normalizeModule));
  return moduleAliases[moduleKey].some((alias) => normalized.has(normalizeModule(alias)));
}

export function useModuleAccess(moduleKey?: ModuleAccessKey) {
  const session = getStoredSession();
  const [modules, setModules] = useState<string[] | null>(null);
  const [loading, setLoading] = useState(Boolean(moduleKey));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    if (!moduleKey) return;

    setLoading(true);
    getMyModules()
      .then((data) => {
        if (!active) return;
        setModules(data.modules || []);
        setError(null);
      })
      .catch((err) => {
        if (!active) return;
        setModules([]);
        setError(err instanceof Error ? err.message : "No se pudieron cargar los módulos");
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [moduleKey]);

  const allowed = useMemo(() => {
    if (!moduleKey) return true;
    if (loading || modules === null) return true;
    return moduleAllowed(moduleKey, modules, session?.role);
  }, [loading, moduleKey, modules, session?.role]);

  return { allowed, loading, error, modules: modules || [], role: session?.role };
}
