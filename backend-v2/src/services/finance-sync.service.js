import { prisma } from "../lib/db.js";
import { env } from "../lib/env.js";
import { decryptSecret } from "../lib/credential-crypto.js";
import { normalizeMetadata } from "../lib/metadata.js";
import { createTenantNotification } from "../lib/notifications.js";
import { withDistributedLock } from "../lib/redis.js";
import { runFinancePostIngestionAnalysis } from "./finance-automation.service.js";

const NUBOX_CHANNEL = "finance_nubox";

function text(value, fallback = "") {
  const normalized = String(value ?? "").trim();
  return normalized || fallback;
}

function metadata(value) {
  return normalizeMetadata(value, {});
}

function currentPeriod() {
  return new Date().toISOString().slice(0, 7);
}

function validPeriod(period) {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(period);
}

function nuboxBaseUrl() {
  const configured = String(env.nuboxApiBaseUrl || "").trim();
  if (!configured) throw new Error("Falta configurar NUBOX_API_BASE_URL en el servidor.");
  const parsed = new URL(configured);
  const host = parsed.hostname.toLowerCase();
  if (parsed.protocol !== "https:" || !(host === "nubox.com" || host.endsWith(".nubox.com"))) {
    throw new Error("NUBOX_API_BASE_URL debe ser una URL HTTPS oficial de Nubox.");
  }
  return configured.replace(/\/$/, "");
}

function authorization(value) {
  const token = text(value);
  return /^bearer\s+/i.test(token) ? token : `Bearer ${token}`;
}

function nuboxError(status, payload) {
  const message = text(payload?.message);
  if (status === 401 || status === 403) return "Nubox rechazó las credenciales. Revisa x-api-key y Authorization.";
  if (status === 404) return "Nubox no encontró el recurso solicitado. Revisa la URL y el ambiente configurado.";
  if (status >= 500) return "Nubox no está disponible temporalmente.";
  return message ? `Nubox no pudo sincronizar: ${message.slice(0, 180)}` : `Nubox no pudo sincronizar (HTTP ${status}).`;
}

async function nuboxRequest(config, path) {
  const apiKey = decryptSecret(config?.accessToken);
  const auth = authorization(decryptSecret(config?.verifyToken));
  if (!apiKey || !auth) throw new Error("Faltan las credenciales de Nubox.");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(`${nuboxBaseUrl()}${path}`, {
      method: "GET",
      headers: { Authorization: auth, "X-Api-Key": apiKey, Accept: "application/json" },
      signal: controller.signal
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(nuboxError(response.status, payload));
    return { payload, total: Number(response.headers.get("x-total-count") || 0) || 0 };
  } catch (error) {
    if (error?.name === "AbortError") throw new Error("La sincronización con Nubox excedió el tiempo de espera.");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function salesFromPayload(payload) {
  if (Array.isArray(payload)) return payload;
  for (const key of ["content", "items", "data", "results"]) {
    if (Array.isArray(payload?.[key])) return payload[key];
  }
  return [];
}

function invoiceFromSale(sale, period) {
  const source = sale && typeof sale === "object" ? sale : {};
  const client = source.client && typeof source.client === "object" ? source.client : {};
  const type = source.type && typeof source.type === "object" ? source.type : {};
  const emission = source.emissionStatus && typeof source.emissionStatus === "object" ? source.emissionStatus : {};
  const balance = Math.max(0, Number.isFinite(Number(source.balance)) ? Number(source.balance) : Number(source.totalAmount) || 0);
  const emitted = String(emission.name || "").toLowerCase();
  const status = source.dataCl?.annulled || emitted.includes("anulado") ? "ANNULLED" : emitted.includes("rechaz") ? "REJECTED" : balance === 0 ? "PAID" : "OPEN";
  const customerName = text(client.tradeName, "Cliente sin nombre");
  const invoiceNumber = text(source.number, String(source.id || "Sin folio"));
  return {
    externalDocumentId: text(source.id),
    title: `${text(type.name, "Documento tributario")} ${invoiceNumber} · ${customerName}`.slice(0, 220),
    status,
    data: {
      source: "nubox", nuboxDocumentId: text(source.id), invoiceNumber,
      documentTypeCode: text(type.legalCode), documentTypeName: text(type.name, "Documento tributario"),
      customerName, customerRut: text(client.identification?.value), rut: text(client.identification?.value), clientRut: text(client.identification?.value),
      customerActivity: text(client.mainActivity), amount: Number(source.totalAmount) || 0, balance,
      netAmount: Number(source.totalNetAmount) || 0, vatAmount: Number(source.totalTaxVatAmount) || 0,
      exemptAmount: Number(source.totalExemptAmount) || 0, issueDate: text(source.emissionDate), dueDate: text(source.dueDate),
      emissionStatus: text(emission.name), emissionStatusDescription: text(emission.description), period, syncedAt: new Date().toISOString()
    }
  };
}

async function importNuboxSales({ tenantId, config, period, limit }) {
  const result = await nuboxRequest(config, `/v1/sales?period=${encodeURIComponent(period)}&page=1&size=${limit}`);
  const sales = salesFromPayload(result.payload).slice(0, limit);
  const existing = await prisma.industryRecord.findMany({ where: { tenantId, recordType: "finance_invoice" }, select: { id: true, data: true } });
  const existingByExternalId = new Map(existing.map((record) => [text(record.data?.nuboxDocumentId), record]).filter(([id]) => Boolean(id)));
  let created = 0;
  let updated = 0;
  let ignored = 0;

  for (const sale of sales) {
    const invoice = invoiceFromSale(sale, period);
    if (!invoice.externalDocumentId) { ignored += 1; continue; }
    const current = existingByExternalId.get(invoice.externalDocumentId);
    if (current) {
      await prisma.industryRecord.update({ where: { id: current.id }, data: { title: invoice.title, status: invoice.status, data: { ...current.data, ...invoice.data } } });
      updated += 1;
    } else {
      await prisma.industryRecord.create({ data: { tenantId, recordType: "finance_invoice", title: invoice.title, status: invoice.status, data: invoice.data } });
      created += 1;
    }
  }
  return { received: sales.length, total: result.total || sales.length, created, updated, ignored };
}

function retryable(error) {
  const message = String(error?.message || "").toLocaleLowerCase("es");
  return !/credencial|x-api-key|authorization|url base|url https|faltan/.test(message);
}

function pause(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function audit(tenantId, action, entityId, details) {
  return prisma.tenantAuditLog.create({ data: { tenantId, action, entity: "tenant_channel_config", entityId, metadata: details } }).catch(() => null);
}

async function updateStatus(config, patch) {
  const nextMetadata = metadata({ ...metadata(config.metadata), ...patch });
  const updated = await prisma.tenantChannelConfig.update({ where: { id: config.id }, data: { metadata: nextMetadata } });
  return updated;
}

export async function syncNuboxForTenant({ tenantId, period = currentPeriod(), limit = 100, source = "manual", maxAttempts = 3 } = {}) {
  if (!tenantId) throw new Error("tenantId es requerido para sincronizar Nubox.");
  if (!validPeriod(period)) throw new Error("El período debe tener formato AAAA-MM.");
  const config = await prisma.tenantChannelConfig.findFirst({ where: { tenantId, channel: NUBOX_CHANNEL, isActive: true }, orderBy: { updatedAt: "desc" } });
  if (!config) throw new Error("Nubox no está configurado o se encuentra inactivo.");
  if (!decryptSecret(config.accessToken) || !decryptSecret(config.verifyToken)) throw new Error("Faltan las credenciales de Nubox.");

  return withDistributedLock(`finance-nubox:${tenantId}`, { ttlMs: 180_000 }, async ({ coordinated }) => {
    await updateStatus(config, { lastSyncStatus: "RUNNING", lastSyncStartedAt: new Date().toISOString(), lastSyncSource: source, lastSyncAttempts: 0 });
    let lastError = null;
    const attempts = Math.max(1, Math.min(3, Number(maxAttempts) || 3));
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        const summary = await importNuboxSales({ tenantId, config, period, limit: Math.max(1, Math.min(100, Number(limit) || 100)) });
        const analysis = await runFinancePostIngestionAnalysis({ tenantId, source: `nubox:${source}` });
        const completedAt = new Date().toISOString();
        await updateStatus(config, {
          lastSyncedAt: completedAt, lastSyncCompletedAt: completedAt, lastSyncStatus: "OK", lastSyncAttempts: attempt,
          lastSyncMessage: `${summary.created} creados, ${summary.updated} actualizados`, lastSyncError: null, lastSyncPeriod: period,
          lastAutomationSummary: analysis
        });
        await audit(tenantId, "NUBOX_SALES_SYNCED", config.id, { source, period, attempt, coordinated, ...summary, analysis });
        if (summary.created || summary.updated) {
          await createTenantNotification({
            tenantId,
            title: "Nubox sincronizó documentos financieros",
            body: `${summary.created} nuevos y ${summary.updated} actualizados. El análisis quedó preparado para revisión humana.`,
            severity: "info", targetUrl: "/finance?tab=facturas",
            metadata: { notificationType: "finance", screen: "finance", provider: "nubox", source }
          }).catch(() => null);
        }
        return { ok: true, period, attempts: attempt, coordinated, ...summary, analysis };
      } catch (error) {
        lastError = error instanceof Error ? error : new Error("No se pudo sincronizar Nubox.");
        if (attempt < attempts && retryable(lastError)) await pause(attempt * 1_000);
        else break;
      }
    }

    const failedAt = new Date().toISOString();
    await updateStatus(config, { lastSyncStatus: "ERROR", lastSyncAttempts: attempts, lastSyncError: lastError?.message || "Error desconocido", lastSyncCompletedAt: failedAt, lastSyncPeriod: period });
    await audit(tenantId, "NUBOX_SALES_SYNC_FAILED", config.id, { source, period, attempts, error: lastError?.message || "Error desconocido" });
    await createTenantNotification({
      tenantId, title: "No se pudo sincronizar Nubox", body: "La información existente no fue modificada. Revisa la conexión e inténtalo nuevamente.",
      severity: "warning", targetUrl: "/connections", metadata: { notificationType: "finance", screen: "connections", provider: "nubox", source }
    }).catch(() => null);
    throw lastError;
  });
}

export async function syncAllActiveNuboxTenants({ period = currentPeriod(), limit = 100 } = {}) {
  const configs = await prisma.tenantChannelConfig.findMany({ where: { channel: NUBOX_CHANNEL, isActive: true }, select: { tenantId: true } });
  const tenantIds = [...new Set(configs.map((config) => config.tenantId))];
  const results = [];
  for (const tenantId of tenantIds) {
    try {
      results.push({ tenantId, ...(await syncNuboxForTenant({ tenantId, period, limit, source: "scheduled" })) });
    } catch (error) {
      results.push({ tenantId, ok: false, error: error instanceof Error ? error.message : "Error desconocido" });
    }
  }
  return {
    period,
    tenants: tenantIds.length,
    succeeded: results.filter((result) => result.ok).length,
    failed: results.filter((result) => !result.ok).length,
    results
  };
}

export async function financeSyncHistory({ tenantId, limit = 30 } = {}) {
  const entries = await prisma.tenantAuditLog.findMany({
    where: { tenantId, action: { in: ["NUBOX_SALES_SYNCED", "NUBOX_SALES_SYNC_FAILED", "FINANCE_POST_INGESTION_ANALYZED"] } },
    orderBy: { createdAt: "desc" }, take: Math.min(100, Math.max(1, Number(limit) || 30))
  });
  return { generatedAt: new Date().toISOString(), entries };
}
