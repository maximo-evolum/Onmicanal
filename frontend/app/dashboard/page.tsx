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

  return (
    <div className="page page-single">
      <main className="main dashboard-page">
        <AnalyticsHeader agentName={agent?.name || "Usuario"} hotLeads={crm.kpis.hotLeads} revenue={money(crm.forecasts.expectedRevenue || crm.revenue.estimated)} />

        {error ? <div className="sales-queue-error">{error}</div> : null}

        <h2 className="section-title">Revenue y operación</h2>
        <div className="dashboard-grid">
          <Card title="Ingresos pagados" value={money(crm.revenue.paid)} />
          <Card title="Ingresos del mes" value={money(crm.revenue.paidMonth)} />
          <Card title="Pagos pendientes" value={money(crm.revenue.pending)} />
          <Card title="Revenue estimado" value={money(crm.revenue.estimated)} />
          <Card title="Pipeline ponderado" value={money(crm.revenue.pipeline)} />
          <Card title="Forecast esperado" value={money(crm.forecasts.expectedRevenue)} />
        </div>

        <h2 className="section-title">Reservas, pagos y cierre</h2>
        <div className="dashboard-grid">
          <Card title="Reservas confirmadas" value={crm.kpis.bookingsConfirmed} />
          <Card title="Reservas pendientes" value={crm.kpis.bookingsPending} />
          <Card title="Pagos pendientes" value={crm.kpis.paymentPending} />
          <Card title="Pagos confirmados" value={crm.kpis.paidCount} />
          <Card title="Listos para cierre" value={crm.kpis.readyToClose} />
          <Card title="Conversión" value={`${crm.kpis.conversionRate}%`} />
        </div>

        <h2 className="section-title">Alertas inteligentes</h2>
        <div className="dashboard-grid">
          {crm.alerts.length ? crm.alerts.map((alert) => (
            <div className="alert-card" key={alert.type}>
              <div>{alert.title}</div>
              <strong>{alert.count}</strong>
              <small className="meta-line">{alert.message}</small>
            </div>
          )) : <div className="empty-state" style={{ minHeight: 120 }}>Sin alertas críticas por ahora.</div>}
        </div>

        <h2 className="section-title">Prioridades del vendedor</h2>
        <div className="ai-ops-dashboard-strip">
          {crm.priorities.slice(0, 6).map((item) => (
            <button className="ai-ops-mini-card" key={item.conversationId} onClick={() => { window.location.href = `/inbox?conversation=${item.conversationId}`; }}>
              <strong>{item.customer}</strong>
              <span>{stageLabel(item.stage)} · {item.score}%</span>
              <small>{item.nextAction}</small>
              {item.amount ? <small>{money(item.amount)}</small> : null}
            </button>
          ))}
        </div>

        <h2 className="section-title">Pipeline CRM completo</h2>
        <div className="dashboard-grid">
          {crm.pipeline.map((stage) => (
            <div className="metric-card" key={stage.stage}>
              <div className="meta-line">{stageLabel(stage.stage)}</div>
              <strong>{stage.count}</strong>
              <small className="meta-line">{money(stage.value)}</small>
            </div>
          ))}
        </div>

        <h2 className="section-title">Próximas reservas</h2>
        <div className="dashboard-grid dashboard-list-grid">
          {crm.upcomingBookings.length ? crm.upcomingBookings.map((booking) => (
            <div key={booking.id} className="metric-card dashboard-booking-card">
              <div className="meta-line">{formatDate(booking.date)} · {booking.status}</div>
              <strong>{booking.guests} personas</strong>
              <div className="meta-line">{booking.location || "Lugar por confirmar"}</div>
              <div className="badge" style={{ marginTop: 8 }}>{money(booking.total)}</div>
            </div>
          )) : <div className="empty-state" style={{ minHeight: 120 }}>Aún no hay reservas próximas.</div>}
        </div>

        <h2 className="section-title">Resumen adicional</h2>
        <div className="dashboard-grid">
          <Card title="Leads totales" value={crm.kpis.leads || metrics?.total || 0} />
          <Card title="Conversaciones" value={crm.kpis.conversations} />
          <Card title="Score cierre promedio" value={`${crm.kpis.averageCloseScore}%`} />
          <Card title="Acciones humanas" value={crm.forecasts.humanActionsRequired} />
          <Card title="Recuperaciones" value={crm.forecasts.recoveryOpportunities} />
          <Card title="Revenue histórico leads" value={money(metrics?.estimatedRevenue || 0)} />
        </div>
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
