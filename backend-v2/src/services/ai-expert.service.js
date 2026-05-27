import { env } from "../lib/env.js";
import { buildProductContext, searchProducts } from "./product.service.js";


function safeJsonParse(text) {
  try {
    const clean = String(text || "").trim().replace(/^```json/i, "").replace(/^```/i, "").replace(/```$/i, "").trim();
    return JSON.parse(clean);
  } catch {
    return null;
  }
}

function fallbackAnalysis(message, products = []) {
  const text = String(message || "").toLowerCase();
  const top = products?.[0];

  let suggestedReply = "Hola 👋 encantado de ayudarte. Cuéntame qué estás buscando y te recomiendo la mejor opción.";
  let nextBestAction = "ask_need";
  let leadScore = 45;

  if (top) {
    const price = Number(top.price || 0).toLocaleString("es-CL", { maximumFractionDigits: 0 });
    suggestedReply = `Tengo una opción que puede calzar contigo 🙌 ${top.name}, precio $${price} y stock ${top.stock}. ¿Quieres que te mande más detalles o prefieres ver otra alternativa?`;
    nextBestAction = "recommend_product";
    leadScore = 65;
  }

  if (text.includes("comprar") || text.includes("quiero") || text.includes("agendar")) {
    leadScore += 15;
    nextBestAction = "close_or_schedule";
  }

  if (text.includes("precio") || text.includes("stock") || text.includes("despacho")) {
    leadScore += 10;
  }

  return {
    summary: top ? `Cliente interesado; se recomienda ${top.name}.` : "Cliente en conversación comercial.",
    nextBestAction,
    suggestedReply,
    leadScore: Math.min(100, leadScore),
    reason: top ? "Hay producto disponible relacionado con la consulta." : "Falta más información para recomendar con precisión."
  };
}

export async function generateExpertAnalysis({ tenantId, conversationId, message }) {
  const products = tenantId ? await searchProducts({ tenantId, query: message, take: 3 }) : [];

  if (!message || !String(message).trim()) {
    return {
      summary: "Sin mensaje",
      nextBestAction: "ask",
      suggestedReply: "Escribe un mensaje para probar el bot 😊",
      leadScore: 10,
      reason: "Mensaje vacío"
    };
  }

  if (!env.openAiApiKey) return fallbackAnalysis(message, products);

  const system = `
Eres una IA experta en ventas conversacionales.
Debes analizar el mensaje y devolver SOLO JSON válido con esta forma:
{
  "summary": "resumen comercial corto",
  "nextBestAction": "ask_need | recommend_product | ask_budget | ask_delivery | close_or_schedule | handoff_human",
  "suggestedReply": "respuesta lista para enviar al cliente",
  "leadScore": 0,
  "reason": "explicación breve del score"
}

Reglas:
- La respuesta sugerida debe ser humana, breve, amable y orientada a avanzar la venta.
- Usa máximo 1 pregunta final.
- Si hay productos relevantes, recomienda el mejor sin inventar datos.
- No uses markdown en el JSON.
`;

  const user = `
Mensaje del cliente:
${message}

Productos recomendables:
${buildProductContext(products)}

conversationId: ${conversationId || "N/A"}
`;

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.openAiApiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.4,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user }
        ]
      })
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data?.error?.message || "OpenAI request failed");
    const raw = data?.choices?.[0]?.message?.content || "";
    const parsed = safeJsonParse(raw);
    if (parsed?.suggestedReply) {
      return {
        summary: parsed.summary || "Cliente en conversación comercial.",
        nextBestAction: parsed.nextBestAction || "continue_qualification",
        suggestedReply: parsed.suggestedReply,
        leadScore: Number(parsed.leadScore || 50),
        reason: parsed.reason || "Análisis IA generado."
      };
    }
  } catch (error) {
    console.error("OpenAI expert analysis error:", error?.message || error);
  }

  return fallbackAnalysis(message, products);
}
