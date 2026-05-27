import { parseWhatsAppPayload } from "./whatsapp.adapter.js";
import { parseInstagramPayload } from "./instagram.adapter.js";

export function normalizeMetaWebhook(body) {
  const whatsappMessage = parseWhatsAppPayload(body);
  if (whatsappMessage) return whatsappMessage;

  const instagramMessage = parseInstagramPayload(body);
  if (instagramMessage) return instagramMessage;

  return null;
}
