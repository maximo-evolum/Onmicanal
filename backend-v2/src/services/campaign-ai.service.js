import { ensurePublicCampaignImage } from "./campaign-assets.service.js";
import { sendWhatsAppImage, sendWhatsAppText } from "./whatsapp.service.js";

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

function clampVariantCount(value, fallback = 2) {
  const n = Number(value || fallback);
  if ([1, 2, 4, 8].includes(n)) return n;
  return Math.min(8, Math.max(1, Number.isFinite(n) ? n : fallback));
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

function metadataObject(config = {}) {
  return config?.metadata && typeof config.metadata === "object" ? config.metadata : {};
}

function firstNonEmpty(...values) {
  return values.find((value) => value !== undefined && value !== null && String(value).trim() !== "");
}

function graphErrorMessage(data, fallback) {
  const error = data?.error;
  if (!error) return fallback;
  const parts = [
    error.message,
    error.code ? `code ${error.code}` : null,
    error.error_subcode ? `subcode ${error.error_subcode}` : null,
    error.fbtrace_id ? `trace ${error.fbtrace_id}` : null
  ].filter(Boolean);
  return parts.length ? parts.join(" | ") : fallback;
}

function buildCampaignCaption(selectedVariant = {}, campaign = null) {
  const base = String(selectedVariant.caption || selectedVariant.text || campaign?.name || "Campana EVOLUM").trim();
  const hashtags = String(selectedVariant.hashtags || "").trim();
  if (!hashtags) return base;
  if (base.includes(hashtags)) return base;
  return `${base}\n\n${hashtags}`;
}

function resolveFacebookPublisherConfig(byChannel = {}) {
  const config = byChannel.facebook || {};
  const instagramConfig = byChannel.instagram || {};
  const metadata = metadataObject(config);
  const instagramMetadata = metadataObject(instagramConfig);
  return {
    pageId: firstNonEmpty(
      config.externalAccountId,
      config.businessAccountId,
      metadata.pageId,
      metadata.facebookPageId,
      instagramMetadata.pageId,
      instagramMetadata.facebookPageId,
      process.env.FACEBOOK_PAGE_ID
    ),
    accessToken: firstNonEmpty(
      config.accessToken,
      metadata.pageAccessToken,
      metadata.facebookPageAccessToken,
      process.env.FACEBOOK_PAGE_ACCESS_TOKEN,
      process.env.META_ACCESS_TOKEN
    )
  };
}

function resolveInstagramPublisherConfig(byChannel = {}, tenant = null) {
  const config = byChannel.instagram || {};
  const metadata = metadataObject(config);
  return {
    igUserId: firstNonEmpty(
      config.externalAccountId,
      config.businessAccountId,
      metadata.instagramBusinessAccountId,
      metadata.igUserId,
      tenant?.instagramBusinessAccountId,
      process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID
    ),
    accessToken: firstNonEmpty(
      config.accessToken,
      metadata.instagramAccessToken,
      process.env.INSTAGRAM_ACCESS_TOKEN,
      process.env.META_ACCESS_TOKEN
    )
  };
}

function buildSystemPrompt({ category, platforms, variantCount }) {
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
- crea exactamente ${variantCount} variantes
- títulos visuales cortos y legibles
- captions no robóticos
- si WhatsApp está seleccionado, el caption debe servir como mensaje promocional
- no inventes precios si no vienen dados

Categoría: ${category}
`;
}

function fallbackVariants(input, count = 2) {
  const title = input.visualTitle || input.product || "Campaña destacada";
  const idea = input.idea || input.description || `Promoción para ${input.product || "tu negocio"}`;
  const cta = input.cta || "Escríbenos para más información";

  const base = [
    {
      title,
      caption: `${idea}\n\n${cta}. 🙌`,
      hashtags: "#promo #servicios #negocio",
      cta,
      imagePrompt: `Imagen publicitaria profesional para ${title}. ${idea}`
    },
    {
      title: title.length > 34 ? title.slice(0, 34) : title,
      caption: `✨ ${input.product || "Nueva campaña"}\n\nTenemos una solución pensada para ti. Consulta disponibilidad y detalles hoy.`,
      hashtags: "#oferta #marketing #clientes",
      cta: input.cta || "Cotiza ahora",
      imagePrompt: `Anuncio moderno y premium para ${input.product || title}. Estilo profesional, alto impacto visual.`
    },
    {
      title: `Descubre ${title}`.slice(0, 42),
      caption: `Una propuesta pensada para quienes buscan calidad, confianza y una experiencia simple.\n\n${cta}.`,
      hashtags: "#calidad #experiencia #clientesfelices",
      cta,
      imagePrompt: `Diseño publicitario elegante para ${title}, colores premium, composición limpia, alto impacto comercial.`
    },
    {
      title: `Oferta especial`.slice(0, 42),
      caption: `Aprovecha esta oportunidad y recibe atención personalizada para elegir la mejor alternativa.\n\n${cta}.`,
      hashtags: "#oportunidad #promocion #ventas",
      cta,
      imagePrompt: `Pieza visual de campaña promocional para ${title}, estilo moderno para redes sociales, enfoque en conversión.`
    }
  ];

  while (base.length < count) {
    base.push({
      title: `${title} ${base.length + 1}`.slice(0, 42),
      caption: `${idea}\n\n${cta}.`,
      hashtags: "#campaña #marketing #negocio",
      cta,
      imagePrompt: `Imagen publicitaria profesional variante ${base.length + 1} para ${title}. ${idea}`
    });
  }

  return { variants: base.slice(0, count) };
}

function normalizeVariant(variant, input, index) {
  const title = input.visualTitle || variant.title || input.product || `Campaña ${index + 1}`;
  return {
    id: variant.id || `copy-${Date.now()}-${index}`,
    title,
    caption: input.description || input.caption || variant.caption || variant.text || "",
    text: input.description || input.caption || variant.caption || variant.text || "",
    hashtags: variant.hashtags || "",
    cta: input.cta || variant.cta || "Más información",
    imagePrompt: variant.imagePrompt || input.idea || input.product || title,
    platforms: normalizePlatforms(input.platforms || input.platform),
    generationStage: "copy"
  };
}

async function generateTextVariants(input) {
  const platforms = normalizePlatforms(input.platforms || input.platform);
  const variantCount = clampVariantCount(input.variantCount, input.quickMode ? 1 : 2);
  const category = input.category || detectCategory(input.product, input.idea);
  const system = buildSystemPrompt({ category, platforms, variantCount });

  const user = `
Producto o servicio: ${input.product || ""}
Idea de campaña: ${input.idea || ""}
Título visual solicitado: ${input.visualTitle || ""}
Descripción/caption base: ${input.description || input.caption || ""}
CTA: ${input.cta || ""}
Público: ${input.target || "general"}
Tono: ${input.tone || "cercano y profesional"}
Plataformas: ${platforms.join(", ")}
Cantidad de variantes: ${variantCount}
`;

  if (!process.env.OPENAI_API_KEY) {
    const fallback = fallbackVariants(input, variantCount);
    return {
      variants: fallback.variants.map((variant, index) => normalizeVariant(variant, input, index))
    };
  }

  const res = await fetch(`${OPENAI_URL}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: input.textModel || "gpt-4o-mini",
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
    const fallback = fallbackVariants(input, variantCount);
    return {
      variants: fallback.variants.map((variant, index) => normalizeVariant(variant, input, index))
    };
  }

  const content = data?.choices?.[0]?.message?.content || "";
  const parsed = safeJsonParse(content);

  const rawVariants = parsed?.variants?.length
    ? parsed.variants.slice(0, variantCount)
    : fallbackVariants(input, variantCount).variants;

  return {
    variants: rawVariants.map((variant, index) => normalizeVariant(variant, input, index))
  };
}

async function generateImage(prompt, visualTitle = "", options = {}) {
  if (!process.env.OPENAI_API_KEY || options.skipRealImage) {
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
      model: options.imageModel || "gpt-image-1",
      prompt: fullPrompt,
      size: options.size || "1024x1536"
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
  if (image?.b64_json) {
    return ensurePublicCampaignImage(`data:image/png;base64,${image.b64_json}`, {
      title: visualTitle || "campaña"
    });
  }

  const encoded = encodeURIComponent(visualTitle || "Campaña IA");
  return `https://placehold.co/1080x1350/21183a/ede9fe/png?text=${encoded}`;
}

export async function generateCampaignCopy(input = {}) {
  const platforms = normalizePlatforms(input.platforms || input.platform);
  const variantCount = clampVariantCount(input.variantCount, input.quickMode ? 1 : 2);
  const textData = await generateTextVariants({ ...input, platforms, variantCount });

  return {
    status: "COPY_READY",
    platforms,
    variantCount,
    quickMode: Boolean(input.quickMode),
    variants: (textData.variants || []).slice(0, variantCount)
  };
}

export async function generateCampaignImages(input = {}) {
  const platforms = normalizePlatforms(input.platforms || input.platform);
  const variantCount = clampVariantCount(input.variantCount, input.quickMode ? 1 : 2);
  const baseVariants = Array.isArray(input.variants) && input.variants.length
    ? input.variants
    : (await generateTextVariants({ ...input, platforms, variantCount })).variants;

  const variants = await Promise.all(
    baseVariants.slice(0, variantCount).map(async (variant, index) => {
      const normalized = normalizeVariant(variant, input, index);
      if (normalized.image || normalized.imageUrl) {
        const image = await ensurePublicCampaignImage(normalized.image || normalized.imageUrl, {
          title: normalized.title
        });
        return {
          ...normalized,
          image,
          imageUrl: image,
          generationStage: "complete"
        };
      }

      const image = await ensurePublicCampaignImage(await generateImage(normalized.imagePrompt, normalized.title, {
        skipRealImage: Boolean(input.previewOnly),
        imageModel: input.imageModel,
        size: input.imageSize
      }), { title: normalized.title });

      return {
        ...normalized,
        id: variant.id || `variant-${Date.now()}-${index}`,
        image,
        imageUrl: image,
        generationStage: "complete"
      };
    })
  );

  return {
    status: "READY",
    platforms,
    variantCount,
    quickMode: Boolean(input.quickMode),
    variants
  };
}

export async function generateCampaignPro(input = {}) {
  const quickMode = Boolean(input.quickMode);
  const variantCount = clampVariantCount(input.variantCount, quickMode ? 1 : 2);
  const copy = await generateCampaignCopy({ ...input, variantCount, quickMode });
  const images = await generateCampaignImages({
    ...input,
    variantCount,
    quickMode,
    variants: copy.variants
  });

  return {
    status: "READY",
    platforms: images.platforms,
    variantCount,
    quickMode,
    variants: images.variants
  };
}

function isHttpImageUrl(url = "") {
  return /^https?:\/\//i.test(String(url || ""));
}

function normalizeWhatsappRecipients(recipients = []) {
  if (!Array.isArray(recipients)) return [];
  return [...new Set(
    recipients
      .map((recipient) => String(recipient || "").replace(/[^\d]/g, ""))
      .filter((recipient) => recipient.length >= 8)
  )];
}

async function publishFacebookPhoto({ pageId, accessToken, imageUrl, caption }) {
  if (!pageId || !accessToken) throw new Error("Facebook Page ID o access token no configurado");
  if (!isHttpImageUrl(imageUrl)) throw new Error("Facebook requiere una URL pública de imagen. Las imágenes base64 deben subirse primero a storage.");

  const res = await fetch(`https://graph.facebook.com/v23.0/${pageId}/photos`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      url: String(imageUrl),
      caption: String(caption || ""),
      access_token: String(accessToken)
    })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(graphErrorMessage(data, "No se pudo publicar en Facebook"));
  return data;
}

async function waitForInstagramContainer({ creationId, accessToken }) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const res = await fetch(
      `https://graph.facebook.com/v23.0/${creationId}?fields=status_code,status&access_token=${encodeURIComponent(accessToken)}`
    );
    const data = await res.json();
    if (!res.ok) throw new Error(graphErrorMessage(data, "No se pudo revisar el estado de Instagram"));
    if (!data.status_code || data.status_code === "FINISHED") return data;
    if (data.status_code === "ERROR") {
      throw new Error(data.status || "Instagram no pudo preparar el contenido");
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  return null;
}

async function publishInstagramPhoto({ igUserId, accessToken, imageUrl, caption }) {
  if (!igUserId || !accessToken) throw new Error("Instagram Business Account ID o access token no configurado");
  if (!isHttpImageUrl(imageUrl)) throw new Error("Instagram requiere una URL pública de imagen. Las imágenes base64 deben subirse primero a storage.");

  const createRes = await fetch(`https://graph.facebook.com/v23.0/${igUserId}/media`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      image_url: String(imageUrl),
      caption: String(caption || ""),
      access_token: String(accessToken)
    })
  });
  const createData = await createRes.json();
  if (!createRes.ok) throw new Error(graphErrorMessage(createData, "No se pudo crear media container de Instagram"));

  await waitForInstagramContainer({ creationId: createData.id, accessToken });

  const publishRes = await fetch(`https://graph.facebook.com/v23.0/${igUserId}/media_publish`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      creation_id: String(createData.id),
      access_token: String(accessToken)
    })
  });
  const publishData = await publishRes.json();
  if (!publishRes.ok) throw new Error(graphErrorMessage(publishData, "No se pudo publicar en Instagram"));
  return { ...publishData, creationId: createData.id };
}

export async function publishCampaignToPlatforms({ tenant, channelConfigs = [], campaign, platforms = [], selectedVariant = {}, whatsappRecipients = [] }) {
  const selectedPlatforms = normalizePlatforms(platforms);
  const caption = buildCampaignCaption(selectedVariant, campaign);
  const imageUrl = await ensurePublicCampaignImage(selectedVariant.imageUrl || selectedVariant.image || null, {
    title: selectedVariant.title || campaign?.name || "campaña",
    requirePublicUrl: selectedPlatforms.some((platform) => ["facebook", "instagram"].includes(platform))
  });

  const byChannel = Object.fromEntries(
    channelConfigs.map((config) => [String(config.channel).toLowerCase(), config])
  );

  const results = [];

  for (const platform of selectedPlatforms) {
    try {
      if (platform === "facebook") {
        const config = resolveFacebookPublisherConfig(byChannel);
        const data = await publishFacebookPhoto({ pageId: config.pageId, accessToken: config.accessToken, imageUrl, caption });
        results.push({ platform, status: "PUBLISHED", data });
        continue;
      }

      if (platform === "instagram") {
        const config = resolveInstagramPublisherConfig(byChannel, tenant);
        const data = await publishInstagramPhoto({ igUserId: config.igUserId, accessToken: config.accessToken, imageUrl, caption });
        results.push({ platform, status: "PUBLISHED", data });
        continue;
      }

      if (platform === "whatsapp") {
        const recipients = normalizeWhatsappRecipients(whatsappRecipients);
        if (!recipients.length) {
          results.push({
            platform,
            status: "READY",
            note: "WhatsApp quedo listo, pero falta agregar destinatarios para enviarlo."
          });
          continue;
        }

        const sent = [];
        const failed = [];
        for (const recipient of recipients) {
          try {
            const data = imageUrl && isHttpImageUrl(imageUrl)
              ? await sendWhatsAppImage({
                  to: recipient,
                  imageUrl,
                  caption,
                  tenant
                })
              : await sendWhatsAppText({
                  to: recipient,
                  message: caption,
                  tenant
                });
            sent.push({ to: recipient, data });
          } catch (error) {
            failed.push({ to: recipient, error: error.message });
          }
        }

        results.push({
          platform,
          status: failed.length && sent.length ? "PARTIAL" : failed.length ? "ERROR" : "PUBLISHED",
          note: failed.length
            ? `WhatsApp envio ${sent.length} de ${recipients.length} destinatarios.`
            : `WhatsApp enviado a ${sent.length} destinatarios.`,
          recipients: recipients.length,
          data: { sent, failed }
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
