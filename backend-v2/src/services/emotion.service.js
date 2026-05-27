
import { analyzeSalesSignals } from "./sales-brain.service.js";

export function clampScore(value, fallback = 0) {
  const n = Number.isFinite(Number(value)) ? Number(value) : fallback;
  return Math.max(0, Math.min(100, Math.round(n)));
}

export function detectEmotionSignals(message = "") {
  const text = String(message || "").toLowerCase();
  let interest = 45;
  let urgency = 20;
  let sentiment = "neutral";

  if (/(me interesa|lo quiero|quiero reservar|quiero comprar|avancemos|me sirve|perfecto|genial|dale|ok)/i.test(text)) interest += 35;
  if (/(precio|valor|cotizar|cu[aá]nto|stock|disponible|agenda|fecha|horario)/i.test(text)) interest += 20;
  if (/(hoy|mañana|urgente|esta semana|este sábado|este sabado|lo antes posible|ahora)/i.test(text)) urgency += 55;
  if (/(gracias|perfecto|excelente|buen[ií]simo|me gusta)/i.test(text)) sentiment = "positive";
  if (/(caro|muy caro|no puedo|no me convence|lo veo despu[eé]s|despu[eé]s|duda|no estoy seguro|lejos|problema)/i.test(text)) sentiment = "negative";

  const sales = analyzeSalesSignals({ message: text });
  interest += sales.interestBoost || 0;
  urgency += sales.urgencyBoost || 0;

  return {
    interestLevel: clampScore(interest, 45),
    urgencyLevel: clampScore(urgency, 20),
    sentiment,
    salesMode: sales.mode,
    salesSignals: sales.signals
  };
}
