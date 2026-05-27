import OpenAI from "openai";
import { env } from "./env.js";

const client = new OpenAI({ apiKey: env.openAiApiKey });

const RETRYABLE = new Set([408, 429, 500, 502, 503, 504]);

/**
 * Wrapper centralizado para todas las llamadas a OpenAI.
 * Incluye retry con backoff exponencial, modo JSON y estimación de tokens.
 */
export async function chatComplete({
  messages,
  model = "gpt-4o-mini",
  maxTokens = 500,
  jsonMode = false,
  retries = 3,
  temperature = 0.7,
} = {}) {
  let lastError;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await client.chat.completions.create({
        model,
        messages,
        max_tokens: maxTokens,
        temperature,
        ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
      });
      return response.choices[0].message.content ?? "";
    } catch (error) {
      lastError = error;
      const status = error?.status ?? error?.response?.status;
      const isRetryable = RETRYABLE.has(status);

      if (isRetryable && attempt < retries) {
        const delay = Math.min(500 * Math.pow(2, attempt - 1), 8000);
        console.warn(`[OpenAI] intento ${attempt}/${retries} falló (${status}), reintentando en ${delay}ms...`);
        await sleep(delay);
        continue;
      }

      console.error(`[OpenAI] error no recuperable (${status || "desconocido"}):`, error?.message);
      throw error;
    }
  }

  throw lastError;
}

/**
 * Estimación rápida de tokens (aprox chars / 4).
 * Útil para truncar contexto antes de enviarlo.
 */
export function estimateTokens(text = "") {
  return Math.ceil((text || "").length / 4);
}

/**
 * Trunca un array de mensajes para que quepan en maxTokens.
 * Siempre conserva el system prompt y los últimos N mensajes.
 */
export function truncateHistory(messages = [], maxTokens = 3000) {
  const systemMessages = messages.filter((m) => m.role === "system");
  const otherMessages = messages.filter((m) => m.role !== "system");

  let total = systemMessages.reduce((sum, m) => sum + estimateTokens(m.content), 0);
  const kept = [];

  for (let i = otherMessages.length - 1; i >= 0; i--) {
    const tokens = estimateTokens(otherMessages[i].content);
    if (total + tokens > maxTokens) break;
    kept.unshift(otherMessages[i]);
    total += tokens;
  }

  return [...systemMessages, ...kept];
}

export { client as openaiClient };

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
