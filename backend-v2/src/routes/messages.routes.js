import { Router } from "express";
import { normalizeText } from "../lib/text.js";
import { prisma } from "../lib/db.js";
import { sendChannelMessage } from "../services/routing.service.js";
import { persistOutboundMessage } from "../services/message.service.js";
import { requireRole, ROLE_GROUPS } from "../middleware/tenant-access.js";

export const messagesRouter = Router();

messagesRouter.post("/messages/send", requireRole(ROLE_GROUPS.STAFF), async (req, res) => {
  try {
    const { conversationId, content } = req.body;
    const normalizedContent = normalizeText(content || "");

    if (!conversationId || !normalizedContent.trim()) {
      return res.status(400).json({ error: "conversationId y content son requeridos" });
    }

    const conversation = await prisma.conversation.findFirst({
      where: { id: conversationId, tenantId: req.tenantId },
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
      // En desarrollo local no siempre existe Meta configurado.
      // Guardamos igual el mensaje para que el inbox/simulador funcione.
      status = "FAILED";
      metadata = {
        devWarning: "No se pudo enviar por canal real, pero se guardó el mensaje.",
        error: error?.message || "channel_send_failed"
      };
      console.warn("Manual send channel warning:", error?.message || error);
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

    res.json(savedMessage);
  } catch (error) {
    console.error("Manual send error:", error);
    res.status(500).json({ error: "No se pudo enviar el mensaje" });
  }
});
