/**
 * Fase 3.3 — Sales Workflow / Human-assisted close.
 *
 * Regla de producto: la IA NO debe cobrar ni enviar links de pago reales.
 * Su trabajo es detectar que el cliente está listo para pagar/reservar,
 * marcar la conversación como READY_TO_CLOSE y avisar al vendedor humano.
 */

export const CONVERSATION_STATES = {
  INFO: "INFO",
  DISCOVERY: "DISCOVERY",
  QUOTE: "QUOTE",
  NEGOTIATION: "NEGOTIATION",
  READY_TO_CLOSE: "READY_TO_CLOSE",
  ESCALATED: "ESCALATED",
  FOLLOW_UP: "FOLLOW_UP"
};

const CLOSE_PATTERNS = [
  /\bquiero\s+(reservar|agendar|comprar|avanzar|cerrar)\b/i,
  /\b(lo\s+tomo|lo\s+quiero|me\s+interesa|hag[aá]moslo|vamos\s+con\s+eso)\b/i,
  /\b(c[oó]mo\s+pago|como\s+pago|pagar|pago|abono|se[ñn]a|transferencia|transferir)\b/i,
  /\b(dejar\s+reservado|dejarlo\s+reservado|confirmar\s+reserva|confirmemos)\b/i,
  /\b(enviar\s+datos|te\s+paso\s+mis\s+datos|dame\s+los\s+datos)\b/i
];

const QUOTE_PATTERNS = [
  /\b(cotizar|cotizaci[oó]n|precio|valor|cu[aá]nto|presupuesto)\b/i,
  /\bpara\s+\d{1,4}\s*(personas|pax|invitados)?\b/i
];

const NEGOTIATION_PATTERNS = [
  /\b(caro|muy\s+caro|rebaja|descuento|mejor\s+precio|fuera\s+de\s+presupuesto)\b/i,
  /\b(lo\s+voy\s+a\s+pensar|lo\s+pienso|no\s+estoy\s+seguro|despu[eé]s\s+veo)\b/i
];

const HUMAN_PATTERNS = [
  /\b(humano|persona|asesor|ejecutivo|vendedor|llamar|tel[eé]fono|hablar\s+con\s+alguien)\b/i
];

function matchesAny(message = "", patterns = []) {
  return patterns.some((pattern) => pattern.test(String(message || "")));
}

export function detectPaymentReadySignal(message = "") {
  const text = String(message || "");
  const matched = CLOSE_PATTERNS.find((pattern) => pattern.test(text));

  return {
    ready: Boolean(matched),
    reason: matched ? "cliente manifestó intención de pagar, reservar o avanzar" : null
  };
}

export function detectConversationState({ message = "", memory = null, lead = null, objection = null }) {
  const text = String(message || "");
  const close = detectPaymentReadySignal(text);

  if (matchesAny(text, HUMAN_PATTERNS)) return CONVERSATION_STATES.ESCALATED;
  if (close.ready || (memory?.interestLevel || 0) >= 90 || (lead?.closeProbability || 0) >= 85) {
    return CONVERSATION_STATES.READY_TO_CLOSE;
  }
  if (objection || matchesAny(text, NEGOTIATION_PATTERNS)) return CONVERSATION_STATES.NEGOTIATION;
  if (matchesAny(text, QUOTE_PATTERNS)) return CONVERSATION_STATES.QUOTE;
  if ((memory?.interestLevel || 0) >= 65 || (lead?.closeProbability || 0) >= 50) return CONVERSATION_STATES.DISCOVERY;

  return CONVERSATION_STATES.INFO;
}

export function nextActionForState(state) {
  switch (state) {
    case CONVERSATION_STATES.READY_TO_CLOSE:
      return "notify_seller_ready_to_close";
    case CONVERSATION_STATES.ESCALATED:
      return "handoff_human";
    case CONVERSATION_STATES.NEGOTIATION:
      return "handle_objection_and_recover";
    case CONVERSATION_STATES.QUOTE:
      return "collect_missing_data_and_quote";
    case CONVERSATION_STATES.DISCOVERY:
      return "ask_key_qualifying_question";
    default:
      return "answer_and_continue_conversation";
  }
}

export function buildSalesWorkflowContext({ state, paymentReady, missing = [] }) {
  const lines = [
    `Estado de conversación: ${state}`,
    `Siguiente acción recomendada: ${nextActionForState(state)}`
  ];

  if (paymentReady?.ready) {
    lines.push("Señal fuerte de cierre: el cliente parece listo para pagar/reservar.");
    lines.push("Regla: NO enviar link de pago ni cobrar automáticamente. Avisar que un vendedor continuará el cierre.");
  }

  if (missing.length) {
    lines.push(`Datos faltantes antes del cierre: ${missing.join(", ")}.`);
  }

  return lines.join("\n");
}
