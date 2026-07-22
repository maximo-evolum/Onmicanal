"use client";

import { useEffect, useState, type FormEvent } from "react";
import {
  disconnectConnectionProvider,
  getConnectionCenter,
  getConnectionOAuthUrl,
  reconcileMetaConnections,
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

function providerByKey(data: ConnectionCenterResponse | null, key: string | null) {
  if (!data || !key) return null;
  return data.groups.flatMap((group) => group.providers).find((provider) => provider.key === key) || null;
}

function providerProgress(provider: ConnectionProvider) {
  const requiredTotal =
    (provider.requiredEnv?.length || 0) +
    (provider.requiredFields?.length || 0) +
    (provider.oauthProvider ? 1 : 0);
  const total = Math.max(1, requiredTotal);
  return Math.max(0, Math.min(100, Math.round(((total - provider.missing.length) / total) * 100)));
}

function providerActionLabel(provider: ConnectionProvider) {
  if (provider.status === "CONNECTED") return provider.oauthProvider ? "Cuenta vinculada" : "Operativo";
  if (provider.oauthProvider) return "Vincular cuenta";
  if (provider.missing.length) return "Completar datos";
  return "Validar conexion";
}

function providerNextStep(provider: ConnectionProvider) {
  if (provider.status === "CONNECTED") {
    return {
      title: "Monitoreo activo",
      description: "La conexion ya puede usarse desde los modulos del CRM.",
    };
  }
  if (provider.oauthProvider) {
    return {
      title: provider.oauthReady === false ? "Proveedor en activacion" : "Vincula una cuenta externa",
      description: provider.oauthReady === false
        ? "EVOLUM esta terminando de habilitar este proveedor. No necesitas ingresar claves ni credenciales manuales."
        : "La cuenta de este proveedor puede ser distinta a la usada para entrar a EVOLUM. No se guardan contraseñas.",
    };
  }
  if (provider.missing.length) {
    return {
      title: "Configuración pendiente",
      description: "EVOLUM necesita completar una configuración segura de este proveedor. No compartas claves ni secretos por este medio.",
    };
  }
  return {
    title: "Probar conexion",
    description: "Ejecuta una prueba y deja trazabilidad operativa antes de usarla.",
  };
}

function providerCapabilities(provider: ConnectionProvider) {
  const haystack = `${provider.key} ${provider.label} ${provider.groupKey} ${provider.module}`.toLowerCase();
  if (haystack.includes("gmail") || haystack.includes("outlook") || haystack.includes("mail")) {
    return ["OAuth correo", "Envio y recepcion", "Trazabilidad"];
  }
  if (haystack.includes("drive") || haystack.includes("sharepoint") || haystack.includes("storage")) {
    return ["Archivos", "Permisos", "Plantillas"];
  }
  if (haystack.includes("webpay") || haystack.includes("mercado") || haystack.includes("bank") || haystack.includes("payment") || haystack.includes("pago")) {
    return ["Links de pago", "Estados", "Reconciliacion"];
  }
  if (haystack.includes("backup") || haystack.includes("replica") || haystack.includes("offline")) {
    return ["Continuidad", "Reintentos", "Recuperacion"];
  }
  return ["Credenciales por tenant", "Prueba de conexion", "Auditoria operativa"];
}

function getOAuthDiscovery(provider: ConnectionProvider) {
  const metadata = provider.config?.metadata;
  if (!metadata || typeof metadata !== "object") return null;
  const discovery = metadata.oauthDiscovery;
  return discovery && typeof discovery === "object" ? discovery as Record<string, unknown> : null;
}

function discoverySummary(provider: ConnectionProvider) {
  const discovery = getOAuthDiscovery(provider);
  if (!discovery) return null;
  const account = discovery.account;
  if (!account || typeof account !== "object") return null;
  const source = account as Record<string, unknown>;
  const candidates = [source.email, source.name, source.username, source.verifiedName, source.displayPhoneNumber, source.nickname]
    .map((value) => typeof value === "string" ? value.trim() : "")
    .filter(Boolean);
  return candidates[0] || null;
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

  async function reactivate(provider: ConnectionProvider) {
    try {
      setNotice(null);
      // Conserva token, IDs y metadatos ya registrados; solo vuelve a dejar
      // disponible la integración que el cliente había configurado antes.
      await saveConnectionProvider(provider.key, { isActive: true });
      setNotice({ type: "success", text: "Conexion existente reactivada" });
      await load(true);
    } catch (error) {
      setNotice({ type: "error", text: error instanceof Error ? error.message : "No se pudo reactivar la conexion" });
    }
  }

  async function reconcileMeta() {
    try {
      setSaving(true);
      setNotice(null);
      const result = await reconcileMetaConnections();
      const detected = Object.entries(result.assetsDetected).filter(([, active]) => active).map(([key]) => key).join(", ");
      setNotice({ type: "success", text: `Meta reconciliado desde ${result.sourceChannel}. Activos detectados: ${detected || "sin activos"}.` });
      await load(true);
    } catch (error) {
      setNotice({ type: "error", text: error instanceof Error ? error.message : "No se pudieron reconciliar los activos Meta" });
    } finally {
      setSaving(false);
    }
  }

  async function openOAuth(provider: ConnectionProvider) {
    try {
      setNotice(null);
      const response = await getConnectionOAuthUrl(provider.key);
      // Mantener una ventana con nombre permite que el callback notifique al
      // Centro de Conexiones y refresque el estado inmediatamente.
      const popup = window.open(response.url, "evolum-oauth", "popup=yes,width=720,height=780");
      if (!popup) {
        window.location.assign(response.url);
      } else {
        popup.focus();
      }
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
              <button className="ghost-btn" type="button" onClick={reconcileMeta} disabled={saving}>
                {saving ? "Reconciliando Meta..." : "Detectar activos Meta"}
              </button>
              <AccountPill fallbackName={agent?.name || "Usuario"} />
            </div>
          </header>

          {loading ? (
            <div className="module-access-state">Cargando conexiones...</div>
          ) : (
            <>
              <section className="connection-command-strip">
                <article>
                  <b>1</b>
                  <strong>Selecciona proveedor</strong>
                  <span>Correo, archivos, pagos, respaldo o modo offline.</span>
                </article>
                <article>
                  <b>2</b>
                  <strong>Vincula una cuenta externa</strong>
                  <span>La cuenta de Gmail, Meta, Microsoft o pagos puede ser distinta a tu acceso EVOLUM.</span>
                </article>
                <article>
                  <b>3</b>
                  <strong>Prueba conexion</strong>
                  <span>Valida permisos, tokens y disponibilidad antes de operar.</span>
                </article>
                <article>
                  <b>4</b>
                  <strong>Usa en modulos</strong>
                  <span>Inbox, campanas, pagos, documentos y continuidad consumen estas conexiones.</span>
                </article>
              </section>

              <section className="connection-summary-grid">
                <article className="connection-summary-card">
                  <div className="connection-summary-icon">CN</div>
                  <span>Total proveedores</span>
                  <strong>{data?.summary.total || 0}</strong>
                  <small>Catalogo operativo</small>
                </article>
                <article className="connection-summary-card">
                  <div className="connection-summary-icon">OK</div>
                  <span>Conectadas</span>
                  <strong>{data?.summary.connected || 0}</strong>
                  <small>Listas para usar</small>
                </article>
                <article className="connection-summary-card">
                  <div className="connection-summary-icon">PD</div>
                  <span>Pendientes</span>
                  <strong>{data?.summary.pending || 0}</strong>
                  <small>Requieren configuracion</small>
                </article>
                <article className="connection-summary-card">
                  <div className="connection-summary-icon">ER</div>
                  <span>Errores</span>
                  <strong>{data?.summary.errors || 0}</strong>
                  <small>Necesitan revision</small>
                </article>
              </section>

              {data?.reconciliation ? (
                <>
                  <section className="connection-command-strip" aria-label="Diagnóstico de conexiones existentes">
                    <article>
                      <b>DX</b>
                      <strong>Diagnóstico de conexiones</strong>
                      <span>Revisión automática y de solo lectura de los registros ya existentes.</span>
                    </article>
                    <article>
                      <b>OK</b>
                      <strong>{data.reconciliation.active} operativas</strong>
                      <span>{data.reconciliation.scanned} configuraciones revisadas en esta cuenta.</span>
                    </article>
                    <article>
                      <b>IN</b>
                      <strong>{data.reconciliation.inactive} inactivas</strong>
                      <span>Conservan sus datos y pueden reactivarse desde su proveedor.</span>
                    </article>
                    <article>
                      <b>RV</b>
                      <strong>{data.reconciliation.incomplete + data.reconciliation.unrecognized} por revisar</strong>
                      <span>{data.reconciliation.incomplete} incompletas · {data.reconciliation.unrecognized} sin proveedor reconocido.</span>
                    </article>
                  </section>
                  {data.reconciliation.unrecognized ? (
                    <div className="connection-notice error">
                      Configuraciones históricas sin proveedor asignado: {data.reconciliation.items
                        .filter((item) => item.status === "UNRECOGNIZED")
                        .map((item) => item.label)
                        .join(", ")}.
                    </div>
                  ) : null}
                </>
              ) : null}

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
                            <div className="connection-card-copy">
                              <div className="connection-card-topline">
                                <strong>{provider.label}</strong>
                                <em>{providerActionLabel(provider)}</em>
                              </div>
                              <small>{provider.description}</small>
                              <span className={`connection-status status-${provider.status.toLowerCase()}`}>
                                <i />
                                {statusLabels[provider.status]}
                              </span>
                              <span className="connection-progress"><i style={{ width: `${providerProgress(provider)}%` }} /></span>
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

                      {selected.oauthProvider ? (
                        <section className="connection-account-context" aria-label="Cuentas involucradas en la vinculación">
                          <article>
                            <span>Cuenta que administra EVOLUM</span>
                            <strong>{agent?.email || agent?.name || "Sesión EVOLUM"}</strong>
                            <small>Solo gestiona esta conexión dentro del CRM.</small>
                          </article>
                          <b aria-hidden="true">→</b>
                          <article className={discoverySummary(selected) ? "connected" : ""}>
                            <span>Cuenta externa vinculada</span>
                            <strong>{discoverySummary(selected) || `Pendiente: ${selected.label}`}</strong>
                            <small>{discoverySummary(selected) ? "Autorizada por el cliente para esta empresa." : "El cliente la seleccionará en la pantalla oficial del proveedor."}</small>
                          </article>
                        </section>
                      ) : null}

                      {selected.oauthProvider && discoverySummary(selected) ? (
                        <div className="connection-oauth-discovery">
                          <span>Cuenta detectada por OAuth</span>
                          <strong>{discoverySummary(selected)}</strong>
                          <small>Los identificadores disponibles fueron completados automáticamente por el proveedor.</small>
                        </div>
                      ) : null}

                      {(() => {
                        const nextStep = providerNextStep(selected);
                        return (
                          <div className="connection-next-step">
                            <span>Siguiente accion</span>
                            <strong>{nextStep.title}</strong>
                            <p>{nextStep.description}</p>
                          </div>
                        );
                      })()}

                      <div className="connection-capability-list">
                        {providerCapabilities(selected).map((item) => <span key={item}>{item}</span>)}
                      </div>

                      {selected.oauthProvider ? (
                        <>
                          <div className="connection-oauth-action">
                            {selected.config && !selected.config.isActive ? (
                              <>
                                <strong>Ya existe una cuenta registrada</strong>
                                <p>Sus credenciales e identificadores se conservaron. Reactívala para volver a usarla sin repetir la vinculación.</p>
                                <button className="primary" type="button" onClick={() => reactivate(selected)}>Reactivar conexión registrada</button>
                              </>
                            ) : (
                              <>
                                <strong>{selected.status === "CONNECTED" ? "¿Necesitas cambiar la cuenta externa?" : "Vincula la cuenta que el cliente quiere usar"}</strong>
                                <p>{selected.oauthReady === false
                                  ? "Este proveedor está siendo habilitado por EVOLUM. Cuando esté disponible, solo tendrás que iniciar sesión y autorizar la cuenta externa."
                                  : `Se abrirá la pantalla oficial de ${selected.label}. El cliente puede iniciar sesión con una cuenta diferente a su usuario EVOLUM.`}</p>
                                <button className="primary" type="button" onClick={() => openOAuth(selected)} disabled={selected.oauthReady === false}>
                                  {selected.oauthReady === false
                                    ? "Proveedor en activación"
                                    : selected.status === "CONNECTED"
                                      ? `Cambiar cuenta de ${selected.label}`
                                      : `Vincular con ${selected.label}`}
                                </button>
                              </>
                            )}
                          </div>

                          <details className="connection-advanced-fields">
                            <summary>Datos complementarios (solo si el proveedor no los detectó)</summary>
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
                            </div>
                            <button type="submit" disabled={saving}>{saving ? "Guardando..." : "Guardar datos complementarios"}</button>
                          </details>

                          <div className="connection-actions">
                            <button type="button" onClick={() => runTest(selected)}>Probar conexión</button>
                            {selected.status === "CONNECTED" ? <button className="danger" type="button" onClick={() => disconnect(selected)}>Desvincular cuenta</button> : null}
                          </div>
                        </>
                      ) : (
                        <>
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
                          </div>

                          <div className="connection-actions">
                            <button className="primary" type="submit" disabled={saving}>{saving ? "Guardando..." : "Guardar conexión"}</button>
                            <button type="button" onClick={() => runTest(selected)}>Probar</button>
                            <button className="danger" type="button" onClick={() => disconnect(selected)}>Desconectar</button>
                          </div>
                        </>
                      )}

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
