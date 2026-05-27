import { Router } from "express";
import { prisma } from "../lib/db.js";
import { releaseConversation, takeConversation } from "../services/conversation.service.js";
import { requireRole, ROLE_GROUPS } from "../middleware/tenant-access.js";

export const conversationsRouter = Router();

conversationsRouter.get("/conversations", async (req, res) => {
  try {
    const conversations = await prisma.conversation.findMany({
      where: { tenantId: req.tenantId },
      include: { contact: true, assignedTo: true, lead: true },
      orderBy: [{ priorityScore: "desc" }, { lastMessageAt: "desc" }]
    });

    res.json(conversations);
  } catch (error) {
    console.error("List conversations error:", error);
    res.status(500).json({ error: "No se pudieron obtener las conversaciones" });
  }
});

conversationsRouter.get("/conversations/:id/messages", async (req, res) => {
  try {
    const conversation = await prisma.conversation.findFirst({
      where: { id: req.params.id, tenantId: req.tenantId }
    });

    if (!conversation) return res.status(404).json({ error: "Conversación no encontrada" });

    const messages = await prisma.message.findMany({
      where: { conversationId: req.params.id, tenantId: req.tenantId },
      orderBy: { createdAt: "asc" }
    });

    res.json(messages);
  } catch (error) {
    console.error("Get messages error:", error);
    res.status(500).json({ error: "No se pudieron obtener los mensajes" });
  }
});

conversationsRouter.post("/conversations/:id/take", requireRole(ROLE_GROUPS.STAFF), async (req, res) => {
  try {
    const { agentId } = req.body;
    if (!agentId) return res.status(400).json({ error: "agentId es requerido" });

    const conversation = await prisma.conversation.findFirst({
      where: { id: req.params.id, tenantId: req.tenantId }
    });
    if (!conversation) return res.status(404).json({ error: "Conversación no encontrada" });

    const agent = await prisma.workspaceUser.findFirst({
      where: { id: agentId, tenantId: req.tenantId, isActive: true }
    });
    if (!agent) return res.status(400).json({ error: "Agente no válido para este tenant" });

    const updated = await takeConversation({ conversationId: req.params.id, agentId });
    res.json(updated);
  } catch (error) {
    console.error("Take conversation error:", error);
    res.status(500).json({ error: "No se pudo tomar la conversación" });
  }
});

conversationsRouter.post("/conversations/:id/release", requireRole(ROLE_GROUPS.STAFF), async (req, res) => {
  try {
    const conversation = await prisma.conversation.findFirst({
      where: { id: req.params.id, tenantId: req.tenantId }
    });
    if (!conversation) return res.status(404).json({ error: "Conversación no encontrada" });

    const updated = await releaseConversation({ conversationId: req.params.id });
    res.json(updated);
  } catch (error) {
    console.error("Release conversation error:", error);
    res.status(500).json({ error: "No se pudo liberar la conversación" });
  }
});

conversationsRouter.post("/conversations/:id/resolve", requireRole(ROLE_GROUPS.STAFF), async (req, res) => {
  try {
    const conversation = await prisma.conversation.findFirst({
      where: { id: req.params.id, tenantId: req.tenantId }
    });
    if (!conversation) return res.status(404).json({ error: "Conversación no encontrada" });

    const updated = await prisma.conversation.update({
      where: { id: req.params.id },
      data: {
        status: "RESOLVED",
        mode: "HUMAN"
      },
      include: {
        contact: true,
        assignedTo: true,
        lead: true
      }
    });

    res.json(updated);
  } catch (error) {
    console.error("Resolve conversation error:", error);
    res.status(500).json({ error: "No se pudo resolver la conversación" });
  }
});

conversationsRouter.delete("/conversations/:id", requireRole(ROLE_GROUPS.MANAGERS), async (req, res) => {
  try {
    const conversation = await prisma.conversation.findFirst({
      where: { id: req.params.id, tenantId: req.tenantId }
    });
    if (!conversation) return res.status(404).json({ error: "Conversación no encontrada" });

    await prisma.message.deleteMany({
      where: { conversationId: req.params.id, tenantId: req.tenantId }
    });

    await prisma.conversation.delete({
      where: { id: req.params.id }
    });

    res.json({ ok: true });
  } catch (error) {
    console.error("Delete conversation error:", error);
    res.status(500).json({ error: "No se pudo eliminar la conversación" });
  }
});
