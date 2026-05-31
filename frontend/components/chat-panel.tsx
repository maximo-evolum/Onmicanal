"use client";

import { useEffect, useMemo, useRef } from "react";
import { Conversation, Message } from "@/lib/types";
import { Composer } from "./composer";

function getInitials(label: string) {
  return label
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat("es-CL", {
    hour: "2-digit",
    minute: "2-digit",
    day: "2-digit",
    month: "2-digit"
  }).format(new Date(value));
}

export function ChatPanel({
  conversation,
  messages,
  messagesLoading,
  sending,
  botTyping = false,
  onTake,
  onRelease,
  onResolve,
  onDelete,
  onSend,
}: {
  conversation: Conversation | null;
  messages: Message[];
  messagesLoading: boolean;
  sending: boolean;
  botTyping?: boolean;
  onTake: () => Promise<void>;
  onRelease: () => Promise<void>;
  onResolve: () => Promise<void>;
  onDelete: () => Promise<void>;
  onSend: (content: string) => Promise<void>;
}) {
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, sending, botTyping, conversation?.id]);

  const displayName = useMemo(() => {
    if (!conversation) return "";
    return conversation.contact.name || conversation.contact.username || conversation.contact.externalId;
  }, [conversation]);

  if (!conversation) {
    return (
      <div className="empty-state guided-empty-state">
        <div>
          <strong>Selecciona una conversación</strong>
          <p>O simula un lead para ver cómo responde la IA y cómo se crea la ficha comercial.</p>
        </div>
      </div>
    );
  }

  const modeLabel =
    conversation.mode === "BOT"
      ? "IA activa"
      : conversation.mode === "HUMAN"
      ? "Humano"
      : "Híbrido";

  const requiresHandoff = Boolean(conversation.aiHandoffRequired || conversation.aiNextActionCode === "READY_TO_CLOSE");
  const closeScore = conversation.aiCloseScore ?? conversation.aiLeadScore ?? 0;

  const modeClass =
    conversation.mode === "BOT"
      ? "mode-bot"
      : conversation.mode === "HUMAN"
      ? "mode-human"
      : "mode-hybrid";

  return (
    <div className="chat-shell">
      <div className="chat-header">
        <div className="chat-header-main">
          <div className="chat-header-left">
            <div className="avatar">{getInitials(displayName)}</div>
            <div>
              <h2 className="chat-title">{displayName}</h2>
              <div className="meta-line">
                {conversation.contact.channel} · Cliente {conversation.contact.externalId}
                {conversation.channelConfig?.displayNumber ? ` · Bot ${conversation.channelConfig.displayNumber}` : ""}
              </div>
            </div>
          </div>

          <div className="header-meta-row">
            <span className="badge">{conversation.status}</span>
            <span className={`badge ${modeClass}`}>{modeLabel}</span>
            {conversation.priorityLabel ? <span className={`badge priority-${conversation.priorityLabel}`}>Prioridad {conversation.priorityLabel}</span> : null}
            {conversation.assignedTo ? <span className="badge">Asignado a {conversation.assignedTo.name}</span> : null}
          </div>
        </div>

        {requiresHandoff ? (
          <div className="ai-handoff-banner">
            <div>
              <strong>🚨 Lead listo para cierre humano</strong>
              <p>{conversation.aiHandoffReason || conversation.aiDecisionReason || "La IA detectó intención alta de compra/reserva. Un vendedor debería continuar el cierre."}</p>
            </div>
            <span className="badge sales-alert-critical">{closeScore}% cierre</span>
          </div>
        ) : closeScore >= 70 ? (
          <div className="ai-handoff-banner soft">
            <div>
              <strong>🔥 Oportunidad caliente</strong>
              <p>{conversation.aiDecisionReason || "La IA detectó señales comerciales fuertes. Mantén la conversación activa."}</p>
            </div>
            <span className="badge sales-alert-hot">{closeScore}% cierre</span>
          </div>
        ) : null}

        <div className="header-actions" style={{ marginTop: 12 }}>
          <button className="secondary-btn" onClick={onTake}>Tomar conversación</button>
          <button className="secondary-btn" onClick={onRelease}>Devolver al bot</button>
          <button className="success-btn" onClick={onResolve}>Marcar resuelta</button>
          <button className="danger-btn" onClick={onDelete}>Eliminar chat</button>
        </div>
      </div>

      <div className="chat-body">
        {messagesLoading ? (
          <div className="meta-line">Cargando mensajes...</div>
        ) : messages.length === 0 ? (
          <div className="empty-state guided-empty-state">
            <div>
              <strong>Sin mensajes todavía</strong>
              <p>Cuando entre un mensaje, la IA responderá y actualizará el lead automáticamente.</p>
            </div>
          </div>
        ) : (
          messages.map((message) => {
            const isInbound = message.direction === "INBOUND";
            return (
              <div key={message.id} className={`message-row ${isInbound ? "inbound" : "outbound"}`}>
                <div className="message-stack">
                  <div className="message-bubble">{message.content}</div>
                  <div className="message-meta">
                    <span>{formatTime(message.createdAt)}</span>
                    <span>·</span>
                    <span>{isInbound ? "Cliente" : conversation.mode === "BOT" ? "IA" : "Asesor"}</span>
                  </div>
                </div>
              </div>
            );
          })
        )}

        {sending ? (
          <div className="message-row outbound">
            <div className="message-stack">
              <div className="typing-indicator"><span></span><span></span><span></span></div>
              <div className="message-meta"><span>Enviando...</span></div>
            </div>
          </div>
        ) : null}

        {botTyping ? (
          <div className="message-row inbound">
            <div className="message-stack">
              <div className="typing-indicator"><span></span><span></span><span></span></div>
              <div className="message-meta"><span>IA escribiendo...</span></div>
            </div>
          </div>
        ) : null}

        <div ref={bottomRef} />
      </div>

      <Composer disabled={sending} suggestedReply={conversation.aiSuggestedReply} onSend={onSend} />
    </div>
  );
}
