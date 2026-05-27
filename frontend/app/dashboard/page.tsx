"use client";

import { useEffect, useState } from "react";
import { getConversations, getLeadMetrics, getSalesDashboard, SalesDashboard } from "@/lib/api";
import { Conversation, LeadMetrics } from "@/lib/types";
import { buildAiOpsProfile, isReadyToClose } from "@/lib/ai-ops";
import { BackToInbox } from "@/components/BackToInbox";
import { Topbar } from "@/components/topbar";
import { getStoredSession } from "@/lib/auth";

function money(value: number) {
  return new Intl.NumberFormat("es-CL", {
    style: "currency",
    currency: "CLP",
    maximumFractionDigits: 0
  }).format(value || 0);
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("es-CL", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

export default function DashboardPage() {
  const agent = getStoredSession();
  const [metrics, setMetrics] = useState<LeadMetrics | null>(null);
  const [sales, setSales] = useState<SalesDashboard | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);

  useEffect(() => {
    Promise.all([
      getLeadMetrics().then(setMetrics),
      getSalesDashboard().then(setSales).catch(() => setSales(null)),
      getConversations().then(setConversations).catch(() => setConversations([]))
    ]).catch(console.error);
  }, []);

  if (!metrics) {
    return (
      <div className="page page-single">
        <main className="main dashboard-page">
          <Topbar agent={agent} />
          <div className="content-toolbar"><BackToInbox /></div>
          <div className="empty-state">Cargando dashboard...</div>
        </main>
      </div>
    );
  }

  const aiOps = conversations.map((conversation) => ({ conversation, profile: buildAiOpsProfile(conversation, conversation.lead || null) }));
  const aiReady = aiOps.filter(({ conversation }) => isReadyToClose(conversation, conversation.lead || null)).length;
  const aiRisk = aiOps.filter(({ profile }) => profile.risk === "high").length;
  const aiStrategies = aiOps.filter(({ conversation }) => conversation.aiStrategy || conversation.aiRecommendedAction).length;
  const aiAvg = aiOps.length ? Math.round(aiOps.reduce((sum, item) => sum + item.profile.score, 0) / aiOps.length) : 0;

  return (
    <div className="page page-single">
      <main className="main dashboard-page">
        <Topbar agent={agent} />
        <div className="content-toolbar"><BackToInbox /></div>

        <div className="chat-header dashboard-hero">
          <div>
            <span className="eyebrow">Centro de control</span>
            <h1 className="chat-title">Dashboard comercial</h1>
            <div className="meta-line">Ventas, reservas, alertas inteligentes, revenue estimado y probabilidad de cierre.</div>
          </div>
          <div className="dashboard-hero-actions">
            <span className="badge signal-hot">🔥 Prioriza leads calientes</span>
            <span className="badge signal-followup">🤖 Revisa follow-ups</span>
          </div>
        </div>

        {sales && (
          <>
            <h2 className="section-title">Ventas y reservas</h2>
            <div className="dashboard-grid">
              <Card title="Ingresos totales" value={money(sales.revenue.total)} />
              <Card title="Ingresos del mes" value={money(sales.revenue.month)} />
              <Card title="Reservas confirmadas" value={sales.bookings.confirmed} />
              <Card title="Reservas pendientes" value={sales.bookings.pending} />
            </div>


            <h2 className="section-title">Decisiones IA</h2>
            <div className="dashboard-grid">
              <Card title="IA HOT" value={sales.ai.hot} />
              <Card title="IA WARM" value={sales.ai.warm} />
              <Card title="Requiere humano" value={sales.ai.handoffRequired} />
              <Card title="Score IA promedio" value={`${sales.ai.averageCloseScore}%`} />
            </div>

            <h2 className="section-title">Próximas reservas</h2>
            <div className="dashboard-grid dashboard-list-grid">
              {sales.bookings.upcoming.length ? sales.bookings.upcoming.map((booking) => (
                <div key={booking.id} className="metric-card dashboard-booking-card">
                  <div className="meta-line">{formatDate(booking.date)} · {booking.status}</div>
                  <strong>{booking.guests} personas</strong>
                  <div className="meta-line">{booking.location || "Lugar por confirmar"}</div>
                  <div className="badge" style={{ marginTop: 8 }}>{money(booking.total)}</div>
                </div>
              )) : (
                <div className="empty-state" style={{ minHeight: 120 }}>Aún no hay reservas próximas.</div>
              )}
            </div>
          </>
        )}

        <h2 className="section-title">Métricas comerciales</h2>
        <div className="dashboard-grid">
          <Card title="Leads totales" value={metrics.total} />
          <Card title="Conversión" value={`${sales?.leads.closeRate ?? metrics.conversionRate}%`} />
          <Card title="Revenue estimado" value={money(metrics.estimatedRevenue)} />
          <Card title="Cierre promedio" value={`${metrics.averageCloseProbability}%`} />
        </div>

        <h2 className="section-title">Alertas inteligentes</h2>
        <div className="dashboard-grid">
          <Alert title="🔥 Leads calientes" value={sales?.leads.hot ?? metrics.alerts.hotLeads} />
          <Alert title="⏱ Estancados" value={metrics.alerts.staleLeads} />
          <Alert title="⚠️ Urgentes sin atender" value={metrics.alerts.urgentUnanswered} />
        </div>

        <h2 className="section-title">Inteligencia operativa Fase 3</h2>
        <div className="dashboard-grid ai-ops-dashboard-grid">
          <Card title="Listos para vendedor" value={aiReady} />
          <Card title="Riesgo comercial alto" value={aiRisk} />
          <Card title="Estrategias IA activas" value={aiStrategies} />
          <Card title="Score IA promedio" value={`${aiAvg}%`} />
        </div>

        <div className="ai-ops-dashboard-strip">
          {aiOps.slice(0, 3).map(({ conversation, profile }) => (
            <div className="ai-ops-mini-card" key={conversation.id}>
              <strong>{conversation.contact.name || conversation.contact.username || conversation.contact.externalId}</strong>
              <span>{profile.label}</span>
              <small>{conversation.aiRecommendedAction || profile.nextBestAction}</small>
            </div>
          ))}
        </div>

        <h2 className="section-title">Pipeline</h2>
        <div className="dashboard-grid">
          {Object.entries(metrics.byStatus).map(([status, count]) => (
            <Card key={status} title={status} value={count} />
          ))}
        </div>

        <h2 className="section-title">Prioridad</h2>
        <div className="dashboard-grid">
          <Card title="Alta" value={metrics.byPriority.high || 0} />
          <Card title="Media" value={metrics.byPriority.medium || 0} />
          <Card title="Baja" value={metrics.byPriority.low || 0} />
        </div>
      </main>
    </div>
  );
}

function Card({ title, value }: { title: string; value: string | number }) {
  return (
    <div className="metric-card">
      <div className="meta-line">{title}</div>
      <strong>{value}</strong>
    </div>
  );
}

function Alert({ title, value }: { title: string; value: number }) {
  return (
    <div className="alert-card">
      <div>{title}</div>
      <strong>{value}</strong>
    </div>
  );
}
