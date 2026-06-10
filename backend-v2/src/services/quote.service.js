
import { prisma } from "../lib/db.js";

function normalize(text = "") {
  return String(text || "").toLowerCase();
}

function money(value = 0) {
  return new Intl.NumberFormat("es-CL").format(Number(value || 0));
}

function detectBasePrice(serviceName = "") {
  const value = normalize(serviceName);

  if (value.includes("mixto")) return 18000;
  if (value.includes("asado")) return 22000;
  if (value.includes("cocktail") || value.includes("coctel")) return 14000;

  return 16000;
}

function detectExtraPrice(extra = "") {
  const value = normalize(extra);

  if (value.includes("dj")) return 120000;
  if (value.includes("postre")) return 90000;
  if (value.includes("decor")) return 150000;
  if (value.includes("bar")) return 250000;

  return 50000;
}

export async function buildEventQuote({
  tenantId,
  eventData = {},
  memory = {}
}) {
  const guests = Number(eventData.guests || memory.guests || 0);
  const location = eventData.location || memory.location || "No especificado";
  const date = eventData.date || memory.date || "No especificado";
  const service = eventData.service || memory.service || "Servicio Mixto";
  const extras = Array.isArray(eventData.extras) && eventData.extras.length
    ? eventData.extras
    : Array.isArray(memory.extras)
      ? memory.extras
      : [];

  if (!guests || guests <= 0) {
    return {
      ready: false,
      missing: "guests"
    };
  }

  // Primero intentamos usar precios reales cargados en BD para el tenant.
  const dbService = tenantId ? await prisma.service.findFirst({
    where: {
      tenantId,
      isActive: true,
      OR: [
        { name: { contains: service, mode: "insensitive" } },
        { name: { contains: service.replace(/servicio/gi, "").trim(), mode: "insensitive" } }
      ]
    },
    orderBy: [{ priority: "asc" }, { updatedAt: "desc" }]
  }).catch(() => null) : null;

  const serviceName = dbService?.name || service;
  const dbBasePrice = Number(dbService?.basePrice || 0);
  const dbPricePerGuest = Number(dbService?.pricePerGuest || 0);

  const basePrice = dbPricePerGuest > 0 ? dbPricePerGuest : detectBasePrice(serviceName);
  const fixedBase = dbBasePrice > 0 ? dbBasePrice : 0;
  const serviceTotal = fixedBase + guests * basePrice;

  let extrasTotal = 0;

  const extrasBreakdown = extras.map((extra) => {
    const price = detectExtraPrice(extra);
    extrasTotal += price;

    return {
      name: extra,
      price
    };
  });

  const total = serviceTotal + extrasTotal;
  const includes = Array.isArray(dbService?.includes) ? dbService.includes : [];

  return {
    ready: true,
    guests,
    location,
    date,
    service: serviceName,
    extras,
    basePrice,
    fixedBase,
    serviceTotal,
    extrasBreakdown,
    extrasTotal,
    total,
    formatted: `✅ Cotización final para tu evento

📍 Lugar: ${location}
📅 Fecha: ${date}
👥 Personas: ${guests}

🔥 Servicio seleccionado:
${serviceName}

💰 Valor por persona:
$${money(basePrice)} CLP${fixedBase ? `

🧾 Cargo base:
$${money(fixedBase)} CLP` : ""}

💵 Subtotal servicio:
$${money(serviceTotal)} CLP

${extrasBreakdown.length ? `✨ Adicionales:
${extrasBreakdown.map((e) => `- ${e.name}: $${money(e.price)} CLP`).join("\n")}

💸 Total adicionales:
$${money(extrasTotal)} CLP
` : ""}

🎯 Total estimado:
$${money(total)} CLP

${includes.length ? `Incluye:
${includes.slice(0, 6).map((item) => `- ${item}`).join("\n")}
` : `Incluye:
- montaje
- personal de servicio
- parrilleros
- coordinación básica del evento
`}

Para dejarlo bien cerrado, uno de nuestros ejecutivos puede revisar disponibilidad y confirmar los últimos detalles de logística.

También podemos ajustar la cotización si quieres:
- modificar cantidad de personas
- agregar o quitar adicionales
- cambiar el formato del servicio
- adaptar la propuesta a tu presupuesto

¿Quieres que la dejemos como está para avanzar con la reserva o prefieres modificar algo? 😊`
  };
}

