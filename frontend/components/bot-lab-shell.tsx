"use client";

import { useEffect, useRef, useState } from "react";
import { simulateLeadUtf8, testBot, type BotLabResult } from "@/lib/api";
import { getStoredSession } from "@/lib/auth";
import { AccountPill } from "@/components/account-pill";
import { EvolumSidebar } from "./evolum-sidebar";

const TENANTS = [
  { slug: "demo-parrilladas", name: "Eventos Alta Brasa", label: "Parrilladas / eventos" },
  { slug: "demo-ecommerce", name: "Demo Ecommerce", label: "Tienda online" },
  { slug: "demo-inmobiliaria", name: "Demo Inmobiliaria", label: "Negocio inmobiliario" },
];

const scenariosByTenant: Record<string, Array<{ id: string; title: string; message: string }>> = {
  "demo-parrilladas": [
    { id: "bbq-1", title: "Carnes Alta Brasa", message: "Qué carnes tienen?" },
    { id: "bbq-2", title: "Servicio mixto", message: "Qué incluye el servicio mixto?" },
    { id: "bbq-3", title: "Evento grande", message: "Qué recomiendas para 40 personas?" },
    { id: "bbq-4", title: "Extras", message: "Tienen DJ y bar abierto?" },
  ],
  "demo-ecommerce": [
    { id: "eco-1", title: "Recomendación", message: "Busco una parrilla portátil para terraza, qué recomiendas?" },
    { id: "eco-2", title: "Stock y precio", message: "Tienen stock del set de cuchillos y cuánto vale?" },
    { id: "eco-3", title: "Despacho", message: "Hacen despacho a Maipú?" },
    { id: "eco-4", title: "Comparar", message: "Quiero algo barato para un regalo parrillero" },
  ],
  "demo-inmobiliaria": [
    { id: "real-1", title: "Arriendo Ñuñoa", message: "Busco departamento en Ñuñoa por 500 mil" },
    { id: "real-2", title: "Visita", message: "Puedo agendar una visita?" },
    { id: "real-3", title: "Inversión", message: "Qué opción recomiendas para inversión?" },
    { id: "real-4", title: "Presupuesto", message: "Tengo presupuesto de 400 mil, qué tienes?" },
  ],
};

function getScenarios(tenantSlug: string) {
  return scenariosByTenant[tenantSlug] || scenariosByTenant["demo-parrilladas"];
}

type LabMessage = {
  role: "user" | "assistant";
  text: string;
  meta?: string;
};

export function BotLabShell() {
  const agent = getStoredSession();
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const [channel, setChannel] = useState("whatsapp");
  const [tenantSlug, setTenantSlug] = useState("demo-parrilladas");
  const [message, setMessage] = useState(getScenarios("demo-parrilladas")[0].message);
  const [result, setResult] = useState<BotLabResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [simulatingLead, setSimulatingLead] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [history, setHistory] = useState<
    Array<{ input: string; output: string }>
  >([]);
  const [chat, setChat] = useState<LabMessage[]>([
    {
      role: "assistant",
      text: "Hola 👋 soy el laboratorio multi-agente. Elige un negocio y prueba cómo respondería su IA en WhatsApp o Instagram.",
      meta: "Bot Lab",
    },
  ]);

  const scenarios = getScenarios(tenantSlug);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [chat.length, loading]);

  useEffect(() => {
    const nextScenarios = getScenarios(tenantSlug);
    setMessage(nextScenarios[0]?.message || "Hola, necesito ayuda");
    const selected = TENANTS.find((item) => item.slug === tenantSlug);
    setChat([
      {
        role: "assistant",
        text: `Listo 🙌 ahora estás probando el agente de ${selected?.name || "este negocio"}. Elige un escenario o escribe una pregunta libre.`,
        meta: "Bot Lab",
      },
    ]);
    setResult(null);
    setHistory([]);
  }, [tenantSlug]);

  async function runTest(customMessage = message) {
    if (!customMessage.trim()) return;

    try {
      setLoading(true);
      setError(null);
      setChat((prev) => [
        ...prev,
        { role: "user", text: customMessage, meta: "Tester" },
      ]);

      await new Promise((resolve) => setTimeout(resolve, 550));
      const data = await testBot(customMessage, channel, tenantSlug);

      setResult(data);
      setChat((prev) => [
        ...prev,
        {
          role: "assistant",
          text: data.reply,
          meta: data.debug?.usedAI ? "IA comercial" : "Respuesta segura",
        },
      ]);
      setHistory((prev) =>
        [{ input: customMessage, output: data.reply }, ...prev].slice(0, 20),
      );
    } catch (err) {
      const fallback =
        "No pude probar el bot en este momento, pero el frontend está listo. Revisa que el backend esté corriendo.";
      setError(err instanceof Error ? err.message : "No se pudo probar el bot");
      setChat((prev) => [
        ...prev,
        { role: "assistant", text: fallback, meta: "Error" },
      ]);
    } finally {
      setLoading(false);
    }
  }

  async function runLeadSimulation() {
    if (!message.trim()) return;

    try {
      setSimulatingLead(true);
      setError(null);
      setChat((prev) => [
        ...prev,
        { role: "user", text: message, meta: "Lead simulado" },
      ]);
      const data = await simulateLeadUtf8(message, tenantSlug);
      const conversationId = data?.conversationId || data?.conversation?.id;
      setChat((prev) => [
        ...prev,
        {
          role: "assistant",
          text: conversationId
            ? "Listo 🙌 creé una conversación real de prueba. Puedes verla en el inbox."
            : "Simulación enviada. Revisa el inbox para ver la conversación generada.",
          meta: "Simulador",
        },
      ]);
      if (conversationId) {
        setTimeout(() => {
          window.location.href = `/inbox?conversation=${conversationId}`;
        }, 900);
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "No se pudo simular el lead real",
      );
    } finally {
      setSimulatingLead(false);
    }
  }

  return (
    <div className={`module-with-menu-shell bot-lab-shell-modern ${sidebarOpen ? "" : "nav-collapsed"}`}>
      <EvolumSidebar
        active="Bot Lab"
        isDeveloper={agent?.role === "SUPER_ADMIN"}
        isOpen={sidebarOpen}
        onToggle={() => setSidebarOpen((value) => !value)}
      />
      <main className="bot-lab-module-main">
        <header className="module-app-header bot-lab-module-header">
          <div>
            <p>BOT LAB</p>
            <h1>Laboratorio de agentes</h1>
            <span>Prueba respuestas, escenarios y trazas antes de publicar cambios.</span>
          </div>
          <AccountPill fallbackName={agent?.name || "Super Admin"} />
        </header>

        <div className="bot-lab-layout">
      <aside className="sidebar">
        <div className="sidebar-header">
          <h2 className="sidebar-title">Bot Lab</h2>
          <div className="meta-line">
            Prueba el mismo motor IA que usa WhatsApp/Instagram.
          </div>
        </div>

        <div className="sidebar-actions">
          <div className="meta-line">Escenarios rápidos</div>
        </div>

        <div className="sidebar-list">
          {scenarios.map((scenario) => (
            <button
              key={scenario.id}
              className="conversation-card"
              onClick={() => {
                setMessage(scenario.message);
                runTest(scenario.message);
              }}
              disabled={loading}
            >
              <div className="conversation-top">
                <strong>{scenario.title}</strong>
              </div>
              <div className="meta-line">{scenario.message}</div>
            </button>
          ))}
        </div>
      </aside>

      <main className="main">
        <div className="chat-shell">
          <div className="chat-header">
            <div className="chat-header-main">
              <div>
                <h2 className="chat-title">Simulador tipo chat</h2>
                <div className="meta-line">
                  Prueba el tono, la intención y la lógica comercial sin crear
                  conversaciones reales.
                </div>
              </div>
              <div className="header-meta-row">
                <select
                  value={tenantSlug}
                  onChange={(e) => setTenantSlug(e.target.value)}
                  title="Negocio de prueba"
                >
                  {TENANTS.map((tenant) => (
                    <option key={tenant.slug} value={tenant.slug}>
                      {tenant.name} — {tenant.label}
                    </option>
                  ))}
                </select>
                <select
                  value={channel}
                  onChange={(e) => setChannel(e.target.value)}
                >
                  <option value="whatsapp">WhatsApp</option>
                  <option value="instagram">Instagram</option>
                </select>
                <button
                  className="ghost-btn"
                  onClick={runLeadSimulation}
                  disabled={simulatingLead || !message.trim()}
                >
                  {simulatingLead ? "Creando lead..." : "Simular lead real"}
                </button>
                <button
                  className="primary-btn"
                  onClick={() => runTest()}
                  disabled={loading || !message.trim()}
                >
                  {loading ? "Probando..." : "Probar bot"}
                </button>
              </div>
            </div>
          </div>

          <div className="chat-body">
            {chat.map((item, index) => {
              const inbound = item.role === "assistant";
              return (
                <div
                  key={`${item.role}-${index}`}
                  className={`message-row ${inbound ? "inbound" : "outbound"}`}
                >
                  <div className="message-stack">
                    <div className="message-bubble">{item.text}</div>
                    <div className="message-meta">
                      <span>{item.meta || (inbound ? "IA" : "Tester")}</span>
                    </div>
                  </div>
                </div>
              );
            })}

            {loading ? (
              <div className="message-row inbound">
                <div className="message-stack">
                  <div className="typing-indicator">
                    <span></span>
                    <span></span>
                    <span></span>
                  </div>
                  <div className="message-meta">
                    <span>IA pensando...</span>
                  </div>
                </div>
              </div>
            ) : null}

            {error ? <div className="meta-line">{error}</div> : null}
            <div ref={bottomRef} />
          </div>

          <form
            className="composer"
            onSubmit={(event) => {
              event.preventDefault();
              runTest();
            }}
          >
            <textarea
              placeholder="Escribe una pregunta para probar el bot..."
              value={message}
              onChange={(e) => setMessage(e.target.value)}
            />
            <button
              className="primary-btn"
              type="submit"
              disabled={loading || !message.trim()}
            >
              {loading ? "Probando..." : "Enviar prueba"}
            </button>
          </form>
        </div>
      </main>

      <aside
        className="sidebar"
        style={{
          borderRight: 0,
          borderLeft: "1px solid rgba(255,255,255,0.10)",
        }}
      >
        <div className="topbar">
          <div>
            <h2 className="brand-title">Debug</h2>
            <div className="meta-line">Traza de decisión segura</div>
          </div>
        </div>

        <div className="sidebar-list">
          {result ? (
            <div className="conversation-card active">
              <div className="badges" style={{ marginBottom: 12 }}>
                <span
                  className={`badge priority-${result.debug?.priority?.label || "low"}`}
                >
                  Prioridad {result.debug?.priority?.label || "low"}
                </span>
                <span className="badge">
                  Score {result.debug?.priority?.score ?? 0}
                </span>
                <span
                  className={`badge ${result.debug?.usedAI ? "mode-bot" : "mode-human"}`}
                >
                  {result.debug?.usedAI ? "IA" : "Regla"}
                </span>
              </div>
              <div className="meta-line" style={{ marginBottom: 6 }}>
                Intent
              </div>
              <div style={{ marginBottom: 14 }}>
                {result.debug?.intent || "other"}
              </div>
              <div className="meta-line" style={{ marginBottom: 6 }}>
                Entidades
              </div>
              <pre
                style={{
                  whiteSpace: "pre-wrap",
                  color: "#fff",
                  margin: 0,
                  marginBottom: 14,
                }}
              >
                {JSON.stringify(result.debug?.entities || {}, null, 2)}
              </pre>
              <div className="meta-line" style={{ marginBottom: 6 }}>
                Siguiente acción sugerida
              </div>
              <div style={{ marginBottom: 14 }}>
                {result.debug?.suggestedNextAction || "continue_qualification"}
              </div>
              <div className="meta-line" style={{ marginBottom: 6 }}>
                Resumen
              </div>
              <div>
                {result.debug?.reasonSummary ||
                  "Respuesta generada correctamente."}
              </div>
            </div>
          ) : (
            <div className="empty-state">
              Ejecuta una prueba para ver la traza.
            </div>
          )}

          <div className="conversation-card">
            <div className="conversation-top">
              <strong>Historial</strong>
            </div>
            {history.length === 0 ? (
              <div className="meta-line">Sin pruebas todavía.</div>
            ) : (
              history.map((item, index) => (
                <div
                  key={index}
                  style={{
                    paddingBottom: 12,
                    marginBottom: 12,
                    borderBottom: "1px solid rgba(255,255,255,0.08)",
                  }}
                >
                  <div className="meta-line">Input</div>
                  <div style={{ marginBottom: 8 }}>{item.input}</div>
                  <div className="meta-line">Output</div>
                  <div>{item.output}</div>
                </div>
              ))
            )}
          </div>
        </div>
      </aside>
        </div>
      </main>
    </div>
  );
}
