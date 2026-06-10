
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
  const guests =
    Number(eventData.guests || memory.guests || 0);

  const location =
    eventData.location || memory.location || "No especificado";

  const date =
    eventData.date || memory.date || "No especificado";

  const service =
    eventData.service || memory.service || "Servicio Mixto";

  const extras =
    eventData.extras ||
    memory.extras ||
    [];

  if (!guests || guests <= 0) {
    return {
      ready: false,
      missing: "guests"
    };
  }

  const basePrice = detectBasePrice(service);
  const serviceTotal = guests * basePrice;

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

  return {
    ready: true,
    guests,
    location,
    date,
    service,
    extras,
    basePrice,
    serviceTotal,
    extrasBreakdown,
    extrasTotal,
    total,
    formatted: `✅ Cotización final para tu evento:

📍 Comuna/Lugar: ${location}
📅 Fecha: ${date}
👥 Personas: ${guests}

🔥 Servicio contratado:
${service}

💰 Valor por persona:
$${money(basePrice)} CLP

💵 Subtotal servicio:
$${money(serviceTotal)} CLP

${extrasBreakdown.length ? `✨ Adicionales:
${extrasBreakdown.map((e) => `- ${e.name}: $${money(e.price)}`).join("\n")}

💸 Total adicionales:
$${money(extrasTotal)} CLP
` : ""}

🎯 TOTAL FINAL:
$${money(total)} CLP

Incluye:
- montaje
- personal
- parrilleros
- coordinación básica

¿Te gustaría avanzar con la reserva? 😊`
  };
}
