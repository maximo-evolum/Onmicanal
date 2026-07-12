import { Router } from "express";
import crypto from "crypto";
import { prisma } from "../lib/db.js";
import { env } from "../lib/env.js";
import { normalizeMetadata } from "../lib/metadata.js";
import { MODULES } from "../lib/modules.js";
import { recordAuditLog } from "../lib/audit.js";
import { requireRole, ROLE_GROUPS } from "../middleware/tenant-access.js";
import { encryptSecret, hasSecret } from "../lib/credential-crypto.js";

export const connectionsPublicRouter = Router();
export const connectionsRouter = Router();

const PROVIDERS = [
  {
    key: "meta_whatsapp",
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
    label: "Instagram / Facebook",
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
    requiredFields: ["host", "port", "username", "accessToken"]
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
    requiredFields: ["commerceCode", "accessToken"]
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
    requiredFields: ["bankName", "accountNumber"]
  },
  {
    key: "backup_provider",
    label: "Proveedor de respaldo",
    group: "Continuidad operativa",
    groupKey: "continuity",
    icon: "BK",
    type: "credentials",
    module: MODULES.BACKUP_PROVIDER,
    description: "Azure Backup, AWS Backup, Backblaze, Wasabi u otro proveedor definido por cliente.",
    requiredFields: ["provider", "bucket", "region", "accessToken"]
  },
  {
    key: "security_replica",
    label: "Replica de seguridad",
    group: "Continuidad operativa",
    groupKey: "continuity",
    icon: "RP",
    type: "credentials",
    module: MODULES.SECURITY_REPLICA,
    description: "Configuracion de replica logica para recuperacion y alta disponibilidad.",
    requiredFields: ["provider", "target", "frequency"]
  },
  {
    key: "offline_sync",
    label: "Sync offline",
    group: "Continuidad operativa",
    groupKey: "continuity",
    icon: "OF",
    type: "local",
    module: MODULES.OFFLINE_SYNC,
    description: "Cola local de cambios offline para sincronizar automaticamente cuando vuelva internet.",
    requiredFields: []
  }
];

const PROVIDER_BY_KEY = new Map(PROVIDERS.map((provider) => [provider.key, provider]));

function cleanText(value, fallback = "") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function publicBaseUrl(req) {
  const host = req.get("host");
  const protocol = req.get("x-forwarded-proto") || req.protocol || "https";
  return env.publicBaseUrl || (host ? `${protocol}://${host}` : "");
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

function hasField(config, field) {
  const metadata = configMetadata(config);
  if (field === "accessToken") return hasSecret(config?.accessToken);
  if (field === "verifyToken") return hasSecret(config?.verifyToken);
  if (field === "externalAccountId") return Boolean(config?.externalAccountId);
  if (field === "businessAccountId") return Boolean(config?.businessAccountId);
  return Boolean(metadata[field]);
}

function missingFields(provider, config) {
  if (!config?.isActive) return provider.requiredFields || [];
  return (provider.requiredFields || []).filter((field) => !hasField(config, field));
}

function providerStatus(provider, config) {
  if (!config || !config.isActive) return "DISCONNECTED";
  const envMissing = missingEnv(provider);
  const fieldMissing = missingFields(provider, config);
  const lastTestStatus = String(configMetadata(config).lastTestStatus || "").toUpperCase();
  if (lastTestStatus === "ERROR") return "ERROR";
  if (envMissing.length || fieldMissing.length) return "PENDING";
  return "CONNECTED";
}

function publicConfig(config) {
  if (!config) return null;
  return {
    id: config.id,
    channel: config.channel,
    label: config.label,
    phoneNumberId: config.phoneNumberId,
    businessAccountId: config.businessAccountId,
    externalAccountId: config.externalAccountId,
    metadata: configMetadata(config),
    isActive: config.isActive,
    hasAccessToken: hasSecret(config.accessToken),
    hasVerifyToken: hasSecret(config.verifyToken),
    createdAt: config.createdAt,
    updatedAt: config.updatedAt
  };
}

function publicProvider(provider, config) {
  const envMissing = missingEnv(provider);
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
    requiredEnv: provider.requiredEnv || [],
    oauthRequiredEnv: provider.oauthRequiredEnv || [],
    requiredFields: provider.requiredFields || [],
    scopes: provider.scopes || [],
    missing: [...envMissing, ...fieldMissing],
    status: providerStatus(provider, config),
    config: publicConfig(config)
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
                : "Backups, replica, alta disponibilidad y trabajo offline.",
        providers: []
      };
      groups.push(group);
    }
    group.providers.push(provider);
  }
  return groups;
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
    const ts = Number(parsed.ts || 0);
    if (!tenantId || !key || !ts) return null;
    if (Date.now() - ts > 15 * 60 * 1000) return null;
    return { tenantId, key, ts };
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
      const existing = await prisma.tenantChannelConfig.findUnique({
        where: { tenantId_channel: { tenantId: state.tenantId, channel: provider.key } }
      });
      const encryptedAccessToken = encryptSecret(token.access_token) || existing?.accessToken || null;
      const encryptedRefreshToken = encryptSecret(token.refresh_token) || existing?.verifyToken || null;
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
        oauthConnectedAt: new Date().toISOString(),
        lastTestStatus: "OK",
        lastTestMessage: "OAuth conectado"
      }, {});

      await prisma.tenantChannelConfig.upsert({
        where: { tenantId_channel: { tenantId: state.tenantId, channel: provider.key } },
        create: {
          tenantId: state.tenantId,
          channel: provider.key,
          label: provider.label,
          accessToken: encryptedAccessToken,
          verifyToken: encryptedRefreshToken,
          metadata,
          isActive: true
        },
        update: {
          label: provider.label,
          accessToken: encryptedAccessToken,
          verifyToken: encryptedRefreshToken,
          metadata,
          isActive: true
        }
      });

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
      where: {
        tenantId: req.tenantId,
        channel: { in: PROVIDERS.map((provider) => provider.key) }
      }
    });
    const byChannel = new Map(configs.map((config) => [config.channel, config]));
    const providers = PROVIDERS.map((provider) => publicProvider(provider, byChannel.get(provider.key)));
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
    next(error);
  }
});

connectionsRouter.put("/connections/:key", requireRole(ROLE_GROUPS.MANAGERS), async (req, res, next) => {
  try {
    const key = String(req.params.key || "").trim().toLowerCase();
    const provider = PROVIDER_BY_KEY.get(key);
    if (!provider) return res.status(404).json({ error: "Proveedor no soportado" });

    const existing = await prisma.tenantChannelConfig.findUnique({
      where: { tenantId_channel: { tenantId: req.tenantId, channel: key } }
    });
    const incomingMetadata = normalizeMetadata(req.body?.metadata, {});
    const metadata = normalizeMetadata({
      ...configMetadata(existing),
      ...incomingMetadata,
      providerType: provider.type,
      providerGroup: provider.groupKey,
      updatedFrom: "connection_center"
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

    const config = await prisma.tenantChannelConfig.upsert({
      where: { tenantId_channel: { tenantId: req.tenantId, channel: key } },
      create: {
        tenantId: req.tenantId,
        channel: key,
        ...data
      },
      update: data
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

    const config = await prisma.tenantChannelConfig.findUnique({
      where: { tenantId_channel: { tenantId: req.tenantId, channel: key } }
    });
    if (!config || !config.isActive) return res.status(400).json({ ok: false, error: "Conexion inactiva o no configurada" });

    const missing = [...missingEnv(provider), ...missingFields(provider, config)];
    const ok = missing.length === 0;
    const metadata = normalizeMetadata({
      ...configMetadata(config),
      lastTestedAt: new Date().toISOString(),
      lastTestStatus: ok ? "OK" : "ERROR",
      lastTestMessage: ok ? "Configuracion completa" : `Faltan campos: ${missing.join(", ")}`
    }, {});

    const updated = await prisma.tenantChannelConfig.update({
      where: { id: config.id },
      data: { metadata }
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

connectionsRouter.post("/connections/:key/disconnect", requireRole(ROLE_GROUPS.MANAGERS), async (req, res, next) => {
  try {
    const key = String(req.params.key || "").trim().toLowerCase();
    const provider = PROVIDER_BY_KEY.get(key);
    if (!provider) return res.status(404).json({ error: "Proveedor no soportado" });

    const config = await prisma.tenantChannelConfig.findUnique({
      where: { tenantId_channel: { tenantId: req.tenantId, channel: key } }
    });
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
    if (missing.length) return res.status(400).json({ error: "Faltan variables de entorno OAuth", missing });

    const url = buildOAuthUrl(req, provider);
    if (!url) return res.status(400).json({ error: "No se pudo construir URL OAuth" });
    res.json({ url, provider: key, oauthProvider: provider.oauthProvider });
  } catch (error) {
    next(error);
  }
});
