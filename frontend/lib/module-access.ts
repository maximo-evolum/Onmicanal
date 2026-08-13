"use client";

import { useEffect, useMemo, useState } from "react";
import { getMe, getMyModules } from "./api";
import { getStoredSession } from "./auth";
import { getStoredTenantAccess, storeTenantAccess } from "./session-access";

export type ModuleAccessKey =
  | "crm"
  | "inbox"
  | "agenda"
  | "pipeline"
  | "campaigns"
  | "payments"
  | "onboarding"
  | "saas"
  | "dashboard"
  | "ai_ops"
  | "admin"
  | "bot_lab"
  | "properties"
  | "property_assignments"
  | "realty_loads"
  | "realty_activity"
  | "broker_portal"
  | "brokers"
  | "customers"
  | "realty_clients"
  | "patients"
  | "exams"
  | "metadata"
  | "revenue"
  | "vehicles"
  | "vehicle_owners"
  | "parts_inventory"
  | "mechanic_assignments"
  | "ready_notifications"
  | "shift_management"
  | "gastronomy_operations"
  | "dental_care"
  | "health_care"
  | "veterinary_care"
  | "documents"
  | "workflows"
  | "integrations"
  | "gmail"
  | "email_imap"
  | "google_drive"
  | "sharepoint"
  | "backup_provider"
  | "offline_sync"
  | "security_replica"
  | "finance_invoices"
  | "finance_bank_sync"
  | "finance_reconciliation"
  | "finance_exceptions"
  | "finance_collections"
  | "finance_analytics";

const moduleAliases: Record<ModuleAccessKey, string[]> = {
  crm: ["crm", "crm_principal"],
  inbox: ["inbox"],
  agenda: ["agenda", "bookings"],
  pipeline: ["pipeline", "sales"],
  campaigns: ["campaigns", "marketing"],
  payments: ["payments"],
  onboarding: ["onboarding", "knowledge", "configuracion_agente"],
  saas: ["saas", "plans", "planes", "users"],
  dashboard: ["dashboard", "analytics"],
  ai_ops: ["ai_ops", "ai-ops", "followups", "sales"],
  admin: ["admin", "developer", "desarrollador"],
  bot_lab: ["bot_lab", "bot-lab"],
  properties: ["properties", "propiedades"],
  property_assignments: ["property_assignments", "seller_assignments", "asignacion_ventas"],
  realty_loads: ["realty_loads", "cargas_inmobiliarias", "cargas"],
  realty_activity: ["realty_activity", "actividad_inmobiliaria"],
  broker_portal: ["broker_portal", "portal_corredor"],
  brokers: ["brokers", "corredores"],
  customers: ["customers", "clientes", "pacientes"],
  realty_clients: ["realty_clients", "clientes_inmobiliarios", "clientes"],
  patients: ["patients", "pacientes"],
  exams: ["exams", "examenes", "presupuestos", "examenes_y_presupuestos"],
  metadata: ["metadata", "esquemas_de_datos"],
  revenue: ["revenue", "ganancias", "ingresos"],
  vehicles: ["vehicles", "vehiculos"],
  vehicle_owners: ["vehicle_owners", "duenos_vehiculos", "vehiculos"],
  parts_inventory: ["parts_inventory", "repuestos", "inventario_repuestos"],
  mechanic_assignments: ["mechanic_assignments", "asignacion_mecanicos"],
  ready_notifications: ["ready_notifications", "avisos_retiro"],
  shift_management: ["shift_management", "turnos", "turnos_clinicos", "turnos_veterinarios", "turnos_local"],
  gastronomy_operations: ["gastronomy_operations", "operacion_gastronomica", "mesas_y_comandas"],
  dental_care: ["dental_care", "atencion_dental", "odontograma"],
  health_care: ["health_care", "atencion_clinica", "ficha_clinica"],
  veterinary_care: ["veterinary_care", "atencion_veterinaria", "mascotas_y_tutores"],
  documents: ["documents", "documentos", "archivos"],
  workflows: ["workflows", "workflow", "automatizaciones"],
  integrations: ["integrations", "integraciones", "conectores"],
  gmail: ["gmail", "google_workspace", "correo_gmail", "correo"],
  email_imap: ["email_imap", "imap", "smtp", "correo_imap", "correo_smtp"],
  google_drive: ["google_drive", "drive", "gdrive"],
  sharepoint: ["sharepoint", "onedrive", "microsoft_drive"],
  backup_provider: ["backup_provider", "backups", "respaldo", "proveedor_respaldo"],
  offline_sync: ["offline_sync", "offline", "sync_offline", "modo_offline"],
  security_replica: ["security_replica", "replica", "replica_seguridad", "drp"],
  finance_invoices: ["finance_invoices", "finance_invoice", "facturas_finance"],
  finance_bank_sync: ["finance_bank_sync", "bank_sync", "cartolas", "movimientos_bancarios"],
  finance_reconciliation: ["finance_reconciliation", "reconciliation", "conciliacion_financiera"],
  finance_exceptions: ["finance_exceptions", "finance_exception", "excepciones_financieras"],
  finance_collections: ["finance_collections", "collections", "cobranza_ia"],
  finance_analytics: ["finance_analytics", "finance_dashboard", "analitica_financiera"],
};

// CRM y administración de cuenta son parte del Core EVOLUM.
const alwaysAllowed = new Set<ModuleAccessKey>(["crm", "saas"]);

const brokerModuleAllowlist = new Set<ModuleAccessKey>([
  "crm",
  "inbox",
  "agenda",
  "dashboard",
  "pipeline",
  "ai_ops",
  "properties",
  "broker_portal"
]);

type ModuleAccessCacheEntry = {
  modules: string[];
  role: string | null;
  industry: string | null;
};

// Evita volver a bloquear visualmente cada ruta mientras ya conocemos los
// permisos de la misma sesión. La API se sigue consultando en segundo plano.
const moduleAccessCache = new Map<string, ModuleAccessCacheEntry>();

function moduleAccessCacheKey(session: ReturnType<typeof getStoredSession>) {
  if (!session?.id) return null;
  return `${session.id}:${session.tenantId || "default"}`;
}

function normalizeModule(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, "_");
}

function isDeveloperRole(role?: string | null) {
  return String(role || "").toUpperCase() === "SUPER_ADMIN";
}

// Replica la frontera de verticales del backend para que una ruta abierta
// manualmente no parezca disponible mientras la API la rechaza. El backend
// continúa siendo la fuente de autorización definitiva.
const verticalModuleIndustries: Partial<Record<ModuleAccessKey, string[]>> = {
  properties: ["REAL_ESTATE"], property_assignments: ["REAL_ESTATE"], realty_loads: ["REAL_ESTATE"],
  realty_activity: ["REAL_ESTATE"], broker_portal: ["REAL_ESTATE"], brokers: ["REAL_ESTATE"], realty_clients: ["REAL_ESTATE"],
  vehicles: ["AUTOMOTIVE"], vehicle_owners: ["AUTOMOTIVE"], parts_inventory: ["AUTOMOTIVE"],
  mechanic_assignments: ["AUTOMOTIVE"], ready_notifications: ["AUTOMOTIVE"],
  gastronomy_operations: ["GASTRONOMY"], dental_care: ["DENTAL"], health_care: ["HEALTH"], veterinary_care: ["VETERINARY"],
  finance_invoices: ["FINANCE"], finance_bank_sync: ["FINANCE"], finance_reconciliation: ["FINANCE"],
  finance_exceptions: ["FINANCE"], finance_collections: ["FINANCE"], finance_analytics: ["FINANCE"]
};

function normalizeIndustry(value?: string | null) {
  const normalized = String(value || "GENERAL").trim().toUpperCase();
  // Los tenants históricos y los creados desde el panel pueden guardar el
  // mismo rubro con nombres distintos. La autorización visual debe usar las
  // mismas claves canónicas que el backend; si no, un módulo habilitado puede
  // parecer bloqueado para una cuenta válida.
  if (normalized === "INMOBILIARIA" || normalized === "REALTY" || normalized === "CORRETAJE") return "REAL_ESTATE";
  if (normalized === "GASTRONOMÍA" || normalized === "GASTRONOMIA") return "GASTRONOMY";
  if (normalized === "VETERINARIA" || normalized === "CLINICA_VETERINARIA" || normalized === "CLÍNICA VETERINARIA") return "VETERINARY";
  if (normalized === "SALUD" || normalized === "SALUD_CLINICA" || normalized === "SALUD CLÍNICA") return "HEALTH";
  if (normalized === "FINANZAS" || normalized === "FINANCIERO" || normalized === "FINANCIERA" || normalized === "CONTABILIDAD" || normalized === "CONTABLE") return "FINANCE";
  return normalized;
}

function isModuleCompatibleWithIndustry(moduleKey: ModuleAccessKey, industry?: string | null) {
  const allowedIndustries = verticalModuleIndustries[moduleKey];
  return !allowedIndustries || allowedIndustries.includes(normalizeIndustry(industry));
}

export function moduleAllowed(moduleKey: ModuleAccessKey, modules: string[], role?: string | null, jobTitle?: string | null, industry?: string | null) {
  if (isDeveloperRole(role)) return true;
  if (!isModuleCompatibleWithIndustry(moduleKey, industry)) return false;
  if (moduleKey === "metadata") return ["OWNER", "ADMIN"].includes(String(role || "").toUpperCase());
  if (alwaysAllowed.has(moduleKey)) return true;
  const isBroker = String(role || "").toUpperCase() === "SELLER" && /corredor/i.test(String(jobTitle || ""));
  if (isBroker && !brokerModuleAllowlist.has(moduleKey)) return false;
  const normalized = new Set(modules.map(normalizeModule));
  return moduleAliases[moduleKey].some((alias) => normalized.has(normalizeModule(alias)));
}

export function useModuleAccess(moduleKey?: ModuleAccessKey) {
  // El primer render debe ser idéntico en servidor y navegador. La sesión y
  // el cache de permisos se leen únicamente tras montar la interfaz.
  const [session, setSession] = useState<ReturnType<typeof getStoredSession>>(null);
  const [sessionReady, setSessionReady] = useState(false);
  const [modules, setModules] = useState<string[] | null>(null);
  const [authoritativeRole, setAuthoritativeRole] = useState<string | null>(null);
  const [industry, setIndustry] = useState<string | null>(null);
  const [loading, setLoading] = useState(Boolean(moduleKey));
  const [identityLoading, setIdentityLoading] = useState(Boolean(moduleKey));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setSession(getStoredSession());
    setSessionReady(true);
  }, []);

  const cacheKey = moduleAccessCacheKey(session);

  useEffect(() => {
    let active = true;
    if (!moduleKey || !sessionReady) return;

    const currentCache = cacheKey ? moduleAccessCache.get(cacheKey) : null;
    const persistedAccess = getStoredTenantAccess(session);
    const currentAccess = currentCache || persistedAccess;
    if (currentAccess) {
      setModules(currentAccess.modules);
      setAuthoritativeRole(currentAccess.role || session?.role || null);
      setIndustry(currentAccess.industry || null);
      setLoading(false);
      setIdentityLoading(false);
      if (cacheKey && !currentCache) moduleAccessCache.set(cacheKey, currentAccess);
      // El acceso ya fue validado al iniciar sesión: no repetir solicitudes ni
      // volver a mostrar el estado de validación al navegar entre módulos.
      return () => { active = false; };
    }

    setLoading(true);
    setIdentityLoading(true);
    getMe()
      .then((data) => {
        if (!active) return;
        setAuthoritativeRole(data.user.role || null);
        // /auth/me ya entrega los módulos autorizados para esta sesión. Los
        // conservamos como respaldo cuando el catálogo tarda en sincronizar.
        if (data.modules?.length) {
          setModules(data.modules);
          const nextIndustry = data.tenant?.industry || null;
          setIndustry(nextIndustry);
          const nextAccess = { modules: data.modules, role: data.user.role || null, industry: nextIndustry };
          if (cacheKey) moduleAccessCache.set(cacheKey, nextAccess);
          storeTenantAccess({
            userId: data.user.id,
            tenantId: data.user.tenantId || null,
            role: data.user.role || null,
            jobTitle: data.user.jobTitle || null,
            industry: nextIndustry,
            modules: data.modules
          });
        }
      })
      .finally(() => { if (active) setIdentityLoading(false); });

    getMyModules()
      .then((data) => {
        if (!active) return;
        setModules((current) => {
          const nextModules = data.modules?.length ? data.modules : (current?.length ? current : (data.modules || []));
          const nextIndustry = data.industry || industry;
          if (data.industry) setIndustry(data.industry);
          if (cacheKey) {
            const preservedRole = isDeveloperRole(session?.role) ? "SUPER_ADMIN" : (data.role || session?.role || null);
            moduleAccessCache.set(cacheKey, { modules: nextModules, role: preservedRole, industry: nextIndustry });
            if (session?.id) storeTenantAccess({
              userId: session.id,
              tenantId: session.tenantId || null,
              role: preservedRole,
              jobTitle: session.jobTitle || null,
              industry: nextIndustry,
              modules: nextModules
            });
          }
          return nextModules;
        });
        // Si /auth/me ya resolvió el rol actual, no volver a pisarlo con
        // información local antigua. El rol del catálogo solo es respaldo.
        if (data.role) {
          // El catálogo representa el rol dentro del tenant y puede responder
          // antes que /auth/me. Nunca debe rebajar visualmente a un Super Admin.
          setAuthoritativeRole((current) => (
            isDeveloperRole(current) || isDeveloperRole(session?.role) ? "SUPER_ADMIN" : (data.role || null)
          ));
        }
        setError(null);
      })
      .catch((err) => {
        if (!active) return;
        // El backend mantiene la autorizacion real. No bloquear la interfaz
        // por una falla transitoria al consultar los modulos del tenant.
        setModules(null);
        setError(err instanceof Error ? err.message : "No se pudieron cargar los módulos");
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [cacheKey, moduleKey, session, sessionReady]);

  const allowed = useMemo(() => {
    if (!moduleKey) return true;
    if (loading || identityLoading || modules === null) return true;
    return moduleAllowed(moduleKey, modules, authoritativeRole, session?.jobTitle, industry);
  }, [authoritativeRole, identityLoading, industry, loading, moduleKey, modules, session?.jobTitle]);

  return { allowed, loading, error, modules: modules || [], role: authoritativeRole, industry };
}
