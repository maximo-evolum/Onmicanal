import { env } from "../lib/env.js";
import { resolveOutboundChannelConfig } from "./tenant-channel-config.service.js";

export async function sendWhatsAppText({ to, message, phoneNumberId, accessToken, tenant = null, tenantId = null }) {
  const resolved = await resolveOutboundChannelConfig({ tenant, tenantId, channel: "whatsapp" });
  const effectivePhoneNumberId = phoneNumberId || resolved.phoneNumberId;
  const token = accessToken || resolved.accessToken || env.whatsappToken;

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
  if (!response.ok) {
    console.error("WhatsApp send error:", data);
    throw new Error(data?.error?.message || "Error enviando mensaje a WhatsApp");
  }

  return data;
}
