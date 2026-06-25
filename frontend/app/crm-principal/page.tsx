"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  getCampaigns,
  getConversations,
  getCrmOperationalDashboard,
  getLeadMetrics,
  getMe,
  getMyModules,
  getOnboardingKnowledge,
  type CrmOperationalDashboard
} from "@/lib/api";
import { getStoredSession, LogoutButton } from "@/lib/auth";
import { moduleAllowed, type ModuleAccessKey } from "@/lib/module-access";
import type { AgentSession, Campaign, Conversation, LeadMetrics, TenantSession } from "@/lib/types";

type LoadState = {
  session: AgentSession | null;
  conversations: Conversation[];
  leadMetrics: LeadMetrics | null;
  crm: CrmOperationalDashboard | null;
  campaigns: Campaign[];
  modules: string[];
  modulesLoaded: boolean;
  onboarding: any | null;
  plan: AccountLevel;
  tenant: TenantSession | null;
  error: string | null;
};

type AccountLevel = "STARTER" | "PRO" | "BUSINESS" | "ENTERPRISE";

type AgentCatalogItem = {
  id: string;
  name: string;
  team: string;
  status: "Activo" | "Preparado" | "Roadmap";
  minPlan: AccountLevel;
  rubros: string[];
  module?: string;
  href: string;
  initials: string;
  description: string;
  implemented: boolean;
};

type NavItem = {
  label: string;
  href: string;
  description: string;
  moduleKey?: ModuleAccessKey;
};

type SearchResult = NavItem & {
  group: string;
};

const navItems: NavItem[] = [
  { label: "Inicio", href: "/crm-principal", description: "Centro principal de EVOLUM", moduleKey: "crm" },
  { label: "Inbox Omnicanal", href: "/inbox", description: "Conversaciones y atencion IA", moduleKey: "inbox" },
  { label: "Agenda", href: "/agenda", description: "Reservas, citas y disponibilidad", moduleKey: "agenda" },
  { label: "Pipeline", href: "/pipeline", description: "Leads, clientes y oportunidades", moduleKey: "pipeline" },
  { label: "Campañas", href: "/campaigns", description: "Marketing IA y publicaciones", moduleKey: "campaigns" },
  { label: "Pagos", href: "/payments", description: "Cobros, estados y links", moduleKey: "payments" },
  { label: "Configuracion de Agente", href: "/onboarding", description: "Perfil, documentos, FAQs y reglas IA", moduleKey: "onboarding" },
  { label: "Planes y modulos", href: "/saas", description: "Plan, modulos, usuarios y limites", moduleKey: "saas" },
  { label: "Dashboard", href: "/dashboard", description: "Metricas operativas", moduleKey: "dashboard" },
  { label: "AI Ops / Cierres IA", href: "/ai-ops", description: "Razonamiento, cierres y alertas IA", moduleKey: "ai_ops" }
];

const developerOnlyItems: NavItem[] = [
  { label: "Desarrollador", href: "/admin", description: "Clientes, planes, modulos y permisos", moduleKey: "admin" },
  { label: "Bot Lab", href: "/dev/bot-lab", description: "Pruebas de respuestas y reglas", moduleKey: "bot_lab" }
];

const planOrder: AccountLevel[] = ["STARTER", "PRO", "BUSINESS", "ENTERPRISE"];

const agentCatalog: AgentCatalogItem[] = [
  {
    id: "chat",
    name: "Agente de Chat",
    team: "Inbox omnicanal",
    status: "Activo",
    minPlan: "STARTER",
    rubros: ["Todos"],
    module: "inbox",
    href: "/inbox",
    initials: "AC",
    implemented: true,
    description: "Responde WhatsApp, Instagram y mensajes entrantes, califica leads y deriva a humano cuando corresponde."
  },
  {
    id: "campaigns",
    name: "Agente de Campañas",
    team: "Marketing IA",
    status: "Activo",
    minPlan: "PRO",
    rubros: ["Todos"],
    module: "marketing",
    href: "/campaigns",
    initials: "AM",
    implemented: true,
    description: "Genera copys, piezas, variantes y publicaciones para marketing segun el negocio."
  },
  {
    id: "support",
    name: "Agente de Soporte",
    team: "Atencion al cliente",
    status: "Preparado",
    minPlan: "PRO",
    rubros: ["Todos"],
    module: "inbox",
    href: "/inbox",
    initials: "AS",
    implemented: false,
    description: "Resolvera tickets, dudas frecuentes, derivaciones y seguimiento postventa."
  },
  {
    id: "realty",
    name: "Agente Inmobiliario",
    team: "Realty",
    status: "Roadmap",
    minPlan: "BUSINESS",
    rubros: ["Inmobiliaria", "Realty"],
    module: "realty",
    href: "/pipeline",
    initials: "AI",
    implemented: false,
    description: "Conectara AI Corretaje: propiedades, visitas, matching, valorizacion y cotizaciones."
  },
  {
    id: "finance",
    name: "Agente de Finanzas",
    team: "Pagos y cobranza",
    status: "Roadmap",
    minPlan: "BUSINESS",
    rubros: ["Todos"],
    module: "payments",
    href: "/payments",
    initials: "AF",
    implemented: false,
    description: "Detectara pagos pendientes, cobranzas, links de pago y alertas financieras."
  },
  {
    id: "operations",
    name: "Agente de Operaciones",
    team: "Servicios y reservas",
    status: "Roadmap",
    minPlan: "ENTERPRISE",
    rubros: ["Hospitality", "Servicios", "Retail", "Manufactura"],
    module: "bookings",
    href: "/agenda",
    initials: "AO",
    implemented: false,
    description: "Coordinara servicios, reservas, tareas operativas y asignaciones internas."
  }
];

const connectedModuleCatalog: Array<NavItem & { value: (state: LoadState, computed: { openConversations: number; totalLeads: number; agentCount: number }) => string }> = [
  { label: "Inbox Omnicanal", href: "/inbox", description: "Conversaciones unificadas por empresa, canal y prioridad.", moduleKey: "inbox", value: (_state, computed) => String(computed.openConversations) },
  { label: "Agenda", href: "/agenda", description: "Reservas, citas, sucursales y direcciones conectadas al inbox.", moduleKey: "agenda", value: (state) => String(state.crm?.kpis?.bookingsConfirmed ?? 0) },
  { label: "Pipeline", href: "/pipeline", description: "Leads, clientes, oportunidades, tareas y actividad comercial.", moduleKey: "pipeline", value: (_state, computed) => String(computed.totalLeads) },
  { label: "Campañas", href: "/campaigns", description: "Marketing IA y publicaciones conectadas a redes sociales.", moduleKey: "campaigns", value: (state) => String(state.campaigns.length) },
  { label: "Pagos", href: "/payments", description: "Cobros, estados, links y pagos asociados a conversaciones.", moduleKey: "payments", value: (state) => money(state.crm?.revenue?.paid || 0) },
  { label: "Configuracion de Agente", href: "/onboarding", description: "Perfil, documentos, FAQs y reglas IA.", moduleKey: "onboarding", value: (state) => String((state.onboarding?.rules || []).length) },
  { label: "Planes y modulos", href: "/saas", description: "Plan, modulos, usuarios y limites activos.", moduleKey: "saas", value: (state) => planLabel(state.plan) },
  { label: "Dashboard", href: "/dashboard", description: "Metricas operativas en tiempo real.", moduleKey: "dashboard", value: (state) => String(state.crm?.kpis?.conversionRate ?? 0) + "%" },
  { label: "AI Ops / Cierres IA", href: "/ai-ops", description: "Razonamiento, cierres y alertas IA.", moduleKey: "ai_ops", value: (state) => String(state.crm?.kpis?.readyToClose ?? 0) }
];

function money(value = 0) {
  return new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 }).format(value || 0);
}

function shortTime(value?: string | null) {
  if (!value) return "Ahora";
  try {
    return new Intl.DateTimeFormat("es-CL", { hour: "2-digit", minute: "2-digit" }).format(new Date(value));
  } catch {
    return "Ahora";
  }
}

function statusLabel(value?: string | null) {
  const map: Record<string, string> = {
    OPEN: "Abierta",
    PENDING: "Pendiente",
    RESOLVED: "Resuelta",
    CLOSED: "Cerrada",
    DRAFT: "Borrador",
    PROCESSING: "Procesando",
    COMPLETED: "Completada",
    FAILED: "Fallida"
  };
  return map[String(value || "")] || value || "Sin estado";
}

function accountLevelFromPlan(plan?: string | null): AccountLevel {
  const value = String(plan || "").toUpperCase();
  if (["FREE", "STARTER", "BASIC", "BASICA", "MVP", "DEMO"].includes(value)) return "STARTER";
  if (["NORMAL", "PRO"].includes(value)) return "PRO";
  if (["BUSINESS", "ADVANCED", "AVANZADA"].includes(value)) return "BUSINESS";
  if (["ENTERPRISE", "PRO_MAX", "PROFESSIONAL"].includes(value)) return "ENTERPRISE";
  return "STARTER";
}

function planAllows(current: AccountLevel, required: AccountLevel) {
  return planOrder.indexOf(current) >= planOrder.indexOf(required);
}

function planLabel(plan: AccountLevel) {
  return plan;
}

function compactText(value?: string | null, maxLength = 92) {
  const text = String(value || "").replace(/\s+/g, " ").replace(/\*\*/g, "").trim();
  if (!text) return "Sin descripcion reciente.";
  return text.length > maxLength ? `${text.slice(0, maxLength).trim()}...` : text;
}

function phoneLabel(conversation?: Conversation | null) {
  const raw = conversation?.contact?.externalId || conversation?.contact?.username || conversation?.contact?.name || "Sin numero";
  const value = String(raw);
  return value.startsWith("+") || value.toLowerCase().includes("cliente") ? value : `+${value}`;
}

export default function CrmPrincipalPage() {
  const router = useRouter();
  const [state, setState] = useState<LoadState>({
    session: null,
    conversations: [],
    leadMetrics: null,
    crm: null,
    campaigns: [],
    modules: [],
    modulesLoaded: false,
    onboarding: null,
    plan: "STARTER",
    tenant: null,
    error: null
  });
  const [searchTerm, setSearchTerm] = useState("");

  const isDeveloper = state.session?.role === "SUPER_ADMIN";
  const visibleNav = (isDeveloper ? [...navItems, ...developerOnlyItems] : navItems).filter((item) => {
    if (!item.moduleKey || !state.modulesLoaded) return true;
    return moduleAllowed(item.moduleKey, state.modules, state.session?.role);
  });

  async function load() {
    const session = getStoredSession();
    setState((current) => ({ ...current, session }));
    const [me, conversations, leadMetrics, crm, campaigns, modules, onboarding] = await Promise.allSettled([
      getMe(),
      getConversations(),
      getLeadMetrics(),
      getCrmOperationalDashboard(),
      getCampaigns(),
      getMyModules(),
      getOnboardingKnowledge()
    ]);

    setState({
      session,
      conversations: conversations.status === "fulfilled" ? conversations.value : [],
      leadMetrics: leadMetrics.status === "fulfilled" ? leadMetrics.value : null,
      crm: crm.status === "fulfilled" ? crm.value : null,
      campaigns: campaigns.status === "fulfilled" ? campaigns.value : [],
      modules: modules.status === "fulfilled" ? modules.value.modules || [] : [],
      modulesLoaded: true,
      onboarding: onboarding.status === "fulfilled" ? onboarding.value : null,
      plan: modules.status === "fulfilled" ? accountLevelFromPlan(modules.value.plan) : accountLevelFromPlan(me.status === "fulfilled" ? me.value.tenant?.plan : null),
      tenant: me.status === "fulfilled" ? me.value.tenant : null,
      error: [me, conversations, leadMetrics, crm, campaigns, modules, onboarding].some((item) => item.status === "rejected")
        ? "Algunos datos reales no pudieron cargarse. Se muestran datos disponibles y estructura base."
        : null
    });
  }

  useEffect(() => {
    setState((current) => ({ ...current, session: getStoredSession() }));
    load().catch((error) => {
      setState((current) => ({
        ...current,
        session: getStoredSession(),
        error: error instanceof Error ? error.message : "No se pudo cargar el CRM principal"
      }));
    });
  }, []);

  const currentSession = state.session;

  const openConversations = state.conversations.filter((item) => item.status === "OPEN").length;
  const hotLeads = state.leadMetrics?.alerts?.hotLeads ?? state.crm?.kpis?.hotLeads ?? 0;
  const totalLeads = state.leadMetrics?.total ?? state.crm?.kpis?.leads ?? 0;
  const estimatedRevenue = state.crm?.forecasts?.expectedRevenue ?? state.leadMetrics?.estimatedRevenue ?? 0;
  const enabledAgents = agentCatalog.filter((agent) => (
    agent.implemented &&
    (
      isDeveloper ||
      (planAllows(state.plan, agent.minPlan) && (!agent.module || state.modules.includes(agent.module)))
    )
  ));
  const agentCount = isDeveloper ? agentCatalog.length : enabledAgents.length;

  const summary = [
    { label: "Agentes visibles", value: `${agentCount}`, delta: isDeveloper ? "Catalogo global" : `Plan ${planLabel(state.plan)}`, tone: "success" },
    { label: "Conversaciones abiertas", value: openConversations, delta: "Inbox omnicanal", tone: "info" },
    { label: "Leads detectados", value: totalLeads, delta: `${hotLeads} calientes`, tone: "primary" },
    { label: "Valor estimado", value: money(estimatedRevenue), delta: "Forecast comercial", tone: "warning" }
  ];

  const activeAgents = useMemo(() => enabledAgents.map((agent) => ({
    ...agent,
    work: agent.id === "chat" ? `${openConversations} conversaciones abiertas` : `${state.campaigns.length} campañas`,
    result: agent.id === "chat"
      ? `${totalLeads} leads registrados`
      : state.campaigns[0]
        ? `Ultima: ${statusLabel(state.campaigns[0].status)}`
        : "Listo para usar"
  })), [enabledAgents, openConversations, totalLeads, state.campaigns]);

  const activity = state.conversations.slice(0, 5).map((conversation) => ({
    channel: conversation.contact?.channel || "whatsapp",
    name: conversation.contact?.name || conversation.contact?.username || phoneLabel(conversation),
    phone: phoneLabel(conversation),
    description: compactText(conversation.aiSummary || conversation.lastMessage?.content || conversation.aiNextAction || `Conversacion ${statusLabel(conversation.status)}`),
    time: shortTime(conversation.lastMessageAt),
    id: conversation.id
  }));

  const fallbackActivity = [
    { channel: "whatsapp", name: "Demo WhatsApp", phone: "+56 9 demo", description: "El agente de chat esta listo para gestionar conversaciones.", time: "Ahora", id: "" },
    { channel: "whatsapp", name: "Campañas", phone: "+56 9 marketing", description: "El agente de campañas esta listo para generar contenido.", time: "Ahora", id: "" },
    { channel: "whatsapp", name: "EVOLUM", phone: "+56 9 crm", description: "La vista principal ya separa usuario y desarrollador.", time: "Ahora", id: "" }
  ];

  const modules = connectedModuleCatalog.map((module) => ({
    title: module.label,
    text: module.description,
    href: module.href,
    moduleKey: module.moduleKey,
    value: module.value(state, { openConversations, totalLeads, agentCount })
  })).filter((item) => {
    if (!item.moduleKey || !state.modulesLoaded) return true;
    return moduleAllowed(item.moduleKey, state.modules, state.session?.role);
  });
  const latestImport = Array.isArray(state.onboarding?.imports) ? state.onboarding.imports[0] : null;
  const latestImportStatus = String(latestImport?.status || "").toUpperCase();
  const onboardingRows = [
    {
      title: "Perfil comercial",
      type: state.onboarding?.profile?.industry || state.onboarding?.tenant?.industry || state.tenant?.industry || "Rubro pendiente",
      status: state.onboarding?.profile || state.onboarding?.tenant?.onboardingCompleted ? "active" : "pending",
      label: state.onboarding?.profile || state.onboarding?.tenant?.onboardingCompleted ? "Activo" : "Pendiente"
    },
    {
      title: "Productos / servicios",
      type: `${(state.onboarding?.products || []).length} registros cargados`,
      status: (state.onboarding?.products || []).length ? "active" : "pending",
      label: (state.onboarding?.products || []).length ? "Activo" : "Pendiente"
    },
    {
      title: "Reglas / FAQs",
      type: `${(state.onboarding?.rules || []).length} reglas disponibles`,
      status: (state.onboarding?.rules || []).length ? "active" : "pending",
      label: (state.onboarding?.rules || []).length ? "Activo" : "Pendiente"
    },
    {
      title: "Ultima carga",
      type: latestImport ? statusLabel(latestImport.status) : "Sin importaciones recientes",
      status: latestImportStatus === "FAILED" || latestImportStatus === "ERROR" ? "error" : latestImport ? "active" : "pending",
      label: latestImportStatus === "FAILED" || latestImportStatus === "ERROR" ? "Error" : latestImport ? "Activo" : "Pendiente"
    }
  ];
  const homeAccessItems = visibleNav.filter((item) => !item.href.startsWith("#"));
  const normalizedSearch = searchTerm.trim().toLowerCase();
  const searchIndex: SearchResult[] = [
    ...visibleNav.map((item) => ({ ...item, group: "Modulo" })),
    ...enabledAgents.map((agent) => ({
      label: agent.name,
      href: agent.href,
      description: `${agent.team}. ${agent.description}`,
      group: "Agente IA"
    })),
    ...modules.map((module) => ({
      label: module.title,
      href: module.href,
      description: module.text,
      group: "Operacion"
    })),
    ...onboardingRows.map((row) => ({
      label: row.title,
      href: "/onboarding",
      description: `${row.type}. ${row.label}`,
      group: "Configuracion"
    }))
  ];
  const searchResults = normalizedSearch
    ? searchIndex.filter((item) => item.label.trim().toLowerCase().startsWith(normalizedSearch)).slice(0, 8)
    : homeAccessItems.map((item) => ({ ...item, group: "Modulo" })).slice(0, 6);
  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const first = searchResults[0];
    if (!first) return;
    if (first.href.startsWith("#")) {
      window.location.hash = first.href;
      return;
    }
    router.push(first.href);
  }

  return (
    <main className="crm-main">
      <aside className="crm-main-sidebar">
        <div className="crm-main-brand">
          <div className="crm-main-mark">EV</div>
          <div>
            <strong>EVOLUM</strong>
            <span>{isDeveloper ? "Catalogo global" : "CRM operativo"}</span>
          </div>
        </div>

        <nav className="crm-main-nav">
          {visibleNav.map((item, index) => (
            item.href.startsWith("#")
              ? <a className={index === 0 ? "active" : ""} href={item.href} key={item.label}><span>{item.label}</span><small>{item.description}</small></a>
              : <Link className={index === 0 ? "active" : ""} href={item.href} key={item.label}><span>{item.label}</span><small>{item.description}</small></Link>
          ))}
        </nav>

        <section className="crm-main-side-summary">
          <span>{isDeveloper ? "Control de plataforma" : "Resumen del dia"}</span>
          <div>
            <small>Nivel de cuenta</small>
            <strong>{planLabel(state.plan)}</strong>
          </div>
          <div>
            <small>Rubro</small>
            <strong>{state.tenant?.industry || "General"}</strong>
          </div>
          <div>
            <small>Modulos activos</small>
            <strong>{state.modules.length || 0}</strong>
          </div>
        </section>
      </aside>

      <section className="crm-main-workspace">
        <header className="crm-main-header">
          <div>
            <span className="crm-main-kicker">{isDeveloper ? "Desarrollador / EVOLUM" : "CRM principal / EVOLUM"}</span>
            <h1>Hola, {currentSession?.name || "Usuario"}</h1>
            <p>{isDeveloper ? "Administra el catalogo global de agentes, sus rubros compatibles y el nivel de cuenta en que aparecen para cada cliente." : "Gestiona conversaciones, clientes, agentes habilitados por tu plan y oportunidades desde una vista central."}</p>
          </div>
          <form className="crm-main-search" onSubmit={submitSearch}>
            <input
              aria-label="Buscar en EVOLUM"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Buscar en EVOLUM..."
            />
            <button type="submit" aria-label="Buscar">Buscar</button>
            {normalizedSearch ? (
              <div className="crm-main-search-results">
                {searchResults.length ? searchResults.map((result) => (
                  result.href.startsWith("#") ? (
                    <a href={result.href} key={`${result.group}-${result.label}`} onClick={() => setSearchTerm("")}>
                      <small>{result.group}</small>
                      <strong>{result.label}</strong>
                      <span>{result.description}</span>
                    </a>
                  ) : (
                    <Link href={result.href} key={`${result.group}-${result.label}`} onClick={() => setSearchTerm("")}>
                      <small>{result.group}</small>
                      <strong>{result.label}</strong>
                      <span>{result.description}</span>
                    </Link>
                  )
                )) : <div className="crm-main-search-empty">Sin resultados disponibles para esta cuenta.</div>}
              </div>
            ) : null}
          </form>
          <div className="crm-main-profile">
            <strong>{currentSession?.name || "Usuario"}</strong>
            <span>{isDeveloper ? "Desarrollador" : currentSession?.role || "Cliente"}</span>
          </div>
          <LogoutButton />
        </header>

        {state.error ? <div className="crm-main-notice">{state.error}</div> : null}

        <div className="crm-main-grid">
          <section className="crm-main-panel crm-main-overview">
            <div className="crm-main-panel-head">
              <div>
                <span>Resumen ejecutivo</span>
                <h2>{isDeveloper ? "Estado del sistema" : "Centro de operaciones"}</h2>
              </div>
              <button onClick={load}>Actualizar</button>
            </div>
            <div className="crm-main-kpi-grid">
              {summary.map((item) => (
                <article className={`crm-main-kpi ${item.tone}`} key={item.label}>
                  <span>{item.label}</span>
                  <strong>{item.value}</strong>
                  <small>{item.delta}</small>
                  <div className="crm-main-line"><i /><i /><i /><i /><i /><i /></div>
                </article>
              ))}
            </div>
          </section>

          <aside className="crm-main-panel crm-main-live">
            <div className="crm-main-panel-head">
              <div>
                <span>Actividad reciente</span>
                <h2>Eventos vivos</h2>
              </div>
            </div>
            {(activity.length ? activity : fallbackActivity).map((item) => (
              <Link className="crm-main-activity" href={item.id ? `/inbox?conversation=${item.id}` : "/inbox"} key={`${item.channel}-${item.time}-${item.phone}`}>
                <b><img alt="" src="https://cdn.simpleicons.org/whatsapp/25D366" /></b>
                <div>
                  <strong>{item.name}</strong>
                  <span>{item.phone}</span>
                  <p>{item.description}</p>
                </div>
                <small>{item.channel} / {item.time}</small>
              </Link>
            ))}
          </aside>

          <section className="crm-main-panel crm-main-agents" id="agents">
            <div className="crm-main-panel-head">
              <div>
                <span>Agentes AI</span>
                <h2>{isDeveloper ? "Agentes AI publicados en cuentas" : "Agentes AI incluidos en tu cuenta"}</h2>
              </div>
              {isDeveloper ? <Link className="crm-main-action-link" href="/admin">Gestionar catalogo</Link> : null}
            </div>
            <div className="crm-main-agent-grid">
              {activeAgents.map((agent) => (
                <Link className="crm-main-agent-card" href={agent.href} key={agent.name}>
                  <div className="crm-main-agent-top">
                    <div className="crm-main-avatar">{agent.initials}</div>
                    <div>
                      <strong>{agent.name}</strong>
                      <span>{agent.team}</span>
                    </div>
                    <small>{agent.status}</small>
                  </div>
                  <p className="crm-main-agent-description">{agent.description}</p>
                  <div className="crm-main-agent-rules">
                    <span>Desde {planLabel(agent.minPlan)}</span>
                    <span>{agent.rubros.join(", ")}</span>
                  </div>
                  <div className="crm-main-agent-metrics">
                    <span>{agent.work}</span>
                    <span>{agent.result}</span>
                  </div>
                  <div className="crm-main-wave" />
                </Link>
              ))}
            </div>
          </section>

          {isDeveloper ? (
            <section className="crm-main-panel crm-main-developer">
              <div className="crm-main-panel-head">
                <div>
                  <span>Exclusivo desarrollador</span>
                  <h2>Catalogo global de agentes AI</h2>
                </div>
                <Link className="crm-main-action-link" href="/admin">Administrar plataforma</Link>
              </div>
              <div className="crm-main-dev-grid">
                {agentCatalog.map((agent) => (
                  <article className="crm-main-dev-card" key={agent.name}>
                    <strong>{agent.name}</strong>
                    <span>{agent.status} / Desde {planLabel(agent.minPlan)}</span>
                    <p>{agent.description}</p>
                    <div className="crm-main-dev-rules">
                      <small>Rubros: {agent.rubros.join(", ")}</small>
                      <small>Modulo: {agent.module || "Sin modulo"}</small>
                    </div>
                  </article>
                ))}
              </div>
              <div className="crm-main-dev-note">
                Aqui se define que agentes existen en EVOLUM, para que rubros aplican y desde que nivel de cuenta aparecen. Los clientes solo ven el subconjunto permitido por su plan y modulos activos.
              </div>
            </section>
          ) : null}

          <section className="crm-main-panel crm-main-modules">
            <div className="crm-main-panel-head">
              <div>
                <span>Modulos conectados</span>
                <h2>Multiempresa y multirubro</h2>
              </div>
              {isDeveloper ? <Link className="crm-main-action-link" href="/saas">Configurar</Link> : null}
            </div>
            <div className="crm-main-module-grid">
              {modules.map((module) => (
                <Link className="crm-main-module" href={module.href} key={module.title}>
                  <div>
                    <strong>{module.title}</strong>
                    <p>{module.text}</p>
                  </div>
                  <span>{module.value}</span>
                </Link>
              ))}
            </div>
          </section>

          <section className="crm-main-panel crm-main-knowledge">
            <div className="crm-main-panel-head">
              <div>
                <span>Configuracion de Agente</span>
                <h2>Perfil, documentos y reglas IA</h2>
              </div>
              <Link className="crm-main-action-link" href="/onboarding">Gestionar</Link>
            </div>
            {onboardingRows.map((row) => (
              <article className="crm-main-row crm-main-status-row" key={row.title}>
                <div>
                  <strong>{row.title}</strong>
                  <span>{row.type}</span>
                </div>
                <small className={`crm-main-status ${row.status}`}><i />{row.label}</small>
              </article>
            ))}
          </section>

          <section className="crm-main-panel crm-main-analytics">
            <div className="crm-main-panel-head">
              <div>
                <span>Dashboard</span>
                <h2>Rendimiento semanal</h2>
              </div>
              <Link className="crm-main-action-link" href="/dashboard">Ver reporte</Link>
            </div>
            <div className="crm-main-bars">
              {[42, 58, 50, 72, 64, 86, 78, 94].map((height, index) => (
                <i style={{ height: `${height}%` }} key={index} />
              ))}
            </div>
            <div className="crm-main-score">
              <strong>{state.leadMetrics?.averageCloseProbability ? `${Math.round(state.leadMetrics.averageCloseProbability)}%` : "4.8/5"}</strong>
              <span>{state.leadMetrics?.averageCloseProbability ? "Probabilidad promedio" : "Satisfaccion clientes"}</span>
            </div>
          </section>
        </div>
      </section>
    </main>
  );
}
