
import { prisma } from "../lib/db.js";
import { detectEmotionSignals } from "./emotion.service.js";
import { detectObjection } from "./objection.service.js";
import { extractEventPreferences } from "./event-sales.service.js";
import { analyzeSalesSignals } from "./sales-brain.service.js";
import { enrichCustomerProfile } from "./customer-profile.service.js";

function mergeObjection(existing, next) {
  const arr = Array.isArray(existing) ? existing : [];
  if (!next || arr.includes(next)) return arr;
  return [...arr, next].slice(-8);
}

function buildSummary({ previous = "", message = "", prefs = {}, emotion = {}, objection = null }) {
  const parts = [];
  if (previous) parts.push(previous);
  if (prefs.guests) parts.push(`Evento para ${prefs.guests} personas`);
  if (prefs.location) parts.push(`Lugar/comuna: ${prefs.location}`);
  if (prefs.date) parts.push(`Fecha: ${prefs.date}`);
  if (prefs.scenario && prefs.scenario !== "general") parts.push(`Escenario: ${prefs.scenario}`);
  if (emotion.interestLevel >= 75) parts.push("Cliente con interés alto");
  if (emotion.urgencyLevel >= 70) parts.push("Cliente con urgencia alta");
  if (objection) parts.push(`Objeción detectada: ${objection}`);
  if (emotion.salesMode) parts.push(`Modo comercial: ${emotion.salesMode}`);
  if (Array.isArray(emotion.salesSignals) && emotion.salesSignals.length) parts.push(`Señales: ${emotion.salesSignals.join(", ")}`);
  if (!parts.length && message) parts.push(`Último mensaje: ${String(message).slice(0, 120)}`);
  return [...new Set(parts)].slice(-10).join(" · ");
}

export async function getConversationMemory(conversationId) {
  if (!conversationId) return null;
  return prisma.conversationMemory.findUnique({ where: { conversationId } });
}

export async function updateConversationMemory({ tenantId, conversationId, message, intent = null }) {
  if (!tenantId || !conversationId) return null;

  const current = await prisma.conversationMemory.findUnique({ where: { conversationId } });
  const prefs = extractEventPreferences(message);
  const emotion = detectEmotionSignals(message);
  const objection = detectObjection(message);
  const sales = analyzeSalesSignals({ message, memory: current });

  const customerProfile = enrichCustomerProfile({
    currentProfile: current?.customerProfile || {},
    message,
    memory: current,
    industry: sales?.industry || "general"
  });

  const data = {
    tenantId,
    conversationId,
    guests: prefs.guests ?? current?.guests ?? null,
    location: prefs.location ?? current?.location ?? null,
    date: prefs.date ?? current?.date ?? null,
    scenario: prefs.scenario || current?.scenario || "general",
    intent: intent || current?.intent || null,
    interestLevel: Math.max(current?.interestLevel || 0, emotion.interestLevel + (sales.interestBoost || 0)),
    urgencyLevel: Math.max(current?.urgencyLevel || 0, emotion.urgencyLevel + (sales.urgencyBoost || 0)),
    sentiment: emotion.sentiment !== "neutral" ? emotion.sentiment : (current?.sentiment || "neutral"),
    objections: mergeObjection(current?.objections, objection),
    customerProfile,
    summary: buildSummary({ previous: current?.summary, message, prefs, emotion, objection })
  };

  return prisma.conversationMemory.upsert({
    where: { conversationId },
    create: data,
    update: data
  });
}

export async function getConversationHistory(conversationId, take = 12) {
  const messages = await prisma.message.findMany({
    where: { conversationId },
    orderBy: { createdAt: "desc" },
    take
  });
  return messages.reverse().map((m) => ({
    role: m.direction === "INBOUND" ? "user" : "assistant",
    content: m.content
  }));
}
