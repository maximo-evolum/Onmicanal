import { Router } from "express";
import { normalizeText } from "../lib/text.js";
import { prisma } from "../lib/db.js";
import { sendChannelMessage } from "../services/routing.service.js";
import { sendWhatsAppTemplate } from "../services/whatsapp.service.js";
import { persistOutboundMessage } from "../services/message.service.js";
import { requireRole, ROLE_GROUPS } from "../middleware/tenant-access.js";

export const messagesRouter = Router();

const DEFAULT_REENGAGEMENT_TEMPLATE = "reactivar_conversacion_evolum";
const DEFAULT_REENGAGEMENT_LANGUAGE = "es";

async function sendManualMessageHandler(req, res) {
  try {
    const conversationId = req.body?.conversationId || req.params?.id || req.params?.conversationId;
    const { content } = req.body || {};
    const normalizedContent = normalizeText(content || "");

    if (!conversationId || !normalizedContent.trim()) {
      return res.status(400).json({ error: "conversationId y content son requeridos" });
    }

    const where = { id: conversationId };
    if (req.user?.role !== "SUPER_ADMIN") {
      where.tenantId = req.tenantId;
    }

    const conversation = await prisma.conversation.findFirst({
      where,
      include: { contact: true, tenant: true }
    });

    if (!conversation) {
      return res.status(404).json({ error: "Conversacion no encontrada" });
    }

    let status = "SENT";
    let metadata = null;
    let externalMessageId = null;
    let rawPayload = null;
    let errorMessage = null;

    try {
      const sendResult = await sendChannelMessage({
        channel: conversation.contact.channel,
        to: conversation.contact.externalId,
        message: normalizedContent,
        tenant: conversation.tenant
      });

      rawPayload = sendResult || null;
      externalMessageId = Array.isArray(sendResult?.messages)
        ? sendResult.messages.map((message) => message.id).filter(Boolean)[0] || null
        : null;
      metadata = {
        metaAccepted: true,
        recipient: conversation.contact.externalId,
        contactWaIds: Array.isArray(sendResult?.contacts)
          ? sendResult.contacts.map((contact) => contact.wa_id || contact.input || null).filter(Boolean)
          : []
      };
    } catch (error) {
      status = "FAILED";
      errorMessage = error?.message || "channel_send_failed";
      metadata = {
        devWarning: "No se pudo enviar por canal real, pero se guardo el mensaje.",
        error: errorMessage,
        providerData: error?.data || null
      };
      console.warn("[MANUAL_SEND_CHANNEL_WARNING]", {
        conversationId,
        tenantId: conversation.tenantId,
        channel: conversation.contact.channel,
        to: conversation.contact.externalId,
        error: error?.message || error
      });
    }

    const savedMessage = await persistOutboundMessage({
      tenantId: conversation.tenantId,
      conversationId: conversation.id,
      contactId: conversation.contactId,
      channel: conversation.contact.channel,
      content: normalizedContent,
      status,
      metadata,
      externalMessageId,
      rawPayload,
      errorMessage
    });

    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { lastMessageAt: new Date(), mode: "HUMAN" }
    });

    return res.json(savedMessage);
  } catch (error) {
    console.error("[MANUAL_SEND_ERROR]", error);
    return res.status(500).json({ error: "No se pudo enviar el mensaje" });
  }
}

async function sendReengagementTemplateHandler(req, res) {
  try {
    const conversationId = req.body?.conversationId || req.params?.id || req.params?.conversationId;
    const templateName = normalizeText(req.body?.templateName || DEFAULT_REENGAGEMENT_TEMPLATE);
    const languageCode = normalizeText(req.body?.languageCode || DEFAULT_REENGAGEMENT_LANGUAGE);

    if (!conversationId) {
      return res.status(400).json({ error: "conversationId es requerido" });
    }

    const where = { id: conversationId };
    if (req.user?.role !== "SUPER_ADMIN") {
      where.tenantId = req.tenantId;
    }

    const conversation = await prisma.conversation.findFirst({
      where,
      include: { contact: true, tenant: true }
    });

    if (!conversation) {
      return res.status(404).json({ error: "Conversacion no encontrada" });
    }

    if (conversation.contact.channel !== "whatsapp") {
      return res.status(400).json({ error: "La reactivacion por plantilla solo aplica a WhatsApp" });
    }

    let status = "SENT";
    let metadata = null;
    let externalMessageId = null;
    let rawPayload = null;
    let errorMessage = null;
    const contactName = conversation.contact.name || conversation.contact.externalId || "cliente";
    const tenantName = conversation.tenant.name || "EVOLUM";
    const content = `Plantilla enviada: ${templateName}`;

    try {
      const sendResult = await sendWhatsAppTemplate({
        to: conversation.contact.externalId,
        templateName,
        languageCode,
        parameters: [contactName, tenantName],
        tenant: conversation.tenant
      });

      rawPayload = sendResult || null;
      externalMessageId = Array.isArray(sendResult?.messages)
        ? sendResult.messages.map((message) => message.id).filter(Boolean)[0] || null
        : null;
      metadata = {
        templateName,
        languageCode,
        recipient: conversation.contact.externalId,
        contactWaIds: Array.isArray(sendResult?.contacts)
          ? sendResult.contacts.map((contact) => contact.wa_id || contact.input || null).filter(Boolean)
          : []
      };
    } catch (error) {
      status = "FAILED";
      errorMessage = error?.data?.error?.message || error?.message || "template_send_failed";
      metadata = {
        templateName,
        languageCode,
        error: errorMessage,
        providerData: error?.data || null
      };
      console.warn("[REENGAGEMENT_TEMPLATE_WARNING]", {
        conversationId,
        tenantId: conversation.tenantId,
        to: conversation.contact.externalId,
        templateName,
        error: errorMessage
      });
    }

    const savedMessage = await persistOutboundMessage({
      tenantId: conversation.tenantId,
      conversationId: conversation.id,
      contactId: conversation.contactId,
      channel: conversation.contact.channel,
      content,
      status,
      metadata,
      externalMessageId,
      rawPayload,
      errorMessage
    });

    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { lastMessageAt: new Date(), mode: status === "SENT" ? "BOT" : conversation.mode }
    });

    return res.json(savedMessage);
  } catch (error) {
    console.error("[REENGAGEMENT_TEMPLATE_ERROR]", error);
    return res.status(500).json({ error: "No se pudo enviar la plantilla" });
  }
}

// Ruta histórica usada por el frontend del Inbox.
messagesRouter.post("/messages/send", requireRole(ROLE_GROUPS.STAFF), sendManualMessageHandler);
messagesRouter.post("/messages/reengage", requireRole(ROLE_GROUPS.STAFF), sendReengagementTemplateHandler);

// Alias robustos para evitar 404 si alguna vista usa otra convención.
messagesRouter.post("/messages", requireRole(ROLE_GROUPS.STAFF), sendManualMessageHandler);
messagesRouter.post("/conversations/:id/messages", requireRole(ROLE_GROUPS.STAFF), sendManualMessageHandler);
messagesRouter.post("/conversations/:conversationId/reply", requireRole(ROLE_GROUPS.STAFF), sendManualMessageHandler);
messagesRouter.post("/conversations/:conversationId/reengage", requireRole(ROLE_GROUPS.STAFF), sendReengagementTemplateHandler);
