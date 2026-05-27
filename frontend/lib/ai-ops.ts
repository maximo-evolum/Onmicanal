import { Conversation, Lead } from "./types";

export type AiOpsProfile = {
  label: string;
  score: number;
  tone: string;
  risk: "low" | "medium" | "high";
  urgency: "low" | "medium" | "high";
  priceSensitivity: "low" | "medium" | "high";
  strategy: string;
  nextBestAction: string;
  reason: string;
};

export function getCloseScore(conversation?: Conversation | null, lead?: Lead | null) {
  return conversation?.aiCloseScore ?? conversation?.aiLeadScore ?? lead?.closeProbability ?? conversation?.lead?.closeProbability ?? 0;
}

export function isReadyToClose(conversation?: Conversation | null, lead?: Lead | null) {
  return Boolean(
    conversation?.aiHandoffRequired ||
      conversation?.aiNextActionCode === "READY_TO_CLOSE" ||
      lead?.status === "READY_TO_CLOSE" ||
      conversation?.lead?.status === "READY_TO_CLOSE" ||
      getCloseScore(conversation, lead) >= 80
  );
}

export function getConversationState(conversation?: Conversation | null, lead?: Lead | null) {
  if (conversation?.aiHandoffRequired || lead?.status === "ESCALATED" || conversation?.lead?.status === "ESCALATED") return "ESCALATED";
  if (isReadyToClose(conversation, lead)) return "READY_TO_CLOSE";
  if (lead?.status === "NEGOTIATION" || conversation?.lead?.status === "NEGOTIATION") return "NEGOTIATION";
  if ((getCloseScore(conversation, lead) >= 55) || lead?.status === "QUALIFIED") return "QUALIFIED";
  return "DISCOVERY";
}

export function buildAiOpsProfile(conversation?: Conversation | null, lead?: Lead | null): AiOpsProfile {
  const score = getCloseScore(conversation, lead);
  const state = getConversationState(conversation, lead);
  const reason =
    conversation?.aiDecisionReason ||
    conversation?.aiHandoffReason ||
    conversation?.aiReason ||
    lead?.closeReason ||
    "La IA aún está reuniendo señales para decidir la mejor acción.";

  let label = "Lead en descubrimiento";
  let tone = "Consultivo";
  let strategy = "Hacer preguntas breves para entender necesidad, presupuesto y urgencia.";
  let nextBestAction = conversation?.aiNextAction || "Continuar conversación y capturar datos faltantes.";
  let risk: AiOpsProfile["risk"] = "medium";
  let urgency: AiOpsProfile["urgency"] = "medium";
  let priceSensitivity: AiOpsProfile["priceSensitivity"] = "medium";

  if (state === "READY_TO_CLOSE") {
    label = "Listo para cierre asistido";
    tone = "Directo y seguro";
    strategy = "Confirmar datos y pasar a vendedor para coordinar pago/reserva sin fricción.";
    nextBestAction = "Tomar conversación, confirmar datos y cerrar manualmente.";
    risk = "low";
    urgency = "high";
  } else if (state === "ESCALATED") {
    label = "Requiere vendedor";
    tone = "Humano y resolutivo";
    strategy = "Un humano debe intervenir para evitar pérdida del lead o resolver una situación sensible.";
    nextBestAction = "Responder como vendedor y tomar control del cierre.";
    risk = "high";
    urgency = "high";
  } else if (state === "NEGOTIATION") {
    label = "Negociación activa";
    tone = "Persuasivo suave";
    strategy = "Manejar objeciones, reforzar valor y ofrecer una decisión simple.";
    nextBestAction = conversation?.aiNextAction || "Resolver la objeción principal y proponer siguiente paso.";
    risk = "medium";
    urgency = score >= 65 ? "high" : "medium";
  } else if (score >= 65) {
    label = "Oportunidad caliente";
    tone = "Cercano y orientado a avance";
    strategy = "Acelerar con una pregunta de cierre suave o propuesta concreta.";
    nextBestAction = conversation?.aiNextAction || "Proponer reserva, visita, cotización o alternativa concreta.";
    risk = "low";
    urgency = "high";
  }

  const text = `${reason} ${lead?.notes || ""} ${conversation?.aiSummary || ""}`.toLowerCase();
  if (text.includes("caro") || text.includes("precio") || text.includes("presupuesto")) priceSensitivity = "high";
  if (text.includes("urgente") || text.includes("hoy") || text.includes("ahora")) urgency = "high";
  if (text.includes("no responde") || text.includes("riesgo") || text.includes("frío")) risk = "high";

  return { label, score, tone, risk, urgency, priceSensitivity, strategy, nextBestAction, reason };
}

export function riskLabel(value: AiOpsProfile["risk"] | AiOpsProfile["urgency"] | AiOpsProfile["priceSensitivity"]) {
  if (value === "high") return "Alta";
  if (value === "medium") return "Media";
  return "Baja";
}

export function getAiBadgeClass(profile: AiOpsProfile) {
  if (profile.label.includes("cierre") || profile.label.includes("vendedor")) return "sales-alert-critical";
  if (profile.score >= 65) return "sales-alert-hot";
  return "sales-alert-action";
}
