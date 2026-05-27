import { analyzeSalesSignals } from "./sales-brain.service.js";

function profile(memory) {
  return (memory?.customerProfile && typeof memory.customerProfile === "object") ? memory.customerProfile : {};
}

export function buildAdaptiveSalesStrategy({ message = "", memory = null, reasoning = null, learning = null, industry = "general" } = {}) {
  const sales = analyzeSalesSignals({ message, memory, industry });
  const p = profile(memory);
  const strategy = {
    tone: "consultivo_cercano",
    pressure: "medium",
    objective: "advance_next_step",
    nextMove: "ask_one_relevant_question",
    avoid: [],
    guidance: []
  };

  if (sales.mode === "INFO") {
    strategy.pressure = "low";
    strategy.objective = "answer_precisely_then_soft_discovery";
    strategy.guidance.push("Responde primero la duda exacta antes de intentar vender.");
  }

  if (sales.mode === "OBJECTION") {
    strategy.pressure = "low";
    strategy.objective = "resolve_objection_and_reduce_risk";
    strategy.nextMove = "validate_concern_then_micro_commitment";
    strategy.guidance.push("Valida la objeción, no discutas con el cliente y haz una pregunta que descubra la causa real.");
  }

  if (sales.mode === "CLOSING" || reasoning?.state === "READY_TO_CLOSE") {
    strategy.pressure = "high";
    strategy.objective = "handoff_or_secure_commitment";
    strategy.nextMove = "confirm_handoff_to_seller";
    strategy.guidance.push("No sigas dando vueltas: confirma que el equipo humano continuará con pago/reserva/cierre.");
  }

  if (p.priceSensitivity === "HIGH") {
    strategy.pressure = "low";
    strategy.avoid.push("No empujes precio de inmediato.");
    strategy.guidance.push("Enfatiza valor, experiencia, ahorro de problemas y opción ajustada a presupuesto.");
  }

  if (p.decisionStyle === "CAUTIOUS") {
    strategy.pressure = "low";
    strategy.nextMove = "educate_and_offer_safe_step";
    strategy.guidance.push("Da seguridad y propone un paso pequeño, no un cierre agresivo.");
  }

  if (p.decisionStyle === "DECISIVE" || (memory?.urgencyLevel || 0) >= 75) {
    strategy.pressure = "high";
    strategy.nextMove = "secure_next_step_now";
    strategy.guidance.push("El cliente está listo: pide dato faltante o confirma derivación a vendedor.");
  }

  if (learning?.recommendedBias === "reduce_pressure_and_discover_more") {
    strategy.pressure = "low";
    strategy.guidance.push("Históricamente conviene descubrir más antes de cerrar.");
  }

  if (learning?.recommendedBias === "move_faster_to_next_step") {
    strategy.pressure = strategy.pressure === "low" ? "medium" : "high";
    strategy.guidance.push("Históricamente conviene avanzar más rápido al siguiente paso.");
  }

  if (learning?.recommendedBias === "recover_objections_before_closing") {
    strategy.guidance.push("Antes de cerrar, revisa y resuelve objeciones explícitas.");
  }

  return strategy;
}

export function buildAdaptiveStrategyPromptContext(strategy) {
  if (!strategy) return "Estrategia adaptativa: no disponible.";
  return `
Estrategia adaptativa IA:
- Tono: ${strategy.tone}
- Presión comercial: ${strategy.pressure}
- Objetivo: ${strategy.objective}
- Próximo movimiento: ${strategy.nextMove}
- Guía: ${strategy.guidance?.length ? strategy.guidance.join(" ") : "Mantener conversación consultiva."}
- Evitar: ${strategy.avoid?.length ? strategy.avoid.join(" ") : "No hay restricciones especiales."}
`.trim();
}
