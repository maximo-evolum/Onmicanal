import { Router } from "express";
import { normalizeText } from "../lib/text.js";
import { prisma } from "../lib/db.js";
import { sendChannelMessage } from "../services/routing.service.js";
import { persistOutboundMessage } from "../services/message.service.js";
import { requireRole, ROLE_GROUPS } from "../middleware/tenant-access.js";

export const messagesRouter = Router();

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
      return res.status(404).json({ error: "Conversación no encontrada" });
    }

    let status = "SENT";
    let metadata = null;

    try {
      await sendChannelMessage({
        channel: conversation.contact.channel,
        to: conversation.contact.externalId,
        message: normalizedContent,
        tenant: conversation.tenant
      });
    } catch (error) {
      // Guardamos igual el mensaje para que el historial del Inbox no se pierda.
      // En producción el status FAILED permite auditar si Meta/API falló.
      status = "FAILED";
      metadata = {
        devWarning: "No se pudo enviar por canal real, pero se guardó el mensaje.",
        error: error?.message || "channel_send_failed"
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
      metadata
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

// Ruta histórica usada por el frontend del Inbox.
messagesRouter.post("/messages/send", requireRole(ROLE_GROUPS.STAFF), sendManualMessageHandler);

// Alias robustos para evitar 404 si alguna vista usa otra convención.
messagesRouter.post("/messages", requireRole(ROLE_GROUPS.STAFF), sendManualMessageHandler);
messagesRouter.post("/conversations/:id/messages", requireRole(ROLE_GROUPS.STAFF), sendManualMessageHandler);
messagesRouter.post("/conversations/:conversationId/reply", requireRole(ROLE_GROUPS.STAFF), sendManualMessageHandler);
