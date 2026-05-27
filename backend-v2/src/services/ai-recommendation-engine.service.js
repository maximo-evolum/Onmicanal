export function buildAIRecommendations({ reasoning = null, adaptiveStrategy = null, learning = null, memory = null } = {}) {
  const recommendations = [];

  if (reasoning?.priority === "CRITICAL" || reasoning?.state === "READY_TO_CLOSE") {
    recommendations.push({
      type: "SELLER_ACTION",
      priority: "CRITICAL",
      title: "Contactar ahora",
      description: "La IA detectó intención fuerte de cierre. Un vendedor debe tomar la conversación."
    });
  }

  if (adaptiveStrategy?.pressure === "low") {
    recommendations.push({
      type: "CONVERSATION_STRATEGY",
      priority: "MEDIUM",
      title: "Bajar presión comercial",
      description: "Conviene educar, resolver dudas y pedir un micro-compromiso."
    });
  }

  if ((memory?.urgencyLevel || 0) >= 75) {
    recommendations.push({
      type: "URGENCY",
      priority: "HIGH",
      title: "Urgencia alta",
      description: "Priorizar disponibilidad, horarios o siguiente paso concreto."
    });
  }

  if (learning?.recommendedBias === "recover_objections_before_closing") {
    recommendations.push({
      type: "LEARNING",
      priority: "MEDIUM",
      title: "Resolver objeciones antes de cerrar",
      description: "Los datos históricos sugieren que las objeciones están afectando conversiones."
    });
  }

  if (!recommendations.length) {
    recommendations.push({
      type: "NEXT_BEST_ACTION",
      priority: "NORMAL",
      title: "Continuar discovery",
      description: "Hacer una pregunta clave y mantener la conversación activa."
    });
  }

  return recommendations;
}

export function formatAIRecommendations(recommendations = []) {
  return recommendations
    .slice(0, 4)
    .map((r) => `- [${r.priority}] ${r.title}: ${r.description}`)
    .join("\n");
}
