
import { prisma } from "../lib/db.js";

function minutesSince(date) {
  if (!date) return 0;
  return Math.floor((Date.now() - new Date(date).getTime()) / 60000);
}

function shouldFollowUp(conversation, lead) {
  if (!lead || ["WON", "LOST"].includes(lead.status)) return { ok: false };
  if (conversation.mode === "HUMAN") return { ok: false };
  if (!["QUOTE_SENT", "READY_TO_CLOSE", "QUALIFIED", "NEGOTIATION"].includes(lead.status)) return { ok: false };

  const idle = minutesSince(conversation.lastMessageAt || lead.lastContactAt || lead.updatedAt);
  const minIdle = lead.status === "READY_TO_CLOSE" ? 45 : lead.status === "QUOTE_SENT" ? 90 : 180;

  if (idle < minIdle) return { ok: false };

  return {
    ok: true,
    idle,
    minIdle,
    reason: lead.status === "READY_TO_CLOSE"
      ? "Lead listo para cierre sin respuesta reciente"
      : lead.status === "QUOTE_SENT"
        ? "Cotización enviada sin seguimiento reciente"
        : "Lead calificado estancado"
  };
}

export function buildFollowUpMessage({ tenantName = "nuestro equipo", lead, conversation }) {
  const status = lead?.status || "QUALIFIED";
  if (status === "READY_TO_CLOSE") {
    return `Hola 👋 soy de ${tenantName}. Te escribo para dar continuidad a tu cotización y revisar si dejamos la reserva encaminada.

¿Quieres que confirmemos disponibilidad y últimos detalles para avanzar?`;
  }

  if (status === "QUOTE_SENT") {
    return `Hola 👋 solo quería saber si pudiste revisar la cotización que te enviamos.

Podemos mantenerla como está o ajustarla si quieres cambiar cantidad de personas, adicionales o presupuesto. ¿Quieres que revisemos algún detalle?`;
  }

  return `Hola 👋 quedé atento a tu solicitud. Si todavía estás evaluando opciones, puedo ayudarte a comparar alternativas o ajustar la propuesta a lo que necesitas.`;
}

export async function runAutonomousSalesFollowUps({ tenantId = null, dryRun = false, limit = 50 } = {}) {
  const where = tenantId ? { tenantId } : {};
  const conversations = await prisma.conversation.findMany({
    where,
    include: { tenant: true, contact: true, lead: true },
    orderBy: { lastMessageAt: "asc" },
    take: limit
  });

  const actions = [];

  for (const conversation of conversations) {
    const lead = conversation.lead;
    const decision = shouldFollowUp(conversation, lead);
    if (!decision.ok) continue;

    const lastOutbound = await prisma.message.findFirst({
      where: {
        conversationId: conversation.id,
        direction: "OUTBOUND",
        metadata: { path: ["autoFollowUp"], equals: true }
      },
      orderBy: { createdAt: "desc" }
    }).catch(() => null);

    if (lastOutbound && minutesSince(lastOutbound.createdAt) < 12 * 60) continue;

    const message = buildFollowUpMessage({
      tenantName: conversation.tenant?.name,
      lead,
      conversation
    });

    actions.push({
      tenantId: conversation.tenantId,
      conversationId: conversation.id,
      contactId: conversation.contactId,
      channel: conversation.contact?.channel,
      to: conversation.contact?.externalId,
      message,
      reason: decision.reason
    });

    if (!dryRun) {
      await prisma.message.create({
        data: {
          tenantId: conversation.tenantId,
          conversationId: conversation.id,
          contactId: conversation.contactId,
          channel: conversation.contact?.channel || "whatsapp",
          direction: "OUTBOUND",
          content: message,
          type: "TEXT",
          status: "PENDING",
          metadata: { autoFollowUp: true, reason: decision.reason }
        }
      }).catch(() => null);

      await prisma.lead.update({
        where: { id: lead.id },
        data: {
          followUpCount: (lead.followUpCount || 0) + 1,
          nextFollowUpAt: new Date(Date.now() + 12 * 60 * 60 * 1000),
          notes: [lead.notes || "", `Follow-up IA programado: ${decision.reason}`].filter(Boolean).join("\n").slice(0, 4000)
        }
      }).catch(() => null);

      await prisma.conversation.update({
        where: { id: conversation.id },
        data: {
          aiRecommendedAction: "Revisar follow-up automático y tomar el cierre si responde.",
          aiStrategy: "Seguimiento autónomo suave después de cotización/lead caliente.",
          aiRecoveryPlan: decision.reason
        }
      }).catch(() => null);
    }
  }

  return { count: actions.length, actions };
}
