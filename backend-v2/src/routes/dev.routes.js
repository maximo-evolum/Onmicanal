import { Router } from "express";
import jwt from "jsonwebtoken";
import { env } from "../lib/env.js";
import { prisma } from "../lib/db.js";
import { detectIntent } from "../services/intent.service.js";
import { extractEntities } from "../services/entity-extractor.service.js";
import { classifyPriority } from "../services/priority.service.js";
import { generateExpertAnalysis } from "../services/ai-expert.service.js";
import { generateSalesReply } from "../services/ai.service.js";
import { isAltaBrasaTenant } from "../services/business-knowledge.service.js";
import {
  getDefaultTenant,
  getOrCreateContact,
  getOrCreateOpenConversation,
  updateContactProfile
} from "../services/conversation.service.js";
import { persistInboundMessage, processIncomingText } from "../services/message.service.js";

export const devRouter = Router();

function getOptionalUser(req) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) return null;
  try {
    return jwt.verify(auth.replace("Bearer ", ""), env.jwtSecret);
  } catch {
    return null;
  }
}

function looksLikeAltaBrasaQuestion(message = "") {
  return /(alta\s*brasa|parrill|asado|carnes?|angus|coctel|cóctel|mixto|matrimonio|boda|dj|bar abierto|vajilla|mobiliario|postres|evento|eventos)/i.test(String(message || ""));
}

async function getTenantForDevRequest(req) {
  const body = req.body || {};

  if (body.tenantId) {
    const tenant = await prisma.tenant.findUnique({ where: { id: String(body.tenantId) } });
    if (tenant) return tenant;
  }

  if (body.tenantSlug) {
    const tenant = await prisma.tenant.findUnique({ where: { slug: String(body.tenantSlug) } });
    if (tenant) return tenant;
  }

  // BotLab suele usarse desde SUPER_ADMIN, que no tiene tenantId.
  // Para preguntas de parrilladas forzamos el tenant demo correcto para que pruebe
  // exactamente la base de conocimiento de Eventos Alta Brasa.
  if (looksLikeAltaBrasaQuestion(body.message)) {
    const bbqTenant = await prisma.tenant.findUnique({ where: { slug: "demo-parrilladas" } });
    if (bbqTenant) return bbqTenant;
  }

  const user = getOptionalUser(req);
  if (user?.tenantId) {
    const tenant = await prisma.tenant.findUnique({ where: { id: user.tenantId } });
    if (tenant) return tenant;
  }

  return getDefaultTenant();
}

function buildReasonSummary({ intent, entities, priority, usedAI }) {
  const reasons = [];

  if (usedAI) reasons.push("usó IA experta");
  if (entities?.commune) reasons.push(`comuna: ${entities.commune}`);
  if (entities?.budget) reasons.push(`presupuesto: ${entities.budget}`);
  if (entities?.interest) reasons.push(`interés: ${entities.interest}`);
  if (entities?.propertyType) reasons.push(`tipo: ${entities.propertyType}`);
  reasons.push(`intención: ${intent}`);

  return `Prioridad ${priority.label} (${priority.score}). ${reasons.join(", ")}.`;
}

devRouter.post("/dev/test-bot", async (req, res) => {
  try {
    const { message, channel = "whatsapp" } = req.body;
    const cleanMessage = String(message || "").trim();

    if (!cleanMessage) {
      const intent = "other";
      const entities = {};
      const priority = { score: 0, label: "low" };

      return res.json({
        reply: "Escribe un mensaje para probar el bot 😊",
        debug: {
          channel,
          matchedRule: null,
          usedAI: false,
          intent,
          entities,
          priority,
          confidence: 0.5,
          suggestedNextAction: "write_test_message",
          reasonSummary: "Sin mensaje de prueba."
        }
      });
    }

    const tenant = await getTenantForDevRequest(req);

    const [intent, entities, analysis, salesReply] = await Promise.all([
      detectIntent({ message: cleanMessage }),
      extractEntities({ message: cleanMessage }),
      generateExpertAnalysis({ tenantId: tenant.id, message: cleanMessage }),
      generateSalesReply({
        tenantId: tenant.id,
        tenantName: tenant.name,
        businessPrompt: tenant.businessPrompt,
        userMessage: cleanMessage,
        tenant
      })
    ]);

    const priority = classifyPriority({ intent, entities, message: cleanMessage });

    return res.json({
      reply: salesReply || analysis?.suggestedReply || "Hola 👋 estoy aquí para ayudarte. Cuéntame un poco más.",
      debug: {
        channel,
        tenant: { id: tenant.id, name: tenant.name, slug: tenant.slug, isAltaBrasa: isAltaBrasaTenant(tenant) },
        matchedRule: null,
        usedAI: true,
        intent,
        entities,
        priority,
        confidence: 0.8,
        suggestedNextAction:
          analysis?.nextBestAction ||
          (priority.label === "high" ? "qualify_and_schedule" : "continue_qualification"),
        reasonSummary:
          analysis?.reason ||
          buildReasonSummary({ intent, entities, priority, usedAI: true })
      }
    });
  } catch (error) {
    console.error("BOT LAB ERROR:", error);

    return res.json({
      reply: "Hola 👋 estoy aquí para ayudarte. ¿Qué necesitas resolver hoy?",
      debug: {
        channel: req.body?.channel || "whatsapp",
        matchedRule: null,
        usedAI: false,
        intent: "other",
        entities: {},
        priority: { score: 10, label: "low" },
        confidence: 0.3,
        suggestedNextAction: "fallback_response",
        reasonSummary: "Se usó respuesta segura por error interno del Bot Lab."
      }
    });
  }
});

devRouter.post("/dev/simulate-inbound", async (req, res) => {
  try {
    const {
      channel = "whatsapp",
      from = `569${Math.floor(10000000 + Math.random() * 89999999)}`,
      message = "Hola, estoy interesado en un departamento en Ñuñoa por 500 mil"
    } = req.body;

    const cleanMessage = String(message || "").trim();

    if (!cleanMessage) {
      return res.status(400).json({ error: "message es requerido" });
    }

    const tenant = await getTenantForDevRequest(req);

    const contact = await getOrCreateContact({
      tenantId: tenant.id,
      externalId: String(from),
      channel
    });

    await updateContactProfile({
      contactId: contact.id,
      profile: {
        name: `Lead demo ${String(from).slice(-4)}`
      }
    });

    const conversation = await getOrCreateOpenConversation({
      tenantId: tenant.id,
      contactId: contact.id
    });

    const inbound = await persistInboundMessage({
      tenantId: tenant.id,
      conversationId: conversation.id,
      contactId: contact.id,
      channel,
      content: cleanMessage,
      externalMessageId: `dev-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      type: "text",
      rawPayload: {
        source: "dev-simulator",
        channel,
        from,
        message: cleanMessage
      }
    });

    const botResult = await processIncomingText({
      tenant,
      conversation,
      contact,
      channel,
      userMessage: cleanMessage
    });

    return res.json({
      ok: true,
      conversationId: conversation.id,
      inbound: inbound.message,
      bot: botResult
    });
  } catch (error) {
    console.error("Simulate inbound error:", error);
    return res.status(500).json({
      error: "No se pudo simular el lead",
      detail: error?.message || "Error desconocido"
    });
  }
});
