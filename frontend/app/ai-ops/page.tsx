"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { getAiOpsSummary, getConversations, type AiOpsSummary } from "@/lib/api";
import { Conversation } from "@/lib/types";
import { buildAiOpsProfile, getAiBadgeClass, getConversationState, isReadyToClose, riskLabel } from "@/lib/ai-ops";
import { getStoredSession, LogoutButton } from "@/lib/auth";
import { EvolumSidebar } from "@/components/evolum-sidebar";

function openInbox(conversationId: string) {
  window.location.href = `/inbox?conversation=${conversationId}`;
}

function customerName(conversation: Conversation) {
  return conversation.contact.name || conversation.contact.username || conversation.contact.externalId || "Cliente";
}

export default function AiOpsPage() {
  const agent = getStoredSession();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [summary, setSummary] = useState<AiOpsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  async function load(silent = false) {
    try {
      if (!silent) setLoading(true);
      if (!silent) setError(null);
      try {
        const data = await getAiOpsSummary();
        setSummary(data);
        setConversations((data.priorities || data.strategies || []).map((item) => item.conversation));
      } catch {
        setSummary(null);
        setConversations(await getConversations());
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo cargar AI Ops");
    } finally {
      if (!silent) setLoading(false);
    }
  }

  useEffect(() => {
    load();
    const interval = window.setInterval(() => load(true), 15000);
    return () => window.clearInterval(interval);
  }, []);

  const enriched = useMemo(() => {
    return conversations
      .map((conversation) => ({ conversation, profile: buildAiOpsProfile(conversation, conversation.lead || null) }))
      .sort((a, b) => b.profile.score - a.profile.score);
  }, [conversations]);

  const critical = enriched.filter(({ conversation }) => conversation.aiHandoffRequired || isReadyToClose(conversation, conversation.lead || null));
  const strategic = enriched.filter(({ profile }) => profile.score >= 55 && profile.score < 80);
  const learning = enriched.filter(({ conversation }) => conversation.aiFeedbackSummary || conversation.aiRecoveryPlan || conversation.aiReasoningSummary);

  const avg = enriched.length ? Math.round(enriched.reduce((sum, item) => sum + item.profile.score, 0) / enriched.length) : 0;

  return (
    <div className={`module-with-menu-shell ${sidebarOpen ? "" : "nav-collapsed"}`}>
      <EvolumSidebar
        active="AI Ops / Cierres IA"
        isDeveloper={agent?.role === "SUPER_ADMIN"}
        isOpen={sidebarOpen}
        onToggle={() => setSidebarOpen((value) => !value)}
      />
      <main className="main ai-ops-page">
        <header className="module-app-header">
          <div>
            <span className="eyebrow">AI Ops / Cierres IA</span>
            <h1>Centro de inteligencia comercial</h1>
            <div className="meta-line">Prioridades, cierre humano, estrategia, riesgo, urgencia y proximas acciones sugeridas por la IA.</div>
          </div>
          <div className="module-app-actions">
            <span className="badge sales-alert-critical">🚨 {summary?.metrics.critical ?? critical.length} críticos</span>
            <span className="badge sales-alert-hot">🔥 {summary?.metrics.opportunities ?? strategic.length} oportunidades</span>
            <span className="badge sales-alert-action">🧠 {summary?.metrics.averageScore ?? avg}% score prom.</span>
            <Link className="ghost-btn" href="/crm-principal">Ir a CRM</Link>
            <span className="module-account-pill">{agent?.name || "Usuario"}</span>
            <LogoutButton />
          </div>
        </header>

        {error ? <div className="sales-queue-error">{error}</div> : null}
        {loading ? <div className="empty-state">Cargando inteligencia IA...</div> : null}

        {!loading ? (
          <>
            <section className="ai-ops-section">
              <div className="ai-ops-section-header">
                <div>
                  <h2>Prioridades del vendedor</h2>
                  <p>Leads que la IA considera listos para acción humana o estrategia de cierre.</p>
                </div>
              </div>
              <div className="ai-ops-grid">
                {(critical.length ? critical : enriched.slice(0, 4)).map(({ conversation, profile }) => (
                  <article className="ai-ops-work-card" key={conversation.id}>
                    <div className="ai-ops-work-top">
                      <div>
                        <strong>{customerName(conversation)}</strong>
                        <div className="meta-line">{conversation.contact.channel} · Estado {getConversationState(conversation, conversation.lead || null)}</div>
                      </div>
                      <span className={`badge ${getAiBadgeClass(profile)}`}>{profile.score}%</span>
                    </div>
                    <h3>{profile.label}</h3>
                    <p>{conversation.aiReasoningSummary || profile.reason}</p>
                    <div className="ai-ops-matrix compact">
                      <span><small>Urgencia</small><strong>{riskLabel(profile.urgency)}</strong></span>
                      <span><small>Riesgo</small><strong>{riskLabel(profile.risk)}</strong></span>
                      <span><small>Precio</small><strong>{riskLabel(profile.priceSensitivity)}</strong></span>
                    </div>
                    <div className="ai-ops-strategy"><small>Estrategia</small><span>{conversation.aiStrategy || profile.strategy}</span></div>
                    <div className="ai-ops-strategy next"><small>Acción</small><span>{conversation.aiRecommendedAction || profile.nextBestAction}</span></div>
                    <button className="primary-btn" onClick={() => openInbox(conversation.id)}>Abrir conversación</button>
                  </article>
                ))}
              </div>
            </section>

            <section className="ai-ops-section two-col">
              <div className="ai-ops-panel">
                <h2>🧭 Estrategias activas</h2>
                <div className="ai-ops-list">
                  {strategic.slice(0, 6).map(({ conversation, profile }) => (
                    <button key={conversation.id} className="ai-ops-list-row" onClick={() => openInbox(conversation.id)}>
                      <span>{customerName(conversation)}</span>
                      <small>{conversation.aiStrategy || profile.strategy}</small>
                    </button>
                  ))}
                  {!strategic.length ? <p className="meta-line">Aún no hay estrategias activas suficientes.</p> : null}
                </div>
              </div>

              <div className="ai-ops-panel">
                <h2>📈 Aprendizaje y recuperación</h2>
                <div className="ai-ops-list">
                  {learning.slice(0, 6).map(({ conversation }) => (
                    <button key={conversation.id} className="ai-ops-list-row" onClick={() => openInbox(conversation.id)}>
                      <span>{customerName(conversation)}</span>
                      <small>{conversation.aiFeedbackSummary || conversation.aiRecoveryPlan || conversation.aiReasoningSummary}</small>
                    </button>
                  ))}
                  {!learning.length ? <p className="meta-line">Cuando la IA registre aprendizajes o planes de recuperación aparecerán aquí.</p> : null}
                </div>
              </div>
            </section>
          </>
        ) : null}
      </main>
    </div>
  );
}
