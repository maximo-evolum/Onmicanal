import { Router } from "express";
import { prisma } from "../lib/db.js";
import { generateCampaignPro, generateCampaignCopy, generateCampaignImages, publishCampaignToPlatforms } from "../services/campaign-ai.service.js";
import { requireRole, ROLE_GROUPS } from "../middleware/tenant-access.js";

export const campaignsRouter = Router();


const campaignJobs = new Map();

function createCampaignJob({ tenantId, kind, payload }) {
  const id = `campjob_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  const now = new Date().toISOString();
  const job = {
    id,
    tenantId,
    kind,
    status: "PROCESSING",
    progress: 5,
    message: "Trabajo creado",
    payload,
    result: null,
    error: null,
    createdAt: now,
    updatedAt: now
  };
  campaignJobs.set(id, job);

  // Limpieza simple para evitar crecimiento infinito en procesos largos.
  setTimeout(() => campaignJobs.delete(id), 1000 * 60 * 60 * 6).unref?.();

  return job;
}

function updateCampaignJob(id, patch) {
  const current = campaignJobs.get(id);
  if (!current) return null;
  const next = {
    ...current,
    ...patch,
    updatedAt: new Date().toISOString()
  };
  campaignJobs.set(id, next);
  return next;
}

function publicCampaignJob(job) {
  if (!job) return null;
  return {
    id: job.id,
    kind: job.kind,
    status: job.status,
    progress: job.progress,
    message: job.message,
    result: job.result,
    error: job.error,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt
  };
}

async function saveGeneratedImagesCampaign({ tenantId, payload, result }) {
  let campaign = null;

  if (payload.campaignId) {
    campaign = await prisma.campaign.findFirst({
      where: { id: payload.campaignId, tenantId }
    });
  }

  const templateData = {
    ...payload,
    variants: result.variants,
    platforms: result.platforms,
    generationMode: "images-async"
  };

  if (campaign) {
    return prisma.campaign.update({
      where: { id: campaign.id },
      data: {
        template: JSON.stringify({
          ...safeJsonParse(campaign.template, {}),
          ...templateData
        }),
        status: "READY"
      }
    });
  }

  return prisma.campaign.create({
    data: {
      tenantId,
      name: payload.visualTitle || payload.product || "Campaña IA",
      segment: "manual",
      template: JSON.stringify(templateData),
      status: "READY"
    }
  });
}

function runCampaignImageJob(jobId) {
  const job = campaignJobs.get(jobId);
  if (!job) return;

  setTimeout(async () => {
    try {
      updateCampaignJob(jobId, {
        progress: 15,
        message: "Generando imágenes en segundo plano"
      });

      const result = await generateCampaignImages({
        ...(job.payload || {}),
        // Modo rápido realmente liviano: una sola variante y preview si se pide desde UI.
        variantCount: job.payload?.quickMode ? 1 : job.payload?.variantCount,
        imageSize: job.payload?.quickMode ? "1024x1024" : job.payload?.imageSize
      });

      updateCampaignJob(jobId, {
        progress: 82,
        message: "Guardando campaña generada"
      });

      const campaign = await saveGeneratedImagesCampaign({
        tenantId: job.tenantId,
        payload: job.payload || {},
        result
      }).catch((error) => {
        console.warn("Async campaign draft save skipped:", error.message);
        return null;
      });

      updateCampaignJob(jobId, {
        status: "COMPLETED",
        progress: 100,
        message: "Campaña lista",
        result: {
          ...result,
          campaign: campaign ? serializeCampaign(campaign) : null
        }
      });
    } catch (error) {
      console.error("Async campaign image job error:", error);
      updateCampaignJob(jobId, {
        status: "FAILED",
        progress: 100,
        message: "Error generando imágenes",
        error: error.message || "Error generando imágenes"
      });
    }
  }, 0);
}

function safeJsonParse(value, fallback = null) {
  try {
    if (!value) return fallback;
    if (typeof value === "object") return value;
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function serializeCampaign(campaign) {
  const template = safeJsonParse(campaign.template, {});
  return {
    ...campaign,
    templateData: template
  };
}

function propertyCampaignContext(property) {
  const data = property?.data && typeof property.data === "object" ? property.data : {};
  const price = Number(data.price || data.value || data.askingPrice || 0);
  const operation = String(data.operation || "venta").toLowerCase();
  const address = String(data.address || data.comuna || data.commune || "ubicación por confirmar").trim();
  const propertyType = String(data.propertyType || data.type || "propiedad").trim();
  const specs = [data.bedrooms ? `${data.bedrooms} dormitorios` : null, data.bathrooms ? `${data.bathrooms} baños` : null, data.meters ? `${data.meters} m²` : null].filter(Boolean).join(", ");
  const value = price ? `$${Math.round(price).toLocaleString("es-CL")}` : "precio a consultar";
  return {
    product: `${propertyType} en ${address}`,
    visualTitle: property.title,
    idea: `${operation === "arriendo" ? "Arriendo" : "Venta"} de ${propertyType} en ${address}. ${specs || "Ficha disponible"}. ${value}.`,
    caption: `${property.title}\n${address}${specs ? ` · ${specs}` : ""}${price ? ` · ${value}` : ""}\n\nEscríbenos para coordinar una visita y recibir la ficha completa.`,
    cta: "Agenda una visita",
    target: operation === "arriendo" ? "personas buscando arriendo en la zona" : "personas interesadas en comprar propiedad en la zona",
    category: "inmobiliaria",
    propertyId: property.id
  };
}

campaignsRouter.get("/campaigns", async (req, res) => {
  try {
    const campaigns = await prisma.campaign.findMany({
      where: { tenantId: req.tenantId },
      orderBy: { createdAt: "desc" }
    });
    return res.json(campaigns.map(serializeCampaign));
  } catch (error) {
    console.error("List campaigns error:", error);
    return res.status(500).json({ error: "No se pudieron obtener campañas" });
  }
});

// Resumen de rendimiento operativo. Las redes no entregan métricas de pauta
// sin sus APIs publicitarias; por eso este reporte distingue publicaciones de
// conversiones, evitando inventar resultados comerciales.
campaignsRouter.get("/campaigns/analytics", async (req, res) => {
  try {
    const campaigns = await prisma.campaign.findMany({ where: { tenantId: req.tenantId }, orderBy: { updatedAt: "desc" }, take: 500 });
    const byStatus = campaigns.reduce((acc, campaign) => {
      const status = String(campaign.status || "DRAFT").toUpperCase();
      acc[status] = (acc[status] || 0) + 1;
      return acc;
    }, {});
    const byPlatform = {};
    let successfulPublications = 0;
    let partialPublications = 0;
    for (const campaign of campaigns) {
      const template = safeJsonParse(campaign.template, {});
      const platforms = Array.isArray(template?.platforms) ? template.platforms : [];
      for (const platform of platforms) {
        const key = String(platform || "").toLowerCase();
        if (key) byPlatform[key] = (byPlatform[key] || 0) + 1;
      }
      if (String(campaign.status).toUpperCase() === "PUBLISHED") successfulPublications += 1;
      if (String(campaign.status).toUpperCase() === "PARTIAL") partialPublications += 1;
    }
    res.json({
      generatedAt: new Date().toISOString(),
      total: campaigns.length,
      byStatus,
      byPlatform: Object.entries(byPlatform).map(([platform, count]) => ({ platform, count })).sort((a, b) => b.count - a.count),
      successfulPublications,
      partialPublications,
      conversionTracking: "pending_provider_events",
      recommendations: [
        successfulPublications ? "Relaciona cada campaña publicada con su fuente de lead para medir atribución comercial." : "Publica una campaña de prueba antes de medir atribución.",
        partialPublications ? "Hay publicaciones parciales: revisa credenciales y permisos del canal." : "No hay publicaciones parciales pendientes de revisión."
      ]
    });
  } catch (error) {
    console.error("Campaign analytics error:", error);
    res.status(500).json({ error: "No se pudo obtener la analítica de campañas" });
  }
});

campaignsRouter.post("/campaigns/realty/property/:propertyId/draft", requireRole(ROLE_GROUPS.STAFF), async (req, res) => {
  try {
    const property = await prisma.industryRecord.findFirst({ where: { id: req.params.propertyId, tenantId: req.tenantId, recordType: "property", status: { not: "ARCHIVED" } } });
    if (!property) return res.status(404).json({ error: "Propiedad no encontrada" });
    const context = propertyCampaignContext(property);
    const platforms = Array.isArray(req.body?.platforms) && req.body.platforms.length ? req.body.platforms : ["instagram", "facebook"];
    const generated = await generateCampaignCopy({ ...context, platforms, variantCount: req.body?.variantCount || 2, tone: req.body?.tone || "profesional, cercano y confiable" });
    const campaign = await prisma.campaign.create({
      data: {
        tenantId: req.tenantId,
        name: `Propiedad · ${property.title}`,
        segment: "realty_property",
        template: JSON.stringify({ ...context, platforms, variants: generated.variants, source: "property_campaign_draft" }),
        status: "DRAFT"
      }
    });
    return res.status(201).json({ campaign: serializeCampaign(campaign), context, variants: generated.variants });
  } catch (error) {
    console.error("Property campaign draft error:", error);
    return res.status(500).json({ error: "No se pudo generar el borrador de campaña inmobiliaria" });
  }
});

campaignsRouter.post("/campaigns", requireRole(ROLE_GROUPS.MANAGERS), async (req, res) => {
  try {
    const {
      name,
      segment = "all",
      template,
      scheduledAt,
      idea,
      product,
      visualTitle,
      caption,
      cta,
      platforms = [],
      selectedVariant = null,
      variants = []
    } = req.body;

    const campaignName = name || visualTitle || product || "Campaña IA";
    const templateData = typeof template === "string"
      ? safeJsonParse(template, { raw: template })
      : {
          idea,
          product,
          visualTitle,
          caption,
          cta,
          platforms,
          selectedVariant,
          variants
        };

    const campaign = await prisma.campaign.create({
      data: {
        tenantId: req.tenantId,
        name: campaignName,
        segment,
        template: JSON.stringify(templateData || {}),
        scheduledAt: scheduledAt ? new Date(scheduledAt) : null,
        status: scheduledAt ? "SCHEDULED" : "DRAFT"
      }
    });

    return res.json(serializeCampaign(campaign));
  } catch (error) {
    console.error("Create campaign error:", error);
    return res.status(500).json({ error: "No se pudo crear campaña" });
  }
});


campaignsRouter.post("/campaigns/generate-copy", requireRole(ROLE_GROUPS.STAFF), async (req, res) => {
  try {
    const result = await generateCampaignCopy(req.body);

    const campaign = await prisma.campaign.create({
      data: {
        tenantId: req.tenantId,
        name: req.body.visualTitle || req.body.product || "Campaña IA",
        segment: "manual",
        template: JSON.stringify({
          ...req.body,
          variants: result.variants,
          platforms: result.platforms,
          variantCount: result.variantCount,
          quickMode: result.quickMode,
          generationMode: "copy-only"
        }),
        status: "DRAFT"
      }
    }).catch((error) => {
      console.warn("Campaign copy draft save skipped:", error.message);
      return null;
    });

    return res.json({
      ...result,
      campaign: campaign ? serializeCampaign(campaign) : null
    });
  } catch (e) {
    console.error("Generate campaign copy error:", e);
    return res.status(500).json({ error: "Error generando copy de campaña" });
  }
});

campaignsRouter.post("/campaigns/generate-images", requireRole(ROLE_GROUPS.STAFF), async (req, res) => {
  try {
    // Las imágenes pueden tardar mucho. Respondemos de inmediato con un job
    // y el frontend consulta /api/campaigns/job/:jobId.
    const job = createCampaignJob({
      tenantId: req.tenantId,
      kind: "campaign-images",
      payload: {
        ...req.body,
        async: true
      }
    });

    runCampaignImageJob(job.id);

    return res.status(202).json({
      status: "PROCESSING",
      async: true,
      jobId: job.id,
      job: publicCampaignJob(job),
      message: "Generación de imágenes iniciada"
    });
  } catch (e) {
    console.error("Generate campaign images async error:", e);
    return res.status(500).json({ error: "Error iniciando generación de imágenes" });
  }
});

campaignsRouter.get("/campaigns/job/:jobId", requireRole(ROLE_GROUPS.STAFF), async (req, res) => {
  const job = campaignJobs.get(req.params.jobId);

  if (!job || job.tenantId !== req.tenantId) {
    return res.status(404).json({ error: "Job no encontrado" });
  }

  return res.json(publicCampaignJob(job));
});

campaignsRouter.post("/campaigns/generate-pro", requireRole(ROLE_GROUPS.STAFF), async (req, res) => {
  try {
    const result = await generateCampaignPro(req.body);

    // Guardamos un borrador auditable para que el cliente no pierda campañas generadas.
    const campaign = await prisma.campaign.create({
      data: {
        tenantId: req.tenantId,
        name: req.body.visualTitle || req.body.product || "Campaña IA",
        segment: "manual",
        template: JSON.stringify({
          ...req.body,
          variants: result.variants,
          platforms: result.platforms,
          variantCount: result.variantCount,
          quickMode: result.quickMode
        }),
        status: "READY"
      }
    }).catch((error) => {
      console.warn("Campaign draft save skipped:", error.message);
      return null;
    });

    return res.json({
      ...result,
      campaign: campaign ? serializeCampaign(campaign) : null
    });
  } catch (e) {
    console.error("Generate campaign error:", e);
    return res.status(500).json({ error: "Error generando campaña" });
  }
});

campaignsRouter.post("/campaigns/publish", requireRole(ROLE_GROUPS.STAFF), async (req, res) => {
  try {
    const {
      campaignId,
      idea,
      product,
      visualTitle,
      caption,
      cta,
      platforms = [],
      selectedVariant,
      variants = [],
      whatsappRecipients = []
    } = req.body;

    const tenant = await prisma.tenant.findUnique({ where: { id: req.tenantId } });
    if (!tenant) return res.status(404).json({ error: "Tenant no encontrado" });

    const channelConfigs = await prisma.tenantChannelConfig.findMany({
      where: {
        tenantId: req.tenantId,
        channel: { in: ["instagram", "facebook", "whatsapp"] },
        isActive: true
      }
    });

    const templateData = {
      idea,
      product,
      visualTitle,
      caption,
      cta,
      platforms,
      selectedVariant,
      variants,
      whatsappRecipientsCount: whatsappRecipients.length
    };

    let campaign = null;
    if (campaignId) {
      campaign = await prisma.campaign.findFirst({
        where: { id: campaignId, tenantId: req.tenantId }
      });
    }

    if (!campaign) {
      campaign = await prisma.campaign.create({
        data: {
          tenantId: req.tenantId,
          name: visualTitle || product || "Campaña IA",
          segment: "manual",
          template: JSON.stringify(templateData),
          status: "PUBLISHING"
        }
      });
    } else {
      campaign = await prisma.campaign.update({
        where: { id: campaign.id },
        data: {
          template: JSON.stringify({
            ...safeJsonParse(campaign.template, {}),
            ...templateData
          }),
          status: "PUBLISHING"
        }
      });
    }

    const results = await publishCampaignToPlatforms({
      tenant,
      channelConfigs,
      campaign,
      platforms,
      selectedVariant: selectedVariant || {},
      whatsappRecipients
    });

    const hasPublished = results.some((r) => ["PUBLISHED", "PARTIAL"].includes(r.status));
    const hasPartial = results.some((r) => r.status === "PARTIAL");
    const hasError = results.some((r) => r.status === "ERROR");
    const status = hasPublished && !hasError && !hasPartial ? "PUBLISHED" : hasPublished || hasPartial ? "PARTIAL" : hasError ? "ERROR" : "READY";

    const updated = await prisma.campaign.update({
      where: { id: campaign.id },
      data: {
        status,
        sentAt: hasPublished ? new Date() : null,
        template: JSON.stringify({
          ...templateData,
          publishResults: results
        })
      }
    });

    return res.json({
      campaign: serializeCampaign(updated),
      results
    });
  } catch (error) {
    console.error("Publish campaign error:", error);
    return res.status(500).json({ error: error.message || "No se pudo publicar la campaña" });
  }
});
