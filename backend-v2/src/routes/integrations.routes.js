import { Router } from "express";
import { prisma } from "../lib/db.js";
import { recordAuditLog } from "../lib/audit.js";
import { normalizeMetadata } from "../lib/metadata.js";
import { requireRole, ROLE_GROUPS } from "../middleware/tenant-access.js";

export const integrationsRouter = Router();

const SUPPORTED_CHANNELS = new Set([
  "whatsapp",
  "instagram",
  "facebook",
  "email",
  "email_imap",
  "gmail",
  "google_workspace",
  "google_calendar",
  "google_drive",
  "sharepoint",
  "onedrive",
  "stripe",
  "mercadopago",
  "transbank",
  "webpay"
]);

function safeChannel(value) {
  return String(value || "").trim().toLowerCase();
}

function publicConfig(config) {
  return {
    id: config.id,
    channel: config.channel,
    label: config.label,
    phoneNumberId: config.phoneNumberId,
    businessAccountId: config.businessAccountId,
    externalAccountId: config.externalAccountId,
    metadata: config.metadata,
    isActive: config.isActive,
    hasAccessToken: Boolean(config.accessToken),
    hasVerifyToken: Boolean(config.verifyToken),
    createdAt: config.createdAt,
    updatedAt: config.updatedAt
  };
}

integrationsRouter.get("/integrations/status", async (req, res) => {
  try {
    const configs = await prisma.tenantChannelConfig.findMany({
      where: { tenantId: req.tenantId },
      orderBy: [{ channel: "asc" }, { updatedAt: "desc" }]
    });

    res.json({
      integrations: configs.map(publicConfig),
      summary: {
        active: configs.filter((item) => item.isActive).length,
        configured: configs.length,
        channels: configs.map((item) => item.channel)
      }
    });
  } catch (error) {
    console.error("Integration status error:", error);
    res.status(500).json({ error: "No se pudo cargar estado de integraciones" });
  }
});

integrationsRouter.put("/integrations/:channel", requireRole(ROLE_GROUPS.MANAGERS), async (req, res) => {
  try {
    const channel = safeChannel(req.params.channel);
    if (!SUPPORTED_CHANNELS.has(channel)) return res.status(400).json({ error: "Canal no soportado" });

    const previous = await prisma.tenantChannelConfig.findUnique({
      where: { tenantId_channel: { tenantId: req.tenantId, channel } }
    });

    const data = {
      label: String(req.body?.label || previous?.label || `${channel} principal`).trim(),
      phoneNumberId: req.body?.phoneNumberId === undefined ? previous?.phoneNumberId || null : String(req.body.phoneNumberId || "").trim() || null,
      businessAccountId: req.body?.businessAccountId === undefined ? previous?.businessAccountId || null : String(req.body.businessAccountId || "").trim() || null,
      externalAccountId: req.body?.externalAccountId === undefined ? previous?.externalAccountId || null : String(req.body.externalAccountId || "").trim() || null,
      accessToken: req.body?.accessToken === undefined ? previous?.accessToken || null : String(req.body.accessToken || "").trim() || null,
      verifyToken: req.body?.verifyToken === undefined ? previous?.verifyToken || null : String(req.body.verifyToken || "").trim() || null,
      metadata: normalizeMetadata({ ...(previous?.metadata || {}), ...(req.body?.metadata || {}) }, {}),
      isActive: req.body?.isActive === undefined ? previous?.isActive ?? true : Boolean(req.body.isActive)
    };

    const config = await prisma.tenantChannelConfig.upsert({
      where: { tenantId_channel: { tenantId: req.tenantId, channel } },
      update: data,
      create: { tenantId: req.tenantId, channel, ...data }
    });

    await recordAuditLog(req, "INTEGRATION_CONFIGURED", "integration", config.id, { channel, isActive: config.isActive });
    res.json({ integration: publicConfig(config) });
  } catch (error) {
    console.error("Configure integration error:", error);
    res.status(500).json({ error: "No se pudo configurar integracion" });
  }
});
