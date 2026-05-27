import { normalizeText } from "../lib/text.js";
export function parseInstagramPayload(body) {
  const entry = body?.entry?.[0];
  const messaging = entry?.messaging?.[0];

  if (!messaging?.sender?.id) return null;

  const senderId = messaging.sender.id;
  const message = messaging.message;
  if (!message) return null;

  let content = "";
  let type = "other";

  if (typeof message.text === "string" && message.text.trim()) {
    type = "text";
    content = normalizeText(message.text);
  } else if (message.attachments?.length) {
    const attachmentType = message.attachments[0]?.type || "attachment";
    if (attachmentType === "image") {
      type = "image";
      content = "[image]";
    } else if (attachmentType === "video") {
      type = "video";
      content = "[video]";
    } else if (attachmentType === "audio") {
      type = "audio";
      content = "[audio]";
    } else if (attachmentType === "file") {
      type = "file";
      content = "[file]";
    } else {
      type = "other";
      content = `[${attachmentType}]`;
    }
  } else {
    type = "other";
    content = "[instagram_event]";
  }

  return {
    channel: "instagram",
    channelAccountId: entry?.id || messaging?.recipient?.id || null,
    externalUserId: senderId,
    externalMessageId: message.mid || null,
    content,
    type,
    profile: {
      name: null,
      username: null,
      profilePicUrl: null
    },
    raw: body
  };
}
