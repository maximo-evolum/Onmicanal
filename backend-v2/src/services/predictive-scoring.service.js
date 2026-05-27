import { analyzeSalesSignals } from "./sales-brain.service.js";

export function calculateCloseScore({ memory, lead, conversation, objection = null }) {
  let score = 10;
  const reasons = [];
  const sales = analyzeSalesSignals({
    message: conversation?.lastMessagePreview || conversation?.lastIntent || "",
    memory,
    industry: lead?.industry || "general"
  });

  if ((memory?.interestLevel || 0) >= 70) { score += 25; reasons.push("alto interés detectado"); }
  if ((memory?.urgencyLevel || 0) >= 70) { score += 20; reasons.push("alta urgencia"); }
  if (memory?.guests || lead?.budget) { score += 15; reasons.push("entregó datos concretos"); }
  if (memory?.date || memory?.location || lead?.commune) { score += 15; reasons.push("contexto definido"); }
  if (/(comprar|reservar|agendar|lo quiero|me interesa|confirmar)/i.test(conversation?.lastIntent || "")) { score += 10; reasons.push("intención de avance"); }
  if (["QUALIFIED", "VISIT_SCHEDULED", "NEGOTIATION"].includes(lead?.status)) { score += 10; reasons.push("etapa comercial avanzada"); }
  if (conversation?.mode === "HUMAN") { score += 5; reasons.push("requiere atención humana"); }

  if (sales.mode === "CLOSING") { score += 12; reasons.push("Sales Brain: modo cierre"); }
  if (sales.mode === "QUOTE") { score += 8; reasons.push("Sales Brain: intención de cotización"); }
  if (sales.signals?.includes("entregó datos concretos")) { score += 6; reasons.push("Sales Brain: señales concretas"); }

  if (memory?.sentiment === "negative") { score -= 15; reasons.push("sentimiento negativo"); }
  if (objection === "price" || sales.objectionType === "price") { score -= 8; reasons.push("objeción por precio"); }
  if (objection === "delay" || sales.objectionType === "delay") { score -= 10; reasons.push("cliente postergó decisión"); }
  if (sales.objectionType === "trust") { score -= 5; reasons.push("requiere confianza/prueba social"); }

  score = Math.max(0, Math.min(100, Math.round(score)));
  const label = score >= 75 ? "HOT" : score >= 45 ? "WARM" : "LOW";
  const nextAction = label === "HOT"
    ? (sales.mode === "CLOSING" ? "close_now" : "handoff_or_close")
    : label === "WARM"
      ? "follow_up"
      : "nurture";

  return {
    score,
    label,
    nextAction,
    reasons: reasons.length ? reasons : ["faltan señales comerciales fuertes"]
  };
}
