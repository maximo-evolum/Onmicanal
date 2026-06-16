"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  getCampaigns,
  getConversations,
  getCrmOperationalDashboard,
  getLeadMetrics,
  getMe,
  getMyModules,
  type CrmOperationalDashboard
} from "@/lib/api";
import { getStoredSession } from "@/lib/auth";
import type { AgentSession, Campaign, Conversation, LeadMetrics, TenantSession } from "@/lib/types";

type LoadState = {
  session: AgentSession | null;
  conversations: Conversation[];
  leadMetrics: LeadMetrics | null;
  crm: CrmOperationalDashboard | null;
  campaigns: Campaign[];
  modules: string[];
  plan: AccountLevel;
  tenant: TenantSession | null;
  error: string | null;
};

type AccountLevel = "basica" | "normal" | "avanzada" | "pro";

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
};

const navItems: NavItem[] = [
  { label: "Inicio", href: "/crm-principal", description: "Centro principal de EVOLUM" },
  { label: "Oficina de Agentes", href: "#agents", description: "Agentes AI activos y futuros" },
  { label: "Inbox Omnicanal", href: "/inbox", description: "Conversaciones y atencion IA" },
  { label: "Agenda", href: "/agenda", description: "Reservas, citas y disponibilidad" },
  { label: "Clientes", href: "/pipeline", description: "Leads, clientes y pipeline" },
  { label: "Campanas", href: "/campaigns", description: "Marketing IA y publicaciones" },
  { label: "Pagos", href: "/payments", description: "Cobros, estados y links" },
  { label: "Cierres IA", href: "/sales-queue", description: "Leads listos para vendedor" },
  { label: "Automatizaciones", href: "#flow", description: "Flujos y procesos operativos" },
  { label: "Base de Conocimiento", href: "/onboarding", description: "Documentos, FAQs y contexto" },
  { label: "Integraciones", href: "/settings/ai", description: "Canales, IA y reglas" },
  { label: "Equipo", href: "/team", description: "Usuarios, roles y actividad" },
  { label: "Analytics & KPIs", href: "/dashboard", description: "Metricas operativas" },
  { label: "SaaS Analytics", href: "/saas-analytics", description: "Uso, costos y rendimiento" },
  { label: "AI Ops", href: "/ai-ops", description: "Razonamiento y alertas IA" }
];

const developerOnlyItems: NavItem[] = [
  { label: "Desarrollador", href: "/admin", description: "Clientes, planes, modulos y permisos" },
  { label: "Planes y modulos", href: "/saas", description: "Configuracion SaaS por cuenta" },
  { label: "Bot Lab", href: "/dev/bot-lab", description: "Pruebas de respuestas y reglas" }
];

const planOrder: AccountLevel[] = ["basica", "normal", "avanzada", "pro"];

const agentCatalog: AgentCatalogItem[] = [
  {
    id: "chat",
    name: "Agente de Chat",
    team: "Inbox omnicanal",
    status: "Activo",
    minPlan: "basica",
    rubros: ["Todos"],
    module: "inbox",
    href: "/inbox",
    initials: "AC",
    implemented: true,
    description: "Responde WhatsApp, Instagram y mensajes entrantes, califica leads y deriva a humano cuando corresponde."
  },
  {
    id: "campaigns",
    name: "Agente de Campanas",
    team: "Marketing IA",
    status: "Activo",
    minPlan: "normal",
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
    minPlan: "normal",
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
    minPlan: "avanzada",
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
    minPlan: "avanzada",
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
    minPlan: "pro",
    rubros: ["Hospitality", "Servicios", "Retail", "Manufactura"],
    module: "bookings",
    href: "/agenda",
    initials: "AO",
    implemented: false,
    description: "Coordinara servicios, reservas, tareas operativas y asignaciones internas."
  }
];

const knowledge = [
  ["Manual de ventas", "Entrenamiento comercial", "Activo"],
  ["Objeciones frecuentes", "Respuestas y politicas", "Activo"],
  ["Guia Realty", "Propiedades y visitas", "Preparado"],
  ["Proceso de onboarding", "Activacion de clientes", "Activo"]
];

const integrations = [
  ["WhatsApp Business", "Conectado"],
  ["Instagram DM", "Conectado"],
  ["Google Workspace", "Listo"],
  ["HubSpot CRM", "Pendiente"],
  ["Stripe", "Pendiente"],
  ["Notion", "Listo"]
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
  if (["FREE", "STARTER", "BASIC", "BASICA", "MVP", "DEMO"].includes(value)) return "basica";
  if (["NORMAL", "PRO"].includes(value)) return "normal";
  if (["BUSINESS", "ADVANCED", "AVANZADA"].includes(value)) return "avanzada";
  if (["ENTERPRISE", "PRO_MAX", "PROFESSIONAL"].includes(value)) return "pro";
  return "basica";
}

function planAllows(current: AccountLevel, required: AccountLevel) {
  return planOrder.indexOf(current) >= planOrder.indexOf(required);
}

function planLabel(plan: AccountLevel) {
  const labels: Record<AccountLevel, string> = {
    basica: "Basica",
    normal: "Normal",
    avanzada: "Avanzada",
    pro: "Pro"
  };
  return labels[plan];
}

export default function CrmPrincipalPage() {
  const [state, setState] = useState<LoadState>({
    session: null,
    conversations: [],
    leadMetrics: null,
    crm: null,
    campaigns: [],
    modules: [],
    plan: "basica",
    tenant: null,
    error: null
  });

  const isDeveloper = state.session?.role === "SUPER_ADMIN";
  const visibleNav = isDeveloper ? [...navItems, ...developerOnlyItems] : navItems;

  async function load() {
    const session = getStoredSession();
    const [me, conversations, leadMetrics, crm, campaigns, modules] = await Promise.allSettled([
      getMe(),
      getConversations(),
      getLeadMetrics(),
      getCrmOperationalDashboard(),
      getCampaigns(),
      getMyModules()
    ]);

    setState({
      session,
      conversations: conversations.status === "fulfilled" ? conversations.value : [],
      leadMetrics: leadMetrics.status === "fulfilled" ? leadMetrics.value : null,
      crm: crm.status === "fulfilled" ? crm.value : null,
      campaigns: campaigns.status === "fulfilled" ? campaigns.value : [],
      modules: modules.status === "fulfilled" ? modules.value.modules || [] : [],
      plan: modules.status === "fulfilled" ? accountLevelFromPlan(modules.value.plan) : accountLevelFromPlan(me.status === "fulfilled" ? me.value.tenant?.plan : null),
      tenant: me.status === "fulfilled" ? me.value.tenant : null,
      error: [me, conversations, leadMetrics, crm, campaigns, modules].some((item) => item.status === "rejected")
        ? "Algunos datos reales no pudieron cargarse. Se muestran datos disponibles y estructura base."
        : null
    });
  }

  useEffect(() => {
    load().catch((error) => {
      setState((current) => ({
        ...current,
        session: getStoredSession(),
        error: error instanceof Error ? error.message : "No se pudo cargar el CRM principal"
      }));
    });
  }, []);

  const openConversations = state.conversations.filter((item) => item.status === "OPEN").length;
  const hotLeads = state.leadMetrics?.alerts?.hotLeads ?? state.crm?.kpis?.hotLeads ?? 0;
  const totalLeads = state.leadMetrics?.total ?? state.crm?.kpis?.leads ?? 0;
  const estimatedRevenue = state.crm?.forecasts?.expectedRevenue ?? state.leadMetrics?.estimatedRevenue ?? 0;
  const tasks = state.crm?.kpis ? state.crm.kpis.readyToClose + state.crm.kpis.paymentPending + state.crm.kpis.bookingsPending : hotLeads;
  const enabledAgents = agentCatalog.filter((agent) => (
    agent.implemented &&
    (
      isDeveloper ||
      (planAllows(state.plan, agent.minPlan) && (!agent.module || state.modules.includes(agent.module)))
    )
  ));
  const lockedAgents = agentCatalog.filter((agent) => !enabledAgents.some((enabled) => enabled.id === agent.id));
  const agentCount = isDeveloper ? agentCatalog.length : enabledAgents.length;

  const summary = [
    { label: "Agentes visibles", value: `${agentCount}`, delta: isDeveloper ? "Catalogo global" : `Plan ${planLabel(state.plan)}`, tone: "success" },
    { label: "Conversaciones abiertas", value: openConversations, delta: "Inbox omnicanal", tone: "info" },
    { label: "Leads detectados", value: totalLeads, delta: `${hotLeads} calientes`, tone: "primary" },
    { label: "Valor estimado", value: money(estimatedRevenue), delta: "Forecast comercial", tone: "warning" }
  ];

  const activeAgents = useMemo(() => enabledAgents.map((agent) => ({
    ...agent,
    work: agent.id === "chat" ? `${openConversations} conversaciones abiertas` : `${state.campaigns.length} campanas`,
    result: agent.id === "chat"
      ? `${totalLeads} leads registrados`
      : state.campaigns[0]
        ? `Ultima: ${statusLabel(state.campaigns[0].status)}`
        : "Listo para usar"
  })), [enabledAgents, openConversations, totalLeads, state.campaigns]);

  const activity = state.conversations.slice(0, 5).map((conversation) => [
    conversation.contact?.channel || "Canal",
    conversation.lastMessage?.content || conversation.aiNextAction || conversation.aiSummary || `Conversacion ${statusLabel(conversation.status)}`,
    shortTime(conversation.lastMessageAt),
    conversation.id
  ]);

  const fallbackActivity = [
    ["WhatsApp", "El agente de chat esta listo para gestionar conversaciones", "Ahora", ""],
    ["Marketing", "El agente de campanas esta listo para generar contenido", "Ahora", ""],
    ["CRM", "La vista principal ya separa usuario y desarrollador", "Ahora", ""]
  ];

  const pipeline = state.crm?.pipeline?.length ? state.crm.pipeline.slice(0, 5).map((stage) => [
    statusLabel(stage.stage),
    String(stage.count),
    money(stage.value)
  ]) : [
    ["Captura", String(openConversations), "Conversaciones"],
    ["IA atiende", String(totalLeads), "Leads"],
    ["Gestor interviene", String(tasks), "Tareas"],
    ["Oportunidad", String(hotLeads), "Leads calientes"],
    ["Cierre", money(estimatedRevenue), "Forecast"]
  ];

  const modules = [
    ["Inbox Omnicanal", "Conversaciones unificadas por empresa, canal y prioridad.", String(openConversations)],
    ["Agentes AI", "Catalogo gobernado por plan, rubro y modulo activo.", String(agentCount)],
    ["CRM Universal", "Leads, clientes, oportunidades, tareas y actividad comercial.", String(totalLeads)],
    ["Agenda", "Reservas, citas, sucursales y direcciones conectadas al inbox.", String(state.crm?.kpis?.bookingsConfirmed ?? 0)],
    ["Realty", "Primer vertical para integrar AI Corretaje como modulo inmobiliario.", isDeveloper ? "Roadmap" : "Proximo"]
  ];
  const homeAccessItems = visibleNav.filter((item) => !item.href.startsWith("#"));

  return (
    <main className="crm-main">
      <aside className="crm-main-sidebar">
        <div className="crm-main-brand">
          <div className="crm-main-mark">EV</div>
          <div>
            <strong>EVOLUM</strong>
            <span>{isDeveloper ? "Catalogo global" : "Oficina de agentes"}</span>
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
            <strong>{planLabel(state.plan)}</strong>
            <small>Nivel de cuenta</small>
          </div>
          <div>
            <strong>{state.tenant?.industry || "General"}</strong>
            <small>Rubro</small>
          </div>
          <div>
            <strong>{state.modules.length || 0}</strong>
            <small>Modulos activos</small>
          </div>
        </section>
      </aside>

      <section className="crm-main-workspace">
        <header className="crm-main-header">
          <div>
            <span className="crm-main-kicker">{isDeveloper ? "Desarrollador / EVOLUM" : "CRM principal / EVOLUM"}</span>
            <h1>Hola, {state.session?.name || "Usuario"}</h1>
            <p>{isDeveloper ? "Administra el catalogo global de agentes, sus rubros compatibles y el nivel de cuenta en que aparecen para cada cliente." : "Gestiona conversaciones, clientes, agentes habilitados por tu plan y oportunidades desde una vista central."}</p>
          </div>
          <div className="crm-main-search">
            <span>Buscar en EVOLUM...</span>
            <kbd>Ctrl K</kbd>
          </div>
          <div className="crm-main-profile">
            <strong>{state.session?.name || "Usuario"}</strong>
            <span>{isDeveloper ? "Desarrollador" : state.session?.role || "Cliente"}</span>
          </div>
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

          <section className="crm-main-panel crm-main-menu-panel">
            <div className="crm-main-panel-head">
              <div>
                <span>Inicio EVOLUM</span>
                <h2>Menu principal</h2>
              </div>
            </div>
            <div className="crm-main-access-grid">
              {homeAccessItems.map((item) => (
                <Link className="crm-main-access-card" href={item.href} key={item.href}>
                  <strong>{item.label}</strong>
                  <span>{item.description}</span>
                </Link>
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
            {(activity.length ? activity : fallbackActivity).map(([channel, title, time, id]) => (
              <Link className="crm-main-activity" href={id ? `/inbox?conversation=${id}` : "/inbox"} key={`${channel}-${time}-${title}`}>
                <b>{String(channel).slice(0, 2).toUpperCase()}</b>
                <div>
                  <strong>{title}</strong>
                  <span>{channel}</span>
                </div>
                <small>{time}</small>
              </Link>
            ))}
          </aside>

          <section className="crm-main-panel crm-main-agents" id="agents">
            <div className="crm-main-panel-head">
              <div>
                <span>Oficina de agentes</span>
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

          <section className="crm-main-panel crm-main-conversation">
            <div className="crm-main-panel-head">
              <div>
                <span>Vista de conversacion</span>
                <h2>{state.conversations[0]?.contact?.name || state.conversations[0]?.contact?.username || "Inbox omnicanal"}</h2>
              </div>
              <Link className="crm-main-action-link" href="/inbox">Abrir inbox</Link>
            </div>
            <div className="crm-main-chat">
              <div className="crm-main-bubble inbound">{state.conversations[0]?.lastMessage?.content || "El agente de chat centraliza los mensajes entrantes."}</div>
              <div className="crm-main-bubble outbound">La conversacion puede convertirse en lead, oportunidad, tarea o derivacion humana.</div>
              <div className="crm-main-bubble inbound">{state.conversations[0]?.aiSuggestedReply || "La IA sugiere la proxima respuesta y actualiza el contexto comercial."}</div>
            </div>
            <div className="crm-main-context">
              <span>Contexto comercial</span>
              <p>Canal: {state.conversations[0]?.contact?.channel || "WhatsApp / Instagram"}</p>
              <p>Estado: {statusLabel(state.conversations[0]?.status)}</p>
              <p>Score IA: {state.conversations[0]?.aiCloseScore ?? state.conversations[0]?.aiLeadScore ?? "Pendiente"}</p>
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

          {!isDeveloper && lockedAgents.length ? (
            <section className="crm-main-panel crm-main-developer">
              <div className="crm-main-panel-head">
                <div>
                  <span>No incluidos en tu plan</span>
                  <h2>Agentes disponibles al subir de nivel</h2>
                </div>
              </div>
              <div className="crm-main-dev-grid">
                {lockedAgents.slice(0, 4).map((agent) => (
                  <article className="crm-main-dev-card muted" key={agent.name}>
                    <strong>{agent.name}</strong>
                    <span>Desde {planLabel(agent.minPlan)}</span>
                    <p>{agent.description}</p>
                  </article>
                ))}
              </div>
            </section>
          ) : null}

          <section className="crm-main-panel crm-main-flow" id="flow">
            <div className="crm-main-panel-head">
              <div>
                <span>Orquestador</span>
                <h2>Flujo general del sistema</h2>
              </div>
              {isDeveloper ? <button>Editar flujo</button> : null}
            </div>
            <div className="crm-main-flow-canvas">
              {pipeline.map(([stage, count, detail], index) => (
                <article className="crm-main-node" key={stage}>
                  <span>{index + 1}</span>
                  <strong>{stage}</strong>
                  <small>{count}</small>
                  <p>{detail}</p>
                </article>
              ))}
            </div>
          </section>

          <section className="crm-main-panel crm-main-modules">
            <div className="crm-main-panel-head">
              <div>
                <span>Modulos conectados</span>
                <h2>Multiempresa y multirubro</h2>
              </div>
              {isDeveloper ? <Link className="crm-main-action-link" href="/saas">Configurar</Link> : null}
            </div>
            <div className="crm-main-module-grid">
              {modules.map(([title, text, value]) => (
                <article className="crm-main-module" key={title}>
                  <strong>{title}</strong>
                  <p>{text}</p>
                  <span>{value}</span>
                </article>
              ))}
            </div>
          </section>

          <section className="crm-main-panel crm-main-knowledge">
            <div className="crm-main-panel-head">
              <div>
                <span>Base de conocimiento</span>
                <h2>Documentos activos</h2>
              </div>
              <Link className="crm-main-action-link" href="/onboarding">Gestionar</Link>
            </div>
            {knowledge.map(([title, type, status]) => (
              <article className="crm-main-row" key={title}>
                <div>
                  <strong>{title}</strong>
                  <span>{type}</span>
                </div>
                <small>{status}</small>
              </article>
            ))}
          </section>

          <section className="crm-main-panel crm-main-integrations">
            <div className="crm-main-panel-head">
              <div>
                <span>Centro de integraciones</span>
                <h2>Canales conectados</h2>
              </div>
              {isDeveloper ? <Link className="crm-main-action-link" href="/admin">Nueva</Link> : null}
            </div>
            <div className="crm-main-integration-grid">
              {integrations.map(([name, status]) => (
                <article key={name}>
                  <b>{name.slice(0, 2)}</b>
                  <strong>{name}</strong>
                  <span>{status}</span>
                </article>
              ))}
            </div>
          </section>

          <section className="crm-main-panel crm-main-analytics">
            <div className="crm-main-panel-head">
              <div>
                <span>Analitica & KPIs</span>
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
