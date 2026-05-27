import { prisma } from "../lib/db.js";

function safeJson(value, fallback = {}) {
  if (!value || typeof value !== "object") return fallback;
  return value;
}

function normalizeOutcome(outcome = "") {
  return String(outcome || "").toUpperCase();
}

export async function getTenantSalesLearning({ tenantId, industry = "general", limit = 80 } = {}) {
  if (!tenantId) {
    return {
      winRate: null,
      sampleSize: 0,
      winningPatterns: [],
      losingPatterns: [],
      commonObjections: [],
      recommendedBias: "balanced"
    };
  }

  const outcomes = await prisma.salesOutcome.findMany({
    where: {
      tenantId,
      ...(industry && industry !== "general" ? { industry } : {})
    },
    orderBy: { createdAt: "desc" },
    take: limit
  }).catch(() => []);

  const sampleSize = outcomes.length;
  const wins = outcomes.filter((o) => ["WON", "BOOKED", "PAID"].includes(normalizeOutcome(o.outcome))).length;
  const losses = outcomes.filter((o) => ["LOST", "NO_RESPONSE"].includes(normalizeOutcome(o.outcome))).length;
  const winRate = sampleSize ? Math.round((wins / sampleSize) * 100) : null;

  const reasonCounts = new Map();
  const lossReasonCounts = new Map();
  for (const outcome of outcomes) {
    const reason = String(outcome.reason || "").trim();
    if (!reason) continue;
    const target = ["WON", "BOOKED", "PAID"].includes(normalizeOutcome(outcome.outcome)) ? reasonCounts : lossReasonCounts;
    target.set(reason, (target.get(reason) || 0) + 1);
  }

  const top = (map) => [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([label, count]) => ({ label, count }));

  let recommendedBias = "balanced";
  if (winRate !== null && winRate < 35) recommendedBias = "reduce_pressure_and_discover_more";
  if (winRate !== null && winRate >= 60) recommendedBias = "move_faster_to_next_step";
  if (losses > wins && sampleSize >= 10) recommendedBias = "recover_objections_before_closing";

  return {
    winRate,
    sampleSize,
    winningPatterns: top(reasonCounts),
    losingPatterns: top(lossReasonCounts),
    commonObjections: top(lossReasonCounts).map((x) => x.label),
    recommendedBias
  };
}

export async function captureLearningSignal({ tenantId, conversationId, lead = null, memory = null, reason = "", outcome = null, industry = "general" } = {}) {
  if (!tenantId || !conversationId) return null;

  const score = Number(lead?.closeProbability || memory?.interestLevel || 0);
  const inferredOutcome = outcome || (score >= 85 ? "HOT_SIGNAL" : score <= 25 ? "LOW_SIGNAL" : null);
  if (!inferredOutcome) return null;

  // No sobrecargar SalesOutcome con cada mensaje: solo guardamos señales fuertes.
  if (!["WON", "LOST", "NO_RESPONSE", "BOOKED", "PAID", "HOT_SIGNAL", "LOW_SIGNAL"].includes(inferredOutcome)) {
    return null;
  }

  return prisma.salesOutcome.create({
    data: {
      tenantId,
      conversationId,
      leadId: lead?.id || null,
      outcome: inferredOutcome,
      reason: reason || inferReasonFromMemory(memory),
      closeScore: Math.round(score || 0),
      industry
    }
  }).catch(() => null);
}

function inferReasonFromMemory(memory) {
  const profile = safeJson(memory?.customerProfile, {});
  if (memory?.sentiment === "negative") return "sentimiento negativo";
  if ((memory?.urgencyLevel || 0) >= 75) return "urgencia alta";
  if ((memory?.interestLevel || 0) >= 80) return "interés alto";
  if (profile.priceSensitivity === "HIGH") return "sensibilidad a precio";
  return "señal comercial detectada";
}

export function buildSalesLearningPromptContext(learning) {
  if (!learning || !learning.sampleSize) {
    return `Aprendizaje histórico: aún no hay suficientes resultados reales. Usa estrategia consultiva, pide datos clave y evita presionar demasiado.`;
  }

  return `
Aprendizaje histórico del negocio:
- Muestra analizada: ${learning.sampleSize} resultados.
- Tasa de éxito aproximada: ${learning.winRate ?? "sin dato"}%.
- Sesgo recomendado: ${learning.recommendedBias}.
- Patrones ganadores: ${learning.winningPatterns?.length ? learning.winningPatterns.map((p) => `${p.label} (${p.count})`).join(", ") : "sin patrón dominante"}.
- Patrones de pérdida/objeción: ${learning.losingPatterns?.length ? learning.losingPatterns.map((p) => `${p.label} (${p.count})`).join(", ") : "sin patrón dominante"}.
`.trim();
}
