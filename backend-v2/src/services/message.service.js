import { prisma } from "../lib/db.js";
import { getIo } from "../lib/socket.js";
import { normalizeObjectStrings, normalizeText } from "../lib/text.js";
import { getRuleReply } from "./rules.service.js";
import { generateSalesReply } from "./ai.service.js";
import { sendChannelMessage } from "./routing.service.js";
import { interactiveSelectionToText, isFirstInboundForConversation, persistInteractiveOutbound, sendQuotePromptInteractive, sendServicesListInteractive, sendWelcomeInteractive, INTERACTIVE_IDS } from "./whatsapp-interactive.service.js";
import { detectIntent } from "./intent.service.js";
import { extractEntities } from "./entity-extractor.service.js";
import { updateConversationAI, updateConversationPriority } from "./conversation.service.js";
import { refreshLeadPrediction, upsertLeadFromConversation } from "./lead.service.js";
import { generateExpertAnalysis } from "./ai-expert.service.js";
import { updateConversationMemory } from "./memory.service.js";
import { updateAIDecision } from "./ai-decision.service.js";
import { isAltaBrasaTenant } from "./business-knowledge.service.js";
import { runActionOrchestrator } from "./ai-action-orchestrator.service.js";
import { captureLearningSignal } from "./ai-performance-learning.service.js";
import { buildAutonomousFollowUpPlan } from "./autonomous-followup-strategy.service.js";
import { recordUsageEvent } from "./saas-commercial.service.js";
import { registerSalesSignal } from "./sales-engine.service.js";
import { traceError, traceStep } from "../lib/trace.js";
import { metadataOrNull } from "../lib/metadata.js";

function mapMessageType(type) {
  switch ((type || "").toLowerCase()) {
    case "text": return "TEXT";
    case "image": return "IMAGE";
    case "audio": return "AUDIO";
    case "video": return "VIDEO";
    case "file": return "FILE";
    case "template": return "TEMPLATE";
    default: return "OTHER";
  }
}

async function emitConversationUpdate(conversationId) {
  const io = getIo();
  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    include: { contact: true, assignedTo: true, lead: true }
  });

  if (!conversation) return;

  io.to(`conversation:${conversationId}`).emit("conversation:updated", conversation);
  io.to(`tenant:${conversation.tenantId}`).emit("inbox:conversation-updated", conversation);
}

// =============================
// INBOUND (mensaje entrante)
// =============================
export async function persistInboundMessage({
  tenantId,
  conversationId,
  contactId,
  channel,
  content,
  externalMessageId,
  type,
  rawPayload,
  metadata = null,
  trace = null
}) {
  traceStep(trace, "7A_DUPLICATE_CHECK_START", { channel, externalMessageId });
  const existing = externalMessageId
    ? await prisma.message.findFirst({ where: { channel, externalMessageId } })
    : null;

  if (existing) {
    traceStep(trace, "7A_DUPLICATE_FOUND", { messageId: existing.id });
    return { message: existing, isDuplicate: true };
  }

  const normalizedContent = normalizeText(content);
  traceStep(trace, "7B_CREATE_INBOUND_MESSAGE_START", { tenantId, conversationId, contactId, channel, type, normalizedContent });

  const message = await prisma.message.create({
    data: {
      tenantId,
      conversationId,
      contactId,
      channel,
      direction: "INBOUND",
      content: normalizedContent,
      externalMessageId,
      type: mapMessageType(type),
      status: "RECEIVED",
      rawPayload: normalizeObjectStrings(rawPayload),
      metadata: metadataOrNull(metadata) || undefined
    }
  });

  traceStep(trace, "7B_CREATE_INBOUND_MESSAGE_OK", { messageId: message.id });
  await recordUsageEvent({ tenantId, type: "MESSAGE_IN", metadata: { channel } });

  await prisma.conversation.update({
    where: { id: conversationId },
    data: { lastMessageAt: new Date() }
  });

  const contact = await prisma.contact.findUnique({ where: { id: contactId } });

  traceStep(trace, "7C_AI_SIDE_EFFECTS_START");
  const intent = await detectIntent({ message: normalizedContent });
  const entities = await extractEntities({ message: normalizedContent });
  const memory = await updateConversationMemory({
    tenantId,
    conversationId,
    message: normalizedContent,
    intent
  });

  await updateConversationPriority({
    conversationId,
    messageText: normalizedContent
  });

  await upsertLeadFromConversation({
    tenantId,
    conversationId,
    contact,
    entities,
    intent
  });

  // Si el cliente respondió, cancelamos cualquier seguimiento pendiente
  // para evitar insistir mientras la conversación sigue activa.
  await prisma.lead.updateMany({
    where: { conversationId },
    data: { followUpCount: 0, nextFollowUpAt: null }
  });

  // 🧠 IA EXPERTA
  let analysis = null;
  try {
    traceStep(trace, "7D_EXPERT_ANALYSIS_START");
    analysis = await generateExpertAnalysis({
      tenantId,
      conversationId,
      message: normalizedContent
    });
    traceStep(trace, "7D_EXPERT_ANALYSIS_OK", analysis);
  } catch (error) {
    traceError(trace, "7D_EXPERT_ANALYSIS_ERROR", error);
  }

  if (analysis) await updateConversationAI({ conversationId, analysis });
  const leadForDecision = await refreshLeadPrediction({ conversationId });
  await updateAIDecision({ conversationId, memory, lead: leadForDecision, message: normalizedContent });

  const io = getIo();
  traceStep(trace, "7E_SOCKET_EMIT_INBOUND_START", { conversationId });
  io.to(`conversation:${conversationId}`).emit("message:new", message);
  io.to(`tenant:${tenantId}`).emit("message:new", message);
  await emitConversationUpdate(conversationId);
  traceStep(trace, "7E_SOCKET_EMIT_INBOUND_OK");

  return { message, isDuplicate: false };
}

// =============================
// OUTBOUND (mensaje saliente)
// =============================
export async function persistOutboundMessage({
  tenantId,
  conversationId,
  contactId,
  channel,
  content,
  status = "SENT",
  metadata = null,
  externalMessageId = null,
  rawPayload = null,
  errorMessage = null
}) {
  const message = await prisma.message.create({
    data: {
      tenantId,
      conversationId,
      contactId,
      channel,
      direction: "OUTBOUND",
      content: normalizeText(content),
      type: "TEXT",
      status,
      externalMessageId,
      rawPayload: rawPayload ? normalizeObjectStrings(rawPayload) : undefined,
      metadata: metadataOrNull(metadata) || undefined,
      errorMessage
    }
  });

  await recordUsageEvent({ tenantId, type: "MESSAGE_OUT", metadata: { channel, status } });

  await prisma.conversation.update({
    where: { id: conversationId },
    data: { lastMessageAt: new Date() }
  });

  const io = getIo();
  io.to(`conversation:${conversationId}`).emit("message:new", message);
  io.to(`tenant:${tenantId}`).emit("message:new", message);
  await emitConversationUpdate(conversationId);

  return message;
}


function getInteractiveFromRaw(rawPayload = null) {
  const message = rawPayload?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
  if (!message || message.type !== "interactive") return null;
  const button = message.interactive?.button_reply;
  const list = message.interactive?.list_reply;
  return {
    id: button?.id || list?.id || null,
    title: button?.title || list?.title || null,
    type: message.interactive?.type || null
  };
}

async function getConversationMessageCount(conversationId) {
  return prisma.message.count({ where: { conversationId } });
}

async function handleInteractiveFlow({ tenant, conversation, contact, channel, userMessage, trace }) {
  if (channel !== "whatsapp") return { handled: false };

  const lastInbound = await prisma.message.findFirst({
    where: {
      conversationId: conversation.id,
      direction: "INBOUND"
    },
    orderBy: { createdAt: "desc" }
  });

  const interactive = lastInbound?.metadata?.interactive || getInteractiveFromRaw(lastInbound?.rawPayload);
  const id = interactive?.id;

  if (!id) return { handled: false };

  const selectedText = interactiveSelectionToText({
    id,
    title: interactive?.title || userMessage
  });

  if (id === INTERACTIVE_IDS.VIEW_SERVICES) {
    await sendServicesListInteractive({ tenant, contact, channel, trace });
    await persistInteractiveOutbound({
      tenantId: tenant.id,
      conversationId: conversation.id,
      contactId: contact.id,
      channel,
      content: "Lista de servicios enviada",
      metadata: { interactiveType: "services_list" }
    });
    return { handled: true, reason: "services_list_sent", reply: selectedText };
  }

  if (id === INTERACTIVE_IDS.QUOTE_EVENT) {
    await sendQuotePromptInteractive({ tenant, contact, channel, trace });
    await persistInteractiveOutbound({
      tenantId: tenant.id,
      conversationId: conversation.id,
      contactId: contact.id,
      channel,
      content: "Solicitud de datos para cotización enviada",
      metadata: { interactiveType: "quote_prompt" }
    });
    return { handled: true, reason: "quote_prompt_sent", reply: selectedText };
  }

  if (id === INTERACTIVE_IDS.TALK_AGENT) {
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { mode: "HUMAN" }
    });

    const reply = "Perfecto, te derivaré con un asesor humano para que pueda ayudarte de forma personalizada 🙌";
    await sendChannelMessage({
      channel,
      to: contact.externalId,
      message: reply,
      tenant,
      trace
    });
    await persistOutboundMessage({
      tenantId: tenant.id,
      conversationId: conversation.id,
      contactId: contact.id,
      channel,
      content: reply
    });
    return { handled: true, reason: "handoff_to_human", reply };
  }

  return {
    handled: false,
    normalizedUserMessage: selectedText
  };
}


// =============================
// PROCESAMIENTO PRINCIPAL (SIMULADOR + BOT)
// =============================
export async function processIncomingText({
  tenant,
  conversation,
  contact,
  channel,
  userMessage,
  trace = null
}) {
  userMessage = normalizeText(userMessage);
  traceStep(trace, "8A_PROCESS_START", {
    tenantId: tenant.id,
    tenantSlug: tenant.slug,
    conversationId: conversation.id,
    contactId: contact.id,
    channel,
    userMessage,
    conversationMode: conversation.mode
  });

  if (conversation.mode === "HUMAN") {
    traceStep(trace, "8A_STOP_HUMAN_MODE");
    return { skipped: true, reason: "conversation_in_human_mode" };
  }

  const messageCount = await getConversationMessageCount(conversation.id);

  if (channel === "whatsapp" && isFirstInboundForConversation(messageCount)) {
    try {
      await sendWelcomeInteractive({ tenant, contact, channel, trace });
      await persistInteractiveOutbound({
        tenantId: tenant.id,
        conversationId: conversation.id,
        contactId: contact.id,
        channel,
        content: "Mensaje de bienvenida con servicios enviado",
        metadata: { interactiveType: "welcome_buttons" }
      });
      return { skipped: false, reason: "welcome_interactive_sent" };
    } catch (error) {
      traceError(trace, "8A_INTERACTIVE_WELCOME_ERROR", error);
      // Si falla interactive por permisos/configuración, continuamos con IA normal.
    }
  }

  const interactiveFlow = await handleInteractiveFlow({ tenant, conversation, contact, channel, userMessage, trace });
  if (interactiveFlow.handled) {
    return { skipped: false, reason: interactiveFlow.reason, reply: interactiveFlow.reply };
  }
  if (interactiveFlow.normalizedUserMessage) {
    userMessage = interactiveFlow.normalizedUserMessage;
  }

  traceStep(trace, "8B_INTENT_MEMORY_START");
  const intent = await detectIntent({ message: userMessage });
  const memory = await updateConversationMemory({
    tenantId: tenant.id,
    conversationId: conversation.id,
    message: userMessage,
    intent
  });

  traceStep(trace, "8B_INTENT_MEMORY_OK", { intent, memory });
  traceStep(trace, "8C_ACTION_ORCHESTRATOR_START");
  const actionPlan = await runActionOrchestrator({
    tenant,
    conversation,
    contact,
    userMessage,
    memory
  });

  traceStep(trace, "8C_ACTION_ORCHESTRATOR_OK", {
    hasActionPlan: Boolean(actionPlan),
    recommendedAction: actionPlan?.sales?.recommendedAction || null
  });

  let reply;

  try {
    // 1) Reglas primero: permiten respuestas controladas por el negocio.
    // Para negocios con base de conocimiento premium (ej: Eventos Alta Brasa),
    // dejamos que la IA use la información oficial completa en vez de devolver
    // una regla rígida que podría sonar robótica o incompleta.
    const preferKnowledgeAI = isAltaBrasaTenant(tenant);
    traceStep(trace, "8D_RULE_REPLY_START", { preferKnowledgeAI });
    reply = preferKnowledgeAI ? null : await getRuleReply({
      tenantId: tenant.id,
      channel,
      message: userMessage
    });

    traceStep(trace, "8D_RULE_REPLY_RESULT", { hasRuleReply: Boolean(reply), reply });
    // 2) Si no hay regla, usa IA comercial con productos/servicios y modo cierre.
    if (!reply) {
      traceStep(trace, "8E_OPENAI_SALES_REPLY_START");
      reply = await generateSalesReply({
        tenantId: tenant.id,
        tenantName: tenant.name,
        businessPrompt: tenant.businessPrompt,
        userMessage,
        conversationId: conversation.id,
        tenant,
        actionContext: actionPlan?.contextText || ""
      });
      traceStep(trace, "8E_OPENAI_SALES_REPLY_OK", { reply });
    }

    // 3) Ejecuta análisis experto para mantener resumen/sugerencia/score actualizados.
    const analysis = await generateExpertAnalysis({
      tenantId: tenant.id,
      conversationId: conversation.id,
      message: userMessage
    });

    await updateConversationAI({ conversationId: conversation.id, analysis });
    const leadForDecision = await refreshLeadPrediction({ conversationId: conversation.id });
    await updateAIDecision({ conversationId: conversation.id, memory, lead: leadForDecision, message: userMessage });

  } catch (error) {
    console.error("Error IA:", error);
    traceError(trace, "8E_AI_PROCESSING_ERROR", error);
    reply = "Hola 👋 ¿en qué puedo ayudarte?";
  }

  reply = normalizeText(reply);
  await recordUsageEvent({ tenantId: tenant.id, type: "AI_REPLY", metadata: { channel, conversationId: conversation.id } });

  // ⚠️ importante para simulador
  try {
    traceStep(trace, "8F_SEND_CHANNEL_MESSAGE_START", { channel, to: contact.externalId, tenantId: tenant.id });
    await sendChannelMessage({
      channel,
      to: contact.externalId,
      message: reply,
      tenant,
      trace
    });
    traceStep(trace, "8F_SEND_CHANNEL_MESSAGE_OK");
  } catch (e) {
    console.log("Simulador sin canal real:", e.message);
    traceError(trace, "8F_SEND_CHANNEL_MESSAGE_ERROR", e);
  }

  traceStep(trace, "8G_PERSIST_OUTBOUND_START");
  await persistOutboundMessage({
    tenantId: tenant.id,
    conversationId: conversation.id,
    contactId: contact.id,
    channel,
    content: reply
  });
  traceStep(trace, "8G_PERSIST_OUTBOUND_OK");

  try {
    await registerSalesSignal({
      tenantId: tenant.id,
      conversationId: conversation.id,
      contact,
      message: `${userMessage}\n${reply}`,
      quote: null,
      reason: "Señal evaluada después de respuesta IA"
    });
  } catch (salesEngineError) {
    traceError(trace, "8H_SALES_ENGINE_ERROR", salesEngineError);
  }

  // Programamos follow-up después de que el bot responde.
  // Fase 3.5: el seguimiento ahora usa reasoning + señales comerciales.
  const lead = await prisma.lead.findUnique({ where: { conversationId: conversation.id } });
  if (lead && !["WON", "LOST"].includes(lead.status)) {
    const followUpPlan = buildAutonomousFollowUpPlan({
      reasoning: actionPlan?.reasoning,
      memory
    });

    await captureLearningSignal({
      tenantId: tenant.id,
      conversationId: conversation.id,
      lead,
      memory,
      industry: actionPlan?.industry || tenant.industry || "general",
      reason: actionPlan?.reasoning?.reasons?.join(", ") || actionPlan?.sales?.recommendedAction || "señal comercial"
    });

    if (followUpPlan.shouldSchedule) {
      const nextNotes = [
        lead.notes || "",
        `Follow-up IA: ${followUpPlan.reason}`
      ].filter(Boolean).join("\n").slice(0, 3000);

      await prisma.lead.update({
        where: { id: lead.id },
        data: {
          lastContactAt: new Date(),
          nextFollowUpAt: new Date(Date.now() + followUpPlan.minutes * 60 * 1000),
          notes: nextNotes
        }
      });
    } else {
      await prisma.lead.update({
        where: { id: lead.id },
        data: {
          lastContactAt: new Date(),
          notes: [lead.notes || "", `Follow-up IA omitido: ${followUpPlan.reason}`].filter(Boolean).join("\n").slice(0, 3000)
        }
      });
    }
  }

  return { skipped: false, reply };
}
