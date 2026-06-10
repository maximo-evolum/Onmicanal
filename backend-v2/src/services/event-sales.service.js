import { prisma } from "../lib/db.js";

const EVENT_KEYWORDS = /(asado|asados|parrillada|parrilladas|parrillero|evento|eventos|cumple|cumpleaños|matrimonio|boda|empresa|corporativo|cena|almuerzo|fiesta)/i;

export function isEventServiceIntent(message = "", tenant = {}) {
  const text = `${message || ""} ${tenant?.industry || ""} ${tenant?.businessPrompt || ""}`;
  return EVENT_KEYWORDS.test(text);
}

export function detectEventScenario(message = "") {
  const text = String(message || "").toLowerCase();
  if (/(empresa|corporativo|oficina|equipo|colaboradores|trabajo)/i.test(text)) return "business";
  if (/(matrimonio|boda|novios|casamiento)/i.test(text)) return "wedding";
  if (/(cumple|cumpleaños|fiesta|celebración|celebracion|junta|familia|amigos)/i.test(text)) return "party";
  return "general";
}

export function extractEventPreferences(message = "") {
  const text = String(message || "").toLowerCase();

  let guests = null;
  const guestMatch = text.match(/(\d{1,4})\s*(personas|pax|invitados|asistentes|gente)/i) || text.match(/somos\s*(\d{1,4})/i);
  if (guestMatch) guests = Number(guestMatch[1]);

  let date = null;
  const explicitDate = text.match(/\b(lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo)\s*(\d{1,2})?\b/i);
  if (explicitDate) {
    date = `${explicitDate[1]}${explicitDate[2] ? ` ${explicitDate[2]}` : ""}`.replace("sabado", "sábado");
  }

  const dateHints = ["hoy", "mañana", "sábado", "sabado", "domingo", "viernes", "fin de semana", "próxima semana", "proxima semana"];
  if (!date) {
    for (const hint of dateHints) {
      if (text.includes(hint)) { date = hint; break; }
    }
  }

  let location = null;
  const comunas = [
    "santiago", "maipú", "maipu", "providencia", "ñuñoa", "nunoa", "la florida", "puente alto",
    "las condes", "vitacura", "lo barnechea", "san miguel", "la reina", "peñalolén", "penalolen",
    "quilicura", "renca", "independencia", "recoleta", "huechuraba", "pudahuel",
    "lampa", "colina", "chicureo", "pirque", "buin", "paine", "san bernardo", "calera de tango",
    "talagante", "peñaflor", "penaflor", "melipilla", "puerto montt"
  ];
  for (const comuna of comunas) {
    if (text.includes(comuna)) { location = comuna; break; }
  }

  return { guests, date, location, scenario: detectEventScenario(message) };
}

function desiredServiceNameFromQuery(query = "") {
  const text = String(query || "").toLowerCase();
  if (/(mixto|cóctel\s*\+\s*asado|coctel\s*\+\s*asado|completo|progresiv)/i.test(text)) return "Servicio Mixto";
  if (/(asado\s*al\s*plato|plato|ensaladas|guarniciones|cena|almuerzo)/i.test(text)) return "Asado al Plato";
  if (/(cóctel|coctel|cocktail|tablas|espacio reducido|bocados|bienvenida)/i.test(text)) return "Cóctel Parrillero";
  return null;
}

export async function getPrimaryService({ tenantId, query = "" }) {
  if (!tenantId) return null;

  const desiredName = desiredServiceNameFromQuery(query);
  if (desiredName) {
    const specific = await prisma.service.findFirst({
      where: {
        tenantId,
        isActive: true,
        name: { contains: desiredName, mode: "insensitive" }
      },
      orderBy: [{ priority: "asc" }, { updatedAt: "desc" }]
    });
    if (specific) return specific;
  }

  return prisma.service.findFirst({
    where: { tenantId, isActive: true },
    orderBy: [{ priority: "asc" }, { updatedAt: "desc" }]
  });
}

export function estimateServiceQuote({ service, guests }) {
  if (!service) return null;
  const safeGuests = Number(guests || service.minGuests || 20);
  const total = Number(service.basePrice || 0) + safeGuests * Number(service.pricePerGuest || 0);
  return { guests: safeGuests, total: Math.round(total) };
}

export function buildServiceContext({ service, preferences }) {
  if (!service) {
    return "No hay servicios cargados. Debes recopilar personas, comuna y fecha, y derivar a humano para cotización.";
  }

  const includes = Array.isArray(service.includes) ? service.includes.join(", ") : "servicio de parrillada";
  const zones = Array.isArray(service.zones) ? service.zones.join(", ") : "zona a coordinar";
  const hasPricing = Number(service.basePrice || 0) > 0 || Number(service.pricePerGuest || 0) > 0;
  const quote = preferences?.guests && hasPricing ? estimateServiceQuote({ service, guests: preferences.guests }) : null;

  return `Servicio principal:\n- Nombre: ${service.name}\n- Precio base: $${Number(service.basePrice || 0).toLocaleString("es-CL")}\n- Precio por persona: $${Number(service.pricePerGuest || 0).toLocaleString("es-CL")}\n- Mínimo personas: ${service.minGuests || "N/A"}\n- Incluye: ${includes}\n- Zonas: ${zones}\n- Notas: ${service.notes || "N/A"}\n${quote ? `- Estimación para ${quote.guests} personas: $${quote.total.toLocaleString("es-CL")}` : "- Cotización personalizada: depende de personas, fecha, comuna/lugar, tipo de servicio y adicionales."}`;
}

export function scenarioInstruction(scenario = "general") {
  if (scenario === "business") {
    return "Escenario corporativo: tono más profesional, destacar puntualidad, logística, factura/propuesta formal y coordinación para equipos.";
  }
  if (scenario === "wedding") {
    return "Escenario matrimonio/evento grande: tono cuidadoso y premium, recomendar agendar para coordinar detalles, menú y logística.";
  }
  if (scenario === "party") {
    return "Escenario fiesta/cumpleaños: tono cercano y alegre, destacar que se encargan de todo para que el cliente disfrute.";
  }
  return "Escenario general: calificar rápido y pedir personas, comuna y fecha.";
}
