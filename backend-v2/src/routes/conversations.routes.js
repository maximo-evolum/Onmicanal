import { Router } from "express";
import { prisma } from "../lib/db.js";
import { releaseConversation, takeConversation } from "../services/conversation.service.js";
import { requireRole, ROLE_GROUPS } from "../middleware/tenant-access.js";

export const conversationsRouter = Router();

function channelDisplayNumber(config) {
  if (!config?.metadata || typeof config.metadata !== "object") return null;
  return config.metadata.displayNumber || config.metadata.whatsappDisplayNumber || null;
}

async function enrichConversation(conversation) {
  if (!conversation) return conversation;

  const channelConfig = await prisma.tenantChannelConfig.findFirst({
    where: {
      tenantId: conversation.tenantId,
      channel: conversation.contact?.channel || undefined,
      isActive: true
    },
    orderBy: { updatedAt: "desc" }
  });

  const lastMessage = await prisma.message.findFirst({
    where: { tenantId: conversation.tenantId, conversationId: conversation.id },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      direction: true,
      content: true,
      status: true,
      channel: true,
      createdAt: true
    }
  });

  const messageCount = await prisma.message.count({
    where: { tenantId: conversation.tenantId, conversationId: conversation.id }
  });

  return {
    ...conversation,
    channelConfig: channelConfig
      ? {
          id: channelConfig.id,
          channel: channelConfig.channel,
          label: channelConfig.label,
          phoneNumberId: channelConfig.phoneNumberId,
          businessAccountId: channelConfig.businessAccountId,
          externalAccountId: channelConfig.externalAccountId,
          displayNumber: channelDisplayNumber(channelConfig),
          isActive: channelConfig.isActive
        }
      : null,
    lastMessage,
    messageCount
  };
}

function conversationWhere(req) {
  const where = {};
  const requestedTenantId = req.query?.tenantId ? String(req.query.tenantId) : null;

  if (req.user?.role === "SUPER_ADMIN" && requestedTenantId) {
    where.tenantId = requestedTenantId;
  } else if (req.user?.role === "SUPER_ADMIN") {
    // El super admin puede auditar todas las conversaciones desde el inbox.
    // Los usuarios normales siguen aislados por tenant.
  } else {
    where.tenantId = req.tenantId;
  }

  if (req.query?.channel && req.query.channel !== "all") {
    where.contact = { channel: String(req.query.channel) };
  }

  // Por defecto no mostrar conversaciones eliminadas/cerradas en el inbox.
  if (!req.query?.includeClosed || req.query.includeClosed !== "true") {
    where.status = {
      notIn: ["CLOSED", "DELETED"]
    };
  }

  return where;
}

async function findAccessibleConversation(req, conversationId) {
  const where = { id: conversationId };
  if (req.user?.role !== "SUPER_ADMIN") {
    where.tenantId = req.tenantId;
  }

  return prisma.conversation.findFirst({
    where,
    include: { contact: true, assignedTo: true, lead: true, tenant: true }
  });
}

function effectiveTenantId(req, conversation) {
  return req.user?.role === "SUPER_ADMIN" ? conversation?.tenantId : req.tenantId;
}

conversationsRouter.get("/conversations", async (req, res) => {
  try {
    const conversations = await prisma.conversation.findMany({
      where: conversationWhere(req),
      include: { contact: true, assignedTo: true, lead: true, tenant: true },
      orderBy: [{ priorityScore: "desc" }, { lastMessageAt: "desc" }],
      take: 200
    });

    const enriched = await Promise.all(conversations.map(enrichConversation));
    res.json(enriched);
  } catch (error) {
    console.error("List conversations error:", error);
    res.status(500).json({ error: "No se pudieron obtener las conversaciones" });
  }
});

conversationsRouter.get("/conversations/:id/messages", async (req, res) => {
  try {
    const conversation = await findAccessibleConversation(req, req.params.id);

    if (!conversation) return res.status(404).json({ error: "Conversación no encontrada" });

    const messages = await prisma.message.findMany({
      where: { conversationId: req.params.id, tenantId: conversation.tenantId },
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

    const conversation = await findAccessibleConversation(req, req.params.id);
    if (!conversation) return res.status(404).json({ error: "Conversación no encontrada" });

    const tenantId = effectiveTenantId(req, conversation);
    const agent = await prisma.workspaceUser.findFirst({
      where: { id: agentId, tenantId, isActive: true }
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
    const conversation = await findAccessibleConversation(req, req.params.id);
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
    const conversation = await findAccessibleConversation(req, req.params.id);
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
    const conversation = await findAccessibleConversation(req, req.params.id);
    if (!conversation) return res.status(404).json({ error: "Conversación no encontrada" });

    // FIX REAL:
    // Antes solo cambiábamos status=CLOSED y la conversación reaparecía.
    // Ahora eliminamos completamente mensajes, memoria y conversación.
    await prisma.$transaction(async (tx) => {
      await tx.message.deleteMany({
        where: { conversationId: req.params.id }
      });

      // Compatibilidad con diferentes nombres de tabla de memoria.
      try {
        await tx.conversationMemory.deleteMany({
          where: { conversationId: req.params.id }
        });
      } catch (_) {}

      try {
        await tx.lead.deleteMany({
          where: { conversationId: req.params.id }
        });
      } catch (_) {}

      await tx.conversation.delete({
        where: { id: req.params.id }
      });
    });

    res.json({
      ok: true,
      deleted: true,
      conversationId: req.params.id
    });
  } catch (error) {
    console.error("Delete conversation error:", error);
    res.status(500).json({ error: "No se pudo eliminar la conversación" });
  }
});
