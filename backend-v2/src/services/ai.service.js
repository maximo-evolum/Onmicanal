import { env } from "../lib/env.js";
import { prisma } from "../lib/db.js";
import { buildProductContext, searchProducts } from "./product.service.js";
import { buildServiceContext, extractEventPreferences, getPrimaryService, isEventServiceIntent, scenarioInstruction } from "./event-sales.service.js";
import { getConversationMemory, getConversationHistory } from "./memory.service.js";
import { detectObjection, handleObjection, objectionLabel } from "./objection.service.js";
import { normalizeIndustry, getIndustryScript } from "./industry-scripts.service.js";
import { buildBusinessKnowledgeContext, businessKnowledgeFallbackReply, isAltaBrasaTenant, altaBrasaFallbackReply, findAltaBrasaFaqAnswer, detectAltaBrasaService } from "./business-knowledge.service.js";
import { buildSalesBrainContext, salesBrainFallbackReply } from "./sales-brain.service.js";
import { buildReasoningSnapshot, buildReasoningPromptContext } from "./ai-reasoning.service.js";
import { getTenantSalesLearning, buildSalesLearningPromptContext } from "./ai-performance-learning.service.js";
import { buildAdaptiveSalesStrategy, buildAdaptiveStrategyPromptContext } from "./adaptive-sales-strategy.service.js";
import { buildAIRecommendations, formatAIRecommendations } from "./ai-recommendation-engine.service.js";
import { buildTenantAiContext } from "./tenant-ai-context.service.js";

function detectClosingIntent(message = "") {
  const text = String(message || "").toLowerCase();
  return /(comprar|lo quiero|me interesa|cómo pago|como pago|agendar|reservar|quiero avanzar|disponible|lo tomo|lo compro)/i.test(text);
}


function trimAtSentenceBoundary(text = "", maxLength = 3200) {
  const value = String(text || "").trim();
  if (value.length <= maxLength) return value;

  const limit = value.slice(0, maxLength);
  const sentenceEnd = Math.max(
    limit.lastIndexOf(". "),
    limit.lastIndexOf("? "),
    limit.lastIndexOf("! "),
    limit.lastIndexOf("\n\n")
  );

  if (sentenceEnd > Math.floor(maxLength * 0.65)) {
    return limit.slice(0, sentenceEnd + 1).trim();
  }

  return limit.trim();
}

function removeDuplicatedClosingQuestions(text = "") {
  let reply = String(text || "").trim();

  const genericClosings = [
    "¿Quieres que avancemos con esta opción o prefieres ver una alternativa?",
    "¿Quieres que avancemos con esta opción?",
    "¿Prefieres ver una alternativa?"
  ];

  for (const closing of genericClosings) {
    const first = reply.indexOf(closing);
    if (first !== -1) {
      const second = reply.indexOf(closing, first + closing.length);
      if (second !== -1) {
        reply = reply.slice(0, second).trim();
      }
    }
  }

  const questions = reply.match(/¿[^?]+\?/g) || [];
  if (questions.length > 1) {
    const lastQuestion = questions[questions.length - 1];
    const duplicatedAdvance = /avancemos|alternativa|reserva|cotizaci[oó]n|coordinar/i.test(lastQuestion);
    const previousHasAdvance = questions.slice(0, -1).some((q) => /avancemos|alternativa|reserva|cotizaci[oó]n|coordinar/i.test(q));

    if (duplicatedAdvance && previousHasAdvance) {
      const lastIndex = reply.lastIndexOf(lastQuestion);
      reply = reply.slice(0, lastIndex).trim();
    }
  }

  return reply;
}

function postProcessReply(text = "") {
  let reply = String(text || "").trim();
  if (!reply) return "Te ayudo feliz 🙌 ¿Qué producto o servicio estás buscando?";

  reply = reply
    .replace(/estimado cliente[:,]?/gi, "")
    .replace(/con gusto le informo que/gi, "te cuento que")
    .trim();

  // Evita cierres duplicados y preguntas repetidas.
  reply = removeDuplicatedClosingQuestions(reply);

  // No cortes respuestas comerciales normales. WhatsApp soporta mensajes largos,
  // pero mantenemos un límite alto y con corte en frase solo como protección extrema.
  reply = trimAtSentenceBoundary(reply, 3200);

  // Fuerza una pregunta final útil solo si el modelo no incluyó ninguna pregunta.
  if (!reply.includes("?")) {
    reply += "\n\n¿Quieres que avancemos con esta opción o prefieres ver una alternativa?";
  }

  return reply.trim();
}

function fallbackSalesReply({ userMessage, products }) {
  const msg = String(userMessage || "").toLowerCase();
  const top = products?.[0];
  const isClosing = detectClosingIntent(userMessage);

  if (top) {
    const price = Number(top.price || 0).toLocaleString("es-CL", { maximumFractionDigits: 0 });
    if (isClosing) {
      return `Perfecto 🙌 podemos avanzar con ${top.name}. Está ${top.stock > 0 ? "disponible" : "con stock limitado"} y su precio es $${price}. ¿Quieres que te tome los datos para dejarlo reservado o prefieres que te mande más detalles?`;
    }
    return `Sí 🙌 te puedo recomendar ${top.name}. Tiene stock ${top.stock > 0 ? "disponible" : "limitado"} y su precio es $${price}. ${top.description ? `${top.description}. ` : ""}¿Quieres que te mande más detalles o prefieres ver una alternativa?`;
  }

  if (msg.includes("hola") || msg.includes("buenas")) {
    return "Hola 👋 encantado de ayudarte. Cuéntame qué producto o servicio estás buscando y te recomiendo la mejor opción disponible.";
  }

  if (msg.includes("precio") || msg.includes("valor") || msg.includes("cuánto") || msg.includes("cuanto")) {
    return "Claro 😊 dime qué producto te interesa y te confirmo precio, stock y opciones disponibles.";
  }

  return "Te ayudo feliz 🙌 cuéntame qué estás buscando, tu presupuesto aproximado y si necesitas despacho o disponibilidad inmediata.";
}


function fallbackEventServiceReply({ userMessage, service, preferences, isClosing }) {
  const missing = [];
  if (!preferences?.guests) missing.push("cantidad de personas");
  if (!preferences?.location) missing.push("comuna o lugar");
  if (!preferences?.date) missing.push("fecha");

  if (isClosing) {
    return "Buenísimo 🙌 para dejarlo avanzado necesito nombre, teléfono y la fecha del evento. ¿Me los compartes y te dejo la reserva encaminada?";
  }

  if (missing.length) {
    return `Hola 🙌 sí, hacemos eventos de parrilladas completos. Para cotizarte bien necesito ${missing.join(", ")}. ¿Me cuentas esos datos?`;
  }

  if (service && preferences?.guests) {
    const hasPricing = Number(service.basePrice || 0) > 0 || Number(service.pricePerGuest || 0) > 0;
    if (hasPricing) {
      const total = Number(service.basePrice || 0) + Number(preferences.guests) * Number(service.pricePerGuest || 0);
      return `Perfecto 🙌 para ${preferences.guests} personas en ${preferences.location} te queda aprox en $${Math.round(total).toLocaleString("es-CL")}. Incluye servicio de parrillada y coordinación del evento. ¿Quieres que avancemos con reserva o prefieres que te contacte para afinar detalles?`;
    }
    return `Perfecto 🙌 para ${preferences.guests} personas en ${preferences.location || "la comuna indicada"} podemos armar una cotización personalizada según fecha, formato y adicionales. ¿Qué fecha tienes en mente para revisar disponibilidad?`;
  }

  return "Perfecto 🙌 puedo ayudarte con la cotización del asado. ¿Para cuántas personas sería, en qué comuna y para qué fecha?";
}

export async function generateSalesReply({
  tenantId,
  tenantName = "tu negocio",
  businessPrompt = "",
  userMessage = "",
  conversationId = null,
  tenant = null,
  actionContext = ""
}) {
  const products = tenantId ? await searchProducts({ tenantId, query: userMessage, take: 3 }) : [];
  const tenantAiContext = await buildTenantAiContext({ tenant, tenantId });
  const tenantProfile = tenantAiContext.tenant || tenant || { name: tenantName, businessPrompt, industry: businessPrompt, slug: "" };
  const altaBrasaMode = isAltaBrasaTenant(tenantProfile);
  const eventMode = altaBrasaMode || isEventServiceIntent(userMessage, { industry: businessPrompt, businessPrompt });
  const eventPreferences = extractEventPreferences(userMessage);
  const service = eventMode && tenantId ? await getPrimaryService({ tenantId, query: userMessage }) : null;
  const memory = conversationId ? await getConversationMemory(conversationId) : null;
  const history = conversationId ? await getConversationHistory(conversationId, 10) : [];
  const industry = normalizeIndustry(`${businessPrompt} ${tenantName}`);
  const effectiveIndustry = eventMode ? "parrilladas" : industry;
  const script = getIndustryScript(effectiveIndustry);
  const objection = detectObjection(userMessage);
  const leadSnapshot = conversationId ? await prisma.lead.findUnique({ where: { conversationId } }).catch(() => null) : null;
  const reasoningSnapshot = buildReasoningSnapshot({ tenant: tenantProfile, userMessage, memory, lead: leadSnapshot, industry: effectiveIndustry });
  const salesLearning = await getTenantSalesLearning({ tenantId, industry: effectiveIndustry });
  const adaptiveStrategy = buildAdaptiveSalesStrategy({ message: userMessage, memory, reasoning: reasoningSnapshot, learning: salesLearning, industry: effectiveIndustry });
  const aiRecommendations = buildAIRecommendations({ reasoning: reasoningSnapshot, adaptiveStrategy, learning: salesLearning, memory });
  const salesBrain = buildSalesBrainContext({ message: userMessage, memory, industry: effectiveIndustry });
  const aiSettingsContext = tenantProfile?.aiSettings ? `\nConfiguración IA del tenant:\n- Tono: ${tenantProfile.aiSettings.tone || "no definido"}\n- Personalidad: ${tenantProfile.aiSettings.personality || "no definida"}\n- Objetivo: ${tenantProfile.aiSettings.objective || "no definido"}\n- Estilo respuesta: ${tenantProfile.aiSettings.responseStyle || "no definido"}\n- Reglas: ${Array.isArray(tenantProfile.aiSettings.businessRules) ? tenantProfile.aiSettings.businessRules.join("; ") : "sin reglas"}\n` : "";
  const objectionReply = objection ? handleObjection(objection, { businessType: eventMode ? "parrilladas" : industry, message: userMessage }) : null;
  const businessKnowledgeContext = buildBusinessKnowledgeContext({ tenant: tenantProfile, message: userMessage });
  const altaBrasaFaq = altaBrasaMode ? findAltaBrasaFaqAnswer(userMessage) : null;
  const altaBrasaServiceDetected = altaBrasaMode ? detectAltaBrasaService(userMessage) : null;
  const productContext = eventMode
    ? `${buildServiceContext({ service, preferences: eventPreferences })}

${businessKnowledgeContext}`.trim()
    : `${buildProductContext(products)}

${businessKnowledgeContext}`.trim();
  const isClosing = detectClosingIntent(userMessage);

  if (altaBrasaMode && (altaBrasaFaq || altaBrasaServiceDetected) && !detectClosingIntent(userMessage)) {
    return postProcessReply(altaBrasaFallbackReply({
      userMessage,
      preferences: eventPreferences,
      isClosing
    }));
  }

  if (!env.openAiApiKey) {
    const salesFallback = salesBrainFallbackReply({ message: userMessage, industry: eventMode ? "parrilladas" : industry });
    if (objectionReply) return postProcessReply(objectionReply);
    if (salesFallback) return postProcessReply(salesFallback);
    const knowledgeFallback = businessKnowledgeFallbackReply({
      tenant: tenantProfile,
      userMessage,
      preferences: eventPreferences,
      products,
      isClosing
    });
    if (knowledgeFallback) return postProcessReply(knowledgeFallback);
    if (eventMode) return fallbackEventServiceReply({ userMessage, service, preferences: eventPreferences, isClosing });
    return fallbackSalesReply({ userMessage, products });
  }

  const closingInstruction = isClosing
    ? `\nModo cierre activado:\n- El cliente muestra intención alta.\n- No entregues información innecesaria.\n- Lleva a una acción concreta: reservar, comprar, agendar, pedir datos o enviar link.\n- Sé directo, seguro y amable.\n`
    : "";

  const eventInstruction = eventMode ? `
Modo parrilladas/eventos activado:
- Tu objetivo es informar, orientar, cotizar y cerrar reservas de eventos.
- Si el negocio es Eventos Alta Brasa, usa SIEMPRE el conocimiento oficial cargado abajo: Cóctel Parrillero, Asado al Plato, Servicio Mixto y servicios adicionales.
- No des precio final si faltan personas, comuna/lugar o fecha; puedes explicar que el valor depende de esos datos.
- Si ya tienes personas y servicio cargado, entrega estimación aproximada y propone reservar/agendar.
- Pide solo los datos faltantes, no hagas interrogatorios largos.
- Menciona beneficios reales: parrilla colgante, ahumado con leña frutal, carnes premium Angus, servicio cuidado y experiencia elegante.
- ${scenarioInstruction(eventPreferences.scenario)}
` : "";

  const system = `
Eres un vendedor experto por chat para ${tenantName}.
${businessPrompt || ""}
${aiSettingsContext}
${tenantAiContext.promptContext || ""}

Objetivo: conversar de forma natural, resolver dudas con información precisa del negocio y avanzar hacia una cotización, reserva o venta cuando corresponda.
Estilo:
- Español natural, cercano y breve.
- Frases cortas.
- Máximo 1 emoji si aporta.
- No suenes como soporte técnico.
- Si el cliente solo pide información, responde primero la información con claridad antes de vender.
- Si el cliente quiere cotizar o reservar, pasa a modo comercial y guía el siguiente paso.

Guía por rubro:
- Descubrimiento: ${script.discovery}
- Objeción precio: ${script.objection_price}
- Cierre: ${script.closing}
- Handoff: ${script.handoff}

Memoria del cliente:
- Resumen: ${memory?.summary || "sin resumen"}
- Personas: ${memory?.guests || eventPreferences.guests || "no detectado"}
- Comuna/lugar: ${memory?.location || eventPreferences.location || "no detectado"}
- Fecha: ${memory?.date || eventPreferences.date || "no detectado"}
- Interés: ${memory?.interestLevel ?? "sin medir"}/100
- Urgencia: ${memory?.urgencyLevel ?? "sin medir"}/100
- Sentimiento: ${memory?.sentiment || "neutral"}
- Objeción actual: ${objection ? objectionLabel(objection) : "ninguna"}
${objectionReply ? `
Respuesta sugerida para objeción: ${objectionReply}
` : ""}

Sales Brain / estrategia comercial:
${salesBrain.prompt}

Reasoning avanzado:
${buildReasoningPromptContext(reasoningSnapshot)}

Aprendizaje histórico y feedback loop:
${buildSalesLearningPromptContext(salesLearning)}

Estrategia adaptativa:
${buildAdaptiveStrategyPromptContext(adaptiveStrategy)}

Recomendaciones IA internas:
${formatAIRecommendations(aiRecommendations)}

Tool Orchestration / acciones reales:
${actionContext || "Sin acciones ejecutadas todavía."}

Reglas:
- Si ya tienes un dato en memoria, NO vuelvas a preguntarlo.
- Si detectas objeción, respóndela primero y luego haz una pregunta corta.
- Recomienda máximo 2 opciones relevantes.
- Explica por qué calzan con lo que pide el cliente.
- Incluye precio/estimación, disponibilidad o despacho solo si está disponible en el contexto.
- No inventes productos, precios, stock, servicios ni disponibilidad.
- Usa el contexto empresarial dinámico si existe; si el cliente pregunta algo informativo, responde la información antes de intentar cerrar.
- Nunca mezcles rubros entre clientes: responde usando solo el tenant actual, sus productos, reglas, memoria y perfil IA.
- Si varios clientes usan la misma IA base, personaliza SIEMPRE con el contexto del tenant actual.
- Haz una sola pregunta final para avanzar.
- No repitas cierres comerciales. Evita cerrar dos veces con preguntas similares.
- Si ya mencionaste una opción recomendada, no agregues otra pregunta redundante al final.
- Entrega respuestas completas, pero breves: máximo 3 bloques y lectura fácil para WhatsApp.
- No cortes palabras ni frases. Termina siempre la idea completa.
- Si el workflow indica READY_TO_CLOSE o mark_payment_ready, no sigas vendiendo: confirma el interés y avisa que un vendedor continuará con pago/reserva.
- Si falta información, pregunta solo el dato clave faltante.
- Ajusta la presión comercial según la estrategia adaptativa: baja presión para dudas/objeciones, alta solo cuando el cliente esté listo.
- Usa las recomendaciones IA como guía interna; NO las muestres como lista técnica al cliente.
${eventInstruction}
${closingInstruction}
`;

  const user = `
Historial reciente:
${history.map((m) => `${m.role === "user" ? "Cliente" : "Bot"}: ${m.content}`).join("\n") || "Sin historial"}

Mensaje del cliente:
${userMessage}

Contexto comercial disponible:
${productContext}

Contexto de acciones automáticas:
${actionContext || "Sin acciones automáticas."}

Análisis comercial detectado:
- Modo: ${salesBrain.analysis.mode}
- Objeción: ${salesBrain.analysis.objectionLabel || "ninguna"}
- Acción recomendada: ${salesBrain.analysis.recommendedAction}
- Estado reasoning: ${reasoningSnapshot.state}
- Prioridad reasoning: ${reasoningSnapshot.priority}
- Score oportunidad reasoning: ${reasoningSnapshot.opportunityScore}/100
- Estrategia adaptativa: ${adaptiveStrategy.objective} / ${adaptiveStrategy.nextMove}

Datos de evento detectados, si aplica:
- Personas: ${eventPreferences.guests || "no detectado"}
- Comuna/lugar: ${eventPreferences.location || "no detectado"}
- Fecha: ${eventPreferences.date || "no detectado"}
- Escenario: ${eventPreferences.scenario || "general"}
`;

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.openAiApiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.55,
        max_tokens: 1200,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user }
        ]
      })
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data?.error?.message || "OpenAI request failed");
    const content = data?.choices?.[0]?.message?.content?.trim();
    return postProcessReply(content || (eventMode ? fallbackEventServiceReply({ userMessage, service, preferences: eventPreferences, isClosing }) : fallbackSalesReply({ userMessage, products })));
  } catch (error) {
    console.error("OpenAI sales reply error:", error?.message || error);
    const salesFallback = salesBrainFallbackReply({ message: userMessage, industry: eventMode ? "parrilladas" : industry });
    if (salesFallback && objection) return postProcessReply(salesFallback);
    const knowledgeFallback = businessKnowledgeFallbackReply({
      tenant: tenantProfile,
      userMessage,
      preferences: eventPreferences,
      products,
      isClosing
    });
    if (knowledgeFallback) return postProcessReply(knowledgeFallback);
    if (eventMode) return fallbackEventServiceReply({ userMessage, service, preferences: eventPreferences, isClosing });
    return fallbackSalesReply({ userMessage, products });
  }
}
