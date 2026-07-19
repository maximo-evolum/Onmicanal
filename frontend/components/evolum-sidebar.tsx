"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { getMe, getMyModules } from "@/lib/api";
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
  ["Chat's", "/inbox", "Conversaciones y atencion IA", "CH", "inbox"],
  ["Agenda", "/agenda", "Reservas, citas y disponibilidad", "AG", "agenda"],
  ["Pipeline", "/pipeline", "Leads, clientes y oportunidades", "PI", "pipeline"],
  ["Campañas", "/campaigns", "Marketing IA y publicaciones", "CA", "campaigns"],
  ["Pagos", "/payments", "Cobros, estados y links", "PA", "payments"],
  ["Centro de Conexiones", "/connections", "Correo, archivos, pagos y respaldo", "CX", "integrations"],
  ["Configuracion de Agente", "/onboarding", "Perfil, documentos, FAQs y reglas IA", "CG", "onboarding"],
  ["Automatizaciones", "/workflows", "Acciones que EVOLUM realiza por ti", "FW", "workflows"],
  ["Datos y formularios", "/settings/metadata", "Define los datos que completará tu equipo", "MD", "metadata"],
  ["Planes y modulos", "/saas", "Plan, modulos, usuarios y limites", "PM", "saas"],
  ["Dashboard", "/dashboard", "Metricas operativas", "DA", "dashboard"],
  ["AI Ops / Cierres IA", "/ai-ops", "Razonamiento, cierres y alertas IA", "AI", "ai_ops"],
  ["Control de IA", "/settings/ai", "Define qué puede hacer la IA y cuándo pedir ayuda", "GI", "ai_ops"],
  ["Cargas inmobiliarias", "/realty-loads", "Carga, importacion y comisiones", "CI", "realty_loads"],
  ["Propiedades", "/properties", "Portal de propiedades cargadas", "PR", "properties"],
  ["Actividad inmobiliaria", "/realty-activity", "Visitas, propietarios y alertas", "AC", "realty_activity"],
  ["Portal corredor", "/broker-portal", "Propiedades asignadas y seguimiento", "PC", "broker_portal"],
  ["Corredores", "/brokers", "Perfiles y reparto comercial", "CO", "brokers"],
  ["Clientes", "/customers", "Compradores, preferencias e historial comercial", "CL", "realty_clients"],
  ["Pacientes", "/patients", "Fichas de atención, historial y seguimiento", "PA", "patients"],
  ["Exámenes y presupuestos", "/exams", "Órdenes, resultados y cotizaciones clínicas", "EP", "exams"],
  ["Dueños y vehículos", "/workshop", "Fichas, historial técnico, repuestos y presupuestos", "DV", "vehicle_owners"],
];

const developerItems: SidebarItem[] = [
  ["Desarrollador", "/admin", "Clientes, planes, modulos y permisos", "DE", "admin"],
  ["Bot Lab", "/dev/bot-lab", "Pruebas de respuestas y reglas", "BL", "bot_lab"],
];

function isRealtyIndustry(industry?: string | null) {
  const value = String(industry || "").toUpperCase();
  return value.includes("REAL_ESTATE") || value.includes("INMOBIL") || value.includes("CORRETAJE");
}

function isCareIndustry(industry?: string | null) {
  const value = String(industry || "").toUpperCase();
  return value.includes("HEALTH") || value.includes("SALUD") || value.includes("CLINIC") || value.includes("DENT") || value.includes("VETER");
}

function isAutomotiveIndustry(industry?: string | null) {
  const value = String(industry || "").toUpperCase();
  return value.includes("AUTO") || value.includes("TALLER") || value.includes("MECAN");
}

function contextualizeItem(item: SidebarItem, industry?: string | null): SidebarItem {
  const [, href, , icon, moduleKey] = item;
  if (moduleKey === "customers" && isRealtyIndustry(industry)) {
    return ["Clientes", href, "Compradores, preferencias e historial comercial", icon, moduleKey];
  }
  if (moduleKey === "customers" && isCareIndustry(industry)) {
    return ["Pacientes", href, "Fichas de atención, historial y seguimiento", icon, moduleKey];
  }
  if (moduleKey === "vehicles" && isAutomotiveIndustry(industry)) {
    return ["Dueños y vehículos", href, "Fichas, historial técnico, repuestos y presupuestos", icon, moduleKey];
  }
  return item;
}

function itemBelongsToIndustry(item: SidebarItem, industry?: string | null) {
  if (!industry) return true;
  const moduleKey = item[4];
  if (moduleKey === "realty_clients") return isRealtyIndustry(industry);
  if (moduleKey === "patients") return isCareIndustry(industry);
  if (moduleKey === "vehicle_owners") return isAutomotiveIndustry(industry);
  return true;
}

export function EvolumSidebar({ active, isOpen, onToggle, isDeveloper }: EvolumSidebarProps) {
  const [enabledModules, setEnabledModules] = useState<string[] | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const [jobTitle, setJobTitle] = useState<string | null>(null);
  const [industry, setIndustry] = useState<string | null>(null);
  const navRef = useRef<HTMLElement | null>(null);
  const pathname = usePathname();

  useEffect(() => {
    let mounted = true;
    const session = getStoredSession();
    setRole(session?.role || null);
    setJobTitle(session?.jobTitle || null);
    getMe()
      .then((data) => { if (mounted) setIndustry(data.tenant?.industry || null); })
      .catch(() => { if (mounted) setIndustry(null); });
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
    const allItems = (showDeveloperItems ? [...baseItems, ...developerItems] : baseItems)
      .map((item) => contextualizeItem(item, industry));
    // Un superadmin administra toda la plataforma: ve el catálogo completo
    // de EVOLUM OS, no solo las verticales del tenant con que inició sesión.
    const applicableItems = showDeveloperItems
      ? allItems
      : allItems.filter((item) => itemBelongsToIndustry(item, industry));
    const availableItems = enabledModules === null
      ? applicableItems
      : applicableItems.filter(([, , , , moduleKey]) =>
      moduleAllowed(moduleKey, enabledModules, showDeveloperItems ? "SUPER_ADMIN" : role, jobTitle),
    );

    // Inicio siempre encabeza la navegacion; los modulos restantes se ordenan
    // alfabeticamente para que el menu sea predecible con cualquier vertical.
    return [...availableItems].sort(([leftLabel], [rightLabel]) => {
      if (leftLabel === "Inicio") return -1;
      if (rightLabel === "Inicio") return 1;
      return leftLabel.localeCompare(rightLabel, "es");
    });
  }, [enabledModules, industry, isDeveloper, jobTitle, role]);

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
        <img className="evolum-brand-logo" src="/brand/evolum-logo.png" alt="EVOLUM OS" />
      </button>
    );
  }

  return (
    <aside className="inbox-unified-nav evolum-unified-nav">
      <div className="inbox-nav-head">
        <div className="inbox-nav-brand" title="EVOLUM OS">
          <img className="evolum-brand-logo" src="/brand/evolum-logo.png" alt="EVOLUM OS" />
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
