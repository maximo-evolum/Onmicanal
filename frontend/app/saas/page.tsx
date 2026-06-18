"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getSaasOverview, SaasOverview } from "@/lib/api";
import { getStoredSession, LogoutButton } from "@/lib/auth";

function money(value?: number, currency = "CLP") {
  return new Intl.NumberFormat("es-CL", { style: "currency", currency, maximumFractionDigits: 0 }).format(value || 0);
}

export default function SaasPage() {
  const agent = getStoredSession();
  const [data, setData] = useState<SaasOverview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getSaasOverview().then(setData).catch((err) => setError(err instanceof Error ? err.message : "No se pudo cargar SaaS Center"));
  }, []);

  return (
    <div className="page page-single">
      <main className="main dashboard-page phase5-page">
        <header className="module-app-header">
          <div>
            <span className="eyebrow">Planes y modulos</span>
            <h1>Centro SaaS</h1>
            <div className="meta-line">Planes, limites, modulos activos, onboarding y senales comerciales.</div>
          </div>
          <div className="module-app-actions">
            <Link className="ghost-btn" href="/crm-principal">Ir a CRM</Link>
            <span className="module-account-pill">{agent?.name || "Usuario"}</span>
            <LogoutButton />
          </div>
        </header>
        <section className="phase5-hero">
          <div>
            <span className="eyebrow">SaaS Command Center</span>
            <h1 className="chat-title">Centro comercial del workspace</h1>
            <p className="meta-line">Planes, límites, onboarding, configuración IA y señales comerciales en un solo lugar.</p>
          </div>
          <div className="phase5-actions">
            <Link className="primary-btn" href="/onboarding">Configurar agente</Link>
            <Link className="ghost-btn" href="/dashboard">Ver analytics</Link>
          </div>
        </section>

        {error ? <div className="admin-notice error">{error}</div> : null}
        {!data ? <div className="empty-state">Cargando centro SaaS...</div> : (
          <>
            <section className="phase5-grid four">
              <Card title="Plan actual" value={data.plan?.name || data.tenant?.plan || "Starter"} detail={data.plan?.description || "Plan activo"} />
              <Card title="Precio mensual" value={money(data.plan?.priceMonthly, data.plan?.currency)} detail="Referencia comercial" />
              <Card title="Uso mensual" value={`${data.usage?.usagePercent || 0}%`} detail={`${data.usage?.messages || 0}/${data.usage?.limits?.messagesMonthly ?? "∞"} mensajes`} />
              <Card title="Onboarding" value={`${data.onboarding?.completedPercent || 0}%`} detail={`${data.onboarding?.completed || 0}/${data.onboarding?.total || 0} pasos`} />
            </section>

            <section className="phase5-grid two">
              <article className="phase5-panel">
                <div className="phase5-panel-head">
                  <div><h2>Módulos activos</h2><p>Capacidades habilitadas para este cliente.</p></div>
                </div>
                <div className="phase5-chip-grid">
                  {(data.modules || []).map((module) => <span key={module} className="phase5-chip">{module}</span>)}
                </div>
              </article>

              <article className="phase5-panel">
                <div className="phase5-panel-head">
                  <div><h2>Recomendaciones IA</h2><p>Señales operativas para mejorar conversión.</p></div>
                </div>
                <div className="phase5-list">
                  {(data.recommendations || []).map((item, index) => <div key={index} className="phase5-list-row">{item}</div>)}
                </div>
              </article>
            </section>

            <section className="phase5-grid three">
              <Card title="Conversaciones" value={data.analytics?.conversations || 0} detail="últimas operativas" />
              <Card title="Listos para cierre" value={data.analytics?.ready || 0} detail="requieren vendedor" />
              <Card title="Handoff IA" value={data.analytics?.handoff || 0} detail="intervención sugerida" />
            </section>

            <section className="phase5-panel">
              <div className="phase5-panel-head"><div><h2>Accesos rápidos</h2><p>Herramientas de operación comercial SaaS.</p></div></div>
              <div className="phase5-quick-grid">
                <Link href="/onboarding">Personalidad y reglas IA</Link>
                <Link href="/team">Equipo y roles</Link>
                <Link href="/onboarding">Onboarding guiado</Link>
                <Link href="/dashboard">Analytics & KPIs</Link>
              </div>
            </section>
          </>
        )}
      </main>
    </div>
  );
}

function Card({ title, value, detail }: { title: string; value: string | number; detail?: string }) {
  return <article className="phase5-card"><span>{title}</span><strong>{value}</strong>{detail ? <small>{detail}</small> : null}</article>;
}
