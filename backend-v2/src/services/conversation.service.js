import { prisma } from "../lib/db.js";
import { env } from "../lib/env.js";
import { getIo } from "../lib/socket.js";
import { detectIntent } from "./intent.service.js";
import { extractEntities } from "./entity-extractor.service.js";
import { classifyPriority } from "./priority.service.js";


async function emitConversation(conversationId) {
  const io = getIo();

  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    include: { contact: true, assignedTo: true, lead: true }
  });

  if (!conversation) return;

  io.to(`conversation:${conversationId}`).emit("conversation:updated", conversation);
  io.emit("inbox:conversation-updated", conversation);
}

export async function updateConversationPriority({ conversationId, messageText }) {
  const text = (messageText || "").trim();

  if (!text) return null;

  const intent = await detectIntent({ message: text });
  const entities = await extractEntities({ message: text });
  const priority = classifyPriority({ intent, entities, message: text });

  const updated = await prisma.conversation.update({
    where: { id: conversationId },
    data: {
      priorityLabel: priority.label,
      priorityScore: priority.score,
      lastIntent: intent,
      lastConfidence: 0.8,
      decisionSummary: `Intent: ${intent}, score: ${priority.score}`
    }
  });

  await emitConversation(conversationId);

  return {
    conversation: updated,
    intent,
    entities,
    priority
  };
}

export async function getDefaultTenant() {
  let tenant = await prisma.tenant.findUnique({
    where: { slug: env.defaultTenantSlug }
  });

  if (!tenant) {
    tenant = await prisma.tenant.create({
      data: {
        name: "Demo Inmobiliaria",
        slug: env.defaultTenantSlug,
        businessPrompt: "Especialistas en departamentos y casas para venta y arriendo."
      }
    });
  }

  return tenant;
}

export async function getOrCreateContact({ tenantId, externalId, channel }) {
  const existing = await prisma.contact.findUnique({
    where: {
      tenantId_externalId_channel: {
        tenantId,
        externalId,
        channel
      }
    }
  });

  if (existing) return existing;

  return prisma.contact.create({
    data: { tenantId, externalId, channel }
  });
}

export async function updateContactProfile({ contactId, profile }) {
  if (!profile) return null;

  return prisma.contact.update({
    where: { id: contactId },
    data: {
      name: profile.name ?? undefined,
      username: profile.username ?? undefined,
      profilePicUrl: profile.profilePicUrl ?? undefined
    }
  });
}

export async function getOrCreateOpenConversation({ tenantId, contactId }) {
  const existing = await prisma.conversation.findFirst({
    where: {
      tenantId,
      contactId,
      status: { in: ["OPEN", "PENDING"] }
    },
    orderBy: { updatedAt: "desc" }
  });

  if (existing) return existing;

  const conversation = await prisma.conversation.create({
    data: {
      tenantId,
      contactId,
      status: "OPEN",
      mode: "BOT",
      priorityLabel: "medium",
      priorityScore: 50
    },
    include: { contact: true, assignedTo: true, lead: true }
  });

  getIo().emit("inbox:conversation-created", conversation);
  return conversation;
}

export async function takeConversation({ conversationId, agentId }) {
  const updated = await prisma.conversation.update({
    where: { id: conversationId },
    data: { mode: "HUMAN", assignedToId: agentId }
  });

  await emitConversation(conversationId);
  return updated;
}

export async function releaseConversation({ conversationId }) {
  const updated = await prisma.conversation.update({
    where: { id: conversationId },
    data: { mode: "BOT", assignedToId: null }
  });

  await emitConversation(conversationId);
  return updated;
}

export async function updateConversationAI({ conversationId, analysis }) {
  const updated = await prisma.conversation.update({
    where: { id: conversationId },
    data: {
      aiSummary: analysis.summary,
      aiNextAction: analysis.nextBestAction,
      aiSuggestedReply: analysis.suggestedReply,
      aiLeadScore: analysis.leadScore,
      aiReason: analysis.reason
    }
  });

  await emitConversation(conversationId);
  return updated;
}
