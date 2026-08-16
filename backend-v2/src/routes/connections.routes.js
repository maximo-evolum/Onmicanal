import { Router } from "express";
import crypto from "crypto";
import { prisma } from "../lib/db.js";
import { env } from "../lib/env.js";
import { normalizeMetadata } from "../lib/metadata.js";
import { MODULES } from "../lib/modules.js";
import { recordAuditLog } from "../lib/audit.js";
import { requireRole, ROLE_GROUPS } from "../middleware/tenant-access.js";
import { decryptSecret, encryptSecret, hasSecret } from "../lib/credential-crypto.js";
import { syncNuboxForTenant } from "../services/finance-sync.service.js";
import { createTenantNotification } from "../lib/notifications.js";
import { CHILEAN_FINANCIAL_INSTITUTIONS, normalizeChileanBankAccounts } from "../lib/finance-integrations.js";

export const connectionsPublicRouter = Router();
export const connectionsRouter = Router();

// Solo responsables del tenant pueden gestionar credenciales, respaldos y
// proveedores. SUPER_ADMIN mantiene el bypass definido por requireRole.
connectionsRouter.use(requireRole(ROLE_GROUPS.MANAGERS));

const PROVIDERS = [
  {
    key: "meta_whatsapp",
    // El inbox y los webhooks existentes usan `whatsapp`. El Centro de
    // Conexiones conserva su clave visual `meta_whatsapp`, pero persiste y
    // reconoce ambas variantes para no perder conexiones ya operativas.
    storageChannel: "whatsapp",
    legacyChannels: ["whatsapp"],
    label: "WhatsApp Business",
    group: "Canales Meta",
    groupKey: "meta_channels",
    icon: "WA",
    type: "oauth",
    oauthProvider: "meta",
    module: MODULES.INBOX,
    description: "Conexion guiada para mensajeria, phone number ID, bandeja omnicanal y campañas por WhatsApp.",
    oauthRequiredEnv: ["META_APP_ID", "META_APP_SECRET", "PUBLIC_BASE_URL"],
    requiredFields: ["accessToken", "phoneNumberId", "businessAccountId"],
    scopes: ["business_management", "whatsapp_business_management", "whatsapp_business_messaging"]
  },
  {
    key: "meta_instagram",
    // Instagram y Facebook se configuraban antes como canales separados.
    // La tarjeta unificada de Meta debe poder leerlos sin obligar al cliente
    // a volver a autorizar una cuenta que ya está en operación.
    storageChannel: "instagram",
    legacyChannels: ["instagram"],
    label: "Instagram Business / Meta",
    group: "Canales Meta",
    groupKey: "meta_channels",
    icon: "IG",
    type: "oauth",
    oauthProvider: "meta",
    module: MODULES.MARKETING,
    description: "Cuentas Meta para mensajes, publicaciones, stories/reels cuando la API y permisos del negocio lo permitan.",
    oauthRequiredEnv: ["META_APP_ID", "META_APP_SECRET", "PUBLIC_BASE_URL"],
    requiredFields: ["accessToken", "businessAccountId"],
    scopes: ["business_management", "pages_show_list", "pages_read_engagement", "pages_manage_posts", "instagram_basic", "instagram_content_publish"]
  },
  {
    key: "meta_business",
    // Meta Business Suite es una vista de los activos Meta ya enlazados. Si
    // no cuenta aún con una autorización propia, puede reconocer de forma
    // segura una cuenta activa de WhatsApp, Instagram o Facebook del tenant.
    sharedSourceChannels: ["whatsapp", "instagram", "facebook", "meta_whatsapp", "meta_instagram", "facebook_business"],
    label: "Meta Business Suite",
    group: "Canales Meta",
    groupKey: "meta_channels",
    icon: "MB",
    type: "oauth",
    oauthProvider: "meta",
    module: MODULES.MARKETING,
    description: "Administrador central de activos Meta: negocio, páginas, Instagram Business y permisos de equipos.",
    oauthRequiredEnv: ["META_APP_ID", "META_APP_SECRET", "PUBLIC_BASE_URL"],
    requiredFields: ["accessToken"],
    scopes: ["business_management", "pages_show_list", "pages_read_engagement"]
  },
  {
    key: "facebook_business",
    // El canal histórico facebook sigue siendo el que consumen los flujos
    // existentes; la nueva tarjeta lo expone como Facebook Business.
    storageChannel: "facebook",
    legacyChannels: ["facebook"],
    label: "Facebook Business",
    group: "Canales Meta",
    groupKey: "meta_channels",
    icon: "FB",
    type: "oauth",
    oauthProvider: "meta",
    module: MODULES.MARKETING,
    description: "Páginas de Facebook, publicaciones, interacción y administración comercial de la marca.",
    oauthRequiredEnv: ["META_APP_ID", "META_APP_SECRET", "PUBLIC_BASE_URL"],
    requiredFields: ["accessToken", "externalAccountId"],
    scopes: ["pages_show_list", "pages_read_engagement", "pages_manage_posts"]
  },
  {
    key: "gmail",
    label: "Gmail / Google Workspace",
    group: "Correos y archivos",
    groupKey: "mail_files",
    icon: "GM",
    type: "oauth",
    oauthProvider: "google",
    module: MODULES.GMAIL,
    description: "Correo conectado para respuestas, adjuntos, trazabilidad y automatizaciones.",
    requiredEnv: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "PUBLIC_BASE_URL"],
    scopes: ["https://www.googleapis.com/auth/gmail.send", "https://www.googleapis.com/auth/gmail.readonly"]
  },
  {
    key: "google_drive",
    label: "Google Drive",
    group: "Correos y archivos",
    groupKey: "mail_files",
    icon: "GD",
    type: "oauth",
    oauthProvider: "google",
    module: MODULES.GOOGLE_DRIVE,
    description: "Almacenamiento de documentos, fotos, propuestas y archivos del cliente.",
    requiredEnv: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "PUBLIC_BASE_URL"],
    scopes: ["https://www.googleapis.com/auth/drive.file"]
  },
  {
    key: "sharepoint",
    label: "SharePoint / OneDrive",
    group: "Correos y archivos",
    groupKey: "mail_files",
    icon: "SP",
    type: "oauth",
    oauthProvider: "microsoft",
    module: MODULES.SHAREPOINT,
    description: "Repositorio Microsoft para documentos operativos, respaldos y carpetas compartidas.",
    requiredEnv: ["MICROSOFT_CLIENT_ID", "MICROSOFT_CLIENT_SECRET", "PUBLIC_BASE_URL"],
    scopes: ["offline_access", "Files.ReadWrite.All", "Sites.ReadWrite.All"]
  },
  {
    key: "email_imap",
    label: "Correo IMAP / SMTP",
    group: "Correos y archivos",
    groupKey: "mail_files",
    icon: "IM",
    type: "credentials",
    module: MODULES.EMAIL_IMAP,
    description: "Conexion de correo tradicional para clientes que no usan OAuth.",
    requiredFields: ["host", "port", "username", "accessToken"],
    publicFields: ["host", "port", "username"]
  },
  {
    key: "webpay",
    label: "WebPay / Transbank",
    group: "Pagos y cobros",
    groupKey: "payments",
    icon: "WP",
    type: "credentials",
    module: MODULES.PAYMENTS,
    description: "Proveedor de pago con credenciales productivas o ambiente de integracion.",
    requiredFields: ["commerceCode", "accessToken"],
    publicFields: ["commerceCode", "environment"]
  },
  {
    key: "mercadopago",
    label: "Mercado Pago",
    group: "Pagos y cobros",
    groupKey: "payments",
    icon: "MP",
    type: "oauth",
    oauthProvider: "mercadopago",
    module: MODULES.PAYMENTS,
    description: "Links, estados y cobros conectados a conversaciones, reservas y oportunidades.",
    oauthRequiredEnv: ["MERCADOPAGO_CLIENT_ID", "MERCADOPAGO_CLIENT_SECRET", "PUBLIC_BASE_URL"],
    requiredFields: ["accessToken"],
    scopes: ["offline_access", "read", "write"]
  },
  {
    key: "bank_links",
    label: "Enlaces bancarios",
    group: "Pagos y cobros",
    groupKey: "payments",
    icon: "BK",
    type: "manual",
    module: MODULES.PAYMENTS,
    description: "Datos bancarios, plantillas de transferencia y links manuales por banco.",
    requiredFields: ["bankName", "accountNumber"],
    publicFields: ["bankName", "accountType", "accountNumber", "accountHolder", "accountRut"]
  },
  {
    key: "finance_bank_statements",
    label: "Cartolas bancarias",
    group: "Finanzas",
    groupKey: "finance",
    icon: "CB",
    type: "local",
    module: MODULES.FINANCE_BANK_SYNC,
    description: "Importa cartolas CSV y movimientos bancarios para el ciclo de conciliación financiera.",
    requiredFields: [],
    publicFields: ["bankAccounts"]
  },
  {
    key: "finance_nubox",
    label: "Nubox",
    group: "Finanzas",
    groupKey: "finance",
    icon: "NB",
    type: "credentials",
    module: MODULES.FINANCE_INVOICES,
    description: "Sincroniza documentos tributarios y cuentas por cobrar cuando la API del cliente esté autorizada.",
    // Nubox se autentica con las cabeceras x-api-key y Authorization. Ambos
    // valores son secretos por tenant: no se pide ni persiste RUT/empresa.
    requiredFields: ["accessToken", "verifyToken"],
    publicFields: []
  },
  {
    key: "finance_defontana",
    label: "Defontana",
    group: "Finanzas",
    groupKey: "finance",
    icon: "DF",
    type: "credentials",
    module: MODULES.FINANCE_INVOICES,
    description: "Próxima conexión para facturación y documentos contables desde Defontana.",
    availability: "COMING_SOON",
    requiredFields: []
  },
  {
    key: "finance_softland",
    label: "Softland",
    group: "Finanzas",
    groupKey: "finance",
    icon: "SL",
    type: "credentials",
    module: MODULES.FINANCE_INVOICES,
    description: "Próxima conexión para sincronizar documentos y cuentas por cobrar desde Softland.",
    availability: "COMING_SOON",
    requiredFields: []
  },
  {
    key: "finance_sii",
    label: "SII / DTE",
    group: "Finanzas",
    groupKey: "finance",
    icon: "SI",
    type: "credentials",
    module: MODULES.FINANCE_INVOICES,
    description: "Prepara la empresa emisora y su certificado para consultar y gestionar DTE autorizados. Las acciones tributarias sensibles requieren revisión humana.",
    requiredFields: ["companyRut", "environment", "certificateReference"],
    publicFields: ["companyRut", "environment", "certificateReference"]
  },
  {
    key: "finance_open_banking",
    label: "Banca abierta",
    group: "Finanzas",
    groupKey: "finance",
    icon: "BA",
    type: "credentials",
    module: MODULES.FINANCE_BANK_SYNC,
    description: "Conecta cuentas bancarias con consentimiento explícito de su titular. Mientras no exista autorización, conserva la carga segura por cartola.",
    requiredFields: ["companyRut", "bankAccounts"],
    publicFields: ["companyRut", "bankAccounts"]
  },
  {
    key: "backup_provider",
    label: "Proveedor de respaldo",
    group: "Continuidad operativa",
    groupKey: "continuity",
    icon: "BK",
    type: "credentials",
    module: MODULES.BACKUP_PROVIDER,
    description: "Próxima conexión para respaldos administrados por EVOLUM o por el proveedor del cliente.",
    availability: "COMING_SOON",
    requiredFields: []
  },
  {
    key: "security_replica",
    label: "Replica de seguridad",
    group: "Continuidad operativa",
    groupKey: "continuity",
    icon: "RP",
    type: "credentials",
    module: MODULES.SECURITY_REPLICA,
    description: "Próxima conexión para réplica, recuperación y continuidad operativa.",
    availability: "COMING_SOON",
    requiredFields: []
  },
  {
    key: "offline_sync",
    label: "Sync offline",
    group: "Continuidad operativa",
    groupKey: "continuity",
    icon: "OF",
    type: "local",
    module: MODULES.OFFLINE_SYNC,
    description: "Próxima conexión para sincronizar de forma segura el trabajo realizado sin internet.",
    availability: "COMING_SOON",
    requiredFields: []
  }
];

const PROVIDER_BY_KEY = new Map(PROVIDERS.map((provider) => [provider.key, provider]));

function providerConfigChannels(provider) {
  return [...new Set([provider.key, provider.storageChannel, ...(provider.legacyChannels || [])].filter(Boolean))];
}

function providerDisplayChannels(provider) {
  return [...new Set([...providerConfigChannels(provider), ...(provider.sharedSourceChannels || [])])];
}

function providerStorageChannel(provider) {
  return provider.storageChannel || provider.key;
}

function resolveProviderConfig(provider, configs) {
  const byChannel = new Map((configs || []).map((config) => [config.channel, config]));
  const candidates = providerDisplayChannels(provider).map((channel) => byChannel.get(channel)).filter(Boolean);
  // Una conexión activa tiene prioridad sobre una configuración antigua que
  // pudo quedar deshabilitada durante una migración o una reconexión.
  return candidates.find((config) => config.isActive) || candidates[0] || null;
}

async function findTenantProviderConfig(tenantId, provider) {
  const configs = await prisma.tenantChannelConfig.findMany({
    where: { tenantId, channel: { in: providerConfigChannels(provider) } }
  });
  return resolveProviderConfig(provider, configs);
}

function cleanText(value, fallback = "") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function publicBaseUrl(req) {
  const host = req.get("host");
  const protocol = req.get("x-forwarded-proto") || req.protocol || "https";
  // Google exige que la URL registrada coincida exactamente con el callback.
  // Normalizamos una barra final para no generar `//api/...` en producción.
  const value = env.publicBaseUrl || (host ? `${protocol}://${host}` : "");
  return String(value || "").replace(/\/+$/, "");
}

function readEnv(key) {
  if (key === "PUBLIC_BASE_URL") return env.publicBaseUrl || process.env.PUBLIC_BASE_URL || process.env.BACKEND_PUBLIC_URL;
  if (key === "META_APP_ID") return process.env.META_APP_ID || process.env.FACEBOOK_APP_ID;
  if (key === "META_APP_SECRET") return process.env.META_APP_SECRET || process.env.FACEBOOK_APP_SECRET || env.metaAppSecret;
  return process.env[key];
}

function missingEnv(provider) {
  return (provider.requiredEnv || []).filter((key) => !readEnv(key));
}

function missingOAuthEnv(provider) {
  return (provider.oauthRequiredEnv || provider.requiredEnv || []).filter((key) => !readEnv(key));
}

function configMetadata(config) {
  return normalizeMetadata(config?.metadata, {});
}

function normalizeBankAccounts(value) {
  return normalizeChileanBankAccounts(value);
}

function hasField(config, field) {
  const metadata = configMetadata(config);
  if (field === "accessToken") return hasSecret(config?.accessToken);
  if (field === "verifyToken") return hasSecret(config?.verifyToken);
  if (field === "externalAccountId") return Boolean(config?.externalAccountId);
  if (field === "phoneNumberId") return Boolean(config?.phoneNumberId);
  if (field === "businessAccountId") return Boolean(config?.businessAccountId);
  return Boolean(metadata[field]);
}

function missingFields(provider, config) {
  if (!config?.isActive) return provider.requiredFields || [];
  return (provider.requiredFields || []).filter((field) => !hasField(config, field));
}

function providerStatus(provider, config) {
  if (provider.availability === "COMING_SOON") return "COMING_SOON";
  if (!config || !config.isActive) return "DISCONNECTED";
  const fieldMissing = missingFields(provider, config);
  const lastTestStatus = String(configMetadata(config).lastTestStatus || "").toUpperCase();
  const lastTestMessage = String(configMetadata(config).lastTestMessage || "");
  // Errores de validación previos no deben dejar bloqueada una conexión que
  // ahora ya contiene todos sus identificadores operativos.
  if (lastTestStatus === "ERROR" && !/^Faltan campos:/i.test(lastTestMessage)) return "ERROR";
  if (lastTestStatus === "PENDING") return "PENDING";
  // Las variables OAuth se requieren para crear o renovar una autorización,
  // no para reconocer una conexión ya configurada con token válido.
  if (fieldMissing.length) return "PENDING";
  return "CONNECTED";
}

function nuboxBaseUrl() {
  const configured = String(env.nuboxApiBaseUrl || "").trim();
  if (!configured) {
    throw new Error("Falta configurar la URL base de Nubox en el servidor. Agrega NUBOX_API_BASE_URL con la URL entregada por Nubox para este ambiente.");
  }

  let parsed;
  try {
    parsed = new URL(configured);
  } catch {
    throw new Error("NUBOX_API_BASE_URL no tiene un formato de URL valido.");
  }

  // Nubox entrega un host distinto para certificación y producción. No se
  // restringe a un dominio fijo porque el host oficial puede variar por
  // ambiente; esta variable sólo existe en la configuración segura del
  // servidor, nunca en un formulario de tenant.
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
    throw new Error("NUBOX_API_BASE_URL debe ser una URL HTTPS válida, sin credenciales incluidas, entregada por Nubox.");
  }
  return configured.replace(/\/$/, "");
}

function nuboxAuthorization(value) {
  const token = String(value || "").trim();
  if (!token) return null;
  return /^bearer\s+/i.test(token) ? token : `Bearer ${token}`;
}

function nuboxErrorMessage(status, payload) {
  const message = typeof payload?.message === "string" ? payload.message.trim() : "";
  if (status === 401 || status === 403) return "Nubox rechazo las credenciales. Revisa x-api-key y Authorization.";
  if (status === 404) return "Nubox no encontro el recurso solicitado. Revisa NUBOX_API_BASE_URL y el ambiente configurado.";
  if (status >= 500) return "Nubox no esta disponible temporalmente. Intenta nuevamente mas tarde.";
  return message ? `Nubox no pudo validar la conexion: ${message.slice(0, 180)}` : `Nubox no pudo validar la conexion (HTTP ${status}).`;
}

function nuboxNetworkErrorMessage(error, action = "validar la conexión") {
  const code = String(error?.cause?.code || error?.code || "").toUpperCase();
  if (["ENOTFOUND", "EAI_AGAIN"].includes(code)) {
    return "EVOLUM no pudo encontrar el servidor de Nubox. Revisa la URL base configurada y vuelve a intentar.";
  }
  if (["ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_SOCKET"].includes(code)) {
    return "No fue posible establecer una conexión segura con Nubox desde el servidor. El servicio puede estar temporalmente no disponible; inténtalo nuevamente.";
  }
  return `No fue posible ${action} con Nubox desde el servidor. Revisa el diagnóstico de Railway o intenta nuevamente en unos minutos.`;
}

async function nuboxRequest(config, path) {
  const apiKey = decryptSecret(config?.accessToken);
  const authorization = nuboxAuthorization(decryptSecret(config?.verifyToken));
  if (!apiKey || !authorization) throw new Error("Faltan las credenciales de Nubox.");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  const baseUrl = nuboxBaseUrl();
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      method: "GET",
      headers: {
        Authorization: authorization,
        "X-Api-Key": apiKey,
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      signal: controller.signal
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(nuboxErrorMessage(response.status, payload));
    return { payload, total: Number(response.headers.get("x-total-count") || 0) || 0 };
  } catch (error) {
    if (error?.name === "AbortError") throw new Error("La validacion con Nubox excedio el tiempo de espera. Intenta nuevamente.");
    if (error instanceof TypeError && /fetch failed/i.test(String(error.message || ""))) {
      // Nunca se registran encabezados ni secretos: sólo el host y el código de
      // red permiten diagnosticar problemas de salida desde Railway.
      console.warn("[NUBOX_REQUEST_FAILED]", {
        host: new URL(baseUrl).host,
        endpoint: String(path || "").split("?")[0],
        code: error?.cause?.code || error?.code || "unknown"
      });
      throw new Error(nuboxNetworkErrorMessage(error));
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function nuboxSalesFromPayload(payload) {
  if (Array.isArray(payload)) return payload;
  for (const key of ["content", "items", "data", "results"]) {
    if (Array.isArray(payload?.[key])) return payload[key];
  }
  return [];
}

async function testNuboxConnection(config) {
  const period = new Date().toISOString().slice(0, 7);
  const result = await nuboxRequest(config, `/v1/sales?period=${encodeURIComponent(period)}&page=1&size=1`);
  const documents = nuboxSalesFromPayload(result.payload);
  return {
    config,
    discovery: {
      label: cleanText(config?.label, "Nubox"),
      documentCount: result.total || documents.length,
      checkedPeriod: period
    }
  };
}

function nuboxInvoiceFromSale(sale, period) {
  const source = sale && typeof sale === "object" ? sale : {};
  const client = source.client && typeof source.client === "object" ? source.client : {};
  const type = source.type && typeof source.type === "object" ? source.type : {};
  const emission = source.emissionStatus && typeof source.emissionStatus === "object" ? source.emissionStatus : {};
  const rawBalance = Number(source.balance);
  const balance = Number.isFinite(rawBalance) ? Math.max(0, rawBalance) : Math.max(0, Number(source.totalAmount) || 0);
  const emitted = String(emission.name || "").toLowerCase();
  const status = source.dataCl?.annulled || emitted.includes("anulado")
    ? "ANNULLED"
    : emitted.includes("rechaz")
      ? "REJECTED"
      : balance === 0
        ? "PAID"
        : "OPEN";
  const customerName = cleanText(client.tradeName, "Cliente sin nombre");
  const invoiceNumber = cleanText(source.number, String(source.id || "Sin folio"));
  return {
    externalDocumentId: cleanText(source.id),
    title: `${cleanText(type.name, "Documento tributario")} ${invoiceNumber} · ${customerName}`.slice(0, 220),
    status,
    data: {
      source: "nubox",
      nuboxDocumentId: cleanText(source.id),
      invoiceNumber,
      documentTypeCode: cleanText(type.legalCode),
      documentTypeName: cleanText(type.name, "Documento tributario"),
      customerName,
      customerRut: cleanText(client.identification?.value),
      rut: cleanText(client.identification?.value),
      clientRut: cleanText(client.identification?.value),
      customerActivity: cleanText(client.mainActivity),
      amount: Number(source.totalAmount) || 0,
      balance,
      netAmount: Number(source.totalNetAmount) || 0,
      vatAmount: Number(source.totalTaxVatAmount) || 0,
      exemptAmount: Number(source.totalExemptAmount) || 0,
      issueDate: cleanText(source.emissionDate),
      dueDate: cleanText(source.dueDate),
      emissionStatus: cleanText(emission.name),
      emissionStatusDescription: cleanText(emission.description),
      period,
      syncedAt: new Date().toISOString()
    }
  };
}

async function syncNuboxSales({ tenantId, config, period, limit = 100 }) {
  const result = await nuboxRequest(config, `/v1/sales?period=${encodeURIComponent(period)}&page=1&size=${limit}`);
  const sales = nuboxSalesFromPayload(result.payload).slice(0, limit);
  const existing = await prisma.industryRecord.findMany({
    where: { tenantId, recordType: "finance_invoice" },
    select: { id: true, data: true }
  });
  const existingByNuboxId = new Map(existing
    .map((record) => [cleanText(record.data?.nuboxDocumentId), record])
    .filter(([nuboxDocumentId]) => Boolean(nuboxDocumentId)));
  let created = 0;
  let updated = 0;
  let ignored = 0;

  for (const sale of sales) {
    const invoice = nuboxInvoiceFromSale(sale, period);
    if (!invoice.externalDocumentId) {
      ignored += 1;
      continue;
    }
    const current = existingByNuboxId.get(invoice.externalDocumentId);
    if (current) {
      await prisma.industryRecord.update({
        where: { id: current.id },
        data: { title: invoice.title, status: invoice.status, data: { ...current.data, ...invoice.data } }
      });
      updated += 1;
    } else {
      await prisma.industryRecord.create({
        data: { tenantId, recordType: "finance_invoice", title: invoice.title, status: invoice.status, data: invoice.data }
      });
      created += 1;
    }
  }
  return { received: sales.length, total: result.total || sales.length, created, updated, ignored };
}

function publicConfig(config, provider = null) {
  if (!config) return null;
  const metadata = configMetadata(config);
  const discovery = metadata.oauthDiscovery && typeof metadata.oauthDiscovery === "object"
    ? metadata.oauthDiscovery
    : null;
  const account = discovery?.account && typeof discovery.account === "object"
    ? discovery.account
    : null;
  // El centro de conexiones solo necesita una referencia humana de la cuenta
  // OAuth. Nunca devolvemos JSON operativo, tokens, errores internos ni datos
  // de trazabilidad que puedan revelar detalles técnicos al usuario.
  const publicAccount = account
    ? Object.fromEntries(
      ["email", "name", "username", "verifiedName", "displayPhoneNumber", "nickname"]
        .filter((key) => typeof account[key] === "string" && account[key].trim())
        .map((key) => [key, account[key]])
    )
    : {};
  // Los campos no secretos se devuelven solo cuando el proveedor los declaró
  // necesarios. Tokens y metadatos técnicos nunca salen de este endpoint.
  const safeFields = [...new Set([...(provider?.requiredFields || []), ...(provider?.publicFields || [])])]
    .filter((field) => !["accessToken", "verifyToken"].includes(field));
  const safeMetadata = Object.fromEntries(
    safeFields
      .filter((field) => !["phoneNumberId", "businessAccountId", "externalAccountId"].includes(field))
      .flatMap((field) => {
        if (field === "bankAccounts") return [[field, normalizeBankAccounts(metadata[field])]];
        if (typeof metadata[field] === "string" || typeof metadata[field] === "number") return [[field, String(metadata[field])]];
        return [];
      })
  );
  return {
    id: config.id,
    channel: config.channel,
    label: config.label,
    phoneNumberId: config.phoneNumberId,
    businessAccountId: config.businessAccountId,
    externalAccountId: config.externalAccountId,
    metadata: {
      ...safeMetadata,
      ...(Object.keys(publicAccount).length ? { oauthDiscovery: { account: publicAccount } } : {})
    },
    isActive: config.isActive,
    hasAccessToken: hasSecret(config.accessToken),
    hasVerifyToken: hasSecret(config.verifyToken),
    createdAt: config.createdAt,
    updatedAt: config.updatedAt
  };
}

function publicProvider(provider, config) {
  const envMissing = provider.oauthProvider ? missingOAuthEnv(provider) : missingEnv(provider);
  const fieldMissing = missingFields(provider, config);
  return {
    key: provider.key,
    label: provider.label,
    group: provider.group,
    groupKey: provider.groupKey,
    icon: provider.icon,
    type: provider.type,
    oauthProvider: provider.oauthProvider || null,
    module: provider.module,
    description: provider.description,
    availability: provider.availability || "AVAILABLE",
    // Las credenciales OAuth pertenecen a EVOLUM como plataforma. Nunca se
    // exponen al tenant ni se solicitan al usuario que vincula su cuenta.
    oauthReady: !envMissing.length,
    requiredEnv: [],
    oauthRequiredEnv: [],
    requiredFields: provider.requiredFields || [],
    scopes: provider.scopes || [],
    // `missing` describe la conexión del tenant; la plataforma OAuth se
    // comunica aparte para no degradar una cuenta existente.
    missing: fieldMissing,
    missingOAuthEnvironment: [],
    status: providerStatus(provider, config),
    config: publicConfig(config, provider)
  };
}

function groupProviders(providers) {
  const groups = [];
  for (const provider of providers) {
    let group = groups.find((item) => item.id === provider.groupKey);
    if (!group) {
      group = {
        id: provider.groupKey,
        label: provider.group,
        description:
          provider.groupKey === "meta_channels"
            ? "Cuentas Meta para WhatsApp, Instagram, Facebook y publicaciones."
            : provider.groupKey === "mail_files"
              ? "Correo, documentos, carpetas y almacenamiento del cliente."
              : provider.groupKey === "payments"
                ? "Medios de pago, links, estados de cobro y bancos."
                : provider.groupKey === "finance"
                  ? "Cartolas, ERP, DTE y fuentes de cuentas por cobrar autorizadas."
                : "Backups, replica, alta disponibilidad y trabajo offline.",
        providers: []
      };
      groups.push(group);
    }
    group.providers.push(provider);
  }
  return groups;
}

function reconciliationProviderForChannel(channel) {
  return PROVIDERS.find((provider) => providerConfigChannels(provider).includes(channel)) || null;
}

function reconcileConnectionConfigs(configs) {
  const items = (configs || []).map((config) => {
    const provider = reconciliationProviderForChannel(config.channel);
    if (!provider) {
      return {
        channel: config.channel,
        label: config.label || config.channel,
        status: "UNRECOGNIZED",
        reason: "No existe un proveedor asociado a esta configuración histórica.",
        updatedAt: config.updatedAt
      };
    }

    const missing = missingFields(provider, config);
    const status = !config.isActive ? "INACTIVE" : missing.length ? "INCOMPLETE" : "ACTIVE";
    return {
      channel: config.channel,
      provider: provider.key,
      label: config.label || provider.label,
      status,
      missing,
      updatedAt: config.updatedAt
    };
  });

  return {
    scanned: items.length,
    active: items.filter((item) => item.status === "ACTIVE").length,
    inactive: items.filter((item) => item.status === "INACTIVE").length,
    incomplete: items.filter((item) => item.status === "INCOMPLETE").length,
    unrecognized: items.filter((item) => item.status === "UNRECOGNIZED").length,
    items
  };
}

function oauthStateSecret() {
  return String(process.env.CONNECTIONS_STATE_SECRET || env.jwtSecret || process.env.DATABASE_URL || "evolum-local-state-secret");
}

function signOAuthState(body) {
  return crypto.createHmac("sha256", oauthStateSecret()).update(body).digest("base64url");
}

function encodeOAuthState(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${signOAuthState(body)}`;
}

function buildOAuthUrl(req, provider) {
  const baseUrl = publicBaseUrl(req);
  const state = encodeOAuthState({
    tenantId: req.tenantId,
    key: provider.key,
    // Identifica a quien inició la gestión dentro de EVOLUM, sin vincular la
    // integración a su cuenta personal del proveedor externo.
    initiatedByUserId: req.user?.id || null,
    ts: Date.now()
  });

  if (provider.oauthProvider === "google") {
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.searchParams.set("client_id", process.env.GOOGLE_CLIENT_ID || "");
    url.searchParams.set("redirect_uri", `${baseUrl}/api/connections/oauth/google/callback`);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("access_type", "offline");
    url.searchParams.set("prompt", "consent");
    url.searchParams.set("scope", (provider.scopes || []).join(" "));
    url.searchParams.set("state", state);
    return url.toString();
  }

  if (provider.oauthProvider === "microsoft") {
    const url = new URL("https://login.microsoftonline.com/common/oauth2/v2.0/authorize");
    url.searchParams.set("client_id", process.env.MICROSOFT_CLIENT_ID || "");
    url.searchParams.set("redirect_uri", `${baseUrl}/api/connections/oauth/microsoft/callback`);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("response_mode", "query");
    url.searchParams.set("scope", (provider.scopes || []).join(" "));
    url.searchParams.set("state", state);
    return url.toString();
  }

  if (provider.oauthProvider === "meta") {
    const url = new URL("https://www.facebook.com/v23.0/dialog/oauth");
    url.searchParams.set("client_id", readEnv("META_APP_ID") || "");
    url.searchParams.set("redirect_uri", `${baseUrl}/api/connections/oauth/meta/callback`);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", (provider.scopes || []).join(","));
    url.searchParams.set("state", state);
    return url.toString();
  }

  if (provider.oauthProvider === "mercadopago") {
    const url = new URL("https://auth.mercadopago.com/authorization");
    url.searchParams.set("client_id", process.env.MERCADOPAGO_CLIENT_ID || "");
    url.searchParams.set("response_type", "code");
    url.searchParams.set("platform_id", "mp");
    url.searchParams.set("redirect_uri", `${baseUrl}/api/connections/oauth/mercadopago/callback`);
    url.searchParams.set("state", state);
    return url.toString();
  }

  return null;
}

function decodeOAuthState(value) {
  try {
    const [body, signature] = String(value || "").split(".");
    if (!body || !signature) return null;
    const expected = signOAuthState(body);
    const left = Buffer.from(signature);
    const right = Buffer.from(expected);
    if (left.length !== right.length || !crypto.timingSafeEqual(left, right)) return null;

    const decoded = Buffer.from(body, "base64url").toString("utf8");
    const parsed = JSON.parse(decoded);
    const tenantId = cleanText(parsed.tenantId);
    const key = cleanText(parsed.key).toLowerCase();
    const initiatedByUserId = cleanText(parsed.initiatedByUserId, null);
    const ts = Number(parsed.ts || 0);
    if (!tenantId || !key || !ts) return null;
    if (Date.now() - ts > 15 * 60 * 1000) return null;
    return { tenantId, key, initiatedByUserId, ts };
  } catch {
    return null;
  }
}

function oauthHtml({ ok, title, message }) {
  const color = ok ? "#8b5cf6" : "#ef4444";
  const safeTitle = String(title || "").replace(/[<>]/g, "");
  const safeMessage = String(message || "").replace(/[<>]/g, "");
  return `<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${safeTitle}</title>
    <style>
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #080411; color: #f4efff; font-family: Arial, sans-serif; }
      main { width: min(520px, calc(100vw - 32px)); border: 1px solid rgba(139, 92, 246, .35); border-radius: 22px; padding: 28px; background: #151022; }
      strong { color: ${color}; letter-spacing: .08em; text-transform: uppercase; font-size: 12px; }
      h1 { margin: 10px 0; font-size: 28px; }
      p { color: #c9bdf0; line-height: 1.5; }
      button { border: 0; border-radius: 14px; padding: 12px 18px; background: ${color}; color: white; font-weight: 700; cursor: pointer; }
    </style>
  </head>
  <body>
    <main>
      <strong>Centro de Conexiones</strong>
      <h1>${safeTitle}</h1>
      <p>${safeMessage}</p>
      <button onclick="window.close()">Cerrar ventana</button>
    </main>
    <script>try { window.opener && window.opener.postMessage({ type: "EVOLUM_CONNECTION_OAUTH_DONE" }, "*"); } catch (e) {}</script>
  </body>
</html>`;
}

async function exchangeOAuthCode(req, provider, code) {
  const baseUrl = publicBaseUrl(req);
  const redirectUri = `${baseUrl}/api/connections/oauth/${provider.oauthProvider}/callback`;
  const body = new URLSearchParams();
  body.set("code", code);
  body.set("grant_type", "authorization_code");
  body.set("redirect_uri", redirectUri);

  let tokenUrl = "";
  if (provider.oauthProvider === "google") {
    tokenUrl = "https://oauth2.googleapis.com/token";
    body.set("client_id", process.env.GOOGLE_CLIENT_ID || "");
    body.set("client_secret", process.env.GOOGLE_CLIENT_SECRET || "");
  } else if (provider.oauthProvider === "microsoft") {
    tokenUrl = "https://login.microsoftonline.com/common/oauth2/v2.0/token";
    body.set("client_id", process.env.MICROSOFT_CLIENT_ID || "");
    body.set("client_secret", process.env.MICROSOFT_CLIENT_SECRET || "");
    body.set("scope", (provider.scopes || []).join(" "));
  } else if (provider.oauthProvider === "meta") {
    tokenUrl = "https://graph.facebook.com/v23.0/oauth/access_token";
    body.set("client_id", readEnv("META_APP_ID") || "");
    body.set("client_secret", readEnv("META_APP_SECRET") || "");
  } else if (provider.oauthProvider === "mercadopago") {
    tokenUrl = "https://api.mercadopago.com/oauth/token";
    body.set("client_id", process.env.MERCADOPAGO_CLIENT_ID || "");
    body.set("client_secret", process.env.MERCADOPAGO_CLIENT_SECRET || "");
  } else {
    throw new Error("Proveedor OAuth no soportado");
  }

  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error_description || data.error || "No se pudo intercambiar el codigo OAuth");
  }
  return data;
}

async function providerRequest(url, accessToken) {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.error?.message || data?.message || data?.error_description || "El proveedor rechazo la conexion");
  }
  return data;
}

function compactDiscovery(value) {
  return JSON.parse(JSON.stringify(value || {}));
}

async function discoverOAuthAccount(provider, accessToken) {
  if (!accessToken) return {};

  if (provider.oauthProvider === "google") {
    if (provider.key === "gmail") {
      const profile = await providerRequest("https://gmail.googleapis.com/gmail/v1/users/me/profile", accessToken);
      const email = cleanText(profile.emailAddress);
      return {
        label: email || provider.label,
        externalAccountId: email ? `google-gmail:${email}` : null,
        discovery: { account: { email, messagesTotal: profile.messagesTotal || 0 } }
      };
    }

    const about = await providerRequest("https://www.googleapis.com/drive/v3/about?fields=user,storageQuota", accessToken);
    const user = about.user || {};
    const identifier = cleanText(user.permissionId || user.emailAddress);
    return {
      label: cleanText(user.emailAddress || user.displayName, provider.label),
      externalAccountId: identifier ? `google-drive:${identifier}` : null,
      discovery: {
        account: {
          email: cleanText(user.emailAddress),
          name: cleanText(user.displayName),
          permissionId: cleanText(user.permissionId),
          storageQuota: about.storageQuota || null
        }
      }
    };
  }

  if (provider.oauthProvider === "microsoft") {
    const [user, drive] = await Promise.all([
      providerRequest("https://graph.microsoft.com/v1.0/me?$select=id,displayName,mail,userPrincipalName", accessToken),
      providerRequest("https://graph.microsoft.com/v1.0/me/drive?$select=id,name,webUrl", accessToken)
    ]);
    const identifier = cleanText(user.id || drive.id);
    return {
      label: cleanText(user.mail || user.userPrincipalName || user.displayName, provider.label),
      externalAccountId: identifier ? `microsoft-sharepoint:${identifier}` : null,
      discovery: {
        account: {
          id: cleanText(user.id),
          name: cleanText(user.displayName),
          email: cleanText(user.mail || user.userPrincipalName),
          driveId: cleanText(drive.id),
          driveName: cleanText(drive.name),
          driveUrl: cleanText(drive.webUrl)
        }
      }
    };
  }

  if (provider.oauthProvider === "mercadopago") {
    const account = await providerRequest("https://api.mercadopago.com/users/me", accessToken);
    const identifier = cleanText(account.id);
    return {
      label: cleanText(account.nickname || account.email || provider.label),
      externalAccountId: identifier ? `mercadopago:${identifier}` : null,
      discovery: {
        account: {
          id: identifier,
          nickname: cleanText(account.nickname),
          email: cleanText(account.email),
          countryId: cleanText(account.country_id)
        }
      }
    };
  }

  if (provider.oauthProvider === "meta") {
    const pages = await providerRequest(
      "https://graph.facebook.com/v23.0/me/accounts?fields=id,name,instagram_business_account{id,username},whatsapp_business_account{id,name,phone_numbers{id,display_phone_number,verified_name}}&limit=100",
      accessToken
    );
    const accounts = Array.isArray(pages.data) ? pages.data : [];
    const availableAccounts = accounts.map((page) => ({
      pageId: cleanText(page.id),
      pageName: cleanText(page.name),
      instagram: page.instagram_business_account
        ? { id: cleanText(page.instagram_business_account.id), username: cleanText(page.instagram_business_account.username) }
        : null,
      whatsapp: page.whatsapp_business_account
        ? {
            id: cleanText(page.whatsapp_business_account.id),
            name: cleanText(page.whatsapp_business_account.name),
            phoneNumbers: Array.isArray(page.whatsapp_business_account.phone_numbers)
              ? page.whatsapp_business_account.phone_numbers.map((phone) => ({
                  id: cleanText(phone.id),
                  displayPhoneNumber: cleanText(phone.display_phone_number),
                  verifiedName: cleanText(phone.verified_name)
                }))
              : []
          }
        : null
    }));

    if (provider.key === "meta_whatsapp") {
      const selected = availableAccounts.find((item) => item.whatsapp?.phoneNumbers?.length) || availableAccounts.find((item) => item.whatsapp);
      const phone = selected?.whatsapp?.phoneNumbers?.[0] || null;
      return {
        label: cleanText(phone?.verifiedName || selected?.whatsapp?.name || selected?.pageName, provider.label),
        externalAccountId: phone?.id ? `meta-whatsapp:${phone.id}` : null,
        businessAccountId: selected?.whatsapp?.id || null,
        phoneNumberId: phone?.id || null,
        discovery: { account: selected || null, availableAccounts }
      };
    }

    if (provider.key === "facebook_business") {
      const selected = availableAccounts.find((item) => item.pageId) || null;
      return {
        label: cleanText(selected?.pageName, provider.label),
        externalAccountId: selected?.pageId ? `meta-page:${selected.pageId}` : null,
        discovery: { account: selected, availableAccounts }
      };
    }

    if (provider.key === "meta_business") {
      const selected = availableAccounts.find((item) => item.whatsapp?.id || item.instagram?.id) || availableAccounts[0] || null;
      const businessId = selected?.whatsapp?.id || selected?.instagram?.id || selected?.pageId || null;
      return {
        label: cleanText(selected?.pageName || selected?.whatsapp?.name || selected?.instagram?.username, provider.label),
        externalAccountId: businessId ? `meta-business:${businessId}` : null,
        businessAccountId: businessId,
        discovery: { account: selected, availableAccounts }
      };
    }

    const selected = availableAccounts.find((item) => item.instagram?.id) || availableAccounts[0] || null;
    const instagramId = selected?.instagram?.id || null;
    return {
      label: cleanText(selected?.instagram?.username || selected?.pageName, provider.label),
      externalAccountId: instagramId ? `meta-instagram:${instagramId}` : (selected?.pageId ? `meta-page:${selected.pageId}` : null),
      businessAccountId: instagramId || selected?.pageId || null,
      discovery: { account: selected, availableAccounts }
    };
  }

  return {};
}

async function refreshOAuthAccessToken(provider, config) {
  const metadata = configMetadata(config);
  const expiresAt = Date.parse(String(metadata.oauthExpiresAt || ""));
  const refreshToken = decryptSecret(config.verifyToken);
  if (!refreshToken || !Number.isFinite(expiresAt) || expiresAt > Date.now() + 120000) return config;

  const body = new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken });
  let tokenUrl = "";
  if (provider.oauthProvider === "google") {
    tokenUrl = "https://oauth2.googleapis.com/token";
    body.set("client_id", process.env.GOOGLE_CLIENT_ID || "");
    body.set("client_secret", process.env.GOOGLE_CLIENT_SECRET || "");
  } else if (provider.oauthProvider === "microsoft") {
    tokenUrl = "https://login.microsoftonline.com/common/oauth2/v2.0/token";
    body.set("client_id", process.env.MICROSOFT_CLIENT_ID || "");
    body.set("client_secret", process.env.MICROSOFT_CLIENT_SECRET || "");
    body.set("scope", (provider.scopes || []).join(" "));
  } else if (provider.oauthProvider === "mercadopago") {
    tokenUrl = "https://api.mercadopago.com/oauth/token";
    body.set("client_id", process.env.MERCADOPAGO_CLIENT_ID || "");
    body.set("client_secret", process.env.MERCADOPAGO_CLIENT_SECRET || "");
  }
  if (!tokenUrl) return config;

  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });
  const token = await response.json().catch(() => ({}));
  if (!response.ok || !token.access_token) {
    throw new Error(token.error_description || token.error || "No se pudo renovar el token OAuth");
  }

  return prisma.tenantChannelConfig.update({
    where: { id: config.id },
    data: {
      accessToken: encryptSecret(token.access_token),
      verifyToken: encryptSecret(token.refresh_token) || config.verifyToken,
      metadata: normalizeMetadata({
        ...metadata,
        oauthExpiresAt: token.expires_in ? new Date(Date.now() + Number(token.expires_in) * 1000).toISOString() : metadata.oauthExpiresAt,
        refreshedAt: new Date().toISOString(),
        hasRefreshToken: Boolean(token.refresh_token || config.verifyToken)
      }, {})
    }
  });
}

async function testOAuthConnection(provider, config) {
  const refreshed = await refreshOAuthAccessToken(provider, config);
  const accessToken = decryptSecret(refreshed.accessToken);
  if (!accessToken) throw new Error("No hay access token OAuth para validar");

  // El token de WhatsApp Business se valida contra el número registrado. No
  // depende de una cuenta personal de Facebook ni de un ID externo ingresado
  // manualmente en el Centro de Conexiones.
  if (provider.key === "meta_whatsapp") {
    const phoneNumberId = cleanText(refreshed.phoneNumberId);
    if (!phoneNumberId) throw new Error("Falta phoneNumberId para validar WhatsApp Business");
    const account = await providerRequest(
      `https://graph.facebook.com/v23.0/${encodeURIComponent(phoneNumberId)}?fields=id,display_phone_number,verified_name`,
      accessToken
    );
    return {
      config: refreshed,
      discovery: {
        label: cleanText(account.verified_name || account.display_phone_number, provider.label),
        externalAccountId: refreshed.externalAccountId || `meta-whatsapp:${phoneNumberId}`,
        phoneNumberId,
        businessAccountId: refreshed.businessAccountId || null,
        discovery: {
          account: {
            id: cleanText(account.id || phoneNumberId),
            displayPhoneNumber: cleanText(account.display_phone_number),
            verifiedName: cleanText(account.verified_name)
          }
        }
      }
    };
  }

  const discovery = await discoverOAuthAccount(provider, accessToken);
  return { config: refreshed, discovery };
}

function verificationSuccessMessage(provider) {
  if (provider.key === "finance_nubox") return "Credenciales Nubox validadas contra documentos de venta";
  if (provider.oauthProvider) return "Token y cuenta OAuth validados";
  return "Configuración completa";
}

// Comprueba solo conexiones que cuentan con una API de verificación. Las
// conexiones manuales/locales no se marcan como listas solo por tener campos.
async function verifyStoredConnection(provider, config) {
  const previousMetadata = configMetadata(config);
  const previousStatus = String(previousMetadata.lastTestStatus || "").toUpperCase();
  const missing = missingFields(provider, config);
  const checkedAt = new Date().toISOString();

  if (missing.length || (!provider.oauthProvider && provider.key !== "finance_nubox")) {
    return { status: "SKIPPED", provider: provider.key, reason: missing.length ? "missing_fields" : "not_verifiable" };
  }

  let testedConfig = config;
  let discovery = null;
  let testError = null;
  try {
    if (provider.oauthProvider) {
      const result = await testOAuthConnection(provider, config);
      testedConfig = result.config;
      discovery = result.discovery;
    } else if (provider.key === "finance_nubox") {
      const result = await testNuboxConnection(config);
      testedConfig = result.config;
      discovery = result.discovery;
    }
  } catch (error) {
    testError = error instanceof Error ? error.message : "No se pudo verificar la conexión";
  }

  const ok = !testError;
  const metadata = normalizeMetadata({
    ...configMetadata(testedConfig),
    lastTestedAt: checkedAt,
    lastTestStatus: ok ? "OK" : "ERROR",
    lastTestMessage: ok ? verificationSuccessMessage(provider) : testError,
    lastConnectionCheckSource: "scheduled",
    ...(ok ? { connectedAt: previousMetadata.connectedAt || checkedAt, connectionReadyNotifiedAt: checkedAt } : {}),
    oauthDiscovery: discovery?.discovery ? compactDiscovery(discovery.discovery) : configMetadata(testedConfig).oauthDiscovery
  }, {});
  const updated = await prisma.tenantChannelConfig.update({
    where: { id: testedConfig.id },
    data: {
      label: discovery?.label || testedConfig.label,
      phoneNumberId: discovery?.phoneNumberId || testedConfig.phoneNumberId,
      businessAccountId: discovery?.businessAccountId || testedConfig.businessAccountId,
      externalAccountId: discovery?.externalAccountId || testedConfig.externalAccountId,
      metadata
    }
  });

  // Avisamos solo si pasa de pendiente/error a validada. Si luego falla y se
  // recupera, se emite otro aviso útil, sin repetirlo en cada ciclo sano.
  if (ok && previousStatus !== "OK") {
    await createTenantNotification({
      tenantId: updated.tenantId,
      title: `${provider.label} está listo para usar`,
      body: "La conexión fue verificada automáticamente. Ya puedes usarla desde EVOLUM.",
      severity: "success",
      targetUrl: "/connections",
      metadata: {
        notificationType: "connection",
        screen: "connections",
        provider: provider.key,
        verifiedAt: checkedAt
      }
    }).catch(() => null);
  }

  await prisma.tenantAuditLog.create({
    data: {
      tenantId: updated.tenantId,
      action: "CONNECTION_AUTO_VERIFIED",
      entity: "tenant_channel_config",
      entityId: updated.id,
      metadata: { provider: provider.key, ok, checkedAt, message: ok ? verificationSuccessMessage(provider) : testError }
    }
  }).catch(() => null);

  return { status: ok ? "VERIFIED" : "ERROR", provider: provider.key, tenantId: updated.tenantId, error: testError || null };
}

// Trabajo de Railway: una autorización que tomó horas/días queda lista sin
// exigir que la persona vuelva a abrir el Centro de Conexiones.
export async function verifyPendingConnections({ limit = 100 } = {}) {
  const configs = await prisma.tenantChannelConfig.findMany({
    where: { isActive: true },
    orderBy: { updatedAt: "asc" },
    take: Math.min(500, Math.max(1, Number(limit) || 100))
  });
  const results = [];
  for (const config of configs) {
    const provider = reconciliationProviderForChannel(config.channel);
    if (!provider || provider.availability === "COMING_SOON") continue;
    const lastStatus = String(configMetadata(config).lastTestStatus || "").toUpperCase();
    // Priorizamos pendientes y errores. Las conexiones sanas se mantienen por
    // sus rutinas de renovación/sincronización y no consumen cuota innecesaria.
    if (lastStatus === "OK") continue;
    results.push(await verifyStoredConnection(provider, config));
  }
  return {
    scanned: configs.length,
    verified: results.filter((item) => item.status === "VERIFIED").length,
    failed: results.filter((item) => item.status === "ERROR").length,
    skipped: results.filter((item) => item.status === "SKIPPED").length,
    results
  };
}

async function reconcileMetaAssets(tenantId) {
  const configs = await prisma.tenantChannelConfig.findMany({ where: { tenantId } });
  const sourceCandidates = ["facebook", "instagram", "whatsapp"]
    .map((channel) => configs.find((item) => item.channel === channel && item.isActive && hasSecret(item.accessToken)))
    .filter(Boolean);
  const metaBusiness = PROVIDER_BY_KEY.get("meta_business");
  let source = null;
  let discovery = null;
  for (const candidate of sourceCandidates) {
    try {
      const token = decryptSecret(candidate.accessToken);
      if (!token) continue;
      const result = await discoverOAuthAccount(metaBusiness, token);
      if (Array.isArray(result?.discovery?.availableAccounts) && result.discovery.availableAccounts.length) {
        source = candidate;
        discovery = result.discovery;
        break;
      }
    } catch {
      // Se prueba el siguiente token Meta activo sin exponer el error ni el secreto.
    }
  }
  if (!source || !discovery) throw new Error("No se encontró un token Meta activo con activos administrables");

  const available = discovery.availableAccounts || [];
  const page = available.find((item) => item.pageId) || null;
  const instagram = available.find((item) => item.instagram?.id)?.instagram || null;
  const whatsappAccount = available.find((item) => item.whatsapp?.phoneNumbers?.length)?.whatsapp || available.find((item) => item.whatsapp)?.whatsapp || null;
  const phone = whatsappAccount?.phoneNumbers?.[0] || null;
  const updates = [];

  async function saveAsset(key, values, { reuseSourceToken = false } = {}) {
    const provider = PROVIDER_BY_KEY.get(key);
    if (!provider) return;
    const channel = providerStorageChannel(provider);
    const existing = configs.find((item) => item.channel === channel) || null;
    const metadata = normalizeMetadata({
      ...configMetadata(existing),
      providerType: provider.type,
      providerGroup: provider.groupKey,
      oauthProvider: "meta",
      oauthReconciledAt: new Date().toISOString(),
      oauthReconciledFrom: source.channel,
      lastTestStatus: "OK",
      lastTestMessage: "Activo Meta detectado y reconciliado",
      oauthDiscovery: compactDiscovery({ account: values.account || null, availableAccounts: available })
    }, {});
    const data = {
      label: values.label || existing?.label || provider.label,
      phoneNumberId: values.phoneNumberId || existing?.phoneNumberId || null,
      businessAccountId: values.businessAccountId || existing?.businessAccountId || null,
      externalAccountId: values.externalAccountId || existing?.externalAccountId || null,
      // Solo Instagram reemplaza un token histórico: fue el canal que no
      // pudo validarse y el token fuente ya probó acceso al mismo negocio.
      accessToken: reuseSourceToken ? source.accessToken : (existing?.accessToken || source.accessToken),
      verifyToken: existing?.verifyToken || source.verifyToken || null,
      metadata,
      isActive: true
    };
    const config = existing
      ? await prisma.tenantChannelConfig.update({ where: { id: existing.id }, data })
      : await prisma.tenantChannelConfig.create({ data: { tenantId, channel, ...data } });
    updates.push({ provider: key, channel: config.channel, status: "CONNECTED" });
  }

  if (page) await saveAsset("facebook_business", { label: page.pageName, externalAccountId: `meta-page:${page.pageId}`, account: page });
  if (instagram) await saveAsset("meta_instagram", { label: instagram.username || page?.pageName, externalAccountId: `meta-instagram:${instagram.id}`, businessAccountId: instagram.id, account: { page, instagram } }, { reuseSourceToken: true });
  if (whatsappAccount) await saveAsset("meta_whatsapp", { label: phone?.verifiedName || whatsappAccount.name || page?.pageName, externalAccountId: phone?.id ? `meta-whatsapp:${phone.id}` : null, businessAccountId: whatsappAccount.id, phoneNumberId: phone?.id || null, account: { page, whatsapp: whatsappAccount } });
  const metaBusinessId = whatsappAccount?.id || instagram?.id || page?.pageId || null;
  if (metaBusinessId) await saveAsset("meta_business", { label: page?.pageName || whatsappAccount?.name || instagram?.username, externalAccountId: `meta-business:${metaBusinessId}`, businessAccountId: metaBusinessId, account: { page, instagram, whatsapp: whatsappAccount } });

  return { sourceChannel: source.channel, assetsDetected: { facebook: Boolean(page), instagram: Boolean(instagram), whatsapp: Boolean(whatsappAccount) }, updates };
}

function oauthCallbackHandler(expectedProvider) {
  return async (req, res) => {
    try {
      const code = cleanText(req.query.code);
      const state = decodeOAuthState(req.query.state);
      if (!code || !state) {
        return res.status(400).send(oauthHtml({
          ok: false,
          title: "Conexion no completada",
          message: "El proveedor no devolvio un codigo valido o el enlace expiro."
        }));
      }

      const provider = PROVIDER_BY_KEY.get(state.key);
      if (!provider || provider.oauthProvider !== expectedProvider) {
        return res.status(400).send(oauthHtml({
          ok: false,
          title: "Proveedor no valido",
          message: "El proveedor OAuth no coincide con la conexion solicitada."
        }));
      }

      const token = await exchangeOAuthCode(req, provider, code);
      const existing = await findTenantProviderConfig(state.tenantId, provider);
      const encryptedAccessToken = encryptSecret(token.access_token) || existing?.accessToken || null;
      const encryptedRefreshToken = encryptSecret(token.refresh_token) || existing?.verifyToken || null;
      let discovery = {};
      try {
        discovery = await discoverOAuthAccount(provider, token.access_token);
      } catch (discoveryError) {
        discovery = {
          discoveryError: discoveryError instanceof Error ? discoveryError.message : "No se pudo descubrir la cuenta autorizada"
        };
      }
      const metadata = normalizeMetadata({
        ...configMetadata(existing),
        providerType: provider.type,
        providerGroup: provider.groupKey,
        oauthProvider: provider.oauthProvider,
        scope: token.scope || (provider.scopes || []).join(" "),
        tokenType: token.token_type || null,
        expiresIn: token.expires_in || null,
        hasRefreshToken: Boolean(token.refresh_token || existing?.verifyToken || configMetadata(existing).hasRefreshToken),
        refreshToken: undefined,
        oauthExpiresAt: token.expires_in ? new Date(Date.now() + Number(token.expires_in) * 1000).toISOString() : null,
        oauthConnectedAt: new Date().toISOString(),
        oauthInitiatedByUserId: state.initiatedByUserId || null,
        lastTestStatus: discovery.discoveryError ? "ERROR" : "OK",
        lastTestMessage: discovery.discoveryError ? "OAuth conectado; falta revisar la cuenta autorizada" : "OAuth conectado y cuenta detectada",
        oauthDiscovery: compactDiscovery(discovery.discovery || discovery)
      }, {});

      const connectionData = {
        label: discovery.label || provider.label,
        phoneNumberId: discovery.phoneNumberId || existing?.phoneNumberId || null,
        businessAccountId: discovery.businessAccountId || existing?.businessAccountId || null,
        externalAccountId: discovery.externalAccountId || existing?.externalAccountId || null,
        accessToken: encryptedAccessToken,
        verifyToken: encryptedRefreshToken,
        metadata,
        isActive: true
      };
      if (existing) {
        await prisma.tenantChannelConfig.update({ where: { id: existing.id }, data: connectionData });
      } else {
        await prisma.tenantChannelConfig.create({
          data: { tenantId: state.tenantId, channel: providerStorageChannel(provider), ...connectionData }
        });
      }

      return res.send(oauthHtml({
        ok: true,
        title: "Conexion completada",
        message: `${provider.label} quedo enlazado. Puedes volver a EVOLUM y refrescar el Centro de Conexiones.`
      }));
    } catch (error) {
      return res.status(500).send(oauthHtml({
        ok: false,
        title: "Error al conectar",
        message: error instanceof Error ? error.message : "No se pudo completar la conexion OAuth."
      }));
    }
  };
}

connectionsPublicRouter.get("/connections/oauth/google/callback", oauthCallbackHandler("google"));
connectionsPublicRouter.get("/connections/oauth/microsoft/callback", oauthCallbackHandler("microsoft"));
connectionsPublicRouter.get("/connections/oauth/meta/callback", oauthCallbackHandler("meta"));
connectionsPublicRouter.get("/connections/oauth/mercadopago/callback", oauthCallbackHandler("mercadopago"));

connectionsRouter.get("/connections", async (req, res, next) => {
  try {
    const configs = await prisma.tenantChannelConfig.findMany({
      where: { tenantId: req.tenantId }
    });
    const providers = PROVIDERS.map((provider) => publicProvider(provider, resolveProviderConfig(provider, configs)));
    const connected = providers.filter((provider) => provider.status === "CONNECTED").length;
    const pending = providers.filter((provider) => provider.status === "PENDING").length;
    const errors = providers.filter((provider) => provider.status === "ERROR").length;

    res.json({
      tenantId: req.tenantId,
      generatedAt: new Date().toISOString(),
      summary: {
        total: providers.length,
        connected,
        pending,
        errors,
        disconnected: providers.length - connected - pending - errors
      },
      reconciliation: reconcileConnectionConfigs(configs),
      callbacks: {
        oauthGoogle: `${publicBaseUrl(req)}/api/connections/oauth/google/callback`,
        oauthMicrosoft: `${publicBaseUrl(req)}/api/connections/oauth/microsoft/callback`,
        oauthMeta: `${publicBaseUrl(req)}/api/connections/oauth/meta/callback`,
        oauthMercadoPago: `${publicBaseUrl(req)}/api/connections/oauth/mercadopago/callback`,
        metaWebhook: `${publicBaseUrl(req)}/meta/webhook`
      },
      groups: groupProviders(providers)
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo sincronizar Nubox.";
    if (/faltan|configurad|periodo|per[ií]odo|url https/i.test(message)) return res.status(400).json({ error: message });
    res.status(502).json({ error: message });
  }
});

connectionsRouter.post("/connections/meta/reconcile", requireRole(ROLE_GROUPS.MANAGERS), async (req, res, next) => {
  try {
    const result = await reconcileMetaAssets(req.tenantId);
    await recordAuditLog(req, "META_CONNECTIONS_RECONCILED", "tenant_channel_config", null, result);
    res.json({ ok: true, ...result });
  } catch (error) {
    next(error);
  }
});

connectionsRouter.put("/connections/:key", requireRole(ROLE_GROUPS.MANAGERS), async (req, res, next) => {
  try {
    const key = String(req.params.key || "").trim().toLowerCase();
    const provider = PROVIDER_BY_KEY.get(key);
    if (!provider) return res.status(404).json({ error: "Proveedor no soportado" });
    if (provider.availability === "COMING_SOON") return res.status(409).json({ error: "Esta conexión aún no está disponible para configuración." });

    const existing = await findTenantProviderConfig(req.tenantId, provider);
    const incomingMetadata = normalizeMetadata(req.body?.metadata, {});
    if (provider.key === "finance_bank_statements" && Object.prototype.hasOwnProperty.call(incomingMetadata, "bankAccounts")) {
      incomingMetadata.bankAccounts = normalizeBankAccounts(incomingMetadata.bankAccounts);
    }
    // Una credencial recién guardada no hereda un error de una credencial
    // anterior. Queda pendiente hasta que la prueba manual o el verificador
    // programado confirme que el proveedor realmente la acepta.
    const supportsRemoteVerification = Boolean(provider.oauthProvider || provider.key === "finance_nubox");
    const verificationInputChanged = ["accessToken", "verifyToken", ...(provider.requiredFields || [])]
      .some((field) => Object.prototype.hasOwnProperty.call(req.body || {}, field));
    const metadata = normalizeMetadata({
      ...configMetadata(existing),
      ...incomingMetadata,
      providerType: provider.type,
      providerGroup: provider.groupKey,
      updatedFrom: "connection_center",
      ...(supportsRemoteVerification && verificationInputChanged
        ? {
          lastTestStatus: "PENDING",
          lastTestMessage: "Configuración guardada. Pendiente de verificación automática.",
          lastTestedAt: null,
          connectionReadyNotifiedAt: null
        }
        : {})
    }, {});

    const data = {
      label: cleanText(req.body?.label, provider.label),
      phoneNumberId: req.body?.phoneNumberId === undefined ? existing?.phoneNumberId || null : cleanText(req.body.phoneNumberId, null),
      businessAccountId: req.body?.businessAccountId === undefined ? existing?.businessAccountId || null : cleanText(req.body.businessAccountId, null),
      externalAccountId: req.body?.externalAccountId === undefined ? existing?.externalAccountId || null : cleanText(req.body.externalAccountId, null),
      accessToken: req.body?.accessToken === undefined ? existing?.accessToken || null : encryptSecret(req.body.accessToken),
      verifyToken: req.body?.verifyToken === undefined ? existing?.verifyToken || null : encryptSecret(req.body.verifyToken),
      metadata,
      isActive: req.body?.isActive === undefined ? true : Boolean(req.body.isActive)
    };

    const config = existing
      ? await prisma.tenantChannelConfig.update({ where: { id: existing.id }, data })
      : await prisma.tenantChannelConfig.create({
          data: { tenantId: req.tenantId, channel: providerStorageChannel(provider), ...data }
        });

    await recordAuditLog(req, "CONNECTION_CONFIGURED", "tenant_channel_config", config.id, {
      provider: key,
      status: providerStatus(provider, config)
    });

    res.json({ provider: publicProvider(provider, config) });
  } catch (error) {
    next(error);
  }
});

connectionsRouter.post("/connections/:key/test", requireRole(ROLE_GROUPS.MANAGERS), async (req, res, next) => {
  try {
    const key = String(req.params.key || "").trim().toLowerCase();
    const provider = PROVIDER_BY_KEY.get(key);
    if (!provider) return res.status(404).json({ error: "Proveedor no soportado" });
    if (provider.availability === "COMING_SOON") return res.status(409).json({ error: "Esta conexión aún no está disponible para pruebas." });

    const config = await findTenantProviderConfig(req.tenantId, provider);
    if (!config || !config.isActive) return res.status(400).json({ ok: false, error: "Conexion inactiva o no configurada" });

    // Una prueba de una conexión ya enlazada no depende de las credenciales
    // de alta OAuth; valida los campos y el token que pertenecen al tenant.
    const missing = missingFields(provider, config);
    let testedConfig = config;
    let testError = null;
    let discovery = null;
    if (!missing.length && provider.oauthProvider) {
      try {
        const result = await testOAuthConnection(provider, config);
        testedConfig = result.config;
        discovery = result.discovery;
      } catch (error) {
        testError = error instanceof Error ? error.message : "La prueba OAuth fallo";
      }
    } else if (!missing.length && provider.key === "finance_nubox") {
      try {
        const result = await testNuboxConnection(config);
        testedConfig = result.config;
        discovery = result.discovery;
      } catch (error) {
        testError = error instanceof Error ? error.message : "La prueba con Nubox fallo";
      }
    }
    const ok = missing.length === 0 && !testError;
    const metadata = normalizeMetadata({
      ...configMetadata(testedConfig),
      lastTestedAt: new Date().toISOString(),
      lastTestStatus: ok ? "OK" : "ERROR",
      lastTestMessage: ok
        ? (provider.oauthProvider
          ? "Token y cuenta OAuth validados"
          : provider.key === "finance_nubox"
            ? "Credenciales Nubox validadas contra documentos de venta"
            : "Configuracion completa")
        : (testError || `Faltan campos: ${missing.join(", ")}`),
      oauthDiscovery: discovery?.discovery ? compactDiscovery(discovery.discovery) : configMetadata(testedConfig).oauthDiscovery
    }, {});

    const updated = await prisma.tenantChannelConfig.update({
      where: { id: testedConfig.id },
      data: {
        label: discovery?.label || testedConfig.label,
        phoneNumberId: discovery?.phoneNumberId || testedConfig.phoneNumberId,
        businessAccountId: discovery?.businessAccountId || testedConfig.businessAccountId,
        externalAccountId: discovery?.externalAccountId || testedConfig.externalAccountId,
        metadata
      }
    });

    await recordAuditLog(req, "CONNECTION_TESTED", "tenant_channel_config", config.id, {
      provider: key,
      ok,
      missing
    });

    res.status(ok ? 200 : 400).json({
      ok,
      missing,
      provider: publicProvider(provider, updated)
    });
  } catch (error) {
    next(error);
  }
});

connectionsRouter.post("/connections/finance_nubox/sync", requireRole(ROLE_GROUPS.MANAGERS), async (req, res, next) => {
  try {
    const requestedPeriod = cleanText(req.body?.period, new Date().toISOString().slice(0, 7));
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(requestedPeriod)) {
      return res.status(400).json({ error: "El periodo debe tener formato AAAA-MM." });
    }
    const limit = Math.max(1, Math.min(Number(req.body?.limit) || 100, 100));
    const summary = await syncNuboxForTenant({ tenantId: req.tenantId, period: requestedPeriod, limit, source: "manual" });
    if (summary?.skipped === "already_running") return res.status(202).json({ ok: false, pending: true, message: "Ya hay una sincronización de Nubox en curso para esta cuenta." });
    res.json(summary);
  } catch (error) {
    next(error);
  }
});

connectionsRouter.post("/connections/:key/disconnect", requireRole(ROLE_GROUPS.MANAGERS), async (req, res, next) => {
  try {
    const key = String(req.params.key || "").trim().toLowerCase();
    const provider = PROVIDER_BY_KEY.get(key);
    if (!provider) return res.status(404).json({ error: "Proveedor no soportado" });
    if (provider.availability === "COMING_SOON") return res.status(409).json({ error: "Esta conexión aún no está disponible para administración." });

    const config = await findTenantProviderConfig(req.tenantId, provider);
    if (!config) return res.json({ ok: true, provider: publicProvider(provider, null) });

    const updated = await prisma.tenantChannelConfig.update({
      where: { id: config.id },
      data: {
        isActive: false,
        accessToken: null,
        verifyToken: null,
        metadata: normalizeMetadata({
          ...configMetadata(config),
          disconnectedAt: new Date().toISOString()
        }, {})
      }
    });

    await recordAuditLog(req, "CONNECTION_DISCONNECTED", "tenant_channel_config", config.id, { provider: key });
    res.json({ ok: true, provider: publicProvider(provider, updated) });
  } catch (error) {
    next(error);
  }
});

connectionsRouter.post("/connections/:key/oauth-url", requireRole(ROLE_GROUPS.MANAGERS), async (req, res, next) => {
  try {
    const key = String(req.params.key || "").trim().toLowerCase();
    const provider = PROVIDER_BY_KEY.get(key);
    if (!provider) return res.status(404).json({ error: "Proveedor no soportado" });
    if (!provider.oauthProvider) return res.status(400).json({ error: "Este proveedor no usa OAuth" });

    const missing = missingOAuthEnv(provider);
    if (missing.length) {
      return res.status(503).json({
        error: "Este proveedor aún está siendo habilitado por EVOLUM. No necesitas ingresar credenciales manuales.",
        code: "OAUTH_PROVIDER_NOT_READY"
      });
    }

    const url = buildOAuthUrl(req, provider);
    if (!url) return res.status(400).json({ error: "No se pudo construir URL OAuth" });
    res.json({ url, provider: key, oauthProvider: provider.oauthProvider });
  } catch (error) {
    next(error);
  }
});
