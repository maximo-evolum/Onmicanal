import { env } from "../lib/env.js";
import { resolveOutboundChannelConfig } from "./tenant-channel-config.service.js";
import { traceError, traceStep } from "../lib/trace.js";

export async function sendInstagramText({ to, message, instagramBusinessAccountId, accessToken, tenant = null, tenantId = null, trace = null }) {
  const resolved = await resolveOutboundChannelConfig({ tenant, tenantId, channel: "instagram" });
  const effectiveBusinessId = instagramBusinessAccountId || resolved.instagramBusinessAccountId;
  const token = accessToken || resolved.accessToken || env.metaAccessToken;

  if (!effectiveBusinessId || !token) {
    throw new Error("Instagram no está configurado para este cliente/tenant");
  }

  const url = `https://graph.facebook.com/v23.0/${effectiveBusinessId}/messages`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      recipient: { id: to },
      message: { text: message }
    })
  });

  const data = await response.json();
  traceStep(trace, "INSTAGRAM_SEND_RESPONSE", {
    ok: response.ok,
    status: response.status,
    data
  });

  if (!response.ok) {
    console.error("Instagram send error:", data);
    const error = new Error(data?.error?.message || "Error enviando mensaje a Instagram");
    traceError(trace, "INSTAGRAM_SEND_ERROR", error);
    throw error;
  }

  return data;
}
