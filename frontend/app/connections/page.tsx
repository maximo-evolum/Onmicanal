"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  disconnectConnectionProvider,
  getConnectionCenter,
  getConnectionOAuthUrl,
  reconcileMetaConnections,
  saveConnectionProvider,
  syncNuboxSales,
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
  COMING_SOON: "Próxima conexión",
};

const statusHelp: Record<ConnectionStatus, string> = {
  CONNECTED: "Listo para operar desde EVOLUM.",
  PENDING: "Faltan credenciales, campos o variables de entorno.",
  ERROR: "La ultima prueba fallo. Revisa credenciales.",
  DISCONNECTED: "Sin conexion activa para este tenant.",
  COMING_SOON: "Esta integración estará disponible próximamente.",
};

type ConnectionActivity = {
  key: string;
  stage: string;
  progress: number;
};

function providerByKey(data: ConnectionCenterResponse | null, key: string | null) {
  if (!data || !key) return null;
  return data.groups.flatMap((group) => group.providers).find((provider) => provider.key === key) || null;
}

function providerProgress(provider: ConnectionProvider) {
  if (provider.status === "COMING_SOON") return 0;
  const requiredTotal =
    (provider.requiredEnv?.length || 0) +
    (provider.requiredFields?.length || 0) +
    (provider.oauthProvider ? 1 : 0);
  const total = Math.max(1, requiredTotal);
  return Math.max(0, Math.min(100, Math.round(((total - provider.missing.length) / total) * 100)));
}

function providerActionLabel(provider: ConnectionProvider) {
  if (provider.status === "COMING_SOON") return "Próxima conexión";
  if (provider.status === "CONNECTED") return provider.oauthProvider ? "Cuenta vinculada" : "Operativo";
  if (provider.oauthProvider) return "Vincular cuenta";
  if (provider.missing.length) return "Completar datos";
  return "Validar conexion";
}

function providerNextStep(provider: ConnectionProvider) {
  if (provider.status === "COMING_SOON") {
    return {
      title: "En preparación",
      description: "EVOLUM habilitará esta conexión cuando su integración, seguridad y validación estén terminadas. Aún no necesitas ingresar datos.",
    };
  }
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
  if (haystack.includes("nubox")) {
    return ["Facturas y DTE", "PDF y XML", "Cuentas por cobrar"];
  }
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

type ConnectionFormState = { label: string; phoneNumberId: string; businessAccountId: string; externalAccountId: string; accessToken: string; verifyToken: string; metadata: Record<string, string>; isActive: boolean };
type ProviderField = { key: string; label: string; placeholder?: string; secret?: boolean; options?: string[] };
type FinanceBankAccount = { bank: string; alias: string; accountType: string; accountLast4: string };

// Catálogo basado en los bancos y sucursales vigentes publicados por la CMF.
const CHILEAN_BANKS = [
  "Banco de Chile", "Banco Internacional", "Scotiabank Chile", "Banco de Crédito e Inversiones (BCI)", "Banco BICE", "HSBC Bank (Chile)",
  "Banco Santander-Chile", "Banco Itaú Chile", "Banco Falabella", "Banco Ripley", "Banco Consorcio", "Banco BTG Pactual Chile",
  "Tanner Banco Digital", "Tenpo Bank Chile", "BancoEstado", "JP Morgan Chase Bank, N.A.", "China Construction Bank, Agencia en Chile", "Bank of China, Agencia en Chile", "Otro banco o institución"
];

function readFinanceBankAccounts(value: unknown): FinanceBankAccount[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    const source = item && typeof item === "object" ? item as Record<string, unknown> : {};
    return {
      bank: typeof source.bank === "string" ? source.bank : "",
      alias: typeof source.alias === "string" ? source.alias : "",
      accountType: typeof source.accountType === "string" ? source.accountType : "Cuenta corriente",
      accountLast4: typeof source.accountLast4 === "string" ? source.accountLast4.replace(/\D/g, "").slice(-4) : ""
    };
  }).filter((account) => Boolean(account.bank));
}

function FinanceBankAccountsEditor({ accounts, setAccounts }: { accounts: FinanceBankAccount[]; setAccounts: (accounts: FinanceBankAccount[]) => void }) {
  const update = (index: number, field: keyof FinanceBankAccount, value: string) => {
    setAccounts(accounts.map((account, position) => position === index ? { ...account, [field]: field === "accountLast4" ? value.replace(/\D/g, "").slice(-4) : value } : account));
  };
  return <section className="connection-bank-accounts" aria-label="Cuentas bancarias para cartolas">
    <div className="connection-bank-heading"><div><strong>Bancos y cuentas para cartolas</strong><p>Agrega todos los bancos del cliente. Por seguridad, solo se guarda el alias y los últimos cuatro dígitos.</p></div><button type="button" onClick={() => setAccounts([...accounts, { bank: "", alias: "", accountType: "Cuenta corriente", accountLast4: "" }])}>+ Agregar banco</button></div>
    {accounts.length ? <div className="connection-bank-list">{accounts.map((account, index) => <article key={`${account.bank}-${index}`}>
      <label>Banco<select value={account.bank} onChange={(event) => update(index, "bank", event.target.value)}><option value="">Selecciona un banco</option>{CHILEAN_BANKS.map((bank) => <option key={bank} value={bank}>{bank}</option>)}</select></label>
      <label>Nombre visible<input placeholder="Ej. Cuenta recaudación" value={account.alias} onChange={(event) => update(index, "alias", event.target.value)} /></label>
      <label>Tipo de cuenta<select value={account.accountType} onChange={(event) => update(index, "accountType", event.target.value)}><option>Cuenta corriente</option><option>Cuenta vista</option><option>Cuenta ahorro</option><option>Otra</option></select></label>
      <label>Últimos 4 dígitos<input inputMode="numeric" maxLength={4} placeholder="1234" value={account.accountLast4} onChange={(event) => update(index, "accountLast4", event.target.value)} /></label>
      <button className="danger" type="button" onClick={() => setAccounts(accounts.filter((_, position) => position !== index))}>Quitar</button>
    </article>)}</div> : <p className="connection-form-help">Aún no hay bancos agregados. Puedes comenzar con BancoEstado u otro banco del cliente.</p>}
  </section>;
}

function fieldsForProvider(provider: ConnectionProvider): ProviderField[] {
  const fields: Record<string, ProviderField[]> = {
    meta_whatsapp: [{ key: "businessAccountId", label: "ID de cuenta de WhatsApp Business" }, { key: "phoneNumberId", label: "Phone number ID" }],
    meta_instagram: [{ key: "businessAccountId", label: "ID de cuenta de Instagram Business" }],
    facebook_business: [{ key: "externalAccountId", label: "ID de página de Facebook" }],
    meta_business: [{ key: "businessAccountId", label: "ID de cuenta de Meta Business" }],
    email_imap: [{ key: "host", label: "Servidor IMAP / SMTP", placeholder: "mail.tuempresa.cl" }, { key: "port", label: "Puerto", placeholder: "993 o 587" }, { key: "username", label: "Correo de la cuenta", placeholder: "cobranza@tuempresa.cl" }, { key: "accessToken", label: "Contraseña de aplicación", secret: true }],
    webpay: [{ key: "commerceCode", label: "Código de comercio" }, { key: "environment", label: "Ambiente", options: ["Integración", "Producción"] }, { key: "accessToken", label: "Clave API", secret: true }],
    bank_links: [{ key: "bankName", label: "Banco" }, { key: "accountType", label: "Tipo de cuenta", options: ["Cuenta corriente", "Cuenta vista", "Cuenta ahorro"] }, { key: "accountNumber", label: "Número de cuenta" }, { key: "accountHolder", label: "Titular de la cuenta" }, { key: "accountRut", label: "RUT del titular" }],
    backup_provider: [{ key: "provider", label: "Proveedor", options: ["Microsoft Azure", "AWS", "Google Cloud", "SONDA Cloud", "Otro"] }, { key: "bucket", label: "Contenedor o bucket" }, { key: "region", label: "Región de almacenamiento" }, { key: "accessToken", label: "Clave de acceso", secret: true }],
    security_replica: [{ key: "provider", label: "Proveedor de réplica" }, { key: "target", label: "Destino de réplica" }, { key: "frequency", label: "Frecuencia", options: ["Cada hora", "Diaria", "Semanal"] }],
    // Nubox autentica la integración con dos cabeceras seguras. El RUT y el
    // nombre de empresa no son credenciales y se obtienen desde la cuenta
    // autorizada, por lo que no se solicitan en este formulario.
    finance_nubox: [{ key: "accessToken", label: "x-api-key de Nubox", secret: true }, { key: "verifyToken", label: "Authorization de Nubox", secret: true, placeholder: "Bearer NP_SECRET_..." }],
    finance_defontana: [{ key: "companyCode", label: "Código de empresa" }, { key: "accessToken", label: "Clave API de Defontana", secret: true }],
    finance_softland: [{ key: "companyCode", label: "Código de empresa / sociedad" }, { key: "accessToken", label: "Clave API de Softland", secret: true }],
    finance_sii: [{ key: "taxpayerRut", label: "RUT del contribuyente" }, { key: "accessToken", label: "Credencial o token autorizado", secret: true }]
  };
  return fields[provider.key] || [];
}

function ProviderFieldGrid({ provider, form, setForm }: { provider: ConnectionProvider; form: ConnectionFormState; setForm: (updater: (current: ConnectionFormState) => ConnectionFormState) => void }) {
  const fields = fieldsForProvider(provider);
  if (!fields.length) return <p className="connection-form-help">Esta conexión se completa por OAuth, carga local o mediante la configuración del proveedor. No requiere IDs de Meta.</p>;
  return <div className="connection-form-grid">{fields.map((field) => {
    const direct = field.key === "businessAccountId" || field.key === "phoneNumberId" || field.key === "externalAccountId" || field.key === "accessToken" || field.key === "verifyToken";
    const directValues: Record<string, string> = { businessAccountId: form.businessAccountId, phoneNumberId: form.phoneNumberId, externalAccountId: form.externalAccountId, accessToken: form.accessToken, verifyToken: form.verifyToken };
    const value = direct ? (directValues[field.key] || "") : (form.metadata[field.key] || "");
    const update = (next: string) => setForm((current) => direct ? ({ ...current, [field.key]: next } as ConnectionFormState) : { ...current, metadata: { ...current.metadata, [field.key]: next } });
    return <label key={field.key}>{field.label}{field.options ? <select value={value} onChange={(event) => update(event.target.value)}><option value="">Selecciona una opción</option>{field.options.map((option) => <option key={option}>{option}</option>)}</select> : <input type={field.secret ? "password" : "text"} autoComplete={field.secret ? "new-password" : "off"} placeholder={field.placeholder} value={value} onChange={(event) => update(event.target.value)} />}{field.secret ? <small>Se guarda cifrada y no vuelve a mostrarse.</small> : null}</label>;
  })}</div>;
}

export default function ConnectionsPage() {
  const agent = getStoredSession();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [data, setData] = useState<ConnectionCenterResponse | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [connectionActivity, setConnectionActivity] = useState<ConnectionActivity | null>(null);
  const oauthTimeoutRef = useRef<number | null>(null);
  const [notice, setNotice] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const selected = providerByKey(data, selectedKey);
  const [form, setForm] = useState({
    label: "",
    phoneNumberId: "",
    businessAccountId: "",
    externalAccountId: "",
    accessToken: "",
    verifyToken: "",
    metadata: {} as Record<string, string>,
    isActive: true,
  });
  const [bankAccounts, setBankAccounts] = useState<FinanceBankAccount[]>([]);

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
      if (oauthTimeoutRef.current) window.clearTimeout(oauthTimeoutRef.current);
      oauthTimeoutRef.current = null;
      setConnectionActivity(null);
      load(true);
    }
    window.addEventListener("message", onOAuthDone);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("message", onOAuthDone);
      if (oauthTimeoutRef.current) window.clearTimeout(oauthTimeoutRef.current);
    };
  }, []);

  useEffect(() => {
    if (!selected) return;
    setBankAccounts(readFinanceBankAccounts(selected.config?.metadata?.bankAccounts));
    setForm({
      label: selected.config?.label || selected.label,
      phoneNumberId: selected.config?.phoneNumberId || "",
      businessAccountId: selected.config?.businessAccountId || "",
      externalAccountId: selected.config?.externalAccountId || "",
      accessToken: "",
      verifyToken: "",
      metadata: Object.fromEntries(
        Object.entries(selected.config?.metadata || {})
          .filter(([key, value]) => key !== "oauthDiscovery" && typeof value === "string")
          .map(([key, value]) => [key, String(value)])
      ),
      isActive: selected.config?.isActive ?? true,
    });
  }, [selected?.key]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!selected || connectionActivity) return;
    try {
      setSaving(true);
      setConnectionActivity({ key: selected.key, stage: "Guardando configuración segura...", progress: 28 });
      setNotice(null);
      setConnectionActivity({ key: selected.key, stage: "Validando información...", progress: 68 });
      const metadata = Object.fromEntries(Object.entries(form.metadata).filter(([, value]) => String(value).trim()));
      await saveConnectionProvider(selected.key, {
        label: form.label,
        phoneNumberId: form.phoneNumberId,
        businessAccountId: form.businessAccountId,
        externalAccountId: form.externalAccountId,
        ...(form.accessToken ? { accessToken: form.accessToken } : {}),
        ...(form.verifyToken ? { verifyToken: form.verifyToken } : {}),
        metadata: selected.key === "finance_bank_statements" ? { ...metadata, bankAccounts } : metadata,
        isActive: form.isActive,
      });
      setConnectionActivity({ key: selected.key, stage: "Configuración guardada", progress: 100 });
      setNotice({ type: "success", text: "Conexion guardada" });
      await load(true);
    } catch (error) {
      setNotice({ type: "error", text: error instanceof Error ? error.message : "No se pudo guardar la conexion" });
    } finally {
      setSaving(false);
      setConnectionActivity(null);
    }
  }

  async function runTest(provider: ConnectionProvider) {
    if (connectionActivity) return;
    try {
      setConnectionActivity({ key: provider.key, stage: "Probando conexión...", progress: 24 });
      setNotice(null);
      setConnectionActivity({ key: provider.key, stage: "Validando acceso y disponibilidad...", progress: 68 });
      await testConnectionProvider(provider.key);
      setConnectionActivity({ key: provider.key, stage: "Conexión validada", progress: 100 });
      setNotice({ type: "success", text: "Conexion validada" });
    } catch (error) {
      setNotice({ type: "error", text: error instanceof Error ? error.message : "La prueba de conexion fallo" });
    } finally {
      await load(true);
      setConnectionActivity(null);
    }
  }

  async function syncNubox(provider: ConnectionProvider) {
    if (connectionActivity) return;
    try {
      setConnectionActivity({ key: provider.key, stage: "Consultando documentos de Nubox...", progress: 32 });
      setNotice(null);
      setConnectionActivity({ key: provider.key, stage: "Actualizando cuentas por cobrar...", progress: 74 });
      const result = await syncNuboxSales();
      setConnectionActivity({ key: provider.key, stage: "Documentos sincronizados", progress: 100 });
      setNotice({ type: "success", text: `Nubox sincronizado: ${result.created} nuevos y ${result.updated} actualizados.` });
    } catch (error) {
      setNotice({ type: "error", text: error instanceof Error ? error.message : "No se pudieron sincronizar los documentos de Nubox" });
    } finally {
      await load(true);
      setConnectionActivity(null);
    }
  }

  async function disconnect(provider: ConnectionProvider) {
    if (connectionActivity) return;
    try {
      setConnectionActivity({ key: provider.key, stage: "Desvinculando cuenta...", progress: 35 });
      setNotice(null);
      await disconnectConnectionProvider(provider.key);
      setConnectionActivity({ key: provider.key, stage: "Cuenta desvinculada", progress: 100 });
      setNotice({ type: "success", text: "Conexion desactivada" });
      await load(true);
    } catch (error) {
      setNotice({ type: "error", text: error instanceof Error ? error.message : "No se pudo desconectar" });
    } finally {
      setConnectionActivity(null);
    }
  }

  async function reactivate(provider: ConnectionProvider) {
    if (connectionActivity) return;
    try {
      setConnectionActivity({ key: provider.key, stage: "Reactivando conexión...", progress: 36 });
      setNotice(null);
      // Conserva token, IDs y metadatos ya registrados; solo vuelve a dejar
      // disponible la integración que el cliente había configurado antes.
      await saveConnectionProvider(provider.key, { isActive: true });
      setConnectionActivity({ key: provider.key, stage: "Conexión reactivada", progress: 100 });
      setNotice({ type: "success", text: "Conexion existente reactivada" });
      await load(true);
    } catch (error) {
      setNotice({ type: "error", text: error instanceof Error ? error.message : "No se pudo reactivar la conexion" });
    } finally {
      setConnectionActivity(null);
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
    if (connectionActivity) return;
    try {
      setConnectionActivity({ key: provider.key, stage: "Preparando vinculación segura...", progress: 26 });
      setNotice(null);
      const response = await getConnectionOAuthUrl(provider.key);
      // Mantener una ventana con nombre permite que el callback notifique al
      // Centro de Conexiones y refresque el estado inmediatamente.
      const popup = window.open(response.url, "evolum-oauth", "popup=yes,width=720,height=780");
      if (!popup) {
        window.location.assign(response.url);
      } else {
        popup.focus();
        setConnectionActivity({ key: provider.key, stage: "Esperando autorización en la ventana del proveedor...", progress: 72 });
        oauthTimeoutRef.current = window.setTimeout(() => {
          setConnectionActivity(null);
          oauthTimeoutRef.current = null;
        }, 180000);
      }
    } catch (error) {
      setNotice({ type: "error", text: error instanceof Error ? error.message : "No se pudo iniciar OAuth" });
      setConnectionActivity(null);
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
              <button className="ghost-btn" type="button" onClick={reconcileMeta} disabled={saving || Boolean(connectionActivity)}>
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
                        {group.providers.map((provider) => {
                          const activity = connectionActivity?.key === provider.key ? connectionActivity : null;
                          return (
                          <button
                            className={`connection-card ${selectedKey === provider.key ? "selected" : ""} ${activity ? "working" : ""} ${provider.status === "COMING_SOON" ? "coming-soon" : ""}`}
                            key={provider.key}
                            type="button"
                            onClick={() => setSelectedKey(provider.key)}
                            disabled={Boolean(connectionActivity)}
                            aria-busy={Boolean(activity)}
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
                              <span className="connection-progress"><i style={{ width: `${activity?.progress ?? providerProgress(provider)}%` }} /></span>
                              {activity ? <span className="connection-card-activity"><i />{activity.stage}</span> : null}
                            </div>
                          </button>
                          );
                        })}
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
                        {selected.missing.length ? <small>Faltan datos de configuración</small> : <small>Configuracion completa</small>}
                      </div>

                      {connectionActivity?.key === selected.key ? (
                        <div className="connection-activity-panel" role="status" aria-live="polite">
                          <div><strong>{connectionActivity.stage}</strong><span>{connectionActivity.progress}%</span></div>
                          <span className="connection-progress"><i style={{ width: `${connectionActivity.progress}%` }} /></span>
                          <small>No cierres esta pantalla ni presiones otra vez el botón mientras EVOLUM termina esta acción.</small>
                        </div>
                      ) : null}

                      {selected.status === "COMING_SOON" ? (
                        <section className="connection-coming-soon" aria-live="polite">
                          <strong>Esta conexión está en preparación</strong>
                          <p>Cuando esté lista, aparecerá aquí su método de vinculación seguro. Por ahora no debes ingresar claves, RUT, cuentas ni otros datos.</p>
                        </section>
                      ) : selected.oauthProvider ? (
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

                      {selected.key === "gmail" && selected.oauthProvider === "google" ? (
                        <section className="connection-google-oauth-help" aria-label="Ayuda para vincular Gmail">
                          <span>Autorización de Google</span>
                          <strong>¿Aparece “Error 403: access_denied”?</strong>
                          <p>No se corrige ingresando claves aquí. La autorización se bloquea desde la configuración oficial de la aplicación EVOLUM en Google.</p>
                          <ol>
                            <li>Durante las pruebas, el correo de Google debe estar registrado como usuario de prueba.</li>
                            <li>En producción, EVOLUM debe publicar y verificar su aplicación y su dominio propio.</li>
                          </ol>
                          <a href="https://developers.google.com/identity/protocols/oauth2/production-readiness/brand-verification?hl=es-419" target="_blank" rel="noreferrer">Abrir guía oficial de Google</a>
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

                      {selected.status === "COMING_SOON" ? null : selected.oauthProvider ? (
                        <>
                          <div className="connection-oauth-action">
                            {selected.config && !selected.config.isActive ? (
                              <>
                                <strong>Ya existe una cuenta registrada</strong>
                                <p>Sus credenciales e identificadores se conservaron. Reactívala para volver a usarla sin repetir la vinculación.</p>
                                <button className="primary" type="button" onClick={() => reactivate(selected)} disabled={Boolean(connectionActivity)}>Reactivar conexión registrada</button>
                              </>
                            ) : (
                              <>
                                <strong>{selected.status === "CONNECTED" ? "¿Necesitas cambiar la cuenta externa?" : "Vincula la cuenta que el cliente quiere usar"}</strong>
                                <p>{selected.oauthReady === false
                                  ? "Este proveedor está siendo habilitado por EVOLUM. Cuando esté disponible, solo tendrás que iniciar sesión y autorizar la cuenta externa."
                                  : `Se abrirá la pantalla oficial de ${selected.label}. El cliente puede iniciar sesión con una cuenta diferente a su usuario EVOLUM.`}</p>
                                <button className="primary" type="button" onClick={() => openOAuth(selected)} disabled={selected.oauthReady === false || Boolean(connectionActivity)}>
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
                            </div>
                            <ProviderFieldGrid provider={selected} form={form} setForm={setForm} />
                            <button type="submit" disabled={saving || Boolean(connectionActivity)}>{saving ? "Guardando..." : "Guardar datos complementarios"}</button>
                          </details>

                          <div className="connection-actions">
                            <button type="button" onClick={() => runTest(selected)} disabled={Boolean(connectionActivity)}>Probar conexión</button>
                            {selected.status === "CONNECTED" ? <button className="danger" type="button" onClick={() => disconnect(selected)} disabled={Boolean(connectionActivity)}>Desvincular cuenta</button> : null}
                          </div>
                        </>
                      ) : (
                        <>
                          {selected.key === "finance_bank_statements" ? (
                            <FinanceBankAccountsEditor accounts={bankAccounts} setAccounts={setBankAccounts} />
                          ) : <>
                            {selected.key !== "finance_nubox" ? <div className="connection-form-grid">
                              <label>
                                Nombre visible
                                <input value={form.label} onChange={(event) => setForm((current) => ({ ...current, label: event.target.value }))} />
                              </label>
                            </div> : null}
                            {selected.key === "finance_nubox" ? <p className="connection-form-help">Ingresa solo las dos cabeceras entregadas por Nubox. El <strong>Authorization</strong> puede pegarse con o sin el prefijo <strong>Bearer</strong>; EVOLUM lo protege y nunca lo vuelve a mostrar.</p> : null}
                            <ProviderFieldGrid provider={selected} form={form} setForm={setForm} />
                          </>}

                          <div className="connection-actions">
                            <button className="primary" type="submit" disabled={saving || Boolean(connectionActivity)}>{saving ? "Guardando..." : "Guardar conexión"}</button>
                            <button type="button" onClick={() => runTest(selected)} disabled={Boolean(connectionActivity)}>Probar</button>
                            {selected.key === "finance_nubox" ? <button type="button" onClick={() => syncNubox(selected)} disabled={Boolean(connectionActivity)}>Sincronizar documentos</button> : null}
                            <button className="danger" type="button" onClick={() => disconnect(selected)} disabled={Boolean(connectionActivity)}>Desconectar</button>
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
