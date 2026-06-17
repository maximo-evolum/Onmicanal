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
import { getStoredSession } from "@/lib/auth";
import { getSocketToken, socket } from "@/lib/socket";
import { Conversation, Message } from "@/lib/types";
import { Topbar } from "./topbar";
import { FiltersBar } from "./filters-bar";
import { ConversationList } from "./conversation-list";
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

  const [search, setSearch] = useState("");
  const [channel, setChannel] = useState("all");
  const [mode, setMode] = useState("all");
  const [status, setStatus] = useState("all");

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
      const label =
        `${conversation.contact.name || ""} ${conversation.contact.username || ""} ${conversation.contact.externalId || ""}`.toLowerCase();
      const matchesSearch = !search || label.includes(search.toLowerCase());
      const matchesChannel =
        channel === "all" || conversation.contact.channel === channel;
      const matchesMode = mode === "all" || conversation.mode === mode;
      const matchesStatus = status === "all" || conversation.status === status;
      return matchesSearch && matchesChannel && matchesMode && matchesStatus;
    });
  }, [conversations, search, channel, mode, status]);

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
    <div className="page inbox-layout">
      <aside className="sidebar">
        <Topbar agent={agent} />

        <div className="sidebar-header">
          <h2 className="sidebar-title">Conversaciones</h2>
          <div className="meta-line">
            {loading
              ? "Cargando..."
              : `${filteredConversations.length} visibles / ${conversations.length} totales`}
          </div>
          {error ? <div className="meta-line">{error}</div> : null}
          <div className="inbox-quick-hint">
            <span></span>
            <Link href="/dev/bot-lab"></Link>
          </div>
        </div>

        <div className="sidebar-body">
          <FiltersBar
            search={search}
            channel={channel}
            mode={mode}
            status={status}
            onSearch={setSearch}
            onChannel={setChannel}
            onMode={setMode}
            onStatus={setStatus}
          />

          <ConversationList
            conversations={filteredConversations}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
        </div>
      </aside>

      <main className="main">
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

      <ChatActivityPanel
        conversations={conversations}
        selectedId={selectedId}
        loading={loading}
        onSelect={setSelectedId}
      />
    </div>
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
