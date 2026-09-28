import { decryptSecret, encryptSecret } from "../lib/credential-crypto.js";
import { FinanceOperationError } from "./finance-integrity.service.js";

const fail = (message) => { throw new FinanceOperationError(409, message); };
const email = (s) => /^[^\s<>@,;\r\n]+@[^\s<>@,;\r\n]+\.[^\s<>@,;\r\n]+$/.test(s);
export function collectionRecipient(channel, value) {
  const recipient = String(value || "").trim();
  if (recipient.length > 254 || !(channel === "gmail" ? email(recipient) : channel === "whatsapp" && /^\+[1-9]\d{7,14}$/.test(recipient))) {
    throw new FinanceOperationError(422, "Indica un correo válido o un teléfono internacional con + y código de país.");
  }
  return recipient;
}

async function readProvider(fetcher, url, options = {}) {
  try {
    const response = await fetcher(url, { ...options, redirect: "error", signal: AbortSignal.timeout(8000) });
    const data = await response.json();
    if (!response.ok) fail("El proveedor rechazó la verificación del canal. Revisa la conexión y sus permisos.");
    return data;
  } catch (error) {
    if (error instanceof FinanceOperationError) throw error;
    fail("No se pudo verificar el canal. No se envió ningún mensaje; revisa la conexión.");
  }
}

// Preflight only. No messages here, and never use global/default-tenant tokens.
export async function prepareCollectionTransport(db, { tenantId, channel, templateName, language = "es" }, fetcher = fetch) {
  if (!["gmail", "whatsapp"].includes(channel)) fail("Este canal todavía no admite envíos efectivos de cobranza.");
  let config = await db.tenantChannelConfig.findFirst({ where: { tenantId, channel: { in: channel === "whatsapp" ? ["whatsapp", "meta_whatsapp"] : [channel] } }, orderBy: [{ updatedAt: "desc" }, { id: "asc" }] });
  if (!config?.isActive || !config?.accessToken) fail("Conecta y activa este canal para esta empresa antes de enviar.");
  let token;
  try { token = decryptSecret(config.accessToken); } catch { fail("No se pudo abrir la credencial. Vuelve a vincular el canal."); }
  if (channel === "gmail") {
    const expiry = Date.parse(config.metadata?.oauthExpiresAt || "");
    if (!Number.isFinite(expiry) || expiry < Date.now() + 60000) {
      let refresh; try { refresh = decryptSecret(config.verifyToken); } catch { /* handled below */ }
      if (!refresh || !process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) fail("Vuelve a vincular Gmail: falta una autorización renovable vigente.");
      const data = await readProvider(fetcher, "https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refresh, client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET }) });
      if (!data.access_token || !(Number(data.expires_in) > 60)) fail("Gmail no devolvió una autorización vigente.");
      token = data.access_token;
      // Conditional update avoids restoring a channel disconnected during refresh.
      const saved = await db.tenantChannelConfig.updateMany({ where: { id: config.id, tenantId, isActive: true, updatedAt: config.updatedAt }, data: { accessToken: encryptSecret(token), metadata: { ...config.metadata, oauthExpiresAt: new Date(Date.now() + Number(data.expires_in) * 1000).toISOString() } } });
      if (saved.count !== 1) fail("La conexión cambió. Actualiza la vista antes de enviar.");
      config = await db.tenantChannelConfig.findFirst({ where: { id: config.id, tenantId, isActive: true } });
      if (!config) fail("El canal se desconectó.");
    }
    const profile = await readProvider(fetcher, "https://gmail.googleapis.com/gmail/v1/users/me/profile", { headers: { Authorization: `Bearer ${token}` } });
    if (!email(String(profile.emailAddress || ""))) fail("Gmail no confirmó la cuenta remitente.");
    return { configId: config.id, configUpdatedAt: config.updatedAt, channel, sender: profile.emailAddress, token };
  }
  if (!/^\d+$/.test(config.phoneNumberId || "") || !/^\d+$/.test(config.businessAccountId || "")) fail("WhatsApp requiere el número y la cuenta de negocio de esta empresa.");
  if (!/^[a-z0-9_]{1,100}$/.test(templateName || "") || !/^[a-z]{2}(?:_[A-Z]{2})?$/.test(language)) fail("Indica el nombre y el idioma de una plantilla aprobada de cobranza.");
  const templates = await readProvider(fetcher, `https://graph.facebook.com/v23.0/${config.businessAccountId}/message_templates?name=${encodeURIComponent(templateName)}&limit=100`, { headers: { Authorization: `Bearer ${token}` } });
  const template = templates.data?.find((t) => t.name === templateName && t.language === language && t.status === "APPROVED");
  const components = template?.components || [];
  const body = components.find((c) => c.type === "BODY")?.text;
  // Only the documented four-value text template is supported. Never hide media/buttons in the preview.
  if (!body || components.some((c) => c.type !== "BODY" && c.type !== "FOOTER") || [1, 2, 3, 4].some((n) => !body.includes(`{{${n}}}`)) || /{{(?![1-4]}})/.test(body)) fail("Usa una plantilla aprobada de solo texto: {{1}} cliente, {{2}} documento, {{3}} saldo y {{4}} vencimiento. No se admiten botones ni encabezados en esta versión.");
  return { configId: config.id, configUpdatedAt: config.updatedAt, channel, sender: config.phoneNumberId, token, templateName, language, templateBody: body, footer: components.find((c) => c.type === "FOOTER")?.text || "" };
}

export async function dispatchCollectionMessage(transport, message, fetcher = fetch) {
  let url, payload;
  if (transport.channel === "gmail") {
    const mime = [`From: ${transport.sender}`, `To: ${message.recipient}`, `Subject: =?UTF-8?B?${Buffer.from(message.subject).toString("base64")}?=`, `Message-ID: <${message.id}@evolum.invalid>`, "MIME-Version: 1.0", 'Content-Type: text/plain; charset="UTF-8"', "Content-Transfer-Encoding: base64", "", Buffer.from(message.body).toString("base64").match(/.{1,76}/g).join("\r\n")].join("\r\n");
    url = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";
    payload = { raw: Buffer.from(mime).toString("base64url") };
  } else {
    url = `https://graph.facebook.com/v23.0/${transport.sender}/messages`;
    payload = { messaging_product: "whatsapp", to: message.recipient.slice(1), type: "template", template: { name: transport.templateName, language: { code: transport.language }, components: [{ type: "body", parameters: message.parameters.map((value) => ({ type: "text", text: value })) }] } };
  }
  // Exactly one attempt. A timeout/5xx may have sent the message already.
  try {
    const response = await fetcher(url, { method: "POST", redirect: "error", signal: AbortSignal.timeout(10000), headers: { Authorization: `Bearer ${transport.token}`, "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const data = await response.json().catch(() => ({}));
    const id = transport.channel === "gmail" ? data.id : data.messages?.[0]?.id;
    if (response.ok && typeof id === "string" && id) return { status: "ACCEPTED", providerMessageId: id.slice(0, 250), detail: "Aceptado por el proveedor. Esto no confirma entrega ni lectura." };
    if (response.status >= 400 && response.status < 500 && response.status !== 408) return { status: "REJECTED", detail: `El proveedor rechazó el envío (HTTP ${response.status}). Revisa el canal, destinatario o plantilla antes de preparar otro.` };
  } catch { /* Never leak provider bodies, credentials or contact data. */ }
  return { status: "UNKNOWN", detail: "Resultado por verificar en el proveedor. No reenvíes: el mensaje podría haber salido." };
}
