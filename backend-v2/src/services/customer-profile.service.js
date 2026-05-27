import { prisma } from "../lib/db.js";
import { extractEventPreferences } from "./event-sales.service.js";
import { detectSalesObjection, analyzeSalesSignals } from "./sales-brain.service.js";

function uniquePush(list = [], value, max = 10) {
  const arr = Array.isArray(list) ? list : [];
  if (!value || arr.includes(value)) return arr.slice(-max);
  return [...arr, value].slice(-max);
}

function detectPriceSensitivity(message = "") {
  const text = String(message).toLowerCase();
  if (/car[oa]|precio|presupuesto|descuento|barato|econ[oó]mico|se me escapa|fuera de presupuesto/.test(text)) return "HIGH";
  if (/premium|mejor|calidad|exclusivo|empresa|matrimonio|lujo/.test(text)) return "LOW";
  return null;
}

function detectDecisionStyle(message = "") {
  const text = String(message).toLowerCase();
  if (/lo voy a pensar|despu[eé]s|no estoy seguro|tengo dudas/.test(text)) return "CAUTIOUS";
  if (/dale|hag[aá]moslo|lo quiero|quiero reservar|avancemos|perfecto/.test(text)) return "DECISIVE";
  if (/comparando|otra opci[oó]n|otro proveedor|en otro lado/.test(text)) return "COMPARING";
  return null;
}

function detectPreferredContact(message = "") {
  const text = String(message).toLowerCase();
  if (/whatsapp|wsp|wasap/.test(text)) return "WHATSAPP";
  if (/llamar|tel[eé]fono|llamada/.test(text)) return "CALL";
  if (/correo|email|mail/.test(text)) return "EMAIL";
  return null;
}

export function enrichCustomerProfile({ currentProfile = {}, message = "", memory = null, industry = "general" } = {}) {
  const prefs = extractEventPreferences(message);
  const objection = detectSalesObjection(message);
  const sales = analyzeSalesSignals({ message, memory, industry });
  const text = String(message || "");

  const next = {
    ...((currentProfile && typeof currentProfile === "object") ? currentProfile : {}),
    lastSignals: sales.signals || [],
    lastMode: sales.mode,
    lastUpdatedAt: new Date().toISOString()
  };

  if (prefs.guests) next.guests = prefs.guests;
  if (prefs.location) next.location = prefs.location;
  if (prefs.date) next.date = prefs.date;
  if (prefs.scenario && prefs.scenario !== "general") next.scenario = prefs.scenario;

  const priceSensitivity = detectPriceSensitivity(text);
  if (priceSensitivity) next.priceSensitivity = priceSensitivity;

  const decisionStyle = detectDecisionStyle(text);
  if (decisionStyle) next.decisionStyle = decisionStyle;

  const preferredContact = detectPreferredContact(text);
  if (preferredContact) next.preferredContact = preferredContact;

  if (objection?.type) {
    next.objectionHistory = uniquePush(next.objectionHistory, objection.type, 12);
    next.lastObjection = objection.type;
  }

  if (/empresa|corporativo|compa[nñ][ií]a|trabajo/i.test(text)) next.customerType = "BUSINESS";
  if (/matrimonio|boda/i.test(text)) next.customerType = "WEDDING";
  if (/cumple|fiesta|celebraci[oó]n/i.test(text)) next.customerType = "PARTY";

  if (/premium|mejor|calidad|experiencia|elegante/i.test(text)) {
    next.valueDrivers = uniquePush(next.valueDrivers, "premium_experience", 8);
  }
  if (/r[aá]pido|urgente|hoy|ma[nñ]ana|esta semana/i.test(text)) {
    next.valueDrivers = uniquePush(next.valueDrivers, "speed", 8);
  }
  if (/bar|dj|mobiliario|vajilla|postre/i.test(text)) {
    next.valueDrivers = uniquePush(next.valueDrivers, "extras", 8);
  }

  return next;
}

export async function updateCustomerProfile({ tenantId, conversationId, message = "", memory = null, industry = "general" } = {}) {
  if (!tenantId || !conversationId) return null;

  const current = memory || await prisma.conversationMemory.findUnique({ where: { conversationId } }).catch(() => null);
  const profile = enrichCustomerProfile({
    currentProfile: current?.customerProfile || {},
    message,
    memory: current,
    industry
  });

  const updated = await prisma.conversationMemory.upsert({
    where: { conversationId },
    create: {
      tenantId,
      conversationId,
      customerProfile: profile,
      summary: `Perfil iniciado: ${profile.lastMode || "DISCOVERY"}`
    },
    update: { customerProfile: profile }
  });

  return updated;
}

export function buildCustomerProfileContext(memory = null) {
  const profile = memory?.customerProfile || {};
  if (!profile || !Object.keys(profile).length) return "Sin perfil avanzado todavía.";

  return [
    profile.customerType ? `Tipo cliente: ${profile.customerType}` : null,
    profile.decisionStyle ? `Estilo decisión: ${profile.decisionStyle}` : null,
    profile.priceSensitivity ? `Sensibilidad precio: ${profile.priceSensitivity}` : null,
    profile.preferredContact ? `Contacto preferido: ${profile.preferredContact}` : null,
    profile.guests ? `Personas: ${profile.guests}` : null,
    profile.location ? `Lugar/comuna: ${profile.location}` : null,
    profile.date ? `Fecha: ${profile.date}` : null,
    Array.isArray(profile.valueDrivers) && profile.valueDrivers.length ? `Motivadores: ${profile.valueDrivers.join(", ")}` : null,
    Array.isArray(profile.objectionHistory) && profile.objectionHistory.length ? `Objeciones históricas: ${profile.objectionHistory.join(", ")}` : null,
    profile.lastMode ? `Último modo comercial: ${profile.lastMode}` : null
  ].filter(Boolean).join("\n");
}
