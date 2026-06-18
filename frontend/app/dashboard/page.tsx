"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getCrmOperationalDashboard, getLeadMetrics, type CrmOperationalDashboard } from "@/lib/api";
import { LeadMetrics } from "@/lib/types";
import { getStoredSession, LogoutButton } from "@/lib/auth";

function money(value = 0) {
  return new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 }).format(value || 0);
}

function formatDate(value?: string | null) {
  if (!value) return "Sin fecha";
  return new Intl.DateTimeFormat("es-CL", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function stageLabel(stage = "") {
  const map: Record<string, string> = {
    NEW: "Nuevo",
    CONTACTED: "Contactado",
    QUALIFIED: "Calificado",
    QUOTE_SENT: "Cotización enviada",
    NEGOTIATION: "Negociación",
    READY_TO_CLOSE: "Listo para cierre",
    PAYMENT_PENDING: "Pago pendiente",
    PARTIAL_PAYMENT: "Abono recibido",
    BOOKED: "Reservado",
    PAID: "Pagado",
    CANCELED: "Cancelado",
    REFUNDED: "Reembolsado"
  };
  return map[stage] || stage || "Sin estado";
}

function AnalyticsHeader({ agentName, hotLeads = 0, revenue = "$0" }: { agentName: string; hotLeads?: number; revenue?: string }) {
  return (
    <header className="module-app-header">
      <div>
        <span className="eyebrow">Analytics & KPIs</span>
        <h1>Analytics & KPIs</h1>
        <div className="meta-line">Revenue, reservas, pagos, pipeline, alertas y próximas acciones.</div>
      </div>
      <div className="module-app-actions">
        <span className="badge signal-followup">💰 {revenue}</span>
        <span className="badge signal-hot">🔥 {hotLeads} leads calientes</span>
        <Link className="ghost-btn" href="/crm-principal">Ir a CRM</Link>
        <span className="module-account-pill">{agentName}</span>
        <LogoutButton />
      </div>
    </header>
  );
}

export default function DashboardPage() {
  const agent = getStoredSession();
  const [metrics, setMetrics] = useState<LeadMetrics | null>(null);
  const [crm, setCrm] = useState<CrmOperationalDashboard | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      setError(null);
      const [leadMetrics, crmData] = await Promise.all([
        getLeadMetrics().catch(() => null),
        getCrmOperationalDashboard()
      ]);
      setMetrics(leadMetrics);
      setCrm(crmData);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo cargar CRM operativo");
    }
  }

  useEffect(() => {
    load();
    const interval = window.setInterval(load, 15000);
    return () => window.clearInterval(interval);
  }, []);

  if (!crm) {
    return (
      <div className="page page-single">
        <main className="main dashboard-page">
          <AnalyticsHeader agentName={agent?.name || "Usuario"} />
          {error ? <div className="sales-queue-error">{error}</div> : <div className="empty-state">Cargando CRM operativo...</div>}
        </main>
      </div>
    );
  }

  const dashboardStats = [
    { label: "Leads captados", value: crm.kpis.leads || metrics?.total || 0, delta: `${crm.kpis.hotLeads} calientes`, tone: "purple", icon: "LC" },
    { label: "Ventas cerradas", value: crm.kpis.paidCount, delta: `${crm.kpis.conversionRate}% conversion`, tone: "blue", icon: "VC" },
    { label: "Reservas activas", value: crm.kpis.bookingsConfirmed, delta: `${crm.kpis.bookingsPending} pendientes`, tone: "pink", icon: "RA" },
    { label: "Ingresos totales", value: money(crm.revenue.paidMonth || crm.revenue.paid), delta: `${money(crm.revenue.pending)} pendiente`, tone: "gold", icon: "$" },
    { label: "Agentes IA activos", value: Math.max(2, crm.forecasts.humanActionsRequired || 0), delta: "operacion online", tone: "cyan", icon: "AI" }
  ];
  const weeklyBars = [42, 55, 63, 58, 74, 82, 79, 91];
  const pipelineValue = crm.pipeline.reduce((sum, stage) => sum + stage.value, 0);
  const sources = [
    { label: "WhatsApp", value: Math.max(42, Math.round((crm.kpis.conversations || 1) * 0.42)), color: "#22c55e" },
    { label: "Portal Web", value: Math.max(24, Math.round((crm.kpis.leads || 1) * 0.24)), color: "#38bdf8" },
    { label: "Instagram", value: 15, color: "#f97316" },
    { label: "Referidos", value: 10, color: "#f43f5e" },
    { label: "Otros", value: 9, color: "#a855f7" }
  ];
  const sourceTotal = sources.reduce((sum, source) => sum + source.value, 0) || 1;

  return (
    <div className="executive-shell">
      <aside className="executive-sidebar">
        <div className="executive-brand">EVOLUM</div>
        {["Dashboard", "Workforce IA", "CRM", "Agenda", "Pagos", "Automatizaciones", "Analytics", "Configuracion"].map((item, index) => (
          <Link className={index === 0 ? "active" : ""} href={item === "Dashboard" ? "/dashboard" : item === "CRM" ? "/crm-principal" : item === "Agenda" ? "/agenda" : item === "Pagos" ? "/payments" : "#"} key={item}>
            <span>{item.slice(0, 2).toUpperCase()}</span>
            {item}
          </Link>
        ))}
        <Link className="executive-new-btn" href="/inbox">Nueva conversacion</Link>
      </aside>

      <main className="executive-dashboard">
        <header className="executive-topbar">
          <button className="executive-menu" aria-label="Menu">=</button>
          <div className="executive-search">Buscar clientes, reservas, pagos...</div>
          <div className="executive-top-actions">
            <span className="executive-icon-btn">⌕</span>
            <span className="executive-icon-btn">●</span>
            <span className="module-account-pill">{agent?.name || "Usuario"}</span>
            <LogoutButton />
          </div>
        </header>

        <section className="executive-title-row">
          <div>
            <h1>Dashboard Ejecutivo</h1>
            <p>Bienvenido, {agent?.name || "Usuario"}. Aqui esta el resumen operativo en tiempo real.</p>
          </div>
          <div className="executive-actions">
            <span className="executive-date">12 May - 18 May 2026</span>
            <Link className="primary-btn" href="/crm-principal">Personalizar</Link>
          </div>
        </section>

        {error ? <div className="sales-queue-error">{error}</div> : null}

        <section className="executive-kpi-grid">
          {dashboardStats.map((stat) => (
            <article className={`executive-kpi-card ${stat.tone}`} key={stat.label}>
              <div className="executive-kpi-icon">{stat.icon}</div>
              <span>{stat.label}</span>
              <strong>{stat.value}</strong>
              <small>↑ {stat.delta}</small>
              <div className="executive-sparkline">{weeklyBars.slice(0, 6).map((bar, index) => <i style={{ height: `${bar}%` }} key={index} />)}</div>
            </article>
          ))}
        </section>

        <section className="executive-main-grid">
          <article className="executive-panel executive-chart-panel">
            <div className="executive-panel-head">
              <h2>Rendimiento de ventas</h2>
              <span>Ventas / Meta</span>
            </div>
            <div className="executive-line-chart">
              {weeklyBars.map((bar, index) => <i style={{ height: `${bar}%` }} key={index}><b /></i>)}
            </div>
            <div className="executive-axis"><span>12 May</span><span>14 May</span><span>16 May</span><span>18 May</span></div>
          </article>

          <article className="executive-panel">
            <div className="executive-panel-head">
              <h2>Leads por fuente</h2>
              <span>Esta semana</span>
            </div>
            <div className="executive-donut-row">
              <div
                className="executive-donut"
                style={{ background: `conic-gradient(#2563eb 0 ${Math.round((sources[0].value / sourceTotal) * 100)}%, #22c55e ${Math.round((sources[0].value / sourceTotal) * 100)}% ${Math.round(((sources[0].value + sources[1].value) / sourceTotal) * 100)}%, #f59e0b 0 76%, #a855f7 0 100%)` }}
              >
                <strong>{crm.kpis.leads || metrics?.total || 0}</strong>
                <span>Leads</span>
              </div>
              <div className="executive-source-list">
                {sources.map((source) => (
                  <div key={source.label}><i style={{ background: source.color }} /><span>{source.label}</span><strong>{Math.round((source.value / sourceTotal) * 100)}%</strong></div>
                ))}
              </div>
            </div>
          </article>
        </section>

        <section className="executive-bottom-grid">
          <article className="executive-panel">
            <div className="executive-panel-head"><h2>Pipeline general</h2><span>{money(pipelineValue)}</span></div>
            <div className="executive-funnel">
              {crm.pipeline.slice(0, 5).map((stage, index) => (
                <div style={{ width: `${100 - index * 12}%` }} key={stage.stage}>
                  <span>{stageLabel(stage.stage)}</span><strong>{stage.count}</strong>
                </div>
              ))}
            </div>
          </article>

          <article className="executive-panel">
            <div className="executive-panel-head"><h2>Alertas criticas</h2><Link href="/ai-ops">Ver todas</Link></div>
            <div className="executive-list">
              {(crm.alerts.length ? crm.alerts : [{ type: "ok", title: "Operacion estable", count: 0, message: "Sin alertas criticas por ahora." }]).slice(0, 4).map((alert) => (
                <div key={alert.type}><b>{alert.count}</b><span>{alert.title}</span><small>{alert.message}</small></div>
              ))}
            </div>
          </article>

          <article className="executive-panel">
            <div className="executive-panel-head"><h2>Proximas actividades</h2><Link href="/agenda">Agenda</Link></div>
            <div className="executive-list schedule">
              {crm.upcomingBookings.slice(0, 4).map((booking) => (
                <div key={booking.id}><b>{formatDate(booking.date).slice(0, 5)}</b><span>{booking.name || "Reserva"}</span><small>{booking.location || "Lugar por confirmar"}</small></div>
              ))}
              {!crm.upcomingBookings.length ? <div><b>--</b><span>Sin reservas proximas</span><small>El agente agregara fechas aqui.</small></div> : null}
            </div>
          </article>
        </section>

        <section className="executive-quickbar">
          <strong>Accesos rapidos</strong>
          <Link className="primary-btn" href="/inbox">Nuevo lead</Link>
          <Link className="ghost-btn" href="/agenda">Crear reserva</Link>
          <Link className="ghost-btn" href="/payments">Crear pago</Link>
          <Link className="ghost-btn" href="/ai-ops">Ver alertas IA</Link>
        </section>
      </main>
    </div>
  );
}


function activityType(title: string) {
  const value = String(title || "").toLowerCase();

  if (value.includes("pago")) return "payment";
  if (value.includes("reserva")) return "booking";
  if (value.includes("humana")) return "warning";
  if (value.includes("lead")) return "lead";
  if (value.includes("ia")) return "ai";

  return "default";
}

function activityIcon(title: string) {
  const value = String(title || "").toLowerCase();

  if (value.includes("pago")) return "💰";
  if (value.includes("reserva")) return "📅";
  if (value.includes("humana")) return "⚠️";
  if (value.includes("lead")) return "🔥";
  if (value.includes("ia")) return "🤖";

  return "✨";
}

function humanizeTitle(title: string) {
  const map: Record<string, string> = {
    "LOW_SIGNAL": "Cliente con baja intención de compra",
    "READY_TO_CLOSE": "Lead listo para cierre",
    "ask_need": "IA solicitó más información",
  };

  return map[title] || title;
}

function humanizeDescription(text: string) {
  return String(text || "")
    .replace(/LOW_SIGNAL/g, "baja intención comercial")
    .replace(/ask_need/g, "solicitud de información")
    .replace(/handoff_human/g, "derivación humana");
}

function relativeTime(date: string) {
  const diff = Math.max(1, Math.floor((Date.now() - new Date(date).getTime()) / 60000));

  if (diff < 60) return `Hace ${diff} min`;

  const hours = Math.floor(diff / 60);
  if (hours < 24) return `Hace ${hours}h`;

  const days = Math.floor(hours / 24);
  return `Hace ${days}d`;
}


function Card({ title, value }: { title: string; value: string | number }) {
  return (
    <div className="metric-card">
      <div className="meta-line">{title}</div>
      <strong>{value}</strong>
    </div>
  );
}
