export function predictCloseProbability({ lead, conversation }) {
  let score = 0;
  const reasons = [];

  if (lead?.budget) { score += 20; reasons.push("tiene presupuesto definido"); }
  if (lead?.commune) { score += 15; reasons.push("tiene comuna definida"); }
  if (lead?.interest) { score += 10; reasons.push("tiene intención comercial"); }
  if (lead?.propertyType) { score += 8; reasons.push("definió tipo de propiedad"); }
  if (lead?.urgency === "high") { score += 15; reasons.push("muestra alta urgencia"); }
  if (conversation?.priorityLabel === "high") { score += 15; reasons.push("alta prioridad en conversación"); }
  if (conversation?.lastIntent === "schedule_visit") { score += 25; reasons.push("quiere agendar visita"); }
  if (conversation?.aiLeadScore) { score = Math.round((score + Number(conversation.aiLeadScore)) / 2); reasons.push("score IA considerado"); }

  return {
    probability: Math.max(0, Math.min(100, score)),
    reason: reasons.length ? reasons.join(", ") : "faltan señales comerciales fuertes"
  };
}
