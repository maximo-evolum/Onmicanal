"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { getMe } from "@/lib/api";
import { getStoredSession, LogoutButton } from "@/lib/auth";
import { moduleAllowed, type ModuleAccessKey } from "@/lib/module-access";
import { getVerticalProduct, type VerticalProductCode } from "@/lib/vertical-products";
import { getStoredTenantAccess, storeTenantAccess } from "@/lib/session-access";

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

type NavigationGroup = {
  id: "crm" | "vertical" | "core" | "settings";
  label: string;
  description: string;
  icon: string;
  items: SidebarItem[];
};

const baseItems: SidebarItem[] = [
  ["CRM", "/crm-principal", "Centro comercial y operación transversal", "IN", "crm"],
  ["Chat's", "/inbox", "Conversaciones y atencion IA", "CH", "inbox"],
  ["Agenda", "/agenda", "Reservas, citas y disponibilidad", "AG", "agenda"],
  ["Pipeline", "/pipeline", "Leads, clientes y oportunidades", "PI", "pipeline"],
  ["Campañas", "/campaigns", "Marketing IA y publicaciones", "CA", "campaigns"],
  ["Pagos", "/payments", "Cobros, estados y links", "PA", "payments"],
  ["Centro de Conexiones", "/connections", "Correo, archivos, pagos y respaldo", "CX", "integrations"],
  ["Documentos", "/documents", "Archivos, adjuntos y documentos operativos", "DO", "documents"],
  ["Configuracion de Agente", "/onboarding", "Perfil, documentos, FAQs y reglas IA", "CG", "onboarding"],
  ["Automatizaciones", "/workflows", "Acciones que EVOLUM realiza por ti", "FW", "workflows"],
  ["Datos y formularios", "/settings/metadata", "Define los datos que completará tu equipo", "MD", "metadata"],
  ["Planes y modulos", "/saas", "Plan, modulos, usuarios y limites", "PM", "saas"],
  ["Dashboard", "/dashboard", "Metricas operativas", "DA", "dashboard"],
  ["AI Ops / Cierres IA", "/ai-ops", "Razonamiento, cierres y alertas IA", "AI", "ai_ops"],
  ["Control de IA", "/settings/ai", "Define qué puede hacer la IA y cuándo pedir ayuda", "GI", "ai_ops"],
  // Inmobiliaria es un producto aislado, pero sus áreas se navegan desde el
  // menú EV. Así no se duplican pestañas dentro del workspace ni se ocultan
  // funciones importantes al corredor.
  ["Resumen inmobiliario", "/realty", "Centro de control de la cartera", "RE", "properties"],
  ["Cargas inmobiliarias", "/realty?view=operations", "Captación, carga manual e importación", "RC", "realty_loads"],
  ["Propiedades", "/realty?view=properties", "Inventario, fichas y publicación", "RP", "properties"],
  ["Corredores", "/realty?view=brokers", "Equipo comercial y reparto de cartera", "RB", "brokers"],
  ["Actividad inmobiliaria", "/realty?view=activity", "Visitas, alertas y seguimientos", "RA", "realty_activity"],
  ["Portal corredor", "/realty?view=portal", "Cartera asignada y publicación", "RO", "broker_portal"],
  ["Clientes inmobiliarios", "/realty?view=buyers", "Perfiles compradores y matching", "RL", "realty_clients"],
  ["Capacitación de corredores", "/realty?view=training", "Formación y progreso comercial", "RT", "brokers"],
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

const financeGatewayModules: ModuleAccessKey[] = [
  "finance_invoices", "finance_bank_sync", "finance_reconciliation",
  "finance_exceptions", "finance_collections", "finance_analytics"
];

// Símbolos funcionales, no siglas: reducen el tiempo de reconocimiento del
// módulo y mantienen un lenguaje visual coherente dentro del menú EV.
const moduleSymbols: Record<string, string> = {
  IN: "⌂", CH: "◌", AG: "◷", PI: "↗", CA: "✦", PA: "▣", CX: "⌁",
  CG: "⚙", FW: "⇄", MD: "▤", PM: "◫", DA: "▥", AI: "✧", GI: "◈",
  RE: "⌂", RC: "⇧", RP: "⌂", RB: "♙", RA: "◴", RO: "◈", RL: "◌", RT: "✦",
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

function verticalWorkspaceItem(item: SidebarItem, productCode: VerticalProductCode) {
  const [, href, , , moduleKey] = item;
  const product = getVerticalProduct(productCode);
  if (!product) return false;
  return href === product.href || product.gatewayModules.includes(moduleKey) || product.sharedModuleKeys.includes(moduleKey);
}

function isShiftIndustry(industry?: string | null) {
  const value = String(industry || "").toUpperCase();
  return value.includes("GASTRON") || value.includes("HEALTH") || value.includes("SALUD") || value.includes("CLINIC") || value.includes("DENT") || value.includes("VETER");
}

function isGastronomyIndustry(industry?: string | null) {
  return String(industry || "").toUpperCase().includes("GASTRON");
}

function currentVerticalLabel(industry?: string | null, product?: ReturnType<typeof getVerticalProduct>) {
  if (product) return product.label;
  const value = String(industry || "").toUpperCase();
  if (value.includes("GASTRON")) return "Gastronomía";
  if (value.includes("DENT")) return "Clínica dental";
  if (value.includes("VETER")) return "Clínica veterinaria";
  if (value.includes("HEALTH") || value.includes("SALUD") || value.includes("CLINIC")) return "Salud clínica";
  if (value.includes("AUTO") || value.includes("TALLER") || value.includes("MECAN")) return "Automotriz y taller";
  return null;
}

function contextualizeItem(item: SidebarItem, industry?: string | null): SidebarItem {
  const [, href, , icon, moduleKey] = item;
  if (moduleKey === "inbox" && isRealtyIndustry(industry)) {
    return ["Chat's", href, "Conversaciones, leads compradores y atención comercial", icon, moduleKey];
  }
  if (moduleKey === "dashboard" && isRealtyIndustry(industry)) {
    return ["Dashboard y reportes", href, "Indicadores inmobiliarios y reporte ejecutivo PDF", icon, moduleKey];
  }
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
  const initialSession = getStoredSession();
  const initialAccess = getStoredTenantAccess(initialSession);
  const [enabledModules, setEnabledModules] = useState<string[] | null>(() => initialAccess?.modules || null);
  const [role, setRole] = useState<string | null>(() => initialAccess?.role || initialSession?.role || null);
  const [jobTitle, setJobTitle] = useState<string | null>(() => initialAccess?.jobTitle || initialSession?.jobTitle || null);
  const [industry, setIndustry] = useState<string | null>(() => initialAccess?.industry || null);
  const [menuReady, setMenuReady] = useState(Boolean(initialAccess));
  const navRef = useRef<HTMLElement | null>(null);
  const pathname = usePathname();
  // Se lee la query actual sin useSearchParams para que el menú pueda vivir
  // en todas las páginas estáticas sin forzar un límite Suspense global.
  const currentSearchParams = typeof window === "undefined"
    ? new URLSearchParams()
    : new URLSearchParams(window.location.search);

  useEffect(() => {
    let mounted = true;
    const session = getStoredSession();
    const storedAccess = getStoredTenantAccess(session);
    setRole(session?.role || null);
    setJobTitle(session?.jobTitle || null);
    if (storedAccess) {
      setEnabledModules(storedAccess.modules);
      setRole(storedAccess.role || session?.role || null);
      setJobTitle(storedAccess.jobTitle || session?.jobTitle || null);
      setIndustry(storedAccess.industry || null);
      setMenuReady(true);
      return () => { mounted = false; };
    }
    getMe()
      .then((data) => {
        if (!mounted) return;
        setIndustry(data.tenant?.industry || null);
        setRole(data.user.role || session?.role || null);
        setJobTitle(data.user.jobTitle || session?.jobTitle || null);
        setEnabledModules(data.modules || []);
        storeTenantAccess({
          userId: data.user.id,
          tenantId: data.user.tenantId || null,
          role: data.user.role || session?.role || null,
          jobTitle: data.user.jobTitle || session?.jobTitle || null,
          industry: data.tenant?.industry || null,
          modules: data.modules || []
        });
        setMenuReady(true);
      })
      .catch(() => { if (mounted) { setEnabledModules([]); setMenuReady(true); } });

    return () => {
      mounted = false;
    };
  }, []);

  const items = useMemo(() => {
    const showDeveloperItems = isDeveloper || String(role || "").toUpperCase() === "SUPER_ADMIN";
    const product = getVerticalProduct(industry);
    const allItems = (showDeveloperItems ? [...baseItems, ...developerItems] : baseItems)
      .map((item) => contextualizeItem(item, industry));
    // La navegación de productos no vuelve a mezclar verticales: dentro de
    // cada tenant de Inmobiliaria o Finanzas aparece su workspace y solo las
    // capacidades de plataforma necesarias. Super Admin conserva el acceso
    // global a través de Desarrollador, no como módulos operativos cruzados.
    const applicableItems = product
      ? allItems.filter((item) => verticalWorkspaceItem(item, product.code) || (showDeveloperItems && item[4] === "admin"))
      : allItems.filter((item) => itemBelongsToIndustry(item, industry));
    const availableItems = enabledModules === null
      ? applicableItems
      : applicableItems.filter(([, href, , , moduleKey]) => {
        if (href === "/realty") {
          return realtyGatewayModules.some((key) =>
            moduleAllowed(key, enabledModules, showDeveloperItems ? "SUPER_ADMIN" : role, jobTitle, industry),
          );
        }
        if (href === "/finance") {
          return financeGatewayModules.some((key) =>
            moduleAllowed(key, enabledModules, showDeveloperItems ? "SUPER_ADMIN" : role, jobTitle, industry),
          );
        }
        return moduleAllowed(moduleKey, enabledModules, showDeveloperItems ? "SUPER_ADMIN" : role, jobTitle, industry);
      });

    // El workspace del producto encabeza la navegación. Las opciones de
    // plataforma siguen ordenadas para que el menú sea predecible.
    return [...availableItems].sort(([leftLabel, leftHref], [rightLabel, rightHref]) => {
      if (product && leftHref === product.href) return -1;
      if (product && rightHref === product.href) return 1;
      if (leftLabel === "CRM") return -1;
      if (rightLabel === "CRM") return 1;
      return leftLabel.localeCompare(rightLabel, "es");
    });
  }, [enabledModules, industry, isDeveloper, jobTitle, role]);

  const navigationGroups = useMemo<NavigationGroup[]>(() => {
    const product = getVerticalProduct(industry);
    const crmModules = new Set<ModuleAccessKey>(["crm", "inbox", "agenda", "pipeline", "campaigns", "payments"]);
    const settingsModules = new Set<ModuleAccessKey>(["onboarding", "metadata", "saas", "admin", "bot_lab"]);
    const coreModules = new Set<ModuleAccessKey>(["dashboard", "ai_ops", "workflows", "integrations", "documents"]);
    const verticalLabel = currentVerticalLabel(industry, product);

    const crmItems = items.filter((item) => crmModules.has(item[4]));
    const settingsItems = items.filter((item) => settingsModules.has(item[4]));
    const coreItems = items.filter((item) => coreModules.has(item[4]));
    const verticalItems = items.filter((item) => {
      const moduleKey = item[4];
      return !crmModules.has(moduleKey) && !settingsModules.has(moduleKey) && !coreModules.has(moduleKey);
    });

    const groups: NavigationGroup[] = [];
    if (crmItems.length) groups.push({
      id: "crm",
      label: "CRM",
      description: "Operación comercial, conversaciones y seguimiento",
      icon: "IN",
      items: crmItems
    });
    // Cada cuenta ve un único grupo vertical: el propio. Nunca se muestran
    // rubros ajenos como opciones navegables dentro del menú EV.
    if (verticalLabel && verticalItems.length) groups.push({
      id: "vertical",
      label: verticalLabel,
      description: "Herramientas propias de esta operación",
      icon: product?.code === "FINANCE" ? "FI" : "RE",
      items: verticalItems
    });
    if (coreItems.length) groups.push({
      id: "core",
      label: "Core EVOLUM",
      description: "Inteligencia, reportes, automatización e integraciones",
      icon: "AI",
      items: coreItems
    });
    if (settingsItems.length) groups.push({
      id: "settings",
      label: "Configuración",
      description: "Cuenta, usuarios, datos y permisos",
      icon: "CG",
      items: settingsItems
    });
    return groups;
  }, [industry, items]);

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

      <nav className="inbox-unified-nav-list evolum-nav-groups" ref={navRef} onScroll={saveMenuPosition} aria-busy={!menuReady}>
        {!menuReady ? <div className="evolum-nav-loading">Cargando menú de esta cuenta…</div> : navigationGroups.map((group) => {
          const groupHasActiveItem = group.items.some(([label, href]) => {
            const [targetPath, targetQuery] = href.split("?");
            const queryMatches = !targetQuery || targetQuery.split("&").every((entry) => {
              const [key, value = ""] = entry.split("=");
              return currentSearchParams.get(key) === value;
            });
            return targetPath === "/realty" ? label === active : (label === active || (pathname === targetPath && queryMatches));
          });
          return (
            <details className="evolum-nav-group" key={group.id} open={groupHasActiveItem || group.id === "crm"}>
              <summary>
                <ModuleSymbol code={group.icon} label={group.label} />
                <span className="evolum-nav-group-copy">
                  <strong>{group.label}</strong>
                  <small>{group.description}</small>
                </span>
                <span className="evolum-nav-group-chevron" aria-hidden="true">›</span>
              </summary>
              <div className="evolum-nav-group-links">
                {group.items.map(([label, href, description, icon]) => {
                  const [targetPath, targetQuery] = href.split("?");
                  const queryMatches = !targetQuery || targetQuery.split("&").every((entry) => {
                    const [key, value = ""] = entry.split("=");
                    return currentSearchParams.get(key) === value;
                  });
                  const matchesRoute = pathname === targetPath && queryMatches;
                  const selected = targetPath === "/realty" ? label === active : (label === active || matchesRoute);
                  return (
                    <Link className={selected ? "active" : ""} href={href} key={label} title={label} data-evolum-active={selected ? "true" : "false"} onClick={saveMenuPosition}>
                      <ModuleSymbol code={icon} label={label} />
                      <div><strong>{label}</strong><small>{description}</small></div>
                    </Link>
                  );
                })}
              </div>
            </details>
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
