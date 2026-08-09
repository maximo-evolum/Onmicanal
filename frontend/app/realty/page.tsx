"use client";

import { useEffect, useState } from "react";
import { RealtyDashboardPageContent, RealtyShell } from "@/components/realty-workspace";
import { getMyModules } from "@/lib/api";
import { getStoredSession } from "@/lib/auth";
import { moduleAllowed, type ModuleAccessKey } from "@/lib/module-access";

const realtySections: ReadonlyArray<ModuleAccessKey> = [
  "realty_loads",
  "properties",
  "brokers",
  "realty_activity",
  "broker_portal",
  "realty_clients"
];

/** Entrada única de Inmobiliaria desde el menú EV. */
export default function RealtyDashboardPage() {
  const [accessModule, setAccessModule] = useState<ModuleAccessKey | null>(null);
  const [status, setStatus] = useState("Validando tu acceso inmobiliario...");

  useEffect(() => {
    let mounted = true;
    const session = getStoredSession();
    getMyModules()
      .then((result) => {
        if (!mounted) return;
        const role = String(session?.role || "").toUpperCase() === "SUPER_ADMIN"
          ? "SUPER_ADMIN"
          : (result.role || session?.role || null);
        const allowed = realtySections.find((moduleKey) => moduleAllowed(moduleKey, result.modules || [], role, session?.jobTitle, "REAL_ESTATE"));
        if (allowed) {
          setAccessModule(allowed);
          return;
        }
        setStatus("Esta cuenta no tiene capacidades inmobiliarias habilitadas.");
      })
      .catch(() => {
        if (mounted) setStatus("No pudimos verificar los módulos inmobiliarios. Reintenta en unos segundos.");
      });
    return () => { mounted = false; };
  }, []);

  if (!accessModule) {
    return <main className="realty-access-status" aria-live="polite"><div><span>Inmobiliaria</span><h1>{status}</h1><p>El acceso se valida una vez al entrar a la vertical.</p></div></main>;
  }

  return (
    <RealtyShell active="Inmobiliaria" moduleKey={accessModule}>
      <RealtyDashboardPageContent />
    </RealtyShell>
  );
}
