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
    traceStep(trace, "WHATSAPP_SEND_ACCEPTED", {
      to,
      contactWaIds: Array.isArray(data?.contacts) ? data.contacts.map((contact) => contact.wa_id || contact.input || null).filter(Boolean) : [],
      messageIds: Array.isArray(data?.messages) ? data.messages.map((message) => message.id || null).filter(Boolean) : [],
      messageStatuses: Array.isArray(data?.messages) ? data.messages.map((message) => message.message_status || null).filter(Boolean) : []
    });

    return data;
  } catch (error) {
    console.error("WhatsApp send error:", error?.data || error);
    traceError(trace, "WHATSAPP_SEND_ERROR", error);
    throw error;
  }
}

export async function sendWhatsAppImage({ to, imageUrl, caption = "", phoneNumberId, accessToken, tenant = null, tenantId = null, trace = null }) {
  const resolved = await resolveOutboundChannelConfig({ tenant, tenantId, channel: "whatsapp" });
  const effectivePhoneNumberId = phoneNumberId || resolved.phoneNumberId;
  const token = accessToken || resolved.accessToken || env.whatsappToken;

  traceStep(trace, "WHATSAPP_IMAGE_SEND_CONFIG", {
    to,
    imageUrl,
    effectivePhoneNumberId,
    hasToken: Boolean(token),
    tenantId: tenant?.id || tenantId || null
  });

  if (!effectivePhoneNumberId || !token) {
    throw new Error("WhatsApp no esta configurado para este cliente/tenant");
  }

  if (!/^https?:\/\//i.test(String(imageUrl || ""))) {
    throw new Error("WhatsApp requiere una URL publica http(s) para enviar imagen de campana");
  }

  const url = `https://graph.facebook.com/v23.0/${effectivePhoneNumberId}/messages`;
  const payload = {
    messaging_product: "whatsapp",
    to,
    type: "image",
    image: {
      link: imageUrl,
      ...(caption ? { caption: String(caption).slice(0, 1024) } : {})
    }
  };

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
      label: "whatsapp_image_send",
      trace,
      traceStep
    });

    traceStep(trace, "WHATSAPP_IMAGE_SEND_RESPONSE", {
      ok: response.ok,
      status: response.status,
      data
    });

    return data;
  } catch (error) {
    console.error("WhatsApp image send error:", error?.data || error);
    traceError(trace, "WHATSAPP_IMAGE_SEND_ERROR", error);
    throw error;
  }
}

export async function sendWhatsAppTemplate({
  to,
  templateName,
  languageCode = "es",
  parameters = [],
  phoneNumberId,
  accessToken,
  tenant = null,
  tenantId = null,
  trace = null
}) {
  const resolved = await resolveOutboundChannelConfig({ tenant, tenantId, channel: "whatsapp" });
  const effectivePhoneNumberId = phoneNumberId || resolved.phoneNumberId;
  const token = accessToken || resolved.accessToken || env.whatsappToken;

  traceStep(trace, "WHATSAPP_TEMPLATE_SEND_CONFIG", {
    to,
    templateName,
    languageCode,
    effectivePhoneNumberId,
    hasToken: Boolean(token),
    tenantId: tenant?.id || tenantId || null
  });

  if (!effectivePhoneNumberId || !token) {
    throw new Error("WhatsApp no esta configurado para este cliente/tenant");
  }

  if (!templateName) {
    throw new Error("templateName es requerido");
  }

  const bodyParameters = parameters
    .filter((value) => value !== undefined && value !== null)
    .map((value) => ({ type: "text", text: String(value) }));

  const url = `https://graph.facebook.com/v23.0/${effectivePhoneNumberId}/messages`;
  const payload = {
    messaging_product: "whatsapp",
    to,
    type: "template",
    template: {
      name: templateName,
      language: { code: languageCode },
      ...(bodyParameters.length
        ? { components: [{ type: "body", parameters: bodyParameters }] }
        : {})
    }
  };

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
      label: "whatsapp_template_send",
      trace,
      traceStep
    });

    traceStep(trace, "WHATSAPP_TEMPLATE_SEND_RESPONSE", {
      ok: response.ok,
      status: response.status,
      data
    });

    return data;
  } catch (error) {
    console.error("WhatsApp template send error:", error?.data || error);
    traceError(trace, "WHATSAPP_TEMPLATE_SEND_ERROR", error);
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
