const ALTA_BRASA_KEYWORDS = /(alta\s*brasa|parrillad|asado|asados|parrillero|cóctel|cocktail|coctel|matrimonio|boda|empresa|corporativo|evento|cumple|fiesta)/i;

export const ALTA_BRASA_KNOWLEDGE = {
  businessName: "Eventos Alta Brasa",
  industry: "parrilladas",
  tone: "premium, cercano, elegante y experto en eventos gastronómicos",
  positioning:
    "Eventos Alta Brasa realiza experiencias de parrilladas para eventos, con servicio cuidado, carnes premium y formatos adaptables a celebraciones, empresas y matrimonios.",
  coreRules: [
    "Responder como asesor experto del negocio, no como bot genérico.",
    "Responder primero la pregunta del cliente con información precisa y luego guiar la conversación.",
    "No copiar textos largos literalmente; resumir, explicar y mantener tono premium.",
    "Si consultan por precios, pedir o confirmar cantidad de personas, comuna/lugar, fecha y tipo de servicio antes de dar una cotización final.",
    "Si el cliente muestra interés alto, proponer reserva, agenda o contacto humano.",
    "Mantener respuestas breves, naturales y con una sola pregunta final."
  ],
  services: [
    {
      id: "coctel-parrillero",
      name: "Cóctel Parrillero",
      summary:
        "Formato innovador y social, ideal para sorprender a los invitados en espacios reducidos o eventos dinámicos.",
      details:
        "Se usa una parrilla colgante donde las carnes se ahúman lentamente con leña frutal, logrando un sabor auténtico. Durante el evento se sirven cortes selectos, embutidos artesanales, frutas frescas y verduras asadas, presentados en tablas rústicas elegantes. No requiere mesas ni sillas, por lo que fomenta la interacción entre invitados.",
      keywords: ["cóctel", "coctel", "cocktail", "tablas", "espacio reducido", "bocados", "bienvenida"]
    },
    {
      id: "asado-al-plato",
      name: "Asado al Plato",
      summary:
        "Experiencia gastronómica completa con carnes premium, guarniciones y buffet de ensaladas frescas.",
      details:
        "Las carnes se cocinan al fuego en parrilla colgante y se potencian con ahumado de leña frutal. Incluye guarniciones y buffet variado de ensaladas frescas. Se trabaja exclusivamente con carnes de origen argentino, uruguayo y estadounidense, todas de raza Angus y crianza seleccionada.",
      keywords: ["asado al plato", "plato", "ensaladas", "guarniciones", "cena", "almuerzo"]
    },
    {
      id: "servicio-mixto",
      name: "Servicio Mixto: Cóctel + Asado al Plato",
      summary:
        "Experiencia progresiva que combina una bienvenida tipo cóctel con un asado al plato premium.",
      details:
        "Comienza con Cóctel Parrillero, con bocados gourmet, frutas, verduras y embutidos, para dar la bienvenida en un ambiente relajado. Luego continúa con Asado al Plato, con carnes premium, guarniciones y ensaladas. Es una experiencia completa, cuidada y elegante, pensada para sorprender en cada etapa del evento.",
      keywords: ["mixto", "cóctel y asado", "coctel y asado", "completo", "progresivo"]
    }
  ],
  extras: ["Bar abierto", "Postres", "Mobiliario", "Vajilla", "DJ", "personalización del evento"],
  qualityNotes: [
    "Carnes de origen argentino, uruguayo y estadounidense.",
    "Carnes Angus y de crianza seleccionada.",
    "Uso de leña frutal para un ahumado auténtico.",
    "Presentación elegante en tablas rústicas y servicio cuidado."
  ],
  faq: [
    {
      intent: "SERVICES_OVERVIEW",
      keywords: ["servicios", "ofrecen", "hacen", "qué hacen", "que hacen"],
      answer:
        "Ofrecemos Cóctel Parrillero, Asado al Plato y Servicio Mixto. También podemos sumar bar abierto, postres, mobiliario, vajilla, DJ y otros extras según el evento."
    },
    {
      intent: "COCKTAIL",
      keywords: ["cóctel", "coctel", "cocktail", "tablas", "espacio reducido"],
      answer:
        "El Cóctel Parrillero es un formato social con parrilla colgante, carnes ahumadas con leña frutal, embutidos artesanales, frutas y verduras asadas servidas en tablas rústicas. Es ideal para espacios reducidos y eventos dinámicos."
    },
    {
      intent: "PLATED_ASADO",
      keywords: ["asado al plato", "plato", "ensaladas", "guarniciones"],
      answer:
        "El Asado al Plato es una experiencia completa con carnes al fuego en parrilla colgante, guarniciones y buffet de ensaladas frescas. Trabajamos con carnes Angus argentinas, uruguayas y estadounidenses."
    },
    {
      intent: "MIXED_SERVICE",
      keywords: ["mixto", "cóctel y asado", "coctel y asado", "completo"],
      answer:
        "El Servicio Mixto combina una primera etapa de Cóctel Parrillero con bocados gourmet y luego Asado al Plato con carnes premium, guarniciones y ensaladas. Es ideal para un evento completo y progresivo."
    },
    {
      intent: "MEAT_QUALITY",
      keywords: ["carne", "carnes", "calidad", "angus", "origen", "cortes"],
      answer:
        "Trabajamos exclusivamente con carnes de origen argentino, uruguayo y estadounidense, todas Angus y de crianza seleccionada. Además, usamos leña frutal para potenciar el sabor con ahumado natural."
    },
    {
      intent: "EXTRAS",
      keywords: ["bar", "tragos", "postres", "dj", "mobiliario", "vajilla", "adicional"],
      answer:
        "Sí, contamos con servicios adicionales como bar abierto, postres, mobiliario, vajilla, DJ y otros complementos para personalizar el evento."
    },
    {
      intent: "PRICE_QUOTE",
      keywords: ["precio", "valor", "cuánto", "cuanto", "cotizar", "cotización", "cotizacion"],
      answer:
        "El valor depende del tipo de servicio, cantidad de personas, comuna/lugar, fecha y adicionales. Para cotizar bien necesitamos esos datos."
    }
  ]
};

export const ECOMMERCE_KNOWLEDGE = {
  businessName: "Demo Ecommerce",
  industry: "ecommerce",
  tone: "claro, amable, rápido y orientado a recomendar productos",
  positioning:
    "Tienda online que ayuda a clientes a encontrar productos, confirmar precio, stock, despacho y alternativas.",
  coreRules: [
    "Responder primero la duda del cliente y luego recomendar máximo dos productos.",
    "Si preguntan por stock, precio o despacho, usar los productos disponibles del catálogo.",
    "No inventar stock, precios ni tiempos de despacho.",
    "Si falta información, preguntar presupuesto, uso o preferencia principal."
  ],
  faq: [
    {
      intent: "SHIPPING",
      keywords: ["despacho", "envío", "envio", "delivery", "entrega"],
      answer: "Podemos orientar el despacho según comuna o región. Para confirmarlo bien necesitamos saber a dónde sería la entrega."
    },
    {
      intent: "STOCK_PRICE",
      keywords: ["stock", "precio", "valor", "cuánto", "cuanto", "disponible"],
      answer: "Puedo revisar precio y disponibilidad según el producto que te interese."
    },
    {
      intent: "RECOMMENDATION",
      keywords: ["recomiendas", "recomendar", "mejor", "busco", "necesito"],
      answer: "Te puedo recomendar opciones según presupuesto, uso y preferencia."
    }
  ]
};

export const REAL_ESTATE_KNOWLEDGE = {
  businessName: "Demo Inmobiliaria",
  industry: "inmobiliaria",
  tone: "profesional, cercano y consultivo",
  positioning:
    "Inmobiliaria enfocada en orientar clientes interesados en departamentos y casas, coordinar visitas y calificar oportunidades.",
  coreRules: [
    "Preguntar comuna, presupuesto, tipo de propiedad y si busca vivir o invertir.",
    "Si ya hay datos, recomendar opciones del catálogo y proponer visita.",
    "No inventar disponibilidad ni precios fuera del catálogo.",
    "Responder con claridad antes de pedir demasiados datos."
  ],
  faq: [
    {
      intent: "VISIT",
      keywords: ["visita", "ver", "agendar", "conocer"],
      answer: "Podemos coordinar una visita según disponibilidad. Para avanzar, necesitamos comuna o propiedad de interés y horario tentativo."
    },
    {
      intent: "BUDGET",
      keywords: ["presupuesto", "precio", "arriendo", "valor", "cuánto", "cuanto"],
      answer: "El valor depende de la comuna, dormitorios y características. Si me indicas presupuesto y comuna, puedo recomendar opciones."
    },
    {
      intent: "INVESTMENT",
      keywords: ["inversión", "inversion", "invertir", "rentabilidad"],
      answer: "Para inversión conviene mirar ubicación, conectividad, demanda de arriendo y precio de entrada."
    }
  ]
};

function includesAny(text = "", keywords = []) {
  const lower = String(text || "").toLowerCase();
  return keywords.some((keyword) => lower.includes(String(keyword).toLowerCase()));
}

export function isAltaBrasaTenant(tenant = {}) {
  const text = `${tenant?.name || ""} ${tenant?.slug || ""} ${tenant?.industry || ""} ${tenant?.businessPrompt || ""}`;
  return ALTA_BRASA_KEYWORDS.test(text) || /alta\s*brasa|demo-parrilladas/i.test(text);
}

export function detectTenantProfile(tenant = {}) {
  const text = `${tenant?.name || ""} ${tenant?.slug || ""} ${tenant?.industry || ""} ${tenant?.businessPrompt || ""}`.toLowerCase();
  if (isAltaBrasaTenant(tenant)) return ALTA_BRASA_KNOWLEDGE;
  if (/ecommerce|e-commerce|tienda|retail|catálogo|catalogo|productos|demo-ecommerce/.test(text)) return ECOMMERCE_KNOWLEDGE;
  if (/inmobiliaria|propiedad|departamento|casa|arriendo|inversión|inversion|demo-inmobiliaria/.test(text)) return REAL_ESTATE_KNOWLEDGE;
  return null;
}

export function findKnowledgeFaqAnswer(message = "", knowledge = null) {
  if (!knowledge?.faq?.length) return null;
  const text = String(message || "").toLowerCase();
  return knowledge.faq.find((item) => includesAny(text, item.keywords));
}

export function findAltaBrasaFaqAnswer(message = "") {
  return findKnowledgeFaqAnswer(message, ALTA_BRASA_KNOWLEDGE);
}

export function detectAltaBrasaService(message = "") {
  const text = String(message || "").toLowerCase();
  return ALTA_BRASA_KNOWLEDGE.services.find((service) => includesAny(text, service.keywords)) || null;
}

export function buildBusinessKnowledgeContext({ tenant = {}, message = "" } = {}) {
  const knowledge = detectTenantProfile(tenant);
  if (!knowledge) return "";

  const faq = findKnowledgeFaqAnswer(message, knowledge);
  const service = knowledge === ALTA_BRASA_KNOWLEDGE ? detectAltaBrasaService(message) : null;
  const serviceContext = knowledge.services?.length
    ? knowledge.services.map((item) => `- ${item.name}: ${item.summary} Detalle: ${item.details}`).join("\n")
    : "";

  return `
Perfil de negocio activo:
- Nombre: ${knowledge.businessName}
- Rubro: ${knowledge.industry}
- Tono: ${knowledge.tone}
- Posicionamiento: ${knowledge.positioning}

${serviceContext ? `Servicios oficiales:\n${serviceContext}` : ""}
${knowledge.extras?.length ? `Servicios adicionales: ${knowledge.extras.join(", ")}` : ""}
${knowledge.qualityNotes?.length ? `Diferenciadores de calidad:\n${knowledge.qualityNotes.map((n) => `- ${n}`).join("\n")}` : ""}
${faq ? `Respuesta base relevante (${faq.intent}): ${faq.answer}` : "No hay FAQ específica detectada; responde con el perfil del negocio y el catálogo disponible."}
${service ? `Servicio detectado: ${service.name}. Prioriza este detalle: ${service.details}` : ""}

Reglas del negocio:
${knowledge.coreRules.map((rule) => `- ${rule}`).join("\n")}
`;
}

export function buildAltaBrasaKnowledgeContext(message = "") {
  return buildBusinessKnowledgeContext({ tenant: { slug: "demo-parrilladas", name: "Eventos Alta Brasa", industry: "parrilladas" }, message });
}

export function businessKnowledgeFallbackReply({ tenant = {}, userMessage = "", preferences = {}, products = [], isClosing = false } = {}) {
  const knowledge = detectTenantProfile(tenant);
  if (!knowledge) return null;

  if (knowledge === ALTA_BRASA_KNOWLEDGE) {
    return altaBrasaFallbackReply({ userMessage, preferences, isClosing });
  }

  const faq = findKnowledgeFaqAnswer(userMessage, knowledge);
  if (knowledge === ECOMMERCE_KNOWLEDGE) {
    const top = products?.[0];
    if (top) {
      const price = Number(top.price || 0).toLocaleString("es-CL", { maximumFractionDigits: 0 });
      return `Te puedo recomendar ${top.name}. ${top.description || ""}\n\nPrecio: $${price}. Stock: ${top.stock > 0 ? "disponible" : "limitado"}.\n\n¿Lo buscas para comprar ahora o quieres comparar otra opción?`;
    }
    return `${faq?.answer || "Te ayudo feliz a encontrar el producto ideal."}\n\n¿Qué tipo de producto buscas y cuál es tu presupuesto aproximado?`;
  }

  if (knowledge === REAL_ESTATE_KNOWLEDGE) {
    const top = products?.[0];
    if (top) {
      const price = Number(top.price || 0).toLocaleString("es-CL", { maximumFractionDigits: 0 });
      return `Tengo una opción que puede calzar: ${top.name}. ${top.description || ""}\n\nValor referencial: $${price}, ubicación: ${top.location || "por confirmar"}.\n\n¿Buscas para vivir o como inversión?`;
    }
    return `${faq?.answer || "Te puedo orientar con opciones según comuna, presupuesto y tipo de propiedad."}\n\n¿En qué comuna estás buscando y cuál es tu presupuesto aproximado?`;
  }

  return faq?.answer || null;
}

export function altaBrasaFallbackReply({ userMessage = "", preferences = {}, isClosing = false } = {}) {
  const service = detectAltaBrasaService(userMessage);
  const faq = findAltaBrasaFaqAnswer(userMessage);
  const missing = [];
  if (!preferences?.guests) missing.push("cantidad de personas");
  if (!preferences?.location) missing.push("comuna o lugar");
  if (!preferences?.date) missing.push("fecha");

  if (isClosing) {
    return "Buenísimo 🙌 para avanzar con la reserva necesito nombre, teléfono, fecha y comuna del evento. ¿Me compartes esos datos y lo dejamos encaminado?";
  }

  if (faq?.intent === "MEAT_QUALITY") {
    const nextQuestion = preferences?.guests
      ? (missing.length ? `Para orientarte mejor, ¿me confirmas ${missing.join(", ")}?` : "¿Tu evento sería más tipo cóctel parrillero o asado al plato?")
      : "¿Para cuántas personas sería el evento?";
    return `${faq.answer}

${nextQuestion}`;
  }

  if (service) {
    const nextQuestion = preferences?.guests
      ? (missing.length ? `Para recomendarte mejor, ¿me confirmas ${missing.join(", ")}?` : "¿Quieres que lo enfoquemos como evento formal o celebración más relajada?")
      : "Para orientarte mejor, ¿para cuántas personas sería el evento?";
    return `${service.name} es una excelente opción ✨ ${service.summary}\n\n${service.details}\n\n${nextQuestion}`;
  }

  if (faq) {
    const nextQuestion = preferences?.guests
      ? (missing.length ? `Para afinar la recomendación, ¿me confirmas ${missing.join(", ")}?` : "¿Quieres que te sugiera el formato más adecuado para ese evento?")
      : "Para recomendarte el formato ideal, ¿para cuántas personas sería el evento?";
    return `${faq.answer}\n\n${nextQuestion}`;
  }

  if (/recomiendas|recomendar|recomienden|sugieres|sugerir|conviene|mejor opción|mejor opcion/i.test(userMessage)) {
    if (preferences?.guests && preferences.guests >= 35) {
      return `Para ${preferences.guests} personas, la opción que más recomendaría es el Servicio Mixto 🔥\n\nParte con Cóctel Parrillero para recibir a los invitados con bocados gourmet, embutidos, frutas y verduras asadas; luego continúa con Asado al Plato con carnes premium, guarniciones y ensaladas. Es ideal para que el evento se sienta completo y progresivo.\n\n¿Sería para empresa, matrimonio o celebración familiar?`;
    }
    if (preferences?.guests) {
      return `Para ${preferences.guests} personas podemos orientar el evento según el estilo que buscas. Si quieres algo más dinámico y social, el Cóctel Parrillero funciona muy bien; si buscas una experiencia más completa, el Asado al Plato o el Servicio Mixto son mejores opciones.\n\n¿La idea es algo formal o más relajado?`;
    }
  }

  return "Hola 🙌 en Eventos Alta Brasa ofrecemos Cóctel Parrillero, Asado al Plato y Servicio Mixto, además de extras como bar abierto, postres, mobiliario, vajilla y DJ.\n\n¿Para cuántas personas sería el evento?";
}
