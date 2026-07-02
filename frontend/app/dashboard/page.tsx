"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { EvolumSidebar } from "@/components/evolum-sidebar";
import { AccountPill } from "@/components/account-pill";
import { ModuleGate } from "@/components/module-gate";
import { getCrmOperationalDashboard, getLeadMetrics, type CrmOperationalDashboard } from "@/lib/api";
import { getStoredSession } from "@/lib/auth";
import type { LeadMetrics } from "@/lib/types";

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
    QUOTE_SENT: "Cotizacion",
    NEGOTIATION: "Negociacion",
    READY_TO_CLOSE: "Listo cierre",
    PAYMENT_PENDING: "Pago pendiente",
    BOOKED: "Reservado",
    PAID: "Pagado"
  };
  return map[stage] || stage || "Sin estado";
}

export default function DashboardPage() {
  const agent = getStoredSession();
  const [metrics, setMetrics] = useState<LeadMetrics | null>(null);
  const [crm, setCrm] = useState<CrmOperationalDashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);

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
      setError(err instanceof Error ? err.message : "No se pudo cargar Dashboard");
    }
  }

  useEffect(() => {
    load();
    const interval = window.setInterval(load, 15000);
    return () => window.clearInterval(interval);
  }, []);

  const dashboardStats = [
    { label: "Leads captados", value: crm?.kpis.leads || metrics?.total || 0, delta: `${crm?.kpis.hotLeads || 0} calientes`, tone: "purple", icon: "LC" },
    { label: "Ventas cerradas", value: crm?.kpis.paidCount || 0, delta: `${crm?.kpis.conversionRate || 0}% conversion`, tone: "blue", icon: "VC" },
    { label: "Reservas activas", value: crm?.kpis.bookingsConfirmed || 0, delta: `${crm?.kpis.bookingsPending || 0} pendientes`, tone: "pink", icon: "RA" },
    { label: "Ingresos totales", value: money(crm?.revenue.paidMonth || crm?.revenue.paid || 0), delta: `${money(crm?.revenue.pending || 0)} pendiente`, tone: "gold", icon: "$" },
    { label: "Agentes IA activos", value: Math.max(2, crm?.forecasts.humanActionsRequired || 0), delta: "operacion online", tone: "cyan", icon: "AI" }
  ];
  const weeklyBars = [42, 55, 63, 58, 74, 82, 79, 91];
  const pipeline = crm?.pipeline || [];
  const pipelineValue = pipeline.reduce((sum, stage) => sum + stage.value, 0);
  const sources = [
    { label: "WhatsApp", value: Math.max(42, Math.round((crm?.kpis.conversations || 1) * 0.42)), color: "var(--theme-primary)" },
    { label: "Portal Web", value: Math.max(24, Math.round((crm?.kpis.leads || 1) * 0.24)), color: "var(--theme-primary-2)" },
    { label: "Instagram", value: 15, color: "#f97316" },
    { label: "Referidos", value: 10, color: "#ec4899" },
    { label: "Otros", value: 9, color: "var(--theme-accent)" }
  ];
  const sourceTotal = sources.reduce((sum, source) => sum + source.value, 0) || 1;
  const whatsappEnd = Math.round((sources[0].value / sourceTotal) * 100);
  const portalEnd = Math.round(((sources[0].value + sources[1].value) / sourceTotal) * 100);

  return (
    <ModuleGate moduleKey="dashboard">
    <div className={`executive-shell analytics-evolum-shell ${sidebarOpen ? "" : "nav-collapsed"}`}>
      <EvolumSidebar
        active="Dashboard"
        isDeveloper={agent?.role === "SUPER_ADMIN"}
        isOpen={sidebarOpen}
        onToggle={() => setSidebarOpen((value) => !value)}
      />

      <main className="executive-dashboard">
        <header className="executive-topbar executive-dashboard-header">
          <div>
            <h1>Dashboard Ejecutivo</h1>
            <p>Bienvenido, {agent?.name || "Usuario"}. Resumen operativo en tiempo real.</p>
          </div>
          <div className="executive-top-actions">
            <AccountPill fallbackName={agent?.name || "Usuario"} />
          </div>
        </header>

        {error ? <div className="sales-queue-error">{error}</div> : null}
        {!crm ? <div className="analytics-loading-strip">Cargando dashboard en tiempo real...</div> : null}

        <section className="executive-kpi-grid">
          {dashboardStats.map((stat) => (
            <article className={`executive-kpi-card ${stat.tone}`} key={stat.label}>
              <div className="executive-kpi-icon">{stat.icon}</div>
              <span>{stat.label}</span>
              <strong>{stat.value}</strong>
              <small>{stat.delta}</small>
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
                style={{ background: `conic-gradient(var(--theme-primary) 0 ${whatsappEnd}%, var(--theme-primary-2) ${whatsappEnd}% ${portalEnd}%, #f97316 0 76%, #ec4899 0 88%, var(--theme-accent) 0 100%)` }}
              >
                <strong>{crm?.kpis.leads || metrics?.total || 0}</strong>
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
              {pipeline.slice(0, 5).map((stage, index) => (
                <div style={{ width: `${100 - index * 12}%` }} key={stage.stage}>
                  <span>{stageLabel(stage.stage)}</span><strong>{stage.count}</strong>
                </div>
              ))}
              {!pipeline.length ? <div style={{ width: "100%" }}><span>Sin etapas cargadas</span><strong>0</strong></div> : null}
            </div>
          </article>

          <article className="executive-panel">
            <div className="executive-panel-head"><h2>Alertas criticas</h2><Link href="/ai-ops">Ver todas</Link></div>
            <div className="executive-list">
              {(crm?.alerts.length ? crm.alerts : [{ type: "ok", title: "Operacion estable", count: 0, message: "Sin alertas criticas por ahora." }]).slice(0, 4).map((alert) => (
                <div key={alert.type}><b>{alert.count}</b><span>{alert.title}</span><small>{alert.message}</small></div>
              ))}
            </div>
          </article>

          <article className="executive-panel">
            <div className="executive-panel-head"><h2>Proximas actividades</h2><Link href="/agenda">Agenda</Link></div>
            <div className="executive-list schedule">
              {(crm?.upcomingBookings || []).slice(0, 4).map((booking) => (
                <div key={booking.id}><b>{formatDate(booking.date).slice(0, 5)}</b><span>{booking.name || "Reserva"}</span><small>{booking.location || "Lugar por confirmar"}</small></div>
              ))}
              {!crm?.upcomingBookings.length ? <div><b>--</b><span>Sin reservas proximas</span><small>El agente agregara fechas aqui.</small></div> : null}
            </div>
          </article>
        </section>
      </main>
    </div>
    </ModuleGate>
  );
}
