"use client";

import { useEffect, useMemo, useState } from "react";
import { getLeads, updateLeadApi } from "@/lib/api";
import { Lead } from "@/lib/types";
import { getStoredSession, LogoutButton } from "@/lib/auth";
import Link from "next/link";

const columns = [
  { id: "NEW", label: "Prospeccion", tone: "prospect" },
  { id: "CONTACTED", label: "Contacto", tone: "contact" },
  { id: "VISIT_SCHEDULED", label: "Propuesta", tone: "proposal" },
  { id: "NEGOTIATION", label: "Negociacion", tone: "negotiation" },
  { id: "READY_TO_CLOSE", label: "Cierre", tone: "close" },
];

function money(value?: number | null) {
  return value
    ? new Intl.NumberFormat("es-CL", {
        style: "currency",
        currency: "CLP",
        maximumFractionDigits: 0
      }).format(value)
    : "Sin presupuesto";
}

function getLeadSignal(lead: Lead) {
  const close = lead.closeProbability ?? 0;
  const priority = lead.conversation?.priorityLabel || "low";

  if (lead.status === "READY_TO_CLOSE" || lead.conversation?.aiHandoffRequired) {
    return { label: "🚨 Listo para vendedor", className: "sales-alert-critical" };
  }

  if (close >= 75 || priority === "high") {
    return { label: "🔥 Lead caliente", className: "signal-hot" };
  }

  if (lead.nextFollowUpAt) {
    return { label: "🤖 Follow-up activo", className: "signal-followup" };
  }

  if (close < 35 && lead.status !== "NEW") {
    return { label: "⚠️ Riesgo de perder", className: "signal-risk" };
  }

  return { label: "💬 En evaluación", className: "signal-neutral" };
}

export default function PipelinePage() {
  const agent = getStoredSession();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      setError(null);
      setLeads(await getLeads());
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudieron cargar leads");
    }
  }

  useEffect(() => {
    load();
  }, []);

  const stats = useMemo(() => {
    const hot = leads.filter((lead) => (lead.closeProbability ?? 0) >= 75 || lead.conversation?.priorityLabel === "high").length;
    const ready = leads.filter((lead) => lead.status === "READY_TO_CLOSE" || lead.conversation?.aiHandoffRequired).length;
    const followups = leads.filter((lead) => Boolean(lead.nextFollowUpAt)).length;
    const totalValue = leads.reduce((acc, lead) => acc + (lead.budget || 0), 0);
    const avgClose = leads.length
      ? Math.round(leads.reduce((acc, lead) => acc + (lead.closeProbability ?? 0), 0) / leads.length)
      : 0;
    return { hot, ready, followups, avgClose, totalValue };
  }, [leads]);

  function stageValue(status: string) {
    return leads.filter((lead) => lead.status === status).reduce((acc, lead) => acc + (lead.budget || 0), 0);
  }

  async function moveLead(lead: Lead, status: string) {
    if (lead.status === status) return;
    const previous = leads;
    setLeads((items) => items.map((item) => item.id === lead.id ? { ...item, status } : item));

    try {
      const updated = await updateLeadApi(lead.conversationId, { status });
      setLeads((items) => items.map((item) => item.id === lead.id ? { ...item, ...updated } : item));
    } catch (err) {
      setLeads(previous);
      setError(err instanceof Error ? err.message : "No se pudo mover el lead");
    }
  }

  function openInbox(conversationId: string) {
    window.location.href = `/inbox?conversation=${conversationId}`;
  }

  return (
    <div className="pipeline-pro-shell">
      <aside className="pipeline-pro-sidebar">
        <div className="executive-brand">EVOLUM</div>
        {["Dashboard", "Workforce IA", "CRM", "Propiedades", "Contratos", "Pagos", "Analytics", "Configuracion"].map((item) => (
          <Link className={item === "CRM" ? "active" : ""} href={item === "Dashboard" ? "/dashboard" : item === "CRM" ? "/crm-principal" : item === "Pagos" ? "/payments" : "#"} key={item}>
            <span>{item.slice(0, 2).toUpperCase()}</span>{item}
          </Link>
        ))}
        <Link className="executive-new-btn" href="/inbox">Nueva oportunidad</Link>
      </aside>

      <main className="pipeline-pro-main">
        <header className="pipeline-pro-topbar">
          <button className="executive-menu" aria-label="Menu">=</button>
          <div className="executive-search">Buscar oportunidades, clientes, propiedades...</div>
          <div className="executive-top-actions">
            <Link className="ghost-btn" href="/crm-principal">Ir a CRM</Link>
            <span className="module-account-pill">{agent?.name || "Usuario"}</span>
            <LogoutButton />
          </div>
        </header>

        <section className="pipeline-pro-title">
          <div>
            <span className="meta-line">CRM / Pipeline</span>
            <h1>Pipeline de oportunidades</h1>
            <p>Gestiona y da seguimiento a tus oportunidades comerciales.</p>
          </div>
          <div className="pipeline-kpis">
            <span className="badge sales-alert-critical">🚨 {stats.ready} listos cierre</span>
            <span className="badge signal-hot">🔥 {stats.hot} calientes</span>
            <span className="badge signal-followup">🤖 {stats.followups} follow-ups</span>
            <span className="badge">🔮 {stats.avgClose}% cierre prom.</span>
          </div>
        </section>

        {error ? <div className="sales-queue-error">{error}</div> : null}

        <section className="pipeline-pro-toolbar">
          <button className="active">Kanban</button>
          <button>Lista</button>
          <button>Actividades</button>
          <button>Analisis</button>
          <span />
          <button>Filtros</button>
          <button>Automatizar</button>
          <Link className="primary-btn" href="/inbox">Nueva oportunidad</Link>
        </section>

        <div className="pipeline-pro-content">
          <div className="pipeline-board pipeline-board-pro">
            {columns.map((column) => {
              const items = leads.filter((lead) => lead.status === column.id);

              return (
                <section
                  key={column.id}
                  className={`pipeline-column pipeline-column-${column.tone}`}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={async () => {
                    const lead = leads.find((item) => item.id === draggingId);
                    if (lead) await moveLead(lead, column.id);
                    setDraggingId(null);
                  }}
                >
                  <div className="pipeline-column-header">
                    <div>
                      <strong>{column.label}</strong>
                      <small>{money(stageValue(column.id))}</small>
                    </div>
                    <span className="badge">{items.length}</span>
                  </div>

                  {items.length === 0 ? (
                    <div className="pipeline-empty">No hay leads aquí todavía.</div>
                  ) : null}

                  {items.map((lead) => {
                    const priorityLabel = lead.conversation?.priorityLabel || "low";
                    const signal = getLeadSignal(lead);

                    return (
                      <article
                        key={lead.id}
                        className={`pipeline-card priority-card-${priorityLabel}`}
                        draggable
                        onDragStart={() => setDraggingId(lead.id)}
                        onDragEnd={() => setDraggingId(null)}
                        onDoubleClick={() => openInbox(lead.conversationId)}
                      >
                        <div className="pipeline-card-top">
                          <strong>{lead.name || lead.phone || "Lead sin nombre"}</strong>
                          <span className={`badge priority-${priorityLabel}`}>{priorityLabel}</span>
                        </div>

                        <div className="meta-line">
                          {lead.commune || "Sin comuna"} · {lead.propertyType || "Sin tipo"}
                        </div>

                        <div className="badges" style={{ marginTop: 8 }}>
                          <span className="badge">💰 {money(lead.budget)}</span>
                          <span className="badge">🔮 {lead.closeProbability ?? 0}%</span>
                          <span className={`badge ${signal.className}`}>{signal.label}</span>
                        </div>

                        {lead.conversation?.aiHandoffRequired ? (
                          <div className="pipeline-next-action critical">🚨 Vendedor debe intervenir: {lead.conversation.aiHandoffReason || "cliente listo para cierre"}</div>
                        ) : lead.conversation?.aiNextAction ? (
                          <div className="pipeline-next-action">🎯 {lead.conversation.aiNextAction}</div>
                        ) : null}

                        {lead.closeReason ? (
                          <div className="meta-line" style={{ marginTop: 8 }}>
                            {lead.closeReason}
                          </div>
                        ) : null}

                        <div className="pipeline-card-actions">
                          <button className="ghost-btn" type="button" onClick={() => openInbox(lead.conversationId)}>Ver chat</button>
                        </div>
                      </article>
                    );
                  })}
                </section>
              );
            })}
          </div>

          <aside className="pipeline-insights-panel">
            <article>
              <div className="pipeline-insight-head">
                <h2>Resumen del pipeline</h2>
                <span>Este mes</span>
              </div>
              <strong>{money(stats.totalValue)}</strong>
              <p>Valor total por oportunidades activas.</p>
              <div className="pipeline-summary-list">
                <span>Oportunidades <b>{leads.length}</b></span>
                <span>Valor promedio <b>{money(leads.length ? stats.totalValue / leads.length : 0)}</b></span>
                <span>Tasa de conversion <b>{stats.avgClose}%</b></span>
                <span>Ciclo promedio <b>32 dias</b></span>
              </div>
            </article>
            <article>
              <div className="pipeline-insight-head">
                <h2>Insights con IA</h2>
                <span>IA</span>
              </div>
              <div className="pipeline-ai-note">2 oportunidades requieren seguimiento para mantener el cierre estimado.</div>
              <div className="pipeline-ai-note">Mejor momento para contactar: entre 10:00 y 12:00 hrs.</div>
              <div className="pipeline-ai-note">La etapa de propuesta acumula el mayor tiempo promedio.</div>
            </article>
            <article>
              <div className="pipeline-insight-head">
                <h2>Conversion por etapa</h2>
              </div>
              <div className="pipeline-stage-bars">
                {columns.map((column) => {
                  const count = leads.filter((lead) => lead.status === column.id).length;
                  const width = Math.max(8, Math.round((count / Math.max(1, leads.length)) * 100));
                  return <div key={column.id}><span>{column.label}</span><i><b style={{ width: `${width}%` }} /></i><strong>{width}%</strong></div>;
                })}
              </div>
            </article>
          </aside>
        </div>
      </main>
    </div>
  );
}
