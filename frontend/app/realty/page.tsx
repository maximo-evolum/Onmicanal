"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { EvolumSidebar } from "@/components/evolum-sidebar";
import { getMyModules } from "@/lib/api";
import { getStoredSession } from "@/lib/auth";
import { moduleAllowed, type ModuleAccessKey } from "@/lib/module-access";

const realtySections: ReadonlyArray<{ href: string; moduleKey: ModuleAccessKey }> = [
  { href: "/realty-loads", moduleKey: "realty_loads" },
  { href: "/properties", moduleKey: "properties" },
  { href: "/brokers", moduleKey: "brokers" },
  { href: "/realty-activity", moduleKey: "realty_activity" },
  { href: "/broker-portal", moduleKey: "broker_portal" },
  { href: "/customers", moduleKey: "realty_clients" }
];

// Puerta de entrada de la vertical. El menú EV no repite cada submódulo; esta
// ruta abre automáticamente el primero que el plan de la cuenta permite usar.
export default function RealtyGatewayPage() {
  const router = useRouter();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [status, setStatus] = useState("Abriendo tu espacio inmobiliario...");

  useEffect(() => {
    let mounted = true;
    const session = getStoredSession();

    getMyModules()
      .then((data) => {
        if (!mounted) return;
        const role = String(session?.role || "").toUpperCase() === "SUPER_ADMIN"
          ? "SUPER_ADMIN"
          : (data.role || session?.role || null);
        const destination = realtySections.find((section) =>
          moduleAllowed(section.moduleKey, data.modules || [], role, session?.jobTitle, "REAL_ESTATE"),
        );
        if (destination) {
          router.replace(destination.href);
          return;
        }
        setStatus("Esta cuenta no tiene módulos inmobiliarios habilitados.");
      })
      .catch(() => {
        if (mounted) setStatus("No pudimos verificar tus módulos inmobiliarios. Reintenta en unos segundos.");
      });

    return () => { mounted = false; };
  }, [router]);

  return (
    <div className={`vertical-shell ${sidebarOpen ? "" : "nav-collapsed"}`}>
      <EvolumSidebar active="Inmobiliaria" isOpen={sidebarOpen} onToggle={() => setSidebarOpen((value) => !value)} />
      <main className="vertical-main realty-page">
        <section className="vertical-card realty-gateway-card" aria-live="polite">
          <span>Inmobiliaria</span>
          <h1>{status}</h1>
          <p>Propiedades, operación, corredores, portal y clientes se organizan dentro de una sola vertical.</p>
        </section>
      </main>
    </div>
  );
}
