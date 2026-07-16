"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { getMyModules } from "@/lib/api";
import { getStoredSession, LogoutButton } from "@/lib/auth";
import { moduleAllowed, type ModuleAccessKey } from "@/lib/module-access";

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
  ["Centro de Conexiones", "/connections", "Correo, archivos, pagos y respaldo", "CX", "integrations"],
  ["Configuracion de Agente", "/onboarding", "Perfil, documentos, FAQs y reglas IA", "CG", "onboarding"],
  ["Esquemas de datos", "/settings/metadata", "Campos y reglas de cada entidad", "MD", "crm"],
  ["Planes y modulos", "/saas", "Plan, modulos, usuarios y limites", "PM", "saas"],
  ["Dashboard", "/dashboard", "Metricas operativas", "DA", "dashboard"],
  ["Reportes", "/reports", "Informes por rubro y operacion", "RE", "reports"],
  ["AI Ops / Cierres IA", "/ai-ops", "Razonamiento, cierres y alertas IA", "AI", "ai_ops"],
  ["Cargas inmobiliarias", "/realty-loads", "Carga, importacion y comisiones", "CI", "realty_loads"],
  ["Propiedades", "/properties", "Portal de propiedades cargadas", "PR", "properties"],
  ["Actividad inmobiliaria", "/realty-activity", "Visitas, propietarios y alertas", "AC", "realty_activity"],
  ["Portal corredor", "/broker-portal", "Propiedades asignadas y seguimiento", "PC", "broker_portal"],
  ["Corredores", "/brokers", "Perfiles y reparto comercial", "CO", "brokers"],
  ["Clientes / Pacientes", "/customers", "Fichas, historial y seguimiento", "CP", "customers"],
  ["Taller", "/workshop", "Vehiculos, repuestos y mecanicos", "TA", "vehicles"],
];

const developerItems: SidebarItem[] = [
  ["Desarrollador", "/admin", "Clientes, planes, modulos y permisos", "DE", "admin"],
  ["Bot Lab", "/dev/bot-lab", "Pruebas de respuestas y reglas", "BL", "bot_lab"],
];

export function EvolumSidebar({ active, isOpen, onToggle, isDeveloper }: EvolumSidebarProps) {
  const [enabledModules, setEnabledModules] = useState<string[] | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const [jobTitle, setJobTitle] = useState<string | null>(null);
  const navRef = useRef<HTMLElement | null>(null);
  const pathname = usePathname();

  useEffect(() => {
    let mounted = true;
    const session = getStoredSession();
    setRole(session?.role || null);
    setJobTitle(session?.jobTitle || null);
    getMyModules()
      .then((data) => {
        if (mounted) {
          setEnabledModules(data.modules || []);
          setRole(data.role || session?.role || null);
        }
      })
      .catch(() => {
        // No ocultar modulos por una falla momentanea de red; cada ruta sigue
        // validada por el backend antes de entregar datos.
        if (mounted) setEnabledModules(null);
      });

    return () => {
      mounted = false;
    };
  }, []);

  const items = useMemo(() => {
    const showDeveloperItems = isDeveloper || String(role || "").toUpperCase() === "SUPER_ADMIN";
    const allItems = showDeveloperItems ? [...baseItems, ...developerItems] : baseItems;
    if (enabledModules === null) return allItems;
    return allItems.filter(([, , , , moduleKey]) =>
      moduleAllowed(moduleKey, enabledModules, showDeveloperItems ? "SUPER_ADMIN" : role, jobTitle),
    );
  }, [enabledModules, isDeveloper, jobTitle, role]);

  useEffect(() => {
    const nav = navRef.current;
    if (!nav || typeof window === "undefined") return;
    const saved = Number(window.sessionStorage.getItem("evolum-sidebar-scroll") || "0");
    if (Number.isFinite(saved) && saved > 0) nav.scrollTop = saved;
    const frame = window.requestAnimationFrame(() => {
      nav.querySelector<HTMLElement>("[data-evolum-active='true']")?.scrollIntoView({ block: "nearest" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [pathname, items]);

  function saveMenuPosition() {
    if (typeof window !== "undefined" && navRef.current) {
      window.sessionStorage.setItem("evolum-sidebar-scroll", String(navRef.current.scrollTop));
    }
  }

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
        <div className="inbox-nav-brand" title="EVOLUM OS">
          <span>EV</span>
          <strong>EVOLUM OS</strong>
        </div>
        <button className="inbox-nav-toggle" type="button" onClick={onToggle} aria-label="Cerrar menu">
          x
        </button>
      </div>

      <nav className="inbox-unified-nav-list" ref={navRef} onScroll={saveMenuPosition}>
        {items.map(([label, href, description, icon]) => {
          const selected = pathname === href || pathname.startsWith(`${href}/`) || label === active;
          return (
          <Link className={selected ? "active" : ""} href={href} key={label} title={label} data-evolum-active={selected ? "true" : "false"} onClick={saveMenuPosition}>
            <span>{icon}</span>
            <div>
              <strong>{label}</strong>
              <small>{description}</small>
            </div>
          </Link>
          );
        })}
      </nav>

      <div className="inbox-nav-footer">
        <div className="inbox-nav-logout">
          <LogoutButton />
        </div>
      </div>
    </aside>
  );
}
