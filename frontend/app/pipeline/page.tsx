"use client";

import { useEffect, useMemo, useState } from "react";
import { getLeads, updateLeadApi } from "@/lib/api";
import { Lead } from "@/lib/types";
import { getStoredSession, LogoutButton } from "@/lib/auth";
import Link from "next/link";

const columns = [
  { id: "NEW", label: "Nuevos" },
  { id: "CONTACTED", label: "Contactados" },
  { id: "VISIT_SCHEDULED", label: "Visitas" },
  { id: "NEGOTIATION", label: "Negociación" },
  { id: "READY_TO_CLOSE", label: "Listos cierre" },
  { id: "LOST", label: "Perdidos" },
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
    const avgClose = leads.length
      ? Math.round(leads.reduce((acc, lead) => acc + (lead.closeProbability ?? 0), 0) / leads.length)
      : 0;
    return { hot, ready, followups, avgClose };
  }, [leads]);

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
    <div className="page page-single">
      <main className="main">
        <header className="pipeline-app-header">
          <div>
            <h1>Pipeline comercial</h1>
            <div className="meta-line">Prioriza oportunidades, revisa senales de cierre y vuelve al chat en un clic.</div>
          </div>
          <div className="pipeline-app-actions">
            <Link className="ghost-btn" href="/crm-principal">Volver al CRM</Link>
            <span className="pipeline-account-pill">{agent?.name || "Usuario"}</span>
            <LogoutButton />
          </div>
        </header>

        <div className="chat-header pipeline-hero">
          <div className="chat-header-main">
            <div className="pipeline-kpis">
              <span className="badge sales-alert-critical">🚨 {stats.ready} listos cierre</span>
              <span className="badge signal-hot">🔥 {stats.hot} calientes</span>
              <span className="badge signal-followup">🤖 {stats.followups} follow-ups</span>
              <span className="badge">🔮 {stats.avgClose}% cierre prom.</span>
            </div>
          </div>

          {error ? <div className="meta-line" style={{ marginTop: 8 }}>{error}</div> : null}
        </div>

        <div className="pipeline-board">
          {columns.map((column) => {
            const items = leads.filter((lead) => lead.status === column.id);

            return (
              <section
                key={column.id}
                className="pipeline-column"
                onDragOver={(event) => event.preventDefault()}
                onDrop={async () => {
                  const lead = leads.find((item) => item.id === draggingId);
                  if (lead) await moveLead(lead, column.id);
                  setDraggingId(null);
                }}
              >
                <div className="pipeline-column-header">
                  <strong>{column.label}</strong>
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
      </main>
    </div>
  );
}
