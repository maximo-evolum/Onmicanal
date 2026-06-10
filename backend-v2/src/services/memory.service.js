
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

function normalizeEventPrefs({ message = "", prefs = {}, current = null }) {
  const text = String(message || "").toLowerCase();
  const next = { ...prefs };

  // Si el cliente responde solo "15", "somos 15" o "para 15", y ya estamos en contexto de evento,
  // interpretarlo como cantidad de personas. Esto evita que la IA vuelva a preguntar.
  if (!next.guests) {
    const bareNumber = text.match(/^\s*(?:somos|para|ser[ií]amos|serian|serían)?\s*(\d{1,4})\s*$/i);
    const peopleNumber = text.match(/(?:somos|para|ser[ií]amos|serian|serían|unas|unos)\s*(\d{1,4})/i);
    const match = bareNumber || peopleNumber;
    if (match && (current?.guests || current?.location || current?.date || /evento|personas|cotiz|reserva|parrill|opci[oó]n|servicio/i.test(text))) {
      next.guests = Number(match[1]);
    }
  }

  // Fechas con día + número: "sábado 13", "sabado 13", "para el sábado 13".
  if (!next.date) {
    const dateMatch = text.match(/\b(lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo)\s*(\d{1,2})?\b/i);
    if (dateMatch) {
      next.date = `${dateMatch[1]}${dateMatch[2] ? ` ${dateMatch[2]}` : ""}`.replace("sabado", "sábado");
    }
  }

  // Servicio elegido: "opción 3", "la 3", "servicio mixto".
  let selectedService = current?.customerProfile?.selectedService || null;
  if (/(opci[oó]n\s*3|la\s*3|servicio\s*mixto|mixto)/i.test(text)) selectedService = "Servicio Mixto";
  else if (/(opci[oó]n\s*2|la\s*2|asado\s*al\s*plato)/i.test(text)) selectedService = "Asado al Plato";
  else if (/(opci[oó]n\s*1|la\s*1|c[oó]ctel|coctel\s*parrillero)/i.test(text)) selectedService = "Cóctel Parrillero";

  const extras = new Set(Array.isArray(current?.customerProfile?.extras) ? current.customerProfile.extras : []);
  if (/bar\s*abierto/i.test(text)) extras.add("bar abierto");
  if (/\bdj\b|m[uú]sica/i.test(text)) extras.add("DJ");
  if (/postres?/i.test(text)) extras.add("postres");
  if (/mobiliario|sillas|mesas/i.test(text)) extras.add("mobiliario");
  if (/vajilla/i.test(text)) extras.add("vajilla");
  if (/decoraci[oó]n/i.test(text)) extras.add("decoración");

  return {
    prefs: next,
    selectedService,
    extras: [...extras]
  };
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
  const rawPrefs = extractEventPreferences(message);
  const { prefs, selectedService, extras } = normalizeEventPrefs({ message, prefs: rawPrefs, current });
  const emotion = detectEmotionSignals(message);
  const objection = detectObjection(message);
  const sales = analyzeSalesSignals({ message, memory: current });

  const customerProfile = {
    ...enrichCustomerProfile({
      currentProfile: current?.customerProfile || {},
      message,
      memory: current,
      industry: sales?.industry || "general"
    }),
    ...(selectedService ? { selectedService } : {}),
    ...(extras.length ? { extras } : {})
  };

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
