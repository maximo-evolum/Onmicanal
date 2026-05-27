function minutesFromPriority(priority) {
  if (priority === "CRITICAL") return 20;
  if (priority === "HIGH") return 60;
  if (priority === "LOW") return 24 * 60;
  return 180;
}

export function buildAutonomousFollowUpPlan({ reasoning = null, adaptiveStrategy = null, memory = null } = {}) {
  if (reasoning?.state === "READY_TO_CLOSE") {
    return {
      shouldSchedule: false,
      reason: "Lead listo para cierre humano; no programar follow-up automático que compita con vendedor.",
      minutes: null,
      tone: "handoff"
    };
  }

  if (memory?.sentiment === "negative") {
    return {
      shouldSchedule: true,
      reason: "Sentimiento negativo: seguimiento suave para recuperar confianza.",
      minutes: 240,
      tone: "recovery"
    };
  }

  const minutes = minutesFromPriority(reasoning?.priority);
  const tone = adaptiveStrategy?.pressure === "low" ? "consultive" : "commercial";

  return {
    shouldSchedule: true,
    reason: `Seguimiento autónomo ${tone} según prioridad ${reasoning?.priority || "NORMAL"}.`,
    minutes,
    tone
  };
}
