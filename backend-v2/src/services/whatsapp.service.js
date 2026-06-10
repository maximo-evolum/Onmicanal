import { env } from "../lib/env.js";
import { resolveOutboundChannelConfig } from "./tenant-channel-config.service.js";
import { traceError, traceStep } from "../lib/trace.js";
import { fetchJsonWithRetry } from "./stability.service.js";

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

  try {
    const { response, data } = await fetchJsonWithRetry(url, {
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
    }, {
      retries: 2,
      timeoutMs: 15000,
      label: "whatsapp_send",
      trace,
      traceStep
    });

    traceStep(trace, "WHATSAPP_SEND_RESPONSE", {
      ok: response.ok,
      status: response.status,
      data
    });

    return data;
  } catch (error) {
    console.error("WhatsApp send error:", error?.data || error);
    traceError(trace, "WHATSAPP_SEND_ERROR", error);
    throw error;
  }
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

  try {
    const { response, data } = await fetchJsonWithRetry(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    }, {
      retries: 2,
      timeoutMs: 15000,
      label: "whatsapp_interactive_send",
      trace,
      traceStep
    });

    traceStep(trace, "WHATSAPP_INTERACTIVE_SEND_RESPONSE", {
      ok: response.ok,
      status: response.status,
      data
    });

    return data;
  } catch (error) {
    console.error("WhatsApp interactive send error:", error?.data || error);
    traceError(trace, "WHATSAPP_INTERACTIVE_SEND_ERROR", error);
    throw error;
  }
}
