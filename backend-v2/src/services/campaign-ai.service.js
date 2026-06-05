const OPENAI_URL = "https://api.openai.com/v1";

function safeJsonParse(text) {
  try {
    const cleaned = String(text || "")
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/```$/i, "")
      .trim();
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

function detectCategory(product = "", idea = "") {
  const p = `${product} ${idea}`.toLowerCase();
  if (p.includes("casa") || p.includes("departamento") || p.includes("propiedad")) return "inmobiliaria";
  if (p.includes("zapat") || p.includes("ropa") || p.includes("tienda") || p.includes("ecommerce")) return "ecommerce";
  if (p.includes("parrill") || p.includes("evento") || p.includes("reserva")) return "eventos";
  if (p.includes("servicio") || p.includes("asesoría") || p.includes("consultoría")) return "servicios";
  return "general";
}

function normalizePlatforms(platforms) {
  if (Array.isArray(platforms) && platforms.length) {
    return [...new Set(platforms.map((p) => String(p).toLowerCase()).filter(Boolean))];
  }
  if (typeof platforms === "string" && platforms) return [platforms.toLowerCase()];
  return ["instagram"];
}

function buildSystemPrompt({ category, platforms }) {
  return `
Eres un estratega senior de marketing digital para un SaaS omnicanal.

Debes generar campañas listas para Instagram, Facebook y WhatsApp según las plataformas seleccionadas:
${platforms.join(", ")}

Objetivo:
- crear copy vendedor, natural y claro
- proponer textos visuales para imagen
- crear captions para redes sociales
- incluir CTA
- hashtags útiles
- adaptar el tono a campañas reales de negocios

Devuelve SOLO JSON válido:
{
  "variants": [
    {
      "title": "texto corto para imagen",
      "caption": "descripción lista para publicar",
      "hashtags": "#...",
      "cta": "mensaje de acción",
      "imagePrompt": "prompt visual para generar imagen publicitaria profesional"
    }
  ]
}

Reglas:
- crea 2 variantes
- títulos visuales cortos y legibles
- captions no robóticos
- si WhatsApp está seleccionado, el caption debe servir como mensaje promocional
- no inventes precios si no vienen dados

Categoría: ${category}
`;
}

function fallbackVariants(input) {
  const title = input.visualTitle || input.product || "Campaña destacada";
  const idea = input.idea || input.description || `Promoción para ${input.product || "tu negocio"}`;
  return {
    variants: [
      {
        title,
        caption: `${idea}\n\nEscríbenos y te ayudamos a elegir la mejor opción. 🙌`,
        hashtags: "#promo #servicios #negocio",
        cta: input.cta || "Escríbenos para más información",
        imagePrompt: `Imagen publicitaria profesional para ${title}. ${idea}`
      },
      {
        title: title.length > 34 ? title.slice(0, 34) : title,
        caption: `✨ ${input.product || "Nueva campaña"}\n\nTenemos una solución pensada para ti. Consulta disponibilidad y detalles hoy.`,
        hashtags: "#oferta #marketing #clientes",
        cta: input.cta || "Cotiza ahora",
        imagePrompt: `Anuncio moderno y premium para ${input.product || title}. Estilo profesional, alto impacto visual.`
      }
    ]
  };
}

async function generateTextVariants(input) {
  const platforms = normalizePlatforms(input.platforms || input.platform);
  const category = input.category || detectCategory(input.product, input.idea);
  const system = buildSystemPrompt({ category, platforms });

  const user = `
Producto o servicio: ${input.product || ""}
Idea de campaña: ${input.idea || ""}
Título visual solicitado: ${input.visualTitle || ""}
Descripción/caption base: ${input.description || ""}
CTA: ${input.cta || ""}
Público: ${input.target || "general"}
Tono: ${input.tone || "cercano y profesional"}
Plataformas: ${platforms.join(", ")}
`;

  if (!process.env.OPENAI_API_KEY) return fallbackVariants(input);

  const res = await fetch(`${OPENAI_URL}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user }
      ],
      temperature: 0.8
    })
  });

  const data = await res.json();
  if (!res.ok) {
    console.error("Campaign text generation error:", data);
    return fallbackVariants(input);
  }

  const content = data?.choices?.[0]?.message?.content || "";
  const parsed = safeJsonParse(content);

  if (!parsed?.variants?.length) return fallbackVariants(input);
  return parsed;
}

async function generateImage(prompt, visualTitle = "") {
  if (!process.env.OPENAI_API_KEY) {
    const encoded = encodeURIComponent(visualTitle || "Campaña IA");
    return `https://placehold.co/1080x1350/21183a/ede9fe/png?text=${encoded}`;
  }

  const fullPrompt = `
Crea una pieza publicitaria vertical premium, estilo redes sociales, formato 4:5.
Debe verse profesional, moderna y lista para Instagram/Facebook.
Texto principal visible en la imagen: "${visualTitle || ""}".
Concepto visual: ${prompt}
Evita logos de marcas reales no solicitadas. No agregues texto pequeño ilegible.
`;

  const res = await fetch(`${OPENAI_URL}/images/generations`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "gpt-image-1",
      prompt: fullPrompt,
      size: "1024x1536"
    })
  });

  const data = await res.json();
  if (!res.ok) {
    console.error("Campaign image generation error:", data);
    const encoded = encodeURIComponent(visualTitle || "Campaña IA");
    return `https://placehold.co/1080x1350/21183a/ede9fe/png?text=${encoded}`;
  }

  const image = data?.data?.[0];
  if (image?.url) return image.url;
  if (image?.b64_json) return `data:image/png;base64,${image.b64_json}`;

  const encoded = encodeURIComponent(visualTitle || "Campaña IA");
  return `https://placehold.co/1080x1350/21183a/ede9fe/png?text=${encoded}`;
}

export async function generateCampaignPro(input = {}) {
  const platforms = normalizePlatforms(input.platforms || input.platform);
  const textData = await generateTextVariants({ ...input, platforms });

  const variants = await Promise.all(
    (textData.variants || []).slice(0, 4).map(async (variant, index) => {
      const title = input.visualTitle || variant.title || input.product || `Campaña ${index + 1}`;
      const imagePrompt = variant.imagePrompt || input.idea || input.product || title;
      const image = await generateImage(imagePrompt, title);

      return {
        id: `variant-${Date.now()}-${index}`,
        title,
        caption: input.description || variant.caption || variant.text || "",
        text: input.description || variant.caption || variant.text || "",
        hashtags: variant.hashtags || "",
        cta: input.cta || variant.cta || "Más información",
        image,
        imageUrl: image,
        imagePrompt,
        platforms
      };
    })
  );

  return {
    status: "READY",
    platforms,
    variants
  };
}

function isHttpImageUrl(url = "") {
  return /^https?:\/\//i.test(String(url || ""));
}

async function publishFacebookPhoto({ pageId, accessToken, imageUrl, caption }) {
  if (!pageId || !accessToken) throw new Error("Facebook Page ID o access token no configurado");
  if (!isHttpImageUrl(imageUrl)) throw new Error("Facebook requiere una URL pública de imagen. Las imágenes base64 deben subirse primero a storage.");

  const res = await fetch(`https://graph.facebook.com/v23.0/${pageId}/photos`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url: imageUrl,
      caption,
      access_token: accessToken
    })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || "No se pudo publicar en Facebook");
  return data;
}

async function publishInstagramPhoto({ igUserId, accessToken, imageUrl, caption }) {
  if (!igUserId || !accessToken) throw new Error("Instagram Business Account ID o access token no configurado");
  if (!isHttpImageUrl(imageUrl)) throw new Error("Instagram requiere una URL pública de imagen. Las imágenes base64 deben subirse primero a storage.");

  const createRes = await fetch(`https://graph.facebook.com/v23.0/${igUserId}/media`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      image_url: imageUrl,
      caption,
      access_token: accessToken
    })
  });
  const createData = await createRes.json();
  if (!createRes.ok) throw new Error(createData?.error?.message || "No se pudo crear media container de Instagram");

  const publishRes = await fetch(`https://graph.facebook.com/v23.0/${igUserId}/media_publish`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      creation_id: createData.id,
      access_token: accessToken
    })
  });
  const publishData = await publishRes.json();
  if (!publishRes.ok) throw new Error(publishData?.error?.message || "No se pudo publicar en Instagram");
  return publishData;
}

export async function publishCampaignToPlatforms({ tenant, channelConfigs = [], campaign, platforms = [], selectedVariant = {}, whatsappRecipients = [] }) {
  const selectedPlatforms = normalizePlatforms(platforms);
  const caption = `${selectedVariant.caption || selectedVariant.text || campaign?.template || ""}${selectedVariant.hashtags ? `\n\n${selectedVariant.hashtags}` : ""}`;
  const imageUrl = selectedVariant.imageUrl || selectedVariant.image || null;

  const byChannel = Object.fromEntries(
    channelConfigs.map((config) => [String(config.channel).toLowerCase(), config])
  );

  const results = [];

  for (const platform of selectedPlatforms) {
    try {
      if (platform === "facebook") {
        const config = byChannel.facebook || byChannel.instagram || {};
        const pageId = config.externalAccountId || config.businessAccountId || process.env.FACEBOOK_PAGE_ID;
        const token = config.accessToken || process.env.META_ACCESS_TOKEN;
        const data = await publishFacebookPhoto({ pageId, accessToken: token, imageUrl, caption });
        results.push({ platform, status: "PUBLISHED", data });
        continue;
      }

      if (platform === "instagram") {
        const config = byChannel.instagram || {};
        const igUserId = config.externalAccountId || config.businessAccountId || tenant?.instagramBusinessAccountId || process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID;
        const token = config.accessToken || process.env.META_ACCESS_TOKEN;
        const data = await publishInstagramPhoto({ igUserId, accessToken: token, imageUrl, caption });
        results.push({ platform, status: "PUBLISHED", data });
        continue;
      }

      if (platform === "whatsapp") {
        if (!whatsappRecipients.length) {
          results.push({
            platform,
            status: "READY",
            note: "WhatsApp no publica posts públicos. La campaña quedó lista para enviar como mensaje/template a una lista de destinatarios."
          });
          continue;
        }

        results.push({
          platform,
          status: "READY",
          note: "Envío masivo de WhatsApp preparado. Se recomienda usar plantillas aprobadas por Meta antes de producción.",
          recipients: whatsappRecipients.length
        });
        continue;
      }

      results.push({ platform, status: "SKIPPED", note: "Plataforma no soportada todavía" });
    } catch (error) {
      results.push({ platform, status: "ERROR", error: error.message });
    }
  }

  return results;
}
