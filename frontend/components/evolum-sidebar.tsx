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
  // Una sola puerta de entrada para Inmobiliaria. Propiedades, cargas,
  // corredores, visitas, portal y compradores se navegan como submódulos
  // dentro de este espacio, para no repetirlos en el menú EV.
  ["Inmobiliaria", "/realty", "Propiedades, cargas, corredores y visitas", "RE", "properties"],
  // Pacientes y exámenes son rutas de compatibilidad para datos antiguos.
  // Las nuevas fichas, órdenes y presupuestos se administran exclusivamente
  // dentro de Atención clínica, dental o veterinaria.
  ["Dueños y vehículos", "/workshop", "Fichas, historial técnico, repuestos y presupuestos", "DV", "vehicle_owners"],
  ["Operación gastronómica", "/operations/gastronomy", "Mesas, comandas, clientes frecuentes y cierre diario", "GO", "gastronomy_operations"],
  ["Atención dental", "/operations/dental", "Fichas odontológicas, odontograma, tratamientos y consentimientos", "OD", "dental_care"],
  ["Atención clínica", "/operations/health", "Fichas, atenciones, órdenes y seguimiento administrativo", "HC", "health_care"],
  ["Atención veterinaria", "/operations/veterinary", "Mascotas, vacunas, hospitalización y recetas", "VE", "veterinary_care"],
  ["Turnos", "/shifts", "Equipo, cobertura y disponibilidad de la jornada", "TU", "shift_management"],
];

// Finanzas es una vertical con su propio espacio de trabajo. El menú EV solo
// expone esta puerta de entrada; sus secciones (facturas, cartolas,
// conciliación, cobranza y equipo IA) se navegan dentro del módulo para evitar
// duplicar accesos y confundir a los usuarios.
baseItems.push(
  ["Finanzas", "/finance", "Facturas, cartolas, conciliación y cobranza IA", "FI", "finance_analytics"]
);

const developerItems: SidebarItem[] = [
  ["Desarrollador", "/admin", "Clientes, planes, modulos y permisos", "DE", "admin"],
  ["Bot Lab", "/dev/bot-lab", "Pruebas de respuestas y reglas", "BL", "bot_lab"],
];

// La entrada principal de Inmobiliaria debe estar visible si la cuenta tiene
// al menos una de sus capacidades. El destino /realty deriva al primer
// submódulo permitido, evitando que un plan parcial quede atrapado en
// Propiedades cuando solo habilitó, por ejemplo, Corredores.
const realtyGatewayModules: ModuleAccessKey[] = [
  "realty_loads", "properties", "realty_activity", "broker_portal",
  "brokers", "realty_clients", "property_assignments"
];

const realtyRoutes = [
  "/realty", "/realty-loads", "/properties", "/brokers",
  "/realty-activity", "/broker-portal", "/customers"
];

// Símbolos funcionales, no siglas: reducen el tiempo de reconocimiento del
// módulo y mantienen un lenguaje visual coherente dentro del menú EV.
const moduleSymbols: Record<string, string> = {
  IN: "⌂", CH: "◌", AG: "◷", PI: "↗", CA: "✦", PA: "▣", CX: "⌁",
  CG: "⚙", FW: "⇄", MD: "▤", PM: "◫", DA: "▥", AI: "✧", GI: "◈",
  RE: "⌂",
  DV: "▱", TU: "◷", DE: "▦", BL: "⚗"
};

Object.assign(moduleSymbols, { FI: "$", GO: "☕", OD: "✦", HC: "⚕", VE: "♥" });

function ModuleSymbol({ code, label }: { code: string; label: string }) {
  return <span className="evolum-module-symbol" aria-hidden="true" title={label}>{moduleSymbols[code] || "◇"}</span>;
}

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

function isFinanceIndustry(industry?: string | null) {
  const value = String(industry || "").toUpperCase();
  return value.includes("FINANCE") || value.includes("FINANZ") || value.includes("CONTABLE") || value.includes("CONTABIL");
}

function isShiftIndustry(industry?: string | null) {
  const value = String(industry || "").toUpperCase();
  return value.includes("GASTRON") || value.includes("HEALTH") || value.includes("SALUD") || value.includes("CLINIC") || value.includes("DENT") || value.includes("VETER");
}

function isGastronomyIndustry(industry?: string | null) {
  return String(industry || "").toUpperCase().includes("GASTRON");
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
  // Las capacidades transversales (CRM, agenda, inbox y dashboard) se
  // mantienen disponibles para todas las verticales. La operación propia de
  // cada rubro no debe aparecer jamás en el tenant de otro rubro.
  const realtyModules = new Set<ModuleAccessKey>([
    "realty_loads", "properties", "realty_activity", "broker_portal",
    "brokers", "realty_clients", "property_assignments"
  ]);
  const careModules = new Set<ModuleAccessKey>(["patients", "exams"]);
  const automotiveModules = new Set<ModuleAccessKey>([
    "vehicle_owners", "vehicles", "parts_inventory", "mechanic_assignments", "ready_notifications"
  ]);
  const financeModules = new Set<ModuleAccessKey>([
    "finance_invoices", "finance_bank_sync", "finance_reconciliation",
    "finance_exceptions", "finance_collections", "finance_analytics"
  ]);
  if (moduleKey === "gastronomy_operations") return isGastronomyIndustry(industry);
  if (moduleKey === "dental_care") return String(industry || "").toUpperCase().includes("DENT");
  if (moduleKey === "health_care") return String(industry || "").toUpperCase().includes("HEALTH") || String(industry || "").toUpperCase().includes("SALUD") || String(industry || "").toUpperCase().includes("CLINIC");
  if (moduleKey === "veterinary_care") return String(industry || "").toUpperCase().includes("VETER");
  if (realtyModules.has(moduleKey)) return isRealtyIndustry(industry);
  // Pacientes y exámenes anteriores se conservan en backend para datos
  // históricos, pero la navegación de cada clínica usa su espacio propio.
  // Así no se invita a crear fichas genéricas paralelas al flujo especializado.
  if (careModules.has(moduleKey)) return false;
  if (automotiveModules.has(moduleKey)) return isAutomotiveIndustry(industry);
  if (financeModules.has(moduleKey)) return isFinanceIndustry(industry);
  if (moduleKey === "shift_management") return isShiftIndustry(industry);
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
      .then((data) => {
        if (!mounted) return;
        setIndustry(data.tenant?.industry || null);
        setRole(data.user.role || session?.role || null);
        setJobTitle(data.user.jobTitle || session?.jobTitle || null);
        if (data.modules?.length) setEnabledModules(data.modules);
      })
      .catch(() => { if (mounted) setIndustry(null); });
    getMyModules()
      .then((data) => {
        if (mounted) {
          setEnabledModules((current) => data.modules?.length ? data.modules : (current?.length ? current : (data.modules || [])));
          // El catálogo puede devolver el rol de la membresía del tenant. Se
          // conserva SUPER_ADMIN cuando la sesión o /auth/me ya lo confirmó.
          setRole((current) => (
            String(current || session?.role || "").toUpperCase() === "SUPER_ADMIN"
              ? "SUPER_ADMIN"
              : (data.role || session?.role || null)
          ));
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
      : applicableItems.filter(([, href, , , moduleKey]) => {
        if (href === "/realty") {
          return realtyGatewayModules.some((key) =>
            moduleAllowed(key, enabledModules, showDeveloperItems ? "SUPER_ADMIN" : role, jobTitle),
          );
        }
        return moduleAllowed(moduleKey, enabledModules, showDeveloperItems ? "SUPER_ADMIN" : role, jobTitle);
      });

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

  function toggleMenu() {
    // Al desmontar el menú cerrado el navegador puede intentar reenfocar el
    // documento y mover la página. Conservamos la lectura actual del módulo.
    const pageY = typeof window === "undefined" ? 0 : window.scrollY;
    const pageX = typeof window === "undefined" ? 0 : window.scrollX;
    saveMenuPosition();
    onToggle();
    if (typeof window !== "undefined") {
      window.requestAnimationFrame(() => window.scrollTo(pageX, pageY));
    }
  }

  if (!isOpen) {
    return (
      <button className="evolum-menu-bubble" type="button" onClick={toggleMenu} aria-label="Abrir menu EVOLUM">
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
        <button className="inbox-nav-toggle" type="button" onClick={toggleMenu} aria-label="Cerrar menu">
          x
        </button>
      </div>

      <nav className="inbox-unified-nav-list" ref={navRef} onScroll={saveMenuPosition}>
        {items.map(([label, href, description, icon]) => {
          const selected = pathname === href
            || pathname.startsWith(`${href}/`)
            || label === active
            || (label === "Inmobiliaria" && realtyRoutes.some((route) => pathname === route || pathname.startsWith(`${route}/`)));
          return (
          <Link className={selected ? "active" : ""} href={href} key={label} title={label} data-evolum-active={selected ? "true" : "false"} onClick={saveMenuPosition}>
            <ModuleSymbol code={icon} label={label} />
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
