
export function shouldHandoff({ memory, objection, closeScore, message = "" }) {
  const t = String(message || "").toLowerCase();
  const reasons = [];

  if ((memory?.urgencyLevel || 0) >= 85) reasons.push("urgencia muy alta");
  if ((memory?.interestLevel || 0) >= 90) reasons.push("interés listo para cierre");
  if ((closeScore || 0) >= 85) reasons.push("probabilidad de cierre alta");
  if (memory?.sentiment === "negative") reasons.push("sentimiento negativo / riesgo de pérdida");
  if (["price", "doubt"].includes(objection) && (closeScore || 0) >= 60) reasons.push("objeción en oportunidad relevante");
  if (/(humano|persona|ejecutivo|asesor|llamar|teléfono|telefono|hablar con alguien)/i.test(t)) reasons.push("solicitud explícita de humano");

  return { handoff: reasons.length > 0, reason: reasons.join(", ") };
}
