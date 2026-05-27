import { normalizeText } from "../lib/text.js";
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
    profile: {
      name: contactProfile?.profile?.name || null,
      username: null,
      profilePicUrl: null
    },
    raw: body
  };
}
