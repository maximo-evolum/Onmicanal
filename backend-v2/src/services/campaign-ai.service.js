const OPENAI_URL = "https://api.openai.com/v1";

function safeJsonParse(text) {
  try { return JSON.parse(text); } catch { return null; }
}

function detectCategory(product = "") {
  const p = product.toLowerCase();
  if (p.includes("casa") || p.includes("departamento")) return "inmobiliaria";
  if (p.includes("zapat") || p.includes("ropa")) return "ecommerce";
  if (p.includes("servicio") || p.includes("asesoría")) return "servicios";
  return "general";
}

function buildSystemPrompt({ category, platform }) {
  return `
Eres un experto en marketing digital.
Generas publicaciones para ${platform}.

Reglas:
- tono natural, cercano y vendedor
- usa emojis moderados
- incluye CTA claro
- evita sonar robótico

Devuelve SOLO JSON:
{
  "variants": [
    { "text": "...", "hashtags": "..." },
    { "text": "...", "hashtags": "..." }
  ]
}
Contexto:
- categoría: ${category}
`;
}

async function generateTextVariants(input) {
  const category = input.category || detectCategory(input.product);
  const system = buildSystemPrompt({ category, platform: input.platform || "instagram" });

  const user = `
Producto: ${input.product}
Precio: ${input.price || "no especificado"}
Público: ${input.target || "general"}
Descripción: ${input.description || ""}
`;

  if (!process.env.OPENAI_API_KEY) {
    // fallback sólido
    return {
      variants: [
        {
          text: `🔥 ${input.product} disponible. Escríbenos para más info 👀`,
          hashtags: "#oferta #promo"
        },
        {
          text: `✨ ¿Buscas ${input.product}? Tenemos opciones para ti 🙌`,
          hashtags: "#comprar #ofertas"
        }
      ]
    };
  }

  const res = await fetch(`${OPENAI_URL}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: system },
        { role: "user", content: user }
      ]
    })
  });

  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content || "";
  const parsed = safeJsonParse(content);

  return parsed || { variants: [] };
}

async function generateImage(prompt) {
  if (!process.env.OPENAI_API_KEY) {
    return "https://via.placeholder.com/1024";
  }

  const res = await fetch(`${OPENAI_URL}/images/generations`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "gpt-image-1",
      prompt: `Imagen publicitaria profesional de: ${prompt}`,
      size: "1024x1024"
    })
  });

  const data = await res.json();
  const image = data?.data?.[0];
  if (image?.url) return image.url;
  if (image?.b64_json) return `data:image/png;base64,${image.b64_json}`;
  return "https://via.placeholder.com/1024";
}

// 🔥 FUNCIÓN PRINCIPAL
export async function generateCampaignPro(input) {
  const textData = await generateTextVariants(input);

  const images = await Promise.all(
    (textData.variants || []).map(() =>
      generateImage(input.product)
    )
  );

  return {
    variants: (textData.variants || []).map((v, i) => ({
      ...v,
      image: images[i]
    }))
  };
}