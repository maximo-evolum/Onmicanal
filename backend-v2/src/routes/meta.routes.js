import { Router } from "express";
import { env } from "../lib/env.js";
import { normalizeMetaWebhook } from "../adapters/channel.adapter.js";
import { getOrCreateContact, getOrCreateOpenConversation, updateContactProfile } from "../services/conversation.service.js";
import { persistInboundMessage, processIncomingText } from "../services/message.service.js";
import { resolveTenantFromMetaWebhook } from "../services/meta-tenant.service.js";
import { isKnownVerifyToken } from "../services/tenant-channel-config.service.js";
import { createTrace, summarizeMetaPayload, traceError, traceStep } from "../lib/trace.js";

export const metaRouter = Router();

metaRouter.get("/webhook", async (req, res) => {
  const trace = createTrace("META_VERIFY");
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  traceStep(trace, "GET /webhook verification received", {
    mode,
    tokenReceived: Boolean(token),
    tokenMatchesEnv: token === env.verifyToken,
    hasChallenge: Boolean(challenge)
  });

  if (mode === "subscribe" && (token === env.verifyToken || await isKnownVerifyToken(token))) {
    traceStep(trace, "WEBHOOK_VERIFIED_OK");
    return res.status(200).type("text/plain").send(challenge);
  }

  traceStep(trace, "WEBHOOK_VERIFICATION_FORBIDDEN");
  return res.sendStatus(403);
});

metaRouter.post("/webhook", async (req, res) => {
  // Meta requiere respuesta rápida. Respondemos 200 y procesamos en segundo plano.
  res.sendStatus(200);

  const trace = createTrace("META_POST");

  try {
    traceStep(trace, "1_WEBHOOK_RECEIVED", summarizeMetaPayload(req.body));
    traceStep(trace, "1B_META_RAW_PAYLOAD", req.body);

    const incoming = normalizeMetaWebhook(req.body);
    traceStep(trace, "2_NORMALIZED_INCOMING", incoming ? {
      channel: incoming.channel,
      channelAccountId: incoming.channelAccountId,
      externalUserId: incoming.externalUserId,
      externalMessageId: incoming.externalMessageId,
      type: incoming.type,
      content: incoming.content,
      profile: incoming.profile
    } : null);

    if (!incoming) {
      traceStep(trace, "2_STOP_NO_INCOMING_MESSAGE");
      return;
    }

    const { tenant, source, ids } = await resolveTenantFromMetaWebhook(req.body);
    traceStep(trace, "3_TENANT_RESOLUTION_RESULT", {
      source,
      ids,
      tenant: tenant ? {
        id: tenant.id,
        slug: tenant.slug,
        name: tenant.name,
        whatsappPhoneNumberId: tenant.whatsappPhoneNumberId,
        instagramBusinessAccountId: tenant.instagramBusinessAccountId
      } : null
    });

    if (!tenant) {
      console.warn("Meta webhook sin tenant asociado", {
        traceId: trace.id,
        channel: incoming.channel,
        ids
      });
      traceStep(trace, "3_STOP_TENANT_NOT_FOUND");
      return;
    }

    if (source === "default_tenant_dev_fallback") {
      console.warn("Meta webhook usando fallback de desarrollo. Configura whatsappPhoneNumberId/instagramBusinessAccountId en Tenant antes de producción.", {
        traceId: trace.id,
        ids
      });
    }

    traceStep(trace, "4_CONTACT_GET_OR_CREATE_START");
    const contact = await getOrCreateContact({
      tenantId: tenant.id,
      externalId: incoming.externalUserId,
      channel: incoming.channel
    });
    traceStep(trace, "4_CONTACT_OK", {
      id: contact.id,
      externalId: contact.externalId,
      channel: contact.channel
    });

    traceStep(trace, "5_CONTACT_PROFILE_UPDATE_START", incoming.profile);
    await updateContactProfile({ contactId: contact.id, profile: incoming.profile });
    traceStep(trace, "5_CONTACT_PROFILE_UPDATE_OK");

    traceStep(trace, "6_CONVERSATION_GET_OR_CREATE_START");
    const conversation = await getOrCreateOpenConversation({ tenantId: tenant.id, contactId: contact.id });
    traceStep(trace, "6_CONVERSATION_OK", {
      id: conversation.id,
      status: conversation.status,
      mode: conversation.mode
    });

    traceStep(trace, "7_PERSIST_INBOUND_START");
    const { message, isDuplicate } = await persistInboundMessage({
      tenantId: tenant.id,
      conversationId: conversation.id,
      contactId: contact.id,
      channel: incoming.channel,
      content: incoming.content,
      externalMessageId: incoming.externalMessageId,
      type: incoming.type,
      rawPayload: incoming.raw,
      trace
    });

    traceStep(trace, "7_PERSIST_INBOUND_OK", {
      messageId: message?.id,
      isDuplicate
    });

    if (isDuplicate) {
      traceStep(trace, "7_STOP_DUPLICATE_MESSAGE");
      return;
    }

    traceStep(trace, "8_PROCESS_INCOMING_TEXT_START");
    const result = await processIncomingText({
      tenant,
      conversation,
      contact,
      channel: incoming.channel,
      userMessage: incoming.content,
      trace
    });
    traceStep(trace, "8_PROCESS_INCOMING_TEXT_DONE", result);
  } catch (error) {
    traceError(trace, "META_WEBHOOK_ERROR", error);
  }
});
