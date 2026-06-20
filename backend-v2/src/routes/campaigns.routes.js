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
