import { analyzeSalesSignals } from "./sales-brain.service.js";
import { detectConversationState, CONVERSATION_STATES } from "./sales-workflow.service.js";
import { extractEventPreferences } from "./event-sales.service.js";
import { buildCustomerProfileContext } from "./customer-profile.service.js";

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}

export function buildReasoningSnapshot({ tenant, userMessage = "", memory = null, lead = null, industry = "general" } = {}) {
  const sales = analyzeSalesSignals({ message: userMessage, memory, industry });
  const prefs = extractEventPreferences(userMessage);
  const state = detectConversationState({ message: userMessage, memory, lead, objection: sales.objectionType });
  const profile = memory?.customerProfile || {};
  const reasons = [];

  let opportunityScore = Number(lead?.closeProbability || 0);
  if (!opportunityScore) opportunityScore = Number(memory?.interestLevel || 35);

  if (sales.mode === "CLOSING") { opportunityScore += 25; reasons.push("señal explícita de cierre"); }
  if (sales.mode === "QUOTE") { opportunityScore += 12; reasons.push("solicitud de cotización"); }
  if (sales.mode === "OBJECTION") { opportunityScore += 6; reasons.push("objeción activa: oportunidad recuperable"); }
  if ((memory?.urgencyLevel || 0) >= 70) { opportunityScore += 15; reasons.push("urgencia alta"); }
  if (prefs.guests || profile.guests || lead?.budget) { opportunityScore += 10; reasons.push("datos concretos entregados"); }
  if (profile.customerType === "BUSINESS" || profile.customerType === "WEDDING") { opportunityScore += 10; reasons.push("posible ticket alto"); }
  if (profile.priceSensitivity === "HIGH") { opportunityScore -= 8; reasons.push("sensibilidad a precio"); }
  if (memory?.sentiment === "negative") { opportunityScore -= 12; reasons.push("sentimiento negativo"); }

  opportunityScore = clamp(Math.round(opportunityScore));

  let priority = "NORMAL";
  if (opportunityScore >= 82 || state === CONVERSATION_STATES.READY_TO_CLOSE) priority = "CRITICAL";
  else if (opportunityScore >= 65) priority = "HIGH";
  else if (opportunityScore < 35) priority = "LOW";

  const missingData = [];
  if (industry === "parrilladas") {
    if (!(prefs.guests || profile.guests || memory?.guests)) missingData.push("cantidad de personas");
    if (!(prefs.location || profile.location || memory?.location)) missingData.push("comuna/lugar");
    if (!(prefs.date || profile.date || memory?.date)) missingData.push("fecha");
  }

  const recommendedStrategy = chooseStrategy({ sales, state, priority, missingData, profile, industry });

  return {
    state,
    salesMode: sales.mode,
    opportunityScore,
    priority,
    reasons,
    missingData,
    recommendedStrategy,
    profileContext: buildCustomerProfileContext(memory),
    sales
  };
}

function chooseStrategy({ sales, state, priority, missingData, profile, industry }) {
  if (state === CONVERSATION_STATES.READY_TO_CLOSE) return "handoff_to_seller_for_close";
  if (priority === "CRITICAL") return "prioritize_seller_and_secure_next_step";
  if (sales.mode === "OBJECTION") return `handle_objection_${sales.objectionType || "general"}`;
  if (missingData?.length) return "ask_one_missing_key_data";
  if (sales.mode === "QUOTE") return "give_or_prepare_quote_then_next_step";
  if (sales.mode === "INFO") return "answer_precisely_then_discovery_question";
  if (profile?.decisionStyle === "CAUTIOUS") return "educate_reduce_risk_and_micro_commitment";
  if (industry === "ecommerce") return "recommend_best_fit_and_confirm_purchase_intent";
  if (industry === "inmobiliaria") return "qualify_budget_commune_and_offer_visit";
  return "continue_discovery_with_value";
}

export function buildReasoningPromptContext(reasoning) {
  if (!reasoning) return "Sin razonamiento avanzado.";
  return `
Reasoning Engine activo:
- Estado: ${reasoning.state}
- Modo ventas: ${reasoning.salesMode}
- Prioridad: ${reasoning.priority}
- Score oportunidad: ${reasoning.opportunityScore}/100
- Estrategia recomendada: ${reasoning.recommendedStrategy}
- Datos faltantes: ${reasoning.missingData?.length ? reasoning.missingData.join(", ") : "ninguno crítico"}
- Razones: ${reasoning.reasons?.length ? reasoning.reasons.join(", ") : "sin razones fuertes"}

Perfil avanzado cliente:
${reasoning.profileContext}
`.trim();
}
