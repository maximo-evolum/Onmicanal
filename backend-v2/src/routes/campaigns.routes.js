import { Router } from "express";
import { prisma } from "../lib/db.js";
import { generateCampaignPro, generateCampaignCopy, generateCampaignImages, publishCampaignToPlatforms } from "../services/campaign-ai.service.js";
import { requireRole, ROLE_GROUPS } from "../middleware/tenant-access.js";

export const campaignsRouter = Router();

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
    const result = await generateCampaignImages(req.body);

    let campaign = null;
    if (req.body.campaignId) {
      campaign = await prisma.campaign.findFirst({
        where: { id: req.body.campaignId, tenantId: req.tenantId }
      });
    }

    const templateData = {
      ...req.body,
      variants: result.variants,
      platforms: result.platforms,
      generationMode: "images"
    };

    if (campaign) {
      campaign = await prisma.campaign.update({
        where: { id: campaign.id },
        data: {
          template: JSON.stringify({
            ...safeJsonParse(campaign.template, {}),
            ...templateData
          }),
          status: "READY"
        }
      });
    } else {
      campaign = await prisma.campaign.create({
        data: {
          tenantId: req.tenantId,
          name: req.body.visualTitle || req.body.product || "Campaña IA",
          segment: "manual",
          template: JSON.stringify(templateData),
          status: "READY"
        }
      }).catch((error) => {
        console.warn("Campaign image draft save skipped:", error.message);
        return null;
      });
    }

    return res.json({
      ...result,
      campaign: campaign ? serializeCampaign(campaign) : null
    });
  } catch (e) {
    console.error("Generate campaign images error:", e);
    return res.status(500).json({ error: "Error generando imágenes de campaña" });
  }
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

    const hasPublished = results.some((r) => r.status === "PUBLISHED");
    const hasError = results.some((r) => r.status === "ERROR");
    const status = hasPublished && !hasError ? "PUBLISHED" : hasPublished ? "PARTIAL" : hasError ? "ERROR" : "READY";

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
