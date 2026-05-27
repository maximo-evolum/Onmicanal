import { prisma } from "../lib/db.js";
import { sendChannelMessage } from "./routing.service.js";
import { persistOutboundMessage } from "./message.service.js";
import { generateSalesReply } from "./ai.service.js";

function addHours(date, hours) { return new Date(date.getTime() + hours * 3600000); }
function addDays(date, days) { return new Date(date.getTime() + days * 86400000); }

function nextFollowUpDate(count, closeProbability = 0) {
  const now = new Date();

  // Leads calientes se retoman antes; fríos se retoman con más espacio.
  if (closeProbability >= 75) {
    if (count === 0) return addHours(now, 2);
    if (count === 1) return addHours(now, 24);
    if (count === 2) return addDays(now, 2);
    return null;
  }

  if (closeProbability >= 45) {
    if (count === 0) return addHours(now, 24);
    if (count === 1) return addDays(now, 3);
    return null;
  }

  if (count === 0) return addDays(now, 2);
  return null;
}

function fallbackFollowUpMessage(lead) {
  if ((lead.closeProbability || 0) >= 75) {
    return "Hola 👋 vi que tu búsqueda está bastante clara. ¿Quieres que avancemos con una opción concreta o prefieres que te mande alternativas?";
  }
  if (lead.followUpCount === 0) {
    return "Hola 👋 te escribo por si aún estás interesado. Puedo recomendarte opciones según lo que estás buscando.";
  }
  if (lead.followUpCount === 1) {
    return "Tengo algunas opciones que podrían calzar contigo. ¿Quieres que las revisemos?";
  }
  return "Cuando quieras, puedo ayudarte a retomar la búsqueda 👍";
}

async function generateSmartFollowUp(lead) {
  const conversation = lead.conversation;
  const lastMessages = await prisma.message.findMany({
    where: { conversationId: lead.conversationId },
    orderBy: { createdAt: "desc" },
    take: 6
  });

  const history = lastMessages
    .reverse()
    .map((m) => `${m.direction === "INBOUND" ? "Cliente" : "Bot"}: ${m.content}`)
    .join("\n");

  try {
    return await generateSalesReply({
      tenantId: lead.tenantId,
      tenantName: conversation?.tenant?.name || "tu negocio",
      businessPrompt: conversation?.tenant?.businessPrompt || "",
      tenant: conversation?.tenant || null,
      conversationId: lead.conversationId,
      userMessage: `
El cliente dejó de responder. Genera un follow-up corto, natural y vendedor.
No seas insistente. Aporta valor y haz solo una pregunta.

Datos del lead:
- Estado: ${lead.status}
- Probabilidad de cierre: ${lead.closeProbability || 0}%
- Motivo: ${lead.closeReason || "N/A"}
- Interés: ${lead.interest || "N/A"}
- Presupuesto: ${lead.budget || "N/A"}

Historial reciente:
${history}
`
    });
  } catch (error) {
    console.error("Smart follow-up generation error:", error?.message || error);
    return fallbackFollowUpMessage(lead);
  }
}

export async function runAutomationCycle() {
  const now = new Date();
  const leads = await prisma.lead.findMany({
    where: {
      nextFollowUpAt: { lte: now },
      status: { notIn: ["WON", "LOST"] },
      followUpCount: { lt: 3 }
    },
    include: {
      conversation: { include: { contact: true, tenant: true } }
    },
    orderBy: [{ closeProbability: "desc" }, { nextFollowUpAt: "asc" }],
    take: 25
  });

  for (const lead of leads) await processLeadFollowUp(lead);
  return { processed: leads.length };
}

async function processLeadFollowUp(lead) {
  const conversation = lead.conversation;
  if (!conversation?.contact) return;

  const content = await generateSmartFollowUp(lead);
  let status = "SENT";
  let errorMessage = null;

  try {
    await sendChannelMessage({
      channel: conversation.contact.channel,
      to: conversation.contact.externalId,
      message: content,
      tenant: conversation.tenant
    });
  } catch (error) {
    status = "FAILED";
    errorMessage = error.message || "No se pudo enviar follow-up";
    console.warn("Follow-up channel warning:", errorMessage);
  }

  await persistOutboundMessage({
    tenantId: lead.tenantId,
    conversationId: lead.conversationId,
    contactId: conversation.contactId,
    channel: conversation.contact.channel,
    content,
    status,
    metadata: { source: "automation", followUpStep: lead.followUpCount + 1, errorMessage }
  });

  const nextCount = lead.followUpCount + 1;

  await prisma.lead.update({
    where: { id: lead.id },
    data: {
      followUpCount: { increment: 1 },
      lastContactAt: new Date(),
      nextFollowUpAt: nextFollowUpDate(nextCount, lead.closeProbability || 0)
    }
  });

  if (nextCount >= 2 && (lead.closeProbability || 0) >= 70) {
    await prisma.conversation.update({
      where: { id: lead.conversationId },
      data: { mode: "HUMAN", decisionSummary: "Lead caliente escalado a humano por follow-up automático." }
    });
  }
}
