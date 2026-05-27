import { prisma } from "../lib/db.js";
import { createBooking, getAvailableSlots } from "./booking.service.js";
import { estimateServiceQuote, extractEventPreferences, getPrimaryService } from "./event-sales.service.js";
import { searchProducts } from "./product.service.js";
import { updateLead } from "./lead.service.js";

/**
 * Tool Registry interno.
 * Estas funciones NO llaman a OpenAI directamente: son acciones seguras que el
 * orquestador puede ejecutar cuando el mensaje del cliente tiene suficiente contexto.
 */
export const AI_TOOLS = {
  UPDATE_LEAD: "update_lead",
  ESTIMATE_EVENT: "estimate_event",
  GET_AVAILABLE_SLOTS: "get_available_slots",
  CREATE_BOOKING: "create_booking",
  MARK_PAYMENT_READY: "mark_payment_ready",
  LOOKUP_PRODUCTS: "lookup_products",
  HANDOFF_HUMAN: "handoff_human",
  SCHEDULE_FOLLOW_UP: "schedule_follow_up"
};

function safeDateFromText(value) {
  if (!value) return null;
  const raw = String(value).trim();

  // Fechas ISO o yyyy-mm-dd son seguras para crear booking.
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) {
    const date = new Date(raw);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  // Para palabras como "sábado" o "mañana" preferimos NO crear reserva real:
  // el bot debe pedir confirmación de fecha exacta.
  return null;
}

export async function runAiTool({ name, args = {}, context }) {
  const { tenant, conversation, contact, userMessage } = context;
  const tenantId = tenant?.id;

  switch (name) {
    case AI_TOOLS.UPDATE_LEAD: {
      const data = {};
      if (args.status) data.status = args.status;
      if (args.interest) data.interest = args.interest;
      if (args.urgency) data.urgency = args.urgency;
      if (args.budget) data.budget = Number(args.budget);
      if (args.notes) data.notes = args.notes;

      if (!conversation?.id || !Object.keys(data).length) {
        return { ok: false, tool: name, message: "No había datos suficientes para actualizar lead." };
      }

      const existing = await prisma.lead.findUnique({ where: { conversationId: conversation.id } });
      if (!existing) {
        await prisma.lead.create({
          data: {
            tenantId,
            conversationId: conversation.id,
            name: contact?.name || null,
            phone: contact?.externalId || null,
            status: data.status || "CONTACTED",
            interest: data.interest || null,
            urgency: data.urgency || null,
            budget: data.budget || null,
            notes: data.notes || null
          }
        });
      } else {
        await updateLead({ conversationId: conversation.id, data });
      }

      return { ok: true, tool: name, message: "Lead actualizado con señales comerciales." };
    }

    case AI_TOOLS.ESTIMATE_EVENT: {
      const prefs = extractEventPreferences(userMessage);
      const service = await getPrimaryService({ tenantId, query: userMessage });
      const guests = Number(args.guests || prefs.guests || 0);

      if (!service || !guests) {
        return {
          ok: false,
          tool: name,
          message: "Faltan datos para estimar: cantidad de personas o servicio activo."
        };
      }

      const quote = estimateServiceQuote({ service, guests });
      return {
        ok: true,
        tool: name,
        service: service.name,
        guests: quote.guests,
        total: quote.total,
        message: `Estimación para ${quote.guests} personas en ${service.name}: $${quote.total.toLocaleString("es-CL")}.`
      };
    }

    case AI_TOOLS.GET_AVAILABLE_SLOTS: {
      const date = args.date || extractEventPreferences(userMessage).date;
      const slots = getAvailableSlots({ date: date || "fecha a confirmar" });
      return {
        ok: true,
        tool: name,
        date: date || null,
        slots,
        message: date
          ? `Horarios tentativos disponibles para ${date}: ${slots.map((s) => s.time).join(", ")}.`
          : "Puedo revisar horarios, pero necesito una fecha exacta."
      };
    }

    case AI_TOOLS.CREATE_BOOKING: {
      const prefs = extractEventPreferences(userMessage);
      const service = await getPrimaryService({ tenantId, query: userMessage });
      const guests = Number(args.guests || prefs.guests || 0);
      const location = args.location || prefs.location || null;
      const dateText = args.date || prefs.date;
      const parsedDate = safeDateFromText(dateText);

      if (!parsedDate || !guests) {
        return {
          ok: false,
          tool: name,
          needsConfirmation: true,
          missing: [
            !parsedDate ? "fecha exacta en formato día/mes o confirmación manual" : null,
            !guests ? "cantidad de personas" : null
          ].filter(Boolean),
          message: "No creé la reserva automáticamente porque faltan fecha exacta y/o cantidad de personas."
        };
      }

      const quote = service ? estimateServiceQuote({ service, guests }) : null;
      const booking = await createBooking({
        tenantId,
        conversationId: conversation.id,
        name: args.name || contact?.name || null,
        phone: args.phone || contact?.externalId || null,
        email: args.email || null,
        date: parsedDate,
        guests,
        location,
        total: quote?.total || 0,
        notes: args.notes || `Reserva generada por IA. Servicio sugerido: ${service?.name || "a confirmar"}`
      });

      await prisma.conversation.update({
        where: { id: conversation.id },
        data: {
          aiNextActionCode: "booking_created",
          aiNextAction: "Reserva pendiente creada por IA"
        }
      }).catch(() => null);

      return {
        ok: true,
        tool: name,
        bookingId: booking.id,
        total: booking.total,
        message: `Reserva pendiente creada. ID: ${booking.id}. Vendedor humano debe coordinar pago/reserva.`
      };
    }

    case AI_TOOLS.MARK_PAYMENT_READY: {
      if (!conversation?.id) {
        return { ok: false, tool: name, message: "No hay conversación para marcar cierre." };
      }

      const existingLead = await prisma.lead.findUnique({ where: { conversationId: conversation.id } });
      const leadData = {
        status: "READY_TO_CLOSE",
        urgency: "HIGH",
        interest: args.interest || "Cliente listo para coordinar pago/reserva",
        notes: [
          existingLead?.notes || "",
          args.reason || "La IA detectó intención clara de pago/reserva.",
          "Acción requerida: vendedor humano debe continuar el cierre y coordinar el pago."
        ].filter(Boolean).join("\n")
      };

      if (existingLead) {
        await prisma.lead.update({
          where: { id: existingLead.id },
          data: {
            ...leadData,
            closeProbability: Math.max(existingLead.closeProbability || 0, 92),
            lastContactAt: new Date(),
            nextFollowUpAt: null
          }
        });
      } else {
        await prisma.lead.create({
          data: {
            tenantId,
            conversationId: conversation.id,
            name: contact?.name || null,
            phone: contact?.externalId || null,
            closeProbability: 92,
            ...leadData
          }
        });
      }

      await prisma.conversation.update({
        where: { id: conversation.id },
        data: {
          mode: "HYBRID",
          priorityLabel: "high",
          priorityScore: 95,
          aiHandoffRequired: true,
          aiHandoffReason: args.reason || "Cliente listo para pago/reserva",
          aiDecisionLabel: "READY_TO_CLOSE",
          aiCloseScore: 92,
          aiNextActionCode: "notify_seller_ready_to_close",
          aiNextAction: "Avisar al vendedor para coordinar pago/reserva",
          decisionSummary: "Cliente listo para cierre: vendedor humano debe continuar el pago/reserva."
        }
      });

      return {
        ok: true,
        tool: name,
        notifySeller: true,
        message: "Cliente marcado como listo para pago/reserva. Vendedor humano debe continuar el cierre."
      };
    }

    case AI_TOOLS.LOOKUP_PRODUCTS: {
      const products = await searchProducts({ tenantId, query: userMessage, take: Number(args.take || 3) });
      return {
        ok: true,
        tool: name,
        products: products.map((p) => ({
          id: p.id,
          name: p.name,
          price: p.price,
          stock: p.stock,
          category: p.category,
          score: p.recommendationScore
        })),
        message: products.length
          ? `Encontré ${products.length} producto(s) relevantes.`
          : "No encontré productos relevantes cargados."
      };
    }

    case AI_TOOLS.HANDOFF_HUMAN: {
      await prisma.conversation.update({
        where: { id: conversation.id },
        data: {
          mode: "HYBRID",
          aiHandoffRequired: true,
          aiHandoffReason: args.reason || "Derivación sugerida por IA",
          aiNextActionCode: "handoff_human"
        }
      });

      return {
        ok: true,
        tool: name,
        message: "Conversación marcada para intervención humana."
      };
    }

    case AI_TOOLS.SCHEDULE_FOLLOW_UP: {
      const minutes = Number(args.minutes || 120);
      const lead = await prisma.lead.findUnique({ where: { conversationId: conversation.id } });
      if (lead) {
        await prisma.lead.update({
          where: { id: lead.id },
          data: {
            nextFollowUpAt: new Date(Date.now() + minutes * 60 * 1000),
            followUpCount: lead.followUpCount || 0
          }
        });
      }

      return {
        ok: true,
        tool: name,
        minutes,
        message: `Follow-up programado en ${minutes} minutos.`
      };
    }

    default:
      return { ok: false, tool: name, message: "Tool no reconocida." };
  }
}
