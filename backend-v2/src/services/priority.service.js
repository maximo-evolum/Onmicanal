export function classifyPriority({ intent, entities, message }) {
  let score = 0;
  const text = (message || "").toLowerCase();

  if (intent === "schedule_visit") score += 35;
  if (intent === "property_search") score += 15;
  if (intent === "pricing_request") score += 10;
  if (intent === "human_handoff") score += 10;

  if (entities?.budget) score += 20;
  if (entities?.commune) score += 15;
  if (entities?.interest) score += 10;
  if (entities?.propertyType) score += 10;
  if (entities?.urgency === "high") score += 15;
  if (entities?.urgency === "medium") score += 8;

  if (text.includes("visita")) score += 20;
  if (text.includes("agendar")) score += 20;
  if (text.includes("hoy")) score += 10;
  if (text.includes("urgente")) score += 15;
  if (text.includes("disponible")) score += 10;
  if (text.includes("precio")) score += 8;
  if (text.includes("valor")) score += 8;

  if (score >= 70) {
    return { score, label: "high" };
  }

  if (score >= 40) {
    return { score, label: "medium" };
  }

  return { score, label: "low" };
}