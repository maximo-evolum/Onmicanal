"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { getMyModules } from "@/lib/api";
import { LogoutButton } from "@/lib/auth";
import { moduleAllowed, type ModuleAccessKey } from "@/lib/module-access";
import { ThemePalettePicker } from "./theme-palette-picker";

type EvolumSidebarProps = {
  active: string;
  isOpen: boolean;
  onToggle: () => void;
  isDeveloper?: boolean;
};

type SidebarItem = readonly [
  label: string,
  href: string,
  description: string,
  icon: string,
  moduleKey: ModuleAccessKey,
];

const baseItems: SidebarItem[] = [
  ["Inicio", "/crm-principal", "Centro principal de EVOLUM", "IN", "crm"],
  ["Inbox Omnicanal", "/inbox", "Conversaciones y atencion IA", "IO", "inbox"],
  ["Agenda", "/agenda", "Reservas, citas y disponibilidad", "AG", "agenda"],
  ["Pipeline", "/pipeline", "Leads, clientes y oportunidades", "PI", "pipeline"],
  ["Campañas", "/campaigns", "Marketing IA y publicaciones", "CA", "campaigns"],
  ["Pagos", "/payments", "Cobros, estados y links", "PA", "payments"],
  ["Configuracion de Agente", "/onboarding", "Perfil, documentos, FAQs y reglas IA", "CG", "onboarding"],
  ["Planes y modulos", "/saas", "Plan, modulos, usuarios y limites", "PM", "saas"],
  ["Dashboard", "/dashboard", "Metricas operativas", "DA", "dashboard"],
  ["AI Ops / Cierres IA", "/ai-ops", "Razonamiento, cierres y alertas IA", "AI", "ai_ops"],
  ["Propiedades", "/properties", "Ficha inmobiliaria y asignaciones", "PR", "properties"],
  ["Clientes / Pacientes", "/customers", "Fichas, historial y seguimiento", "CP", "customers"],
  ["Ganancias", "/revenue", "Ingresos, pagos y forecast", "GA", "revenue"],
  ["Taller", "/workshop", "Vehiculos, repuestos y mecanicos", "TA", "vehicles"],
];

const developerItems: SidebarItem[] = [
  ["Desarrollador", "/admin", "Clientes, planes, modulos y permisos", "DE", "admin"],
  ["Bot Lab", "/dev/bot-lab", "Pruebas de respuestas y reglas", "BL", "bot_lab"],
];

export function EvolumSidebar({ active, isOpen, onToggle, isDeveloper }: EvolumSidebarProps) {
  const [enabledModules, setEnabledModules] = useState<string[] | null>(null);

  useEffect(() => {
    let mounted = true;
    getMyModules()
      .then((data) => {
        if (mounted) setEnabledModules(data.modules || []);
      })
      .catch(() => {
        if (mounted) setEnabledModules([]);
      });

    return () => {
      mounted = false;
    };
  }, []);

  const items = useMemo(() => {
    const allItems = isDeveloper ? [...baseItems, ...developerItems] : baseItems;
    if (enabledModules === null) return allItems;
    return allItems.filter(([, , , , moduleKey]) =>
      moduleAllowed(moduleKey, enabledModules, isDeveloper ? "SUPER_ADMIN" : undefined),
    );
  }, [enabledModules, isDeveloper]);

  if (!isOpen) {
    return (
      <button className="evolum-menu-bubble" type="button" onClick={onToggle} aria-label="Abrir menu EVOLUM">
        EV
      </button>
    );
  }

  return (
    <aside className="inbox-unified-nav evolum-unified-nav">
      <div className="inbox-nav-head">
        <div className="inbox-nav-brand" title="EVOLUM">
          <span>EV</span>
          <strong>EVOLUM</strong>
        </div>
        <button className="inbox-nav-toggle" type="button" onClick={onToggle} aria-label="Cerrar menu">
          x
        </button>
      </div>

      <nav className="inbox-unified-nav-list">
        {items.map(([label, href, description, icon]) => (
          <Link className={label === active ? "active" : ""} href={href} key={label} title={label}>
            <span>{icon}</span>
            <div>
              <strong>{label}</strong>
              <small>{description}</small>
            </div>
          </Link>
        ))}
      </nav>

      <div className="inbox-nav-footer">
        <ThemePalettePicker />
        <div className="inbox-nav-logout">
          <LogoutButton />
        </div>
      </div>
    </aside>
  );
}
