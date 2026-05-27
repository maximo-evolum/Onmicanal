// Sales Brain Engine
// Inspirado en principios comerciales del playbook de ventas cargado por el usuario.
// No usa el libro completo en prompts: transforma principios en señales, modos y estrategias reutilizables.

const OBJECTION_PATTERNS = [
  {
    type: "price",
    label: "Objeción de precio",
    patterns: [/(muy )?car[oa]/i, /precio alto/i, /se me escapa/i, /fuera de presupuesto/i, /más barato/i, /mas barato/i, /descuento/i],
    strategy: "validar la preocupación, reforzar valor total y descubrir rango de presupuesto sin presionar"
  },
  {
    type: "delay",
    label: "Postergación",
    patterns: [/lo veo despu[eé]s/i, /más adelante/i, /mas adelante/i, /otro d[ií]a/i, /despu[eé]s te digo/i, /lo voy a pensar/i, /tengo que pensarlo/i],
    strategy: "validar la pausa, descubrir qué falta para decidir y proponer un próximo paso pequeño"
  },
  {
    type: "doubt",
    label: "Duda o indecisión",
    patterns: [/no estoy seguro/i, /tengo dudas/i, /no me convence/i, /no sé/i, /no se/i, /quiz[aá]s/i],
    strategy: "reducir incertidumbre explicando simple, confirmar necesidad y resolver la duda principal"
  },
  {
    type: "comparison",
    label: "Comparación con alternativa",
    patterns: [/estoy comparando/i, /vi otra opci[oó]n/i, /en otro lado/i, /la competencia/i, /otro proveedor/i],
    strategy: "diferenciar por valor, experiencia y tranquilidad sin atacar a la competencia"
  },
  {
    type: "trust",
    label: "Confianza o prueba social",
    patterns: [/son confiables/i, /tienen referencias/i, /opiniones/i, /fotos/i, /videos/i, /garant[ií]a/i, /cómo sé/i, /como se/i],
    strategy: "entregar señales de confianza, explicar el proceso y ofrecer prueba o siguiente paso seguro"
  },
  {
    type: "availability",
    label: "Disponibilidad",
    patterns: [/disponible/i, /hay cupo/i, /tienen fecha/i, /stock/i, /agotado/i, /no hay/i],
    strategy: "revisar disponibilidad, pedir dato clave y proponer alternativa si aplica"
  },
  {
    type: "location",
    label: "Ubicación o cobertura",
    patterns: [/muy lejos/i, /lejos/i, /no llegan/i, /despacho/i, /zona/i, /comuna/i, /ubicaci[oó]n/i],
    strategy: "confirmar zona, explicar cobertura o coordinar alternativa"
  }
];

const BUYING_SIGNALS = [
  /me interesa/i,
  /lo quiero/i,
  /quiero avanzar/i,
  /reservar/i,
  /agendar/i,
  /comprar/i,
  /cómo pago/i,
  /como pago/i,
  /confirmar/i,
  /me sirve/i,
  /dale/i,
  /perfecto/i
];

const INFO_PATTERNS = [
  /qu[eé] (incluye|ofrecen|hacen|tienen)/i,
  /cu[aá]l es/i,
  /diferencia/i,
  /expl[ií]came/i,
  /informaci[oó]n/i,
  /carnes?/i,
  /servicios?/i,
  /calidad/i
];

const QUOTE_PATTERNS = [/cotizar/i, /cotizaci[oó]n/i, /precio/i, /valor/i, /cu[aá]nto/i, /presupuesto/i];
const SUPPORT_PATTERNS = [/problema/i, /reclamo/i, /molest[oa]/i, /no funciona/i, /cambio/i, /devoluci[oó]n/i];

export function detectSalesObjection(message = "") {
  const text = String(message || "");
  for (const item of OBJECTION_PATTERNS) {
    if (item.patterns.some((pattern) => pattern.test(text))) return item;
  }
  return null;
}

export function detectSalesMode(message = "", memory = null) {
  const text = String(message || "");
  const objection = detectSalesObjection(text);

  if (SUPPORT_PATTERNS.some((p) => p.test(text))) return "SUPPORT";
  if (objection) return "OBJECTION";
  if (BUYING_SIGNALS.some((p) => p.test(text))) return "CLOSING";
  if (QUOTE_PATTERNS.some((p) => p.test(text))) return "QUOTE";
  if (INFO_PATTERNS.some((p) => p.test(text))) return "INFO";
  if (memory?.summary || memory?.interestLevel >= 60) return "DISCOVERY";
  return "DISCOVERY";
}

export function analyzeSalesSignals({ message = "", memory = null, industry = "general" } = {}) {
  const text = String(message || "");
  const objection = detectSalesObjection(text);
  const mode = detectSalesMode(text, memory);
  let interestBoost = 0;
  let urgencyBoost = 0;
  const signals = [];

  if (BUYING_SIGNALS.some((p) => p.test(text))) {
    interestBoost += 25;
    signals.push("señal explícita de avance");
  }
  if (/hoy|mañana|urgente|esta semana|este fin de semana|ahora|lo antes posible/i.test(text)) {
    urgencyBoost += 30;
    signals.push("urgencia temporal");
  }
  if (/personas|pax|presupuesto|comuna|fecha|modelo|producto|dormitorios|visita/i.test(text)) {
    interestBoost += 12;
    signals.push("entregó datos concretos");
  }
  if (objection) {
    signals.push(objection.label.toLowerCase());
    if (["price", "delay", "doubt"].includes(objection.type)) interestBoost -= 5;
  }

  const action = getRecommendedSalesAction({ mode, objectionType: objection?.type, industry });

  return {
    mode,
    objectionType: objection?.type || null,
    objectionLabel: objection?.label || null,
    objectionStrategy: objection?.strategy || null,
    interestBoost,
    urgencyBoost,
    signals,
    recommendedAction: action
  };
}

export function getRecommendedSalesAction({ mode, objectionType = null, industry = "general" } = {}) {
  if (mode === "INFO") return "responder la información primero y cerrar con una pregunta de diagnóstico";
  if (mode === "QUOTE") return "pedir solo el dato faltante para cotizar o entregar estimación si ya hay contexto";
  if (mode === "CLOSING") return "proponer siguiente paso concreto: reservar, pagar, agendar o tomar datos";
  if (mode === "SUPPORT") return "resolver con calma y derivar a humano si hay molestia o riesgo";
  if (mode === "OBJECTION") {
    if (objectionType === "price") return "validar precio, reforzar valor y preguntar rango de presupuesto";
    if (objectionType === "delay") return "descubrir qué falta para decidir y dejar un micro-compromiso";
    if (objectionType === "doubt") return "aclarar la duda principal con explicación simple";
    if (objectionType === "comparison") return "diferenciar sin atacar a la competencia";
    if (objectionType === "trust") return "aportar confianza y explicar el proceso";
  }
  if (industry === "inmobiliaria") return "calificar comuna, presupuesto, propiedad y proponer visita";
  if (industry === "parrilladas") return "calificar personas, fecha, lugar y recomendar formato";
  if (industry === "ecommerce") return "recomendar producto, confirmar stock/precio y proponer compra";
  return "entender necesidad, aportar valor y proponer siguiente paso";
}

export function buildSalesBrainContext({ message = "", memory = null, industry = "general" } = {}) {
  const analysis = analyzeSalesSignals({ message, memory, industry });
  return {
    analysis,
    prompt: `
Sales Brain activo:
- Modo conversacional: ${analysis.mode}
- Objeción detectada: ${analysis.objectionLabel || "ninguna"}
- Estrategia para objeción: ${analysis.objectionStrategy || "no aplica"}
- Señales comerciales: ${analysis.signals.length ? analysis.signals.join(", ") : "sin señales fuertes"}
- Acción recomendada: ${analysis.recommendedAction}

Principios comerciales globales:
- Responde primero lo que el cliente preguntó; luego guía la conversación.
- No presiones: vende con claridad, valor y preguntas inteligentes.
- Si hay objeción, valida primero y descubre la objeción real antes de cerrar.
- Evita respuestas pasivas como “quedo atento”; propone un siguiente paso pequeño.
- Mantén control conversacional con una sola pregunta final.
- No inventes datos; si falta información, pregunta solo el dato clave.
- Cuando el cliente muestre intención alta, facilita el cierre con una acción concreta.
`.trim()
  };
}

export function salesBrainFallbackReply({ message = "", industry = "general", knowledgeReply = null } = {}) {
  const analysis = analyzeSalesSignals({ message, industry });

  if (knowledgeReply && analysis.mode === "INFO") return knowledgeReply;

  if (analysis.objectionType === "price") {
    if (industry === "parrilladas") {
      return "Te entiendo 😊 en eventos el valor no es solo la comida: también incluye experiencia, montaje, servicio y tranquilidad para que no tengas que preocuparte por la logística. Si quieres, lo ajustamos según tu presupuesto. ¿En qué rango te gustaría mantenerte?";
    }
    if (industry === "inmobiliaria") {
      return "Te entiendo, el presupuesto es clave. Podemos buscar una opción que mantenga buena ubicación y se acerque mejor a tu rango. ¿Cuál sería tu tope ideal?";
    }
    return "Te entiendo 😊 podemos revisar una alternativa más conveniente o ver cuál opción entrega mejor valor por el precio. ¿En qué rango te gustaría mantenerte?";
  }

  if (analysis.objectionType === "delay") {
    return "Claro, es válido pensarlo 😊 Para ayudarte a decidir mejor, ¿hay algo puntual que quieras revisar antes: precio, disponibilidad o qué incluye?";
  }

  if (analysis.objectionType === "doubt") {
    return "Totalmente válido tener dudas 👍 Te lo puedo explicar simple para que decidas con tranquilidad. ¿Qué parte te gustaría aclarar primero?";
  }

  return null;
}
