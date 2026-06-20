import { normalizeText } from "../lib/text.js";

export function parseWhatsAppStatuses(body) {
  const value = body?.entry?.[0]?.changes?.[0]?.value;
  const statuses = Array.isArray(value?.statuses) ? value.statuses : [];

  return statuses.map((status) => ({
    channel: "whatsapp",
    channelAccountId: value?.metadata?.phone_number_id || null,
    displayPhoneNumber: value?.metadata?.display_phone_number || null,
    externalMessageId: status.id || null,
    recipientId: status.recipient_id || null,
    status: status.status || null,
    timestamp: status.timestamp || null,
    conversationId: status.conversation?.id || null,
    conversationOrigin: status.conversation?.origin?.type || null,
    pricingCategory: status.pricing?.category || null,
    pricingType: status.pricing?.pricing_model || null,
    errors: Array.isArray(status.errors) ? status.errors.map((error) => ({
      code: error.code || null,
      title: error.title || null,
      message: error.message || null,
      details: error.error_data?.details || null
    })) : [],
    raw: status
  }));
}

export function parseWhatsAppPayload(body) {
  const value = body?.entry?.[0]?.changes?.[0]?.value;
  const message = value?.messages?.[0];

  if (!message?.from) return null;

  let content = "";
  let type = "other";

  switch (message.type) {
    case "text":
      type = "text";
      content = normalizeText(message.text?.body || "");
      break;
    case "interactive": {
      type = "interactive";
      const button = message.interactive?.button_reply;
      const list = message.interactive?.list_reply;
      const selectedId = button?.id || list?.id || null;
      const selectedTitle = button?.title || list?.title || null;
      content = normalizeText(selectedTitle || selectedId || "[interactive]");
      break;
    }
    case "button":
      type = "interactive";
      content = normalizeText(message.button?.text || message.button?.payload || "[button]");
      break;
    case "image":
      type = "image";
      content = "[image]";
      break;
    case "audio":
      type = "audio";
      content = "[audio]";
      break;
    case "video":
      type = "video";
      content = "[video]";
      break;
    case "document":
      type = "file";
      content = "[document]";
      break;
    default:
      type = "other";
      content = `[${message.type || "unknown"}]`;
      break;
  }

  const contactProfile = value?.contacts?.[0];

  return {
    channel: "whatsapp",
    channelAccountId: value?.metadata?.phone_number_id || null,
    externalUserId: message.from,
    externalMessageId: message.id || null,
    content,
    type,
    interactive: message.type === "interactive" ? {
      id: message.interactive?.button_reply?.id || message.interactive?.list_reply?.id || null,
      title: message.interactive?.button_reply?.title || message.interactive?.list_reply?.title || null,
      type: message.interactive?.type || null
    } : null,
    profile: {
      name: contactProfile?.profile?.name || null,
      username: null,
      profilePicUrl: null
    },
    raw: body
  };
}
