import { Router } from "express";
import { prisma } from "../lib/db.js";
import { generateCampaignPro } from "../services/campaign-ai.service.js";
import { requireRole, ROLE_GROUPS } from "../middleware/tenant-access.js";

export const campaignsRouter = Router();

campaignsRouter.get("/campaigns", async (req, res) => {
  try {
    const campaigns = await prisma.campaign.findMany({
      where: { tenantId: req.tenantId },
      orderBy: { createdAt: "desc" }
    });
    return res.json(campaigns);
  } catch (error) {
    console.error("List campaigns error:", error);
    return res.status(500).json({ error: "No se pudieron obtener campañas" });
  }
});

campaignsRouter.post("/campaigns", requireRole(ROLE_GROUPS.MANAGERS), async (req, res) => {
  try {
    const { name, segment = "all", template, scheduledAt } = req.body;
    if (!name || !template) return res.status(400).json({ error: "name y template son requeridos" });

    const campaign = await prisma.campaign.create({
      data: {
        tenantId: req.tenantId,
        name,
        segment,
        template,
        scheduledAt: scheduledAt ? new Date(scheduledAt) : null,
        status: scheduledAt ? "SCHEDULED" : "DRAFT"
      }
    });

    return res.json(campaign);
  } catch (error) {
    console.error("Create campaign error:", error);
    return res.status(500).json({ error: "No se pudo crear campaña" });
  }
});

campaignsRouter.post("/campaigns/generate-pro", requireRole(ROLE_GROUPS.STAFF), async (req, res) => {
  try {
    const result = await generateCampaignPro(req.body);
    return res.json(result);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Error generando campaña" });
  }
});
