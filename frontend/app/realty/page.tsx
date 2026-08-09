"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  BrokerPortalPageContent,
  BrokerTrainingPageContent,
  BrokersPageContent,
  RealtyActivityPageContent,
  RealtyBuyersPageContent,
  RealtyDashboardPageContent,
  RealtyLoadsPageContent,
  RealtyPropertiesPageContent,
  RealtyShell
} from "@/components/realty-workspace";
import { getMe } from "@/lib/api";
import { getStoredSession } from "@/lib/auth";
import { moduleAllowed, type ModuleAccessKey } from "@/lib/module-access";
import { getStoredTenantAccess, storeTenantAccess, type TenantAccessSnapshot } from "@/lib/session-access";

const realtySections: ReadonlyArray<ModuleAccessKey> = [
  "realty_loads",
  "properties",
  "brokers",
  "realty_activity",
  "broker_portal",
  "realty_clients"
];

const views = {
  summary: { label: "Inicio", module: null, content: RealtyDashboardPageContent },
  operations: { label: "Cargas inmobiliarias", module: "realty_loads", content: RealtyLoadsPageContent },
  properties: { label: "Propiedades", module: "properties", content: RealtyPropertiesPageContent },
  brokers: { label: "Corredores", module: "brokers", content: BrokersPageContent },
  activity: { label: "Actividad inmobiliaria", module: "realty_activity", content: RealtyActivityPageContent },
  portal: { label: "Portal corredor", module: "broker_portal", content: BrokerPortalPageContent },
  buyers: { label: "Clientes inmobiliarios", module: "realty_clients", content: RealtyBuyersPageContent },
  training: { label: "Capacitación de corredores", module: "brokers", content: BrokerTrainingPageContent }
} as const;

type RealtyView = keyof typeof views;

/** Entrada única de Inmobiliaria desde el menú EV. */
function RealtyDashboardContent() {
  const searchParams = useSearchParams();
  const [accessModule, setAccessModule] = useState<ModuleAccessKey | null>(null);
  const [enabledModules, setEnabledModules] = useState<string[]>([]);
  const [role, setRole] = useState<string | null>(null);
  const [status, setStatus] = useState("Validando tu acceso inmobiliario...");

  useEffect(() => {
    let mounted = true;
    const session = getStoredSession();
    const resolveAccess = (access: TenantAccessSnapshot) => {
      const effectiveRole = String(session?.role || "").toUpperCase() === "SUPER_ADMIN"
        ? "SUPER_ADMIN"
        : (access.role || session?.role || null);
      const allowed = realtySections.find((moduleKey) => moduleAllowed(moduleKey, access.modules || [], effectiveRole, access.jobTitle || session?.jobTitle, access.industry || "REAL_ESTATE"));
      if (!allowed) {
        setStatus("Esta cuenta no tiene capacidades inmobiliarias habilitadas.");
        return;
      }
      setAccessModule(allowed);
      setEnabledModules(access.modules || []);
      setRole(effectiveRole);
    };

    const snapshot = getStoredTenantAccess(session);
    if (snapshot) {
      resolveAccess(snapshot);
      return () => { mounted = false; };
    }

    // Respaldo para una sesión abierta antes de esta mejora. En sesiones
    // nuevas el snapshot se crea en login y este bloque no vuelve a ejecutarse
    // al cambiar entre áreas de Inmobiliaria.
    getMe()
      .then((result) => {
        if (!mounted) return;
        const access = {
          userId: result.user.id,
          tenantId: result.user.tenantId || null,
          role: result.user.role || session?.role || null,
          jobTitle: result.user.jobTitle || session?.jobTitle || null,
          industry: result.tenant?.industry || null,
          modules: result.modules || []
        };
        storeTenantAccess(access);
        resolveAccess(access);
      })
      .catch(() => {
        if (mounted) setStatus("No pudimos verificar los módulos inmobiliarios. Reintenta en unos segundos.");
      });
    return () => { mounted = false; };
  }, []);

  if (!accessModule) {
    return <main className="realty-access-status" aria-live="polite"><div><span>Inmobiliaria</span><h1>{status}</h1><p>El acceso se valida una vez al entrar a la vertical.</p></div></main>;
  }

  const requestedView = String(searchParams.get("view") || "summary") as RealtyView;
  const requested = views[requestedView] || views.summary;
  const session = getStoredSession();
  const mayOpenRequested = !requested.module || moduleAllowed(requested.module, enabledModules, role, session?.jobTitle, "REAL_ESTATE");
  const current = mayOpenRequested ? requested : views.summary;
  const CurrentView = current.content;

  return (
    <RealtyShell active={current.label} moduleKey={accessModule}>
      <CurrentView />
    </RealtyShell>
  );
}

export default function RealtyDashboardPage() {
  return <Suspense fallback={<main className="realty-access-status" aria-live="polite"><div><span>Inmobiliaria</span><h1>Abriendo workspace inmobiliario...</h1><p>Preparando tu cartera y módulos disponibles.</p></div></main>}><RealtyDashboardContent /></Suspense>;
}
