"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  deleteConversation,
  getConversations,
  getLead,
  getMessages,
  releaseConversation,
  resolveConversation,
  sendManualMessage,
  takeConversation,
  updateLeadApi,
} from "@/lib/api";
import { getStoredSession } from "@/lib/auth";
import { socket } from "@/lib/socket";
import { Conversation, Lead, Message } from "@/lib/types";
import { Topbar } from "./topbar";
import { FiltersBar } from "./filters-bar";
import { ConversationList } from "./conversation-list";
import { ChatPanel } from "./chat-panel";
import { LeadPanel } from "./lead-panel";

export function InboxShell() {
  const agent = getStoredSession();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [lead, setLead] = useState<Lead | null>(null);
  const [loading, setLoading] = useState(true);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [botTyping, setBotTyping] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [channel, setChannel] = useState("all");
  const [mode, setMode] = useState("all");
  const [status, setStatus] = useState("all");

  async function loadConversations(preferredConversationId?: string | null) {
    try {
      setLoading(true);
      const data = await getConversations();
      setConversations(data);

      const conversationFromUrl =
        typeof window !== "undefined"
          ? new URLSearchParams(window.location.search).get("conversation")
          : null;
      const targetId =
        preferredConversationId || conversationFromUrl || selectedId;
      const targetExists =
        targetId && data.some((item) => item.id === targetId);

      if (targetExists) {
        setSelectedId(targetId);
      } else if (!selectedId && data.length > 0) {
        setSelectedId(data[0].id);
      }
    } catch (err) {
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
    loadConversations();
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      loadConversations(selectedId);
    }, 12000);

    return () => window.clearInterval(timer);
  }, [selectedId]);

  useEffect(() => {
    if (!selectedId) return;
    loadMessages(selectedId);
    loadLead(selectedId);
  }, [selectedId]);
  async function loadLead(conversationId: string) {
    try {
      const data = await getLead(conversationId);
      setLead(data);
    } catch {
      setLead(null);
    }
  }

  useEffect(() => {
    socket.connect();
    if (agent?.tenantId) {
      socket.emit("join:tenant", agent.tenantId);
    }

    const onConversationCreated = (conversation: Conversation) => {
      setConversations((prev) => {
        const exists = prev.some((item) => item.id === conversation.id);
        if (exists) return prev;
        return [conversation, ...prev];
      });
    };

    const onConversationUpdated = (conversation: Conversation) => {
      setConversations((prev) => {
        const index = prev.findIndex((item) => item.id === conversation.id);
        if (index === -1) return [conversation, ...prev];
        const copy = [...prev];
        copy[index] = conversation;
        copy.sort(
          (a, b) => +new Date(b.lastMessageAt) - +new Date(a.lastMessageAt),
        );
        return copy;
      });
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
      setLead(null);
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
    setLead(null);
  }

  async function handleSend(content: string) {
    if (!selectedConversation || !content.trim()) return;
    try {
      setSending(true);
      await sendManualMessage(selectedConversation.id, content);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "No se pudo enviar el mensaje",
      );
    } finally {
      setSending(false);
    }
  }

  function handleLeadChange(field: keyof Lead, value: string | number | null) {
    setLead((prev) => (prev ? { ...prev, [field]: value } : prev));
  }

  async function handleLeadSave() {
    if (!selectedConversation || !lead) return;
    try {
      const updated = await updateLeadApi(selectedConversation.id, lead);
      setLead(updated);
      await loadConversations();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "No se pudo guardar el lead",
      );
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
            <span>Prueba conversaciones sin llenar el inbox.</span>
            <Link href="/dev/bot-lab">Abrir Bot Lab</Link>
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

      <LeadPanel
        lead={lead || selectedConversation?.lead || null}
        conversation={selectedConversation}
        onChange={handleLeadChange}
        onSave={handleLeadSave}
      />
    </div>
  );
}
