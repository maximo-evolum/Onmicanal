"use client";

import Link from "next/link";
import { LogoutButton } from "@/lib/auth";

type EvolumSidebarProps = {
  active: string;
  isOpen: boolean;
  onToggle: () => void;
  isDeveloper?: boolean;
};

const baseItems = [
  ["Inicio", "/crm-principal", "Centro principal de EVOLUM", "IN"],
  ["Inbox Omnicanal", "/inbox", "Conversaciones y atencion IA", "IO"],
  ["Agenda", "/agenda", "Reservas, citas y disponibilidad", "AG"],
  ["Clientes", "/pipeline", "Leads, clientes y pipeline", "CL"],
  ["Campañas", "/campaigns", "Marketing IA y publicaciones", "CA"],
  ["Pagos", "/payments", "Cobros, estados y links", "PA"],
  ["Configuracion de Agente", "/onboarding", "Perfil, documentos, FAQs y reglas IA", "CG"],
  ["Analytics & KPIs", "/dashboard", "Metricas operativas", "AN"],
  ["AI Ops / Cierres IA", "/ai-ops", "Razonamiento, cierres y alertas IA", "AI"],
] as const;

const developerItems = [
  ["Desarrollador", "/admin", "Clientes, planes, modulos y permisos", "DE"],
  ["Planes y modulos", "/saas", "Configuracion SaaS por cuenta", "PM"],
  ["Bot Lab", "/dev/bot-lab", "Pruebas de respuestas y reglas", "BL"],
] as const;

export function EvolumSidebar({ active, isOpen, onToggle, isDeveloper }: EvolumSidebarProps) {
  const items = isDeveloper ? [...baseItems, ...developerItems] : baseItems;

  return (
    <aside className="inbox-unified-nav evolum-unified-nav">
      <div className="inbox-nav-head">
        <div className="inbox-nav-brand" title="EVOLUM">
          <span>EV</span>
          <strong>EVOLUM</strong>
        </div>
        <button className="inbox-nav-toggle" type="button" onClick={onToggle} aria-label={isOpen ? "Cerrar menu" : "Abrir menu"}>
          {isOpen ? "‹" : "›"}
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
        <div className="inbox-nav-logout">
          <LogoutButton />
        </div>
      </div>
    </aside>
  );
}
