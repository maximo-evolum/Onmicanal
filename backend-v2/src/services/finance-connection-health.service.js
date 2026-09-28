import { MODULES } from "../lib/modules.js";
import { FinanceOperationError, findAllFinanceRecords } from "./finance-integrity.service.js";

export const CONNECTION_HEALTH_MAX_AGE_MS = 24 * 60 * 60 * 1000;
export const CONNECTION_SYNC_TIMEOUT_MS = 30 * 60 * 1000;
export const FINANCE_CONNECTION_SOURCES = [
  { key: "finance_nubox", label: "Nubox", module: MODULES.FINANCE_INVOICES, remote: true, sync: true },
  { key: "finance_sii", label: "SII / DTE", module: MODULES.FINANCE_INVOICES, authorization: true },
  { key: "finance_open_banking", label: "Banca abierta", module: MODULES.FINANCE_BANK_SYNC, authorization: true },
  { key: "finance_bank_statements", label: "Carga de cartolas", module: MODULES.FINANCE_BANK_SYNC, manual: true },
  { key: "gmail", label: "Gmail / Google Workspace", module: MODULES.GMAIL, remote: true, oauth: true },
  { key: "meta_whatsapp", aliases: ["whatsapp"], label: "WhatsApp Business", module: MODULES.INBOX, remote: true, oauth: true },
  { key: "email_imap", label: "Correo IMAP / SMTP", module: MODULES.EMAIL_IMAP },
  { key: "mercadopago", label: "Mercado Pago", module: MODULES.PAYMENTS, remote: true, oauth: true },
  { key: "webpay", label: "WebPay / Transbank", module: MODULES.PAYMENTS },
  { key: "finance_defontana", label: "Defontana", module: MODULES.FINANCE_INVOICES, comingSoon: true },
  { key: "finance_softland", label: "Softland", module: MODULES.FINANCE_INVOICES, comingSoon: true }
];
const labels = { NOT_CONFIGURED: "Sin configurar", DISCONNECTED: "Desactivada", CONFIGURED: "Configurada, sin verificar", PENDING_AUTH: "Autorización pendiente", VERIFIED: "Verificada recientemente", STALE: "Verificación antigua", ERROR: "Requiere atención", EXPIRED: "Autorización por renovar", SYNCING: "Sincronizando", SYNC_STALLED: "Sincronización sin confirmar", MANUAL: "Carga manual", COMING_SOON: "Próxima conexión" };
const metadata = (r) => r?.metadata && typeof r.metadata === "object" && !Array.isArray(r.metadata) ? r.metadata : {};
const timestamp = (v) => { if (!v || !["string", "number"].includes(typeof v) && !(v instanceof Date)) return null; const date = new Date(v); return Number.isFinite(date.getTime()) ? date.toISOString() : null; };
const millis = (v) => timestamp(v) ? Date.parse(v) : 0;

// Verification and synchronization results are server facts, never editable form fields.
export function editableConnectionMetadata(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([key]) => !/^(lastTest|lastSync|lastConnection|lastAutomation|connectionConfigChangedAt|connectionReady|connectedAt|disconnectedAt|oauthExpiresAt|oauthConnectedAt|oauthDiscovery|hasRefreshToken)/i.test(key)));
}

export function buildFinanceConnectionHealth({ tenantId, configs = [], consents = [], allowedModules = [], now = new Date() }) {
  if (!tenantId) throw new FinanceOperationError(401, "Se requiere una empresa autenticada.");
  const nowMs = now.getTime();
  const allowed = new Set(allowedModules);
  const scoped = configs.filter((c) => c.tenantId === tenantId).sort((a, b) => millis(b.updatedAt) - millis(a.updatedAt) || String(a.channel).localeCompare(String(b.channel)));
  const items = FINANCE_CONNECTION_SOURCES.filter((s) => allowed.has(s.module)).map((source) => {
    const config = scoped.find((c) => [source.key, ...(source.aliases || [])].includes(c.channel));
    const m = metadata(config), changed = millis(m.connectionConfigChangedAt);
    const effective = (v) => { const time = millis(v); return time && time >= changed && time <= nowMs ? timestamp(v) : null; };
    const lastCheckedAt = effective(m.lastTestedAt);
    const lastSuccessfulSyncAt = source.sync ? effective(m.lastSyncedAt) : null;
    const syncFinishedAt = source.sync ? effective(m.lastSyncCompletedAt) : null;
    const syncStartedAt = source.sync ? effective(m.lastSyncStartedAt) : null;
    const expiresAt = source.oauth ? timestamp(m.oauthExpiresAt) : null;
    const remotelyChecked = source.remote && lastCheckedAt && m.lastTestStatus === "OK";
    const checkedSuccessAt = remotelyChecked ? lastCheckedAt : null;
    const legacyPending = !changed && m.lastTestStatus === "PENDING";
    const lastSuccessAt = legacyPending ? null : [checkedSuccessAt, lastSuccessfulSyncAt].filter(Boolean).sort().at(-1) || null;
    const recentFailure = source.remote && m.lastTestStatus === "ERROR" && ((!changed && !lastCheckedAt) || lastCheckedAt && millis(lastCheckedAt) >= millis(lastSuccessAt));
    let syncStatus = "NOT_RUN";
    if (source.sync && (!changed || syncFinishedAt) && m.lastSyncStatus === "ERROR") syncStatus = "ERROR";
    if (source.sync && syncFinishedAt && m.lastSyncStatus === "OK") syncStatus = "OK";
    if (source.sync && m.lastSyncStatus === "RUNNING" && (!changed || syncStartedAt)) syncStatus = syncStartedAt && nowMs - millis(syncStartedAt) <= CONNECTION_SYNC_TIMEOUT_MS ? "RUNNING" : "STALLED";
    let status = "NOT_CONFIGURED", note = "Aún no hay una configuración registrada para esta empresa.";
    if (source.comingSoon) { status = "COMING_SOON"; note = "Integración todavía no habilitada para uso operativo."; }
    else if (source.manual) { status = "MANUAL"; note = "Importación de archivos disponible. No es una conexión automática con el banco."; }
    else if (config && !config.isActive) { status = "DISCONNECTED"; note = "La conexión está desactivada; los datos históricos se conservan."; }
    else if (config) {
      status = "CONFIGURED"; note = "Guardar la configuración no acredita comunicación con el proveedor. Revisa o prueba la conexión en el Centro de Conexiones.";
      if (source.authorization) { status = "PENDING_AUTH"; note = source.key === "finance_sii" ? "El registro tributario y la importación manual de XML no acreditan autorización de una API del SII." : "Registrar cuentas o recibir un lote no acredita acceso bancario continuo. Cada consulta depende del consentimiento autorizado."; }
      else if (source.remote) {
        if (lastSuccessAt) { status = nowMs - millis(lastSuccessAt) <= CONNECTION_HEALTH_MAX_AGE_MS ? "VERIFIED" : "STALE"; note = status === "VERIFIED" ? "El proveedor respondió correctamente en la última comprobación registrada. No garantiza disponibilidad en este instante ni cobertura completa de datos." : "La última comprobación exitosa tiene más de 24 horas. Vuelve a verificar antes de depender de la conexión."; }
        if (recentFailure) { status = "ERROR"; note = "La última prueba no fue satisfactoria. Revisa la autorización y vuelve a probar en el Centro de Conexiones."; }
        if (expiresAt && millis(expiresAt) <= nowMs) { status = "EXPIRED"; note = "La autorización registrada venció. Puede requerir renovación; vuelve a probar la conexión."; }
        if (syncStatus === "ERROR") { status = "ERROR"; note = "La última sincronización falló. Una prueba de conexión exitosa no garantiza que los documentos se hayan incorporado."; }
        if (syncStatus === "RUNNING") { status = "SYNCING"; note = "Hay una sincronización registrada en curso. Sus resultados todavía no están confirmados."; }
        if (syncStatus === "STALLED") { status = "SYNC_STALLED"; note = "La sincronización no tiene un resultado confirmado dentro de 30 minutos. Revisa su historial antes de reintentar."; }
      }
    }
    const result = { key: source.key, label: source.label, status, statusLabel: labels[status], note,
      lastCheckedAt, lastSuccessAt, expiresAt, sync: { status: syncStatus, startedAt: syncStartedAt, completedAt: syncFinishedAt, lastSuccessAt: lastSuccessfulSyncAt,
        period: source.sync && (syncStartedAt || syncFinishedAt) && /^\d{4}-(0[1-9]|1[0-2])$/.test(String(m.lastSyncPeriod || "")) ? m.lastSyncPeriod : null },
      targetUrl: source.manual ? "/finance?tab=cartolas" : "/connections" };
    if (source.key === "finance_open_banking") {
      const own = consents.filter((c) => c.tenantId === tenantId && c.recordType === "finance_open_banking_consent");
      const completed = own.filter((c) => c.status === "SYNCED" && timestamp(c.data?.lastSyncAt) && millis(c.data.lastSyncAt) <= nowMs);
      result.banking = { total: own.length, pending: own.filter((c) => ["PENDING", "PROCESSING"].includes(c.status)).length, received: completed.length, failed: own.filter((c) => ["ERROR", "FAILED", "REVOKED", "EXPIRED"].includes(c.status)).length,
        lastReceivedAt: completed.map((c) => timestamp(c.data.lastSyncAt)).sort().at(-1) || null };
    }
    return result;
  });
  return { checkedAt: now.toISOString(), maxVerificationAgeHours: 24, scope: "Estado de conexiones de la empresa actual, independiente del período, cuenta y moneda del Dashboard. Se muestran resultados registrados; actualizar esta vista no ejecuta pruebas externas ni sincroniza datos.", items };
}

export async function readFinanceConnectionHealth(db, options) {
  if (!options.tenantId) throw new FinanceOperationError(401, "Se requiere una empresa autenticada.");
  const sources = FINANCE_CONNECTION_SOURCES.filter((s) => options.allowedModules.includes(s.module));
  const channels = sources.flatMap((s) => [s.key, ...(s.aliases || [])]);
  const [configs, consents] = await Promise.all([
    db.tenantChannelConfig.findMany({ where: { tenantId: options.tenantId, channel: { in: channels } }, select: { tenantId: true, channel: true, isActive: true, metadata: true, updatedAt: true } }),
    sources.some((s) => s.key === "finance_open_banking") ? findAllFinanceRecords(db, { where: { tenantId: options.tenantId, recordType: "finance_open_banking_consent" }, select: { id: true, tenantId: true, recordType: true, status: true, data: true } }) : []
  ]);
  return buildFinanceConnectionHealth({ ...options, configs, consents });
}
