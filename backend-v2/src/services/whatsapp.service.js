import { env } from "../lib/env.js";
import { resolveOutboundChannelConfig } from "./tenant-channel-config.service.js";
import { traceError, traceStep } from "../lib/trace.js";

export async function sendWhatsAppText({ to, message, phoneNumberId, accessToken, tenant = null, tenantId = null, trace = null }) {
  const resolved = await resolveOutboundChannelConfig({ tenant, tenantId, channel: "whatsapp" });
  const effectivePhoneNumberId = phoneNumberId || resolved.phoneNumberId;
  const token = accessToken || resolved.accessToken || env.whatsappToken;

  traceStep(trace, "WHATSAPP_SEND_CONFIG", {
    to,
    effectivePhoneNumberId,
    hasToken: Boolean(token),
    tenantId: tenant?.id || tenantId || null
  });

  if (!effectivePhoneNumberId || !token) {
    throw new Error("WhatsApp no está configurado para este cliente/tenant");
  }

  const url = `https://graph.facebook.com/v23.0/${effectivePhoneNumberId}/messages`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body: message }
    })
  });

  const data = await response.json();
  traceStep(trace, "WHATSAPP_SEND_RESPONSE", {
    ok: response.ok,
    status: response.status,
    data
  });

  if (!response.ok) {
    console.error("WhatsApp send error:", data);
    const error = new Error(data?.error?.message || "Error enviando mensaje a WhatsApp");
    traceError(trace, "WHATSAPP_SEND_ERROR", error);
    throw error;
  }

  return data;
}


export async function sendWhatsAppInteractive({ to, payload, phoneNumberId, accessToken, tenant = null, tenantId = null, trace = null }) {
  const resolved = await resolveOutboundChannelConfig({ tenant, tenantId, channel: "whatsapp" });
  const effectivePhoneNumberId = phoneNumberId || resolved.phoneNumberId;
  const token = accessToken || resolved.accessToken || env.whatsappToken;

  traceStep(trace, "WHATSAPP_INTERACTIVE_SEND_CONFIG", {
    to,
    effectivePhoneNumberId,
    hasToken: Boolean(token),
    tenantId: tenant?.id || tenantId || null,
    interactiveType: payload?.interactive?.type || null
  });

  if (!effectivePhoneNumberId || !token) {
    throw new Error("WhatsApp no está configurado para este cliente/tenant");
  }

  const url = `https://graph.facebook.com/v23.0/${effectivePhoneNumberId}/messages`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const data = await response.json();
  traceStep(trace, "WHATSAPP_INTERACTIVE_SEND_RESPONSE", {
    ok: response.ok,
    status: response.status,
    data
  });

  if (!response.ok) {
    console.error("WhatsApp interactive send error:", data);
    const error = new Error(data?.error?.message || "Error enviando mensaje interactivo a WhatsApp");
    traceError(trace, "WHATSAPP_INTERACTIVE_SEND_ERROR", error);
    throw error;
  }

  return data;
}
