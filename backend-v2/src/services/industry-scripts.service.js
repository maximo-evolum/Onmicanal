
export function normalizeIndustry(input = "") {
  const t = String(input || "").toLowerCase();
  if (/(parrilla|asado|evento|banqueter|catering)/i.test(t)) return "parrilladas";
  if (/(ecommerce|tienda|producto|retail|ropa|zapatilla|venta online)/i.test(t)) return "ecommerce";
  if (/(servicio|asesor|consultor|agencia|profesional)/i.test(t)) return "servicios";
  if (/(inmobiliaria|departamento|casa|arriendo|propiedad)/i.test(t)) return "inmobiliaria";
  return "general";
}

export function getIndustryScript(industry = "general") {
  const scripts = {
    parrilladas: {
      discovery: "Pregunta personas, comuna/lugar y fecha. Explica que el servicio puede incluir parrillero, carnes, acompañamientos y logística.",
      objection_price: "Refuerza que el valor incluye servicio completo, coordinación y tranquilidad para el evento. Ofrece ajustar según presupuesto.",
      closing: "Propón reservar fecha, agendar coordinación o enviar link de abono.",
      handoff: "Deriva a humano si el evento es grande, urgente o corporativo."
    },
    ecommerce: {
      discovery: "Pregunta qué busca, presupuesto, talla/modelo/preferencia si aplica. Recomienda máximo dos productos.",
      objection_price: "Ofrece alternativa más económica o destaca calidad, garantía, despacho o beneficio.",
      closing: "Propón comprar ahora, reservar stock o enviar link de pago.",
      handoff: "Deriva a humano ante reclamos, cambios o compras de alto monto."
    },
    servicios: {
      discovery: "Pregunta problema principal, urgencia y objetivo. Resume la solución en simple.",
      objection_price: "Habla de resultado esperado y retorno, no solo horas/precio.",
      closing: "Propón agendar llamada, diagnóstico o enviar propuesta.",
      handoff: "Deriva a humano si pide contrato, propuesta formal o negociación."
    },
    inmobiliaria: {
      discovery: "Pregunta comuna, presupuesto, tipo de propiedad y finalidad. Recomienda opciones concretas.",
      objection_price: "Ofrece alternativas por comuna, tamaño o condición, y refuerza valor de ubicación.",
      closing: "Propón agendar visita o enviar ficha completa.",
      handoff: "Deriva si quiere visita, reserva o negociación."
    },
    general: {
      discovery: "Haz una pregunta breve para entender necesidad, presupuesto y urgencia.",
      objection_price: "Responde con valor antes de volver al precio.",
      closing: "Propón el siguiente paso concreto.",
      handoff: "Deriva si detectas urgencia alta, molestia o intención de pago."
    }
  };
  return scripts[industry] || scripts.general;
}
