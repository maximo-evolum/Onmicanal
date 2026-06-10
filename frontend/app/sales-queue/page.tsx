"use client";

import { useEffect, useMemo, useState } from "react";
import { getConversations, getSalesQueue } from "@/lib/api";
import { Conversation } from "@/lib/types";
import { buildAiOpsProfile, riskLabel } from "@/lib/ai-ops";
import { Topbar } from "@/components/topbar";
import { BackToInbox } from "@/components/BackToInbox";
import { getStoredSession } from "@/lib/auth";

function getScore(conversation: Conversation) {
  return conversation.aiCloseScore ?? conversation.aiLeadScore ?? conversation.lead?.closeProbability ?? 0;
}

function isReady(conversation: Conversation) {
  return Boolean(
    conversation.aiHandoffRequired ||
    conversation.aiNextActionCode === "READY_TO_CLOSE" ||
    conversation.lead?.status === "READY_TO_CLOSE" ||
    getScore(conversation) >= 75
  );
}

function openInbox(conversationId: string) {
  window.location.href = `/inbox?conversation=${conversationId}`;
}

export default function SalesQueuePage() {
  const agent = getStoredSession();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      setLoading(true);
      setError(null);
      try {
        setConversations(await getSalesQueue());
      } catch {
        setConversations(await getConversations());
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo cargar la cola de ventas");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const ready = useMemo(() => {
    return conversations
      .filter(isReady)
      .sort((a, b) => getScore(b) - getScore(a));
  }, [conversations]);

  const stats = useMemo(() => {
    const handoff = ready.filter((item) => item.aiHandoffRequired).length;
    const avg = ready.length ? Math.round(ready.reduce((sum, item) => sum + getScore(item), 0) / ready.length) : 0;
    return { total: ready.length, handoff, avg };
  }, [ready]);

  return (
    <div className="page page-single">
      <main className="main sales-queue-page">
        <Topbar agent={agent} />
        <div className="content-toolbar"><BackToInbox /></div>

        <section className="sales-queue-hero">
          <div>
            <h1 className="chat-title">Cierres IA</h1>
            <p className="meta-line">Cola operativa para vendedores: leads con intención alta, listos para reserva/pago o que requieren intervención humana.</p>
          </div>
          <div className="sales-queue-kpis">
            <span className="badge sales-alert-critical">🚨 {stats.total} listos</span>
            <span className="badge sales-alert-hot">👤 {stats.handoff} handoff</span>
            <span className="badge">🔮 {stats.avg}% cierre prom.</span>
          </div>
        </section>

        {error ? <div className="sales-queue-error">{error}</div> : null}
        {loading ? <div className="empty-state">Cargando cierres...</div> : null}

        {!loading && ready.length === 0 ? (
          <div className="empty-state guided-empty-state">
            <div>
              <strong>No hay cierres pendientes</strong>
              <p>Cuando la IA detecte intención de pago, reserva o compra, aparecerá aquí para que un vendedor tome acción.</p>
            </div>
          </div>
        ) : null}

        <div className="sales-queue-grid">
          {ready.map((conversation) => {
            const label = conversation.contact.name || conversation.contact.username || conversation.contact.externalId;
            const score = getScore(conversation);
            const profile = buildAiOpsProfile(conversation, conversation.lead || null);
            const reason = conversation.aiHandoffReason || conversation.aiDecisionReason || conversation.aiReason || "La IA detectó una oportunidad con señales comerciales fuertes.";
            const action = conversation.aiNextAction || "Tomar conversación y continuar el cierre.";
            return (
              <article key={conversation.id} className={`sales-queue-card ${conversation.aiHandoffRequired ? "urgent" : ""}`}>
                <div className="sales-queue-card-top">
                  <div>
                    <strong>{label}</strong>
                    <div className="meta-line">{conversation.contact.channel} · {conversation.contact.externalId}</div>
                  </div>
                  <span className={conversation.aiHandoffRequired ? "badge sales-alert-critical" : "badge sales-alert-hot"}>{score}%</span>
                </div>

                <div className="sales-queue-reason">{reason}</div>

                <div className="sales-next-steps">
                  <span>🎯 {conversation.aiRecommendedAction || action}</span>
                  <span>🧠 {conversation.aiStrategy || profile.strategy}</span>
                  <span>⚡ Urgencia {riskLabel(profile.urgency)} · Riesgo {riskLabel(profile.risk)}</span>
                  {conversation.lead?.status ? <span>📌 {conversation.lead.status}</span> : null}
                </div>

                <button className="primary-btn" type="button" onClick={() => openInbox(conversation.id)}>
                  Abrir chat y cerrar
                </button>
              </article>
            );
          })}
        </div>
      </main>
    </div>
  );
}
