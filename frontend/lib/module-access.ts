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
  | "bot_lab";

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
};

const alwaysAllowed = new Set<ModuleAccessKey>(["crm", "saas"]);

function normalizeModule(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, "_");
}

function isDeveloperRole(role?: string | null) {
  return String(role || "").toUpperCase() === "SUPER_ADMIN";
}

export function moduleAllowed(moduleKey: ModuleAccessKey, modules: string[], role?: string | null) {
  if (isDeveloperRole(role)) return true;
  if (alwaysAllowed.has(moduleKey)) return true;
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
        setError(err instanceof Error ? err.message : "No se pudieron cargar los modulos");
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

