"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  deleteConversation,
  getConversations,
  getMessages,
  releaseConversation,
  resolveConversation,
  sendManualMessage,
  takeConversation,
} from "@/lib/api";
import { getStoredSession, LogoutButton } from "@/lib/auth";
import { getCommercialState } from "@/lib/commercial-state";
import { getSocketToken, socket } from "@/lib/socket";
import { Conversation, Message } from "@/lib/types";
import { ChatPanel } from "./chat-panel";

export function InboxShell() {
  const agent = getStoredSession();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [botTyping, setBotTyping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState("all");
  const [channelFilter, setChannelFilter] = useState("all");
  const [sidebarOpen, setSidebarOpen] = useState(true);

  function getInboxCacheKey() {
    return `inbox_conversations_${agent?.tenantId || agent?.id || "global"}`;
  }

  function saveInboxCache(items: Conversation[]) {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(getInboxCacheKey(), JSON.stringify(items));
    } catch {}
  }

  function readInboxCache(): Conversation[] {
    if (typeof window === "undefined") return [];
    try {
      const raw = window.localStorage.getItem(getInboxCacheKey());
      return raw ? (JSON.parse(raw) as Conversation[]) : [];
    } catch {
      return [];
    }
  }

  function mergeConversationsById(current: Conversation[], incoming: Conversation[]) {
    const map = new Map<string, Conversation>();
    [...current, ...incoming].forEach((conversation) => {
      map.set(conversation.id, {
        ...(map.get(conversation.id) || {}),
        ...conversation,
      });
    });
    return Array.from(map.values()).sort(
      (a, b) => +new Date(b.lastMessageAt || b.updatedAt || b.createdAt) - +new Date(a.lastMessageAt || a.updatedAt || a.createdAt),
    );
  }

  async function loadConversations(preferredConversationId?: string | null) {
    try {
      setLoading(true);
      const data = await getConversations();
      const merged = mergeConversationsById(conversations, data);
      setConversations(merged);
      saveInboxCache(merged);

      const conversationFromUrl =
        typeof window !== "undefined"
          ? new URLSearchParams(window.location.search).get("conversation")
          : null;
      const targetId = preferredConversationId || conversationFromUrl || selectedId;
      const targetExists = targetId && merged.some((item) => item.id === targetId);

      if (targetExists) {
        setSelectedId(targetId);
      } else if (!selectedId && merged.length > 0) {
        setSelectedId(merged[0].id);
      }
      setError(null);
    } catch (err) {
      const cached = readInboxCache();
      if (cached.length && conversations.length === 0) {
        setConversations(cached);
        if (!selectedId) setSelectedId(cached[0].id);
      }
      setError(
        err instanceof Error
          ? err.message
          : "No se pudieron cargar las conversaciones",
      );
    } finally {
      setLoading(false);
    }
  }

  async function loadMessages(conversationId: string) {
    try {
      setMessagesLoading(true);
      const data = await getMessages(conversationId);
      setMessages(data);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "No se pudieron cargar los mensajes",
      );
    } finally {
      setMessagesLoading(false);
    }
  }

  useEffect(() => {
    const cached = readInboxCache();
    if (cached.length) {
      setConversations(cached);
      if (!selectedId) setSelectedId(cached[0].id);
      setLoading(false);
    }
    loadConversations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (conversations.length) saveInboxCache(conversations);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversations]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      loadConversations(selectedId);
    }, 12000);

    return () => window.clearInterval(timer);
  }, [selectedId]);

  useEffect(() => {
    if (!selectedId) return;
    loadMessages(selectedId);
  }, [selectedId]);

  useEffect(() => {
    socket.auth = { token: getSocketToken() };
    socket.connect();
    if (agent?.tenantId) {
      socket.emit("join:tenant", agent.tenantId);
    }

    const onConversationCreated = (conversation: Conversation) => {
      setConversations((prev) => mergeConversationsById(prev, [conversation]));
    };

    const onConversationUpdated = (conversation: Conversation) => {
      setConversations((prev) => mergeConversationsById(prev, [conversation]));
    };

    socket.on("inbox:conversation-created", onConversationCreated);
    socket.on("inbox:conversation-updated", onConversationUpdated);

    return () => {
      socket.off("inbox:conversation-created", onConversationCreated);
      socket.off("inbox:conversation-updated", onConversationUpdated);
      if (agent?.tenantId) {
        socket.emit("leave:tenant", agent.tenantId);
      }
      socket.disconnect();
    };
  }, [agent?.tenantId]);

  useEffect(() => {
    if (!selectedId) return;

    socket.emit("join:conversation", selectedId);

    const onMessageNew = (message: Message) => {
      if (message.conversationId !== selectedId) return;
      setBotTyping(false);
      setMessages((prev) => {
        const exists = prev.some((item) => item.id === message.id);
        if (exists) return prev;
        return [...prev, message];
      });
    };

    const onConversationUpdated = (conversation: Conversation) => {
      if (conversation.id !== selectedId) return;
      setConversations((prev) =>
        prev.map((item) => (item.id === conversation.id ? conversation : item)),
      );
    };

    socket.on("message:new", onMessageNew);
    socket.on("conversation:updated", onConversationUpdated);

    return () => {
      socket.emit("leave:conversation", selectedId);
      socket.off("message:new", onMessageNew);
      socket.off("conversation:updated", onConversationUpdated);
    };
  }, [selectedId]);

  const filteredConversations = useMemo(() => {
    return conversations.filter((conversation) => {
      const matchesChannel = channelFilter === "all" || conversation.contact.channel === channelFilter;
      const matchesStatus =
        statusFilter === "all" ||
        (statusFilter === "untaken" && !conversation.assignedTo && conversation.status !== "RESOLVED") ||
        (statusFilter === "open" && conversation.status === "OPEN") ||
        (statusFilter === "resolved" && conversation.status === "RESOLVED");
      return matchesChannel && matchesStatus;
    });
  }, [conversations, statusFilter, channelFilter]);

  const selectedConversation = useMemo(
    () =>
      filteredConversations.find(
        (conversation) => conversation.id === selectedId,
      ) ||
      conversations.find((conversation) => conversation.id === selectedId) ||
      null,
    [filteredConversations, conversations, selectedId],
  );

  async function handleTake() {
    if (!selectedConversation || !agent?.id) return;
    await takeConversation(selectedConversation.id, agent.id);
    await loadConversations();
  }

  async function handleRelease() {
    if (!selectedConversation) return;
    await releaseConversation(selectedConversation.id);
    await loadConversations();
  }

  async function handleResolve() {
    if (!selectedConversation) return;
    await resolveConversation(selectedConversation.id);
    await loadConversations();
    if (selectedId === selectedConversation.id) {
      setSelectedId(null);
      setMessages([]);
    }
  }

  async function handleDelete() {
    if (!selectedConversation) return;
    await deleteConversation(selectedConversation.id);
    setConversations((prev) =>
      prev.filter((item) => item.id !== selectedConversation.id),
    );
    setSelectedId(null);
    setMessages([]);
  }

  async function handleSend(content: string) {
    if (!selectedConversation || !content.trim()) return;
    try {
      setSending(true);
      const saved = await sendManualMessage(selectedConversation.id, content);
      setMessages((prev) => {
        if (prev.some((item) => item.id === saved.id)) return prev;
        return [...prev, saved];
      });
      await Promise.all([
        loadMessages(selectedConversation.id),
        loadConversations(selectedConversation.id)
      ]);
      setError(null);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "No se pudo enviar el mensaje",
      );
    } finally {
      setSending(false);
    }
  }

  return (
    <div className={`inbox-unified-shell ${sidebarOpen ? "" : "nav-collapsed"}`}>
      <InboxUnifiedNav agent={agent} isOpen={sidebarOpen} onToggle={() => setSidebarOpen((value) => !value)} />

      <section className="inbox-unified-workspace">
        <InboxAppHeader
          agent={agent}
          loading={loading}
          visibleTotal={filteredConversations.length}
          total={conversations.length}
          error={error}
        />

        <InboxChannelTabs conversations={filteredConversations} />

        <div className="inbox-unified-main">
          <ChatActivityPanel
            conversations={filteredConversations}
            selectedId={selectedId}
            loading={loading}
            onSelect={setSelectedId}
          />

          <main className="main inbox-chat-stage">
            <ChatPanel
              conversation={selectedConversation}
              messages={messages}
              messagesLoading={messagesLoading}
              sending={sending}
              botTyping={botTyping}
              onTake={handleTake}
              onRelease={handleRelease}
              onResolve={handleResolve}
              onDelete={handleDelete}
              onSend={handleSend}
            />
          </main>

          <aside className="sidebar inbox-contact-panel">
            <ActiveConversationPanel
              conversation={selectedConversation}
              onTake={handleTake}
              onRelease={handleRelease}
              onResolve={handleResolve}
              onDelete={handleDelete}
            />
          </aside>
        </div>

      </section>
    </div>
  );
}

function InboxUnifiedNav({
  agent,
  isOpen,
  onToggle,
}: {
  agent: ReturnType<typeof getStoredSession>;
  isOpen: boolean;
  onToggle: () => void;
}) {
  const isDeveloper = agent?.role === "SUPER_ADMIN";
  const items = [
    ["Inicio", "/crm-principal", "Centro principal de EVOLUM", "IN"],
    ["Oficina de Agentes", "/crm-principal#agents", "Agentes AI activos y futuros", "OA"],
    ["Inbox Omnicanal", "/inbox", "Conversaciones y atencion IA", "IO"],
    ["Agenda", "/agenda", "Reservas, citas y disponibilidad", "AG"],
    ["Clientes", "/pipeline", "Leads, clientes y pipeline", "CL"],
    ["Campañas", "/campaigns", "Marketing IA y publicaciones", "CA"],
    ["Pagos", "/payments", "Cobros, estados y links", "PA"],
    ["Configuracion de Agente", "/onboarding", "Perfil, documentos, FAQs y reglas IA", "CG"],
    ["Equipo", "/team", "Usuarios, roles y actividad", "EQ"],
    ["Analytics & KPIs", "/dashboard", "Metricas operativas", "AN"],
    ["AI Ops / Cierres IA", "/ai-ops", "Razonamiento, cierres y alertas IA", "AI"],
    ...(isDeveloper ? [
      ["Desarrollador", "/admin", "Clientes, planes, modulos y permisos", "DE"],
      ["Planes y modulos", "/saas", "Configuracion SaaS por cuenta", "PM"],
      ["Bot Lab", "/dev/bot-lab", "Pruebas de respuestas y reglas", "BL"],
    ] : [])
  ];

  return (
    <aside className="inbox-unified-nav">
      <div className="inbox-nav-head">
        <Link className="inbox-nav-brand" href="/crm-principal" title="EVOLUM">
          <span>EV</span>
          <strong>EVOLUM</strong>
        </Link>
        <button className="inbox-nav-toggle" type="button" onClick={onToggle} aria-label={isOpen ? "Cerrar menu" : "Abrir menu"}>
          {isOpen ? "‹" : "›"}
        </button>
      </div>

      <nav className="inbox-unified-nav-list">
        {items.map(([label, href, description, icon]) => (
          <Link className={label === "Inbox Omnicanal" ? "active" : ""} href={href} key={label} title={label}>
            <span>{icon}</span>
            <div>
              <strong>{label}</strong>
              <small>{description}</small>
            </div>
          </Link>
        ))}
      </nav>

      <div className="inbox-nav-footer">
        <Link className="inbox-nav-action" href="/crm-principal" title="Volver al CRM">
          <span>CR</span>
          <strong>Volver al CRM</strong>
        </Link>
        <div className="inbox-nav-logout">
          <LogoutButton />
        </div>
      </div>
    </aside>
  );
}

function InboxChannelTabs({ conversations }: { conversations: Conversation[] }) {
  const count = (channel: string) => conversations.filter((conversation) => conversation.contact.channel === channel).length;
  const tabs = [
    ["Todos", conversations.length, ""],
    ["WhatsApp", count("whatsapp"), "https://cdn.simpleicons.org/whatsapp/25D366"],
    ["Instagram", count("instagram"), "https://cdn.simpleicons.org/instagram/E4405F"]
  ];

  return (
    <div className="inbox-channel-tabs">
      {tabs.map(([label, value, icon]) => (
        <span key={label}>
          {icon ? <img alt="" src={String(icon)} /> : null}
          {label}
          <b>{value}</b>
        </span>
      ))}
    </div>
  );
}

function inboxInitials(label: string) {
  return label
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

function conversationModeLabel(conversation: Conversation) {
  if (conversation.mode === "BOT") return "IA activa";
  if (conversation.mode === "HUMAN") return "Humano";
  return "Hibrido";
}

function conversationModeClass(conversation: Conversation) {
  if (conversation.mode === "BOT") return "mode-bot";
  if (conversation.mode === "HUMAN") return "mode-human";
  return "mode-hybrid";
}

function InboxAppHeader({
  agent,
  loading,
  visibleTotal,
  total,
  error,
}: {
  agent: ReturnType<typeof getStoredSession>;
  loading: boolean;
  visibleTotal: number;
  total: number;
  error: string | null;
}) {
  return (
    <header className="inbox-app-header">
      <div className="inbox-app-header-top">
        <div>
          <span className="eyebrow">Inbox IA</span>
          <h1>Conversaciones omnicanal</h1>
          <p>{error || (loading ? "Cargando conversaciones..." : `${visibleTotal} visibles / ${total} totales`)}</p>
        </div>

        <div className="inbox-account-box">
          <span>Cuenta</span>
          <strong>{agent?.name || "Usuario"}</strong>
          <small>{agent?.role || "Cliente"}</small>
        </div>

        <div className="inbox-app-actions" aria-hidden="true" />
      </div>
    </header>
  );
}

function ActiveConversationPanel({
  conversation,
  onTake,
  onRelease,
  onResolve,
  onDelete,
}: {
  conversation: Conversation | null;
  onTake: () => Promise<void>;
  onRelease: () => Promise<void>;
  onResolve: () => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  if (!conversation) {
    return (
      <section className="active-conversation-panel empty">
        <div>
          <span className="eyebrow">Conversacion activa</span>
          <h2>Selecciona un chat</h2>
          <p>Elige una conversacion desde Chats recientes para ver su contexto comercial.</p>
        </div>
      </section>
    );
  }

  const name = chatContactName(conversation);
  const commercial = getCommercialState(conversation, conversation.lead);
  const closeScore = conversation.aiCloseScore ?? conversation.aiLeadScore ?? 0;
  const requiresHandoff = Boolean(conversation.aiHandoffRequired || conversation.aiNextActionCode === "READY_TO_CLOSE");
  const handoffTitle = requiresHandoff
    ? "Lead listo para cierre humano"
    : closeScore >= 70
      ? "Oportunidad caliente"
      : "Conversacion activa";
  const handoffReason = conversation.aiHandoffReason || conversation.aiDecisionReason || conversation.aiNextAction || "La IA mantiene el contexto comercial listo para operar.";

  return (
    <section className="active-conversation-panel">
      <div className="active-conversation-main">
        <div className="avatar">{inboxInitials(name)}</div>
        <div className="active-conversation-copy">
          <span className="eyebrow">Conversacion activa</span>
          <h2>{name}</h2>
          <p>
            {conversation.contact.channel || "whatsapp"} / Cliente {conversation.contact.externalId || "sin numero"}
            {conversation.channelConfig?.displayNumber ? ` / Bot ${conversation.channelConfig.displayNumber}` : ""}
          </p>
        </div>
      </div>

      <div className="active-conversation-status">
        <span className={`badge priority-${commercial.priority}`}>{commercial.label}</span>
        <span className={`badge ${conversationModeClass(conversation)}`}>{conversationModeLabel(conversation)}</span>
        {conversation.priorityLabel ? <span className={`badge priority-${conversation.priorityLabel}`}>Prioridad {conversation.priorityLabel}</span> : null}
        {closeScore ? <span className="badge sales-alert-critical">{closeScore}% cierre</span> : null}
      </div>

      <div className={`active-conversation-signal ${requiresHandoff ? "critical" : closeScore >= 70 ? "hot" : ""}`}>
        <strong>{handoffTitle}</strong>
        <span>{handoffReason}</span>
      </div>

      <div className="active-conversation-actions">
        <button className="secondary-btn" onClick={onTake}>Tomar conversacion</button>
        <button className="secondary-btn" onClick={onRelease}>Devolver al bot</button>
        <button className="success-btn" onClick={onResolve}>Marcar resuelta</button>
        <button className="danger-btn" onClick={onDelete}>Eliminar chat</button>
      </div>
    </section>
  );
}

function chatContactName(conversation: Conversation) {
  return conversation.contact.name || conversation.contact.username || conversation.contact.externalId || "Contacto sin nombre";
}

function chatContactNumber(conversation: Conversation) {
  const value = conversation.contact.externalId || conversation.contact.username || "";
  if (!value) return conversation.contact.channel || "whatsapp";
  return value.startsWith("+") ? value : `+${value}`;
}

function chatDescription(conversation: Conversation) {
  const text = conversation.aiSummary || conversation.decisionSummary || conversation.lastMessage?.content || conversation.aiNextAction || "Conversacion activa en el inbox.";
  const clean = String(text).replace(/\s+/g, " ").replace(/\*\*/g, "").trim();
  return clean.length > 84 ? `${clean.slice(0, 84).trim()}...` : clean;
}

function chatTime(value?: string | null) {
  if (!value) return "Ahora";
  try {
    return new Intl.DateTimeFormat("es-CL", { hour: "2-digit", minute: "2-digit" }).format(new Date(value));
  } catch {
    return "Ahora";
  }
}

function ChatActivityPanel({
  conversations,
  selectedId,
  loading,
  onSelect,
}: {
  conversations: Conversation[];
  selectedId: string | null;
  loading: boolean;
  onSelect: (id: string) => void;
}) {
  const recent = conversations.slice(0, 12);

  return (
    <aside className="sidebar inbox-chat-feed-panel">
      <div className="sidebar-header inbox-chat-feed-head">
        <h2 className="sidebar-title">Chats recientes</h2>
        <div className="meta-line">
          {loading ? "Cargando conversaciones..." : `${recent.length} conversaciones visibles`}
        </div>
      </div>

      <div className="inbox-chat-feed-list">
        {recent.map((conversation) => (
          <button
            className={`inbox-chat-feed-item ${conversation.id === selectedId ? "active" : ""}`}
            key={conversation.id}
            type="button"
            onClick={() => onSelect(conversation.id)}
          >
            <span className="inbox-chat-feed-icon">
              <img alt="" src="https://cdn.simpleicons.org/whatsapp/25D366" />
            </span>
            <span className="inbox-chat-feed-copy">
              <strong>{chatContactName(conversation)}</strong>
              <small>{chatContactNumber(conversation)} / {chatTime(conversation.lastMessageAt)}</small>
              <em>{chatDescription(conversation)}</em>
            </span>
          </button>
        ))}

        {!recent.length ? (
          <div className="inbox-chat-feed-empty">Cuando lleguen mensajes, apareceran aqui para revisar rapido.</div>
        ) : null}
      </div>
    </aside>
  );
}
