import { Router } from "express";
import { env } from "../lib/env.js";
import { normalizeMetaWebhook } from "../adapters/channel.adapter.js";
import { getOrCreateContact, getOrCreateOpenConversation, updateContactProfile } from "../services/conversation.service.js";
import { persistInboundMessage, processIncomingText } from "../services/message.service.js";
import { resolveTenantFromMetaWebhook } from "../services/meta-tenant.service.js";
import { isKnownVerifyToken } from "../services/tenant-channel-config.service.js";

export const metaRouter = Router();

metaRouter.get("/webhook", async (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && (token === env.verifyToken || await isKnownVerifyToken(token))) {
    return res.status(200).type("text/plain").send(challenge);
  }

  return res.sendStatus(403);
});

metaRouter.post("/webhook", async (req, res) => {
  // Meta requiere respuesta rápida. Procesamos en segundo plano.
  res.sendStatus(200);

  try {
    console.log("META RAW PAYLOAD:");
    console.log(JSON.stringify(req.body, null, 2));

    const incoming = normalizeMetaWebhook(req.body);
    if (!incoming) return;

    const { tenant, source, ids } = await resolveTenantFromMetaWebhook(req.body);
    console.log("META IDS:");
    console.log(ids);
    console.log("TENANT ENCONTRADO:");
    console.log(tenant);
    
    if (!tenant) {
      console.warn("Meta webhook sin tenant asociado", {
        channel: incoming.channel,
        ids
      });
      return;
    }

    if (source === "default_tenant_dev_fallback") {
      console.warn("Meta webhook usando fallback de desarrollo. Configura whatsappPhoneNumberId/instagramBusinessAccountId en Tenant antes de producción.", ids);
    }

    const contact = await getOrCreateContact({
      tenantId: tenant.id,
      externalId: incoming.externalUserId,
      channel: incoming.channel
    });

    await updateContactProfile({ contactId: contact.id, profile: incoming.profile });

    const conversation = await getOrCreateOpenConversation({ tenantId: tenant.id, contactId: contact.id });

    const { isDuplicate } = await persistInboundMessage({
      tenantId: tenant.id,
      conversationId: conversation.id,
      contactId: contact.id,
      channel: incoming.channel,
      content: incoming.content,
      externalMessageId: incoming.externalMessageId,
      type: incoming.type,
      rawPayload: incoming.raw
    });

    if (isDuplicate) return;

    await processIncomingText({
      tenant,
      conversation,
      contact,
      channel: incoming.channel,
      userMessage: incoming.content
    });
  } catch (error) {
    console.error("Meta webhook error:", error);
  }
});
