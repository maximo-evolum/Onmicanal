"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AgentSession } from "@/lib/types";
import { getStoredSession, LogoutButton } from "@/lib/auth";
import { getMyModules } from "@/lib/api";
import AppMenu from "./AppMenu";

const ADMIN_MENU_ITEM = { href: "/admin", label: "Desarrollador", module: "admin", description: "Clientes, planes y módulos" };

const MENU_ITEMS = [
  { href: "/saas", label: "SaaS Center", module: "analytics", description: "Plan, límites y salud" },
  { href: "/settings/ai", label: "Config IA", module: "bot_lab", description: "Personalidad y reglas" },
  { href: "/team", label: "Equipo", module: "inbox", description: "Roles y actividad" },
  { href: "/saas-analytics", label: "SaaS Analytics", module: "analytics", description: "Uso y performance" },
  { href: "/inbox", label: "Inbox", module: "inbox", description: "Conversaciones y bot" },
  { href: "/pipeline", label: "Pipeline", module: "sales", description: "Leads y ventas" },
  { href: "/sales-queue", label: "Cierres IA", module: "sales", description: "Leads listos para vendedor" },
  { href: "/payments", label: "Pagos", module: "payments", description: "Links, estados y reservas" },
  { href: "/ai-ops", label: "AI Ops", module: "analytics", description: "Razonamiento y recomendaciones" },
  { href: "/dashboard", label: "Dashboard", module: "analytics", description: "Métricas e IA" },
  { href: "/campaigns", label: "Campañas", module: "marketing", description: "Marketing IA" },
  { href: "/dev/bot-lab", label: "Bot Lab", module: "bot_lab", description: "Probar respuestas" },
  { href: "/onboarding", label: "Onboarding", module: "inbox", description: "Guía inicial" }
];

export function Topbar({ agent }: { agent?: AgentSession | null }) {
  const [mounted, setMounted] = useState(false);
  const [session, setSession] = useState<AgentSession | null>(agent || null);
  const [modules, setModules] = useState<string[]>([]);
  const [plan, setPlan] = useState<string>("");

  useEffect(() => {
    setMounted(true);
    setSession(agent || getStoredSession());
    getMyModules()
      .then((data) => {
        setModules(data.modules || []);
        setPlan(data.plan || "");
      })
.catch(() => {
        // Fallback seguro SaaS:
        // nunca mostrar módulos bloqueados si falla la carga.
        setModules([]);
      });
  }, [agent]);

  const userName = mounted ? session?.name || "Usuario" : "Usuario";
  const visibleItems = useMemo(() => {
    if (session?.role === "SUPER_ADMIN") return [ADMIN_MENU_ITEM, ...MENU_ITEMS];

    if (session?.role === "SELLER") {
      return MENU_ITEMS.filter((item) => ["/inbox", "/dashboard", "/pipeline", "/campaigns", "/payments"].includes(item.href));
    }

    // Evita mostrar módulos bloqueados si aún no cargan.
    if (!modules.length) return [];

    return MENU_ITEMS.filter((item) => modules.includes(item.module));
  }, [modules, session?.role]);

  return (
    <div className="topbar">
      <div>
        <h1 className="brand-title">Inbox IA</h1>
        <div className="workspace-pill">
          <span>Omnicanal + IA</span>{plan ? <span>· Plan {plan}</span> : null}
        </div>
      </div>

      <div className="topbar-actions">
        <AppMenu trigger={<button className="ghost-btn" type="button">Menú ▾</button>}>
          {visibleItems.map((item) => (
            <Link key={item.href} href={item.href}>
              <span>{item.label}</span>
              <small className="menu-item-description">{item.description}</small>
            </Link>
          ))}
        </AppMenu>

        <span className="badge accent">{userName}</span>
        <LogoutButton />
      </div>
    </div>
  );
}
