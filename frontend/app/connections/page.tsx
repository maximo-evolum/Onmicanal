"use client";

import { useEffect, useState, type FormEvent } from "react";
import {
  disconnectConnectionProvider,
  getConnectionCenter,
  getConnectionOAuthUrl,
  saveConnectionProvider,
  testConnectionProvider,
  type ConnectionCenterResponse,
  type ConnectionProvider,
  type ConnectionStatus,
} from "@/lib/api";
import { getStoredSession } from "@/lib/auth";
import { AccountPill } from "@/components/account-pill";
import { EvolumSidebar } from "@/components/evolum-sidebar";
import { ModuleGate } from "@/components/module-gate";

const statusLabels: Record<ConnectionStatus, string> = {
  CONNECTED: "Conectado",
  PENDING: "Pendiente",
  ERROR: "Error",
  DISCONNECTED: "Desconectado",
};

const statusHelp: Record<ConnectionStatus, string> = {
  CONNECTED: "Listo para operar desde EVOLUM.",
  PENDING: "Faltan credenciales, campos o variables de entorno.",
  ERROR: "La ultima prueba fallo. Revisa credenciales.",
  DISCONNECTED: "Sin conexion activa para este tenant.",
};

function safeJson(value: unknown) {
  return JSON.stringify(value || {}, null, 2);
}

function parseJson(value: string) {
  const text = value.trim();
  if (!text) return {};
  return JSON.parse(text);
}

function providerByKey(data: ConnectionCenterResponse | null, key: string | null) {
  if (!data || !key) return null;
  return data.groups.flatMap((group) => group.providers).find((provider) => provider.key === key) || null;
}

export default function ConnectionsPage() {
  const agent = getStoredSession();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [data, setData] = useState<ConnectionCenterResponse | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const selected = providerByKey(data, selectedKey);
  const [form, setForm] = useState({
    label: "",
    phoneNumberId: "",
    businessAccountId: "",
    externalAccountId: "",
    accessToken: "",
    verifyToken: "",
    metadata: "{}",
    isActive: true,
  });

  async function load(silent = false) {
    try {
      if (!silent) setLoading(true);
      const response = await getConnectionCenter();
      setData(response);
      setSelectedKey((current) => current || response.groups[0]?.providers[0]?.key || null);
      setNotice(null);
    } catch (error) {
      setNotice({ type: "error", text: error instanceof Error ? error.message : "No se pudo cargar el centro de conexiones" });
    } finally {
      if (!silent) setLoading(false);
    }
  }

  useEffect(() => {
    load();
    const interval = window.setInterval(() => load(true), 20000);
    function onOAuthDone() {
      load(true);
    }
    window.addEventListener("message", onOAuthDone);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("message", onOAuthDone);
    };
  }, []);

  useEffect(() => {
    if (!selected) return;
    setForm({
      label: selected.config?.label || selected.label,
      phoneNumberId: selected.config?.phoneNumberId || "",
      businessAccountId: selected.config?.businessAccountId || "",
      externalAccountId: selected.config?.externalAccountId || "",
      accessToken: "",
      verifyToken: "",
      metadata: safeJson(selected.config?.metadata || {}),
      isActive: selected.config?.isActive ?? true,
    });
  }, [selected?.key]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!selected) return;
    try {
      setSaving(true);
      setNotice(null);
      await saveConnectionProvider(selected.key, {
        label: form.label,
        phoneNumberId: form.phoneNumberId,
        businessAccountId: form.businessAccountId,
        externalAccountId: form.externalAccountId,
        accessToken: form.accessToken || undefined,
        verifyToken: form.verifyToken || undefined,
        metadata: parseJson(form.metadata),
        isActive: form.isActive,
      });
      setNotice({ type: "success", text: "Conexion guardada" });
      await load(true);
    } catch (error) {
      setNotice({ type: "error", text: error instanceof Error ? error.message : "No se pudo guardar la conexion" });
    } finally {
      setSaving(false);
    }
  }

  async function runTest(provider: ConnectionProvider) {
    try {
      setNotice(null);
      await testConnectionProvider(provider.key);
      setNotice({ type: "success", text: "Conexion validada" });
    } catch (error) {
      setNotice({ type: "error", text: error instanceof Error ? error.message : "La prueba de conexion fallo" });
    } finally {
      await load(true);
    }
  }

  async function disconnect(provider: ConnectionProvider) {
    try {
      setNotice(null);
      await disconnectConnectionProvider(provider.key);
      setNotice({ type: "success", text: "Conexion desactivada" });
      await load(true);
    } catch (error) {
      setNotice({ type: "error", text: error instanceof Error ? error.message : "No se pudo desconectar" });
    }
  }

  async function openOAuth(provider: ConnectionProvider) {
    try {
      setNotice(null);
      const response = await getConnectionOAuthUrl(provider.key);
      window.open(response.url, "_blank", "noopener,noreferrer,width=720,height=780");
    } catch (error) {
      setNotice({ type: "error", text: error instanceof Error ? error.message : "No se pudo iniciar OAuth" });
    }
  }

  return (
    <ModuleGate moduleKey="integrations">
      <div className={`module-with-menu-shell ${sidebarOpen ? "" : "nav-collapsed"}`}>
        <EvolumSidebar
          active="Centro de Conexiones"
          isDeveloper={agent?.role === "SUPER_ADMIN"}
          isOpen={sidebarOpen}
          onToggle={() => setSidebarOpen((value) => !value)}
        />
        <main className="main dashboard-page connections-page">
          <header className="module-app-header connections-header">
            <div>
              <span className="eyebrow">Centro de Conexiones</span>
              <h1>Correo, archivos, pagos y continuidad</h1>
              <div className="meta-line">OAuth, credenciales, respaldo, replica y sincronizacion offline por tenant.</div>
            </div>
            <div className="module-app-actions">
              <AccountPill fallbackName={agent?.name || "Usuario"} />
            </div>
          </header>

          {loading ? (
            <div className="module-access-state">Cargando conexiones...</div>
          ) : (
            <>
              <section className="connection-summary-grid">
                <article>
                  <span>Total</span>
                  <strong>{data?.summary.total || 0}</strong>
                </article>
                <article>
                  <span>Conectadas</span>
                  <strong>{data?.summary.connected || 0}</strong>
                </article>
                <article>
                  <span>Pendientes</span>
                  <strong>{data?.summary.pending || 0}</strong>
                </article>
                <article>
                  <span>Errores</span>
                  <strong>{data?.summary.errors || 0}</strong>
                </article>
              </section>

              {notice && <div className={`connection-notice ${notice.type}`}>{notice.text}</div>}

              <section className="connections-layout">
                <div className="connection-groups">
                  {data?.groups.map((group) => (
                    <section className="connection-group" key={group.id}>
                      <div>
                        <span className="eyebrow">{group.label}</span>
                        <p>{group.description}</p>
                      </div>
                      <div className="connection-card-grid">
                        {group.providers.map((provider) => (
                          <button
                            className={`connection-card ${selectedKey === provider.key ? "selected" : ""}`}
                            key={provider.key}
                            type="button"
                            onClick={() => setSelectedKey(provider.key)}
                          >
                            <span className="connection-icon">{provider.icon}</span>
                            <div>
                              <strong>{provider.label}</strong>
                              <small>{provider.description}</small>
                              <span className={`connection-status status-${provider.status.toLowerCase()}`}>
                                <i />
                                {statusLabels[provider.status]}
                              </span>
                            </div>
                          </button>
                        ))}
                      </div>
                    </section>
                  ))}
                </div>

                <aside className="connection-detail-panel">
                  {selected ? (
                    <form onSubmit={submit}>
                      <div className="connection-detail-head">
                        <span className="connection-icon large">{selected.icon}</span>
                        <div>
                          <span className="eyebrow">{selected.group}</span>
                          <h2>{selected.label}</h2>
                          <p>{statusHelp[selected.status]}</p>
                        </div>
                      </div>

                      <div className={`connection-status-banner status-${selected.status.toLowerCase()}`}>
                        <span>{statusLabels[selected.status]}</span>
                        {selected.missing.length ? <small>Falta: {selected.missing.join(", ")}</small> : <small>Configuracion completa</small>}
                      </div>

                      <div className="connection-form-grid">
                        <label>
                          Nombre visible
                          <input value={form.label} onChange={(event) => setForm((current) => ({ ...current, label: event.target.value }))} />
                        </label>
                        <label>
                          ID externo / cuenta
                          <input value={form.externalAccountId} onChange={(event) => setForm((current) => ({ ...current, externalAccountId: event.target.value }))} />
                        </label>
                        <label>
                          Business account ID
                          <input value={form.businessAccountId} onChange={(event) => setForm((current) => ({ ...current, businessAccountId: event.target.value }))} />
                        </label>
                        <label>
                          Phone number ID
                          <input value={form.phoneNumberId} onChange={(event) => setForm((current) => ({ ...current, phoneNumberId: event.target.value }))} />
                        </label>
                        <label>
                          Access token / API key
                          <input
                            type="password"
                            value={form.accessToken}
                            placeholder={selected.config?.hasAccessToken ? "Token guardado. Escribe uno nuevo para reemplazar." : ""}
                            onChange={(event) => setForm((current) => ({ ...current, accessToken: event.target.value }))}
                          />
                        </label>
                        <label>
                          Verify token / secreto
                          <input
                            type="password"
                            value={form.verifyToken}
                            placeholder={selected.config?.hasVerifyToken ? "Secreto guardado. Escribe uno nuevo para reemplazar." : ""}
                            onChange={(event) => setForm((current) => ({ ...current, verifyToken: event.target.value }))}
                          />
                        </label>
                      </div>

                      <label className="connection-metadata-field">
                        Metadatos JSON
                        <textarea value={form.metadata} onChange={(event) => setForm((current) => ({ ...current, metadata: event.target.value }))} />
                      </label>

                      <div className="connection-callbacks">
                        <span>Callbacks</span>
                        <code>{data?.callbacks.oauthGoogle}</code>
                        <code>{data?.callbacks.oauthMicrosoft}</code>
                      </div>

                      <div className="connection-actions">
                        <button className="primary" type="submit" disabled={saving}>{saving ? "Guardando..." : "Guardar conexion"}</button>
                        {selected.oauthProvider && <button type="button" onClick={() => openOAuth(selected)}>Conectar OAuth</button>}
                        <button type="button" onClick={() => runTest(selected)}>Probar</button>
                        <button className="danger" type="button" onClick={() => disconnect(selected)}>Desconectar</button>
                      </div>
                    </form>
                  ) : (
                    <p>Selecciona una conexion.</p>
                  )}
                </aside>
              </section>
            </>
          )}
        </main>
      </div>
    </ModuleGate>
  );
}
