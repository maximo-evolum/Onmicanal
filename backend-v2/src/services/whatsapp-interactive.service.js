import { prisma } from "../lib/db.js";
import { sendWhatsAppInteractive } from "./whatsapp.service.js";
import { traceStep } from "../lib/trace.js";

export const INTERACTIVE_IDS = {
  QUOTE_EVENT: "quote_event",
  VIEW_SERVICES: "view_services",
  TALK_AGENT: "talk_agent",
  SERVICE_COCKTAIL: "service_cocktail",
  SERVICE_ASADO: "service_asado",
  SERVICE_MIXTO: "service_mixto",
  EXTRA_BAR: "extra_bar",
  EXTRA_DJ: "extra_dj",
  EXTRA_POSTRES: "extra_postres"
};

function tenantDisplayName(tenant) {
  return tenant?.name || "nuestro equipo";
}

export function isFirstInboundForConversation(messageCountBeforeBot = 0) {
  // Después de persistir el primer mensaje entrante, la conversación normalmente tiene 1 mensaje.
  return Number(messageCountBeforeBot || 0) <= 1;
}

export function buildWelcomeServicesText(tenant) {
  const name = tenantDisplayName(tenant);
  return `👋 ¡Hola! Bienvenido a *${name}* 🔥

Te ayudamos con:
🍖 Cóctel Parrillero
🥩 Asado al Plato
🔥 Servicio Mixto
🍸 Bar abierto
🎧 DJ y música
🍰 Postres y adicionales

Selecciona una opción para ayudarte más rápido 👇`;
}

export function buildWelcomeButtonsPayload({ to, tenant }) {
  return {
    messaging_product: "whatsapp",
    to,
    type: "interactive",
    interactive: {
      type: "button",
      body: {
        text: buildWelcomeServicesText(tenant)
      },
      action: {
        buttons: [
          {
            type: "reply",
            reply: {
              id: INTERACTIVE_IDS.QUOTE_EVENT,
              title: "Cotizar evento"
            }
          },
          {
            type: "reply",
            reply: {
              id: INTERACTIVE_IDS.VIEW_SERVICES,
              title: "Ver servicios"
            }
          },
          {
            type: "reply",
            reply: {
              id: INTERACTIVE_IDS.TALK_AGENT,
              title: "Hablar asesor"
            }
          }
        ]
      }
    }
  };
}

export function buildServicesListPayload({ to, tenant }) {
  const name = tenantDisplayName(tenant);
  return {
    messaging_product: "whatsapp",
    to,
    type: "interactive",
    interactive: {
      type: "list",
      header: {
        type: "text",
        text: name
      },
      body: {
        text: "Estos son los servicios que podemos ofrecerte. Elige uno para avanzar 👇"
      },
      footer: {
        text: "También puedes pedir bar abierto, DJ, postres u otros adicionales."
      },
      action: {
        button: "Ver opciones",
        sections: [
          {
            title: "Formatos principales",
            rows: [
              {
                id: INTERACTIVE_IDS.SERVICE_COCKTAIL,
                title: "Cóctel Parrillero",
                description: "Formato social con carnes ahumadas y tablas."
              },
              {
                id: INTERACTIVE_IDS.SERVICE_ASADO,
                title: "Asado al Plato",
                description: "Experiencia completa con guarniciones."
              },
              {
                id: INTERACTIVE_IDS.SERVICE_MIXTO,
                title: "Servicio Mixto",
                description: "Cóctel inicial + asado al plato."
              }
            ]
          },
          {
            title: "Adicionales",
            rows: [
              {
                id: INTERACTIVE_IDS.EXTRA_BAR,
                title: "Bar abierto",
                description: "Complemento para eventos y celebraciones."
              },
              {
                id: INTERACTIVE_IDS.EXTRA_DJ,
                title: "DJ / Música",
                description: "Ambiente musical para el evento."
              },
              {
                id: INTERACTIVE_IDS.EXTRA_POSTRES,
                title: "Postres",
                description: "Opciones dulces para cerrar el servicio."
              }
            ]
          }
        ]
      }
    }
  };
}

export function buildQuotePromptPayload({ to, tenant }) {
  return {
    messaging_product: "whatsapp",
    to,
    type: "interactive",
    interactive: {
      type: "button",
      body: {
        text: `Perfecto 😊 Para cotizar tu evento en *${tenantDisplayName(tenant)}*, cuéntame por favor:

1. Cantidad de personas
2. Comuna/lugar
3. Fecha del evento

También puedes elegir si quieres ver servicios o hablar con un asesor.`
      },
      action: {
        buttons: [
          {
            type: "reply",
            reply: {
              id: INTERACTIVE_IDS.VIEW_SERVICES,
              title: "Ver servicios"
            }
          },
          {
            type: "reply",
            reply: {
              id: INTERACTIVE_IDS.TALK_AGENT,
              title: "Hablar asesor"
            }
          }
        ]
      }
    }
  };
}

export function interactiveSelectionToText({ id, title }) {
  const selected = String(id || "").toLowerCase();
  const fallbackTitle = title ? `Seleccioné: ${title}` : "Seleccioné una opción";

  const map = {
    [INTERACTIVE_IDS.QUOTE_EVENT]: "Quiero cotizar un evento",
    [INTERACTIVE_IDS.VIEW_SERVICES]: "Quiero ver los servicios disponibles",
    [INTERACTIVE_IDS.TALK_AGENT]: "Quiero hablar con un asesor humano",
    [INTERACTIVE_IDS.SERVICE_COCKTAIL]: "Me interesa el Cóctel Parrillero",
    [INTERACTIVE_IDS.SERVICE_ASADO]: "Me interesa el Asado al Plato",
    [INTERACTIVE_IDS.SERVICE_MIXTO]: "Me interesa el Servicio Mixto",
    [INTERACTIVE_IDS.EXTRA_BAR]: "Quiero agregar bar abierto",
    [INTERACTIVE_IDS.EXTRA_DJ]: "Quiero agregar DJ o música",
    [INTERACTIVE_IDS.EXTRA_POSTRES]: "Quiero agregar postres"
  };

  return map[selected] || fallbackTitle;
}

export async function sendWelcomeInteractive({ tenant, contact, channel, trace = null }) {
  if (channel !== "whatsapp") return null;

  traceStep(trace, "INTERACTIVE_WELCOME_START", {
    tenantId: tenant?.id,
    to: contact?.externalId
  });

  return sendWhatsAppInteractive({
    to: contact.externalId,
    payload: buildWelcomeButtonsPayload({ to: contact.externalId, tenant }),
    tenant,
    tenantId: tenant?.id,
    trace
  });
}

export async function sendServicesListInteractive({ tenant, contact, channel, trace = null }) {
  if (channel !== "whatsapp") return null;

  traceStep(trace, "INTERACTIVE_SERVICES_LIST_START", {
    tenantId: tenant?.id,
    to: contact?.externalId
  });

  return sendWhatsAppInteractive({
    to: contact.externalId,
    payload: buildServicesListPayload({ to: contact.externalId, tenant }),
    tenant,
    tenantId: tenant?.id,
    trace
  });
}

export async function sendQuotePromptInteractive({ tenant, contact, channel, trace = null }) {
  if (channel !== "whatsapp") return null;

  traceStep(trace, "INTERACTIVE_QUOTE_PROMPT_START", {
    tenantId: tenant?.id,
    to: contact?.externalId
  });

  return sendWhatsAppInteractive({
    to: contact.externalId,
    payload: buildQuotePromptPayload({ to: contact.externalId, tenant }),
    tenant,
    tenantId: tenant?.id,
    trace
  });
}

export async function persistInteractiveOutbound({ tenantId, conversationId, contactId, channel, content, metadata = null }) {
  return prisma.message.create({
    data: {
      tenantId,
      conversationId,
      contactId,
      channel,
      direction: "OUTBOUND",
      content,
      type: "OTHER",
      status: "SENT",
      metadata
    }
  });
}
