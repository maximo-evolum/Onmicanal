import { Router } from "express";
import { prisma } from "../lib/db.js";
import { recordAuditLog } from "../lib/audit.js";
import { createTenantNotification } from "../lib/notifications.js";
import { requireRole, ROLE_GROUPS } from "../middleware/tenant-access.js";

export const notificationsRouter = Router();

function serializeNotification(record) {
  return {
    id: record.id,
    title: record.title,
    status: record.status,
    assignedToId: record.assignedToId,
    body: record.data?.body || "",
    severity: record.data?.severity || "info",
    targetUrl: record.data?.targetUrl || null,
    metadata: record.data || {},
    createdAt: record.createdAt,
    updatedAt: record.updatedAt
  };
}

notificationsRouter.get("/notifications", async (req, res) => {
  try {
    const status = req.query.status ? String(req.query.status).trim().toUpperCase() : null;
    const limit = Math.min(Number(req.query.limit || 50), 150);

    const records = await prisma.industryRecord.findMany({
      where: {
        tenantId: req.tenantId,
        recordType: "notification",
        ...(status ? { status } : {})
      },
      orderBy: { createdAt: "desc" },
      take: limit
    });

    res.json({ notifications: records.map(serializeNotification) });
  } catch (error) {
    console.error("Notifications list error:", error);
    res.status(500).json({ error: "No se pudieron cargar las notificaciones" });
  }
});

notificationsRouter.post("/notifications", requireRole(ROLE_GROUPS.MANAGERS), async (req, res) => {
  try {
    const notification = await createTenantNotification({
      tenantId: req.tenantId,
      title: req.body?.title,
      body: req.body?.body,
      severity: req.body?.severity,
      targetUrl: req.body?.targetUrl,
      assignedToId: req.body?.assignedToId,
      metadata: req.body?.metadata || {}
    });

    if (!notification) {
      return res.status(400).json({ error: "Titulo de notificacion requerido" });
    }

    await recordAuditLog(req, "NOTIFICATION_CREATED", "notification", notification.id, {
      title: notification.title,
      severity: notification.data?.severity || "info"
    });

    res.status(201).json({ notification: serializeNotification(notification) });
  } catch (error) {
    console.error("Notification create error:", error);
    res.status(500).json({ error: "No se pudo crear la notificacion" });
  }
});

notificationsRouter.patch("/notifications/:id/read", async (req, res) => {
  try {
    const current = await prisma.industryRecord.findFirst({
      where: { id: req.params.id, tenantId: req.tenantId, recordType: "notification" }
    });

    if (!current) return res.status(404).json({ error: "Notificacion no encontrada" });

    const notification = await prisma.industryRecord.update({
      where: { id: current.id },
      data: {
        status: "READ",
        data: {
          ...(current.data || {}),
          readAt: new Date().toISOString(),
          readByUserId: req.user?.id || null
        }
      }
    });

    await recordAuditLog(req, "NOTIFICATION_READ", "notification", notification.id);
    res.json({ notification: serializeNotification(notification) });
  } catch (error) {
    console.error("Notification read error:", error);
    res.status(500).json({ error: "No se pudo marcar la notificacion" });
  }
});

notificationsRouter.patch("/notifications/read-all", async (req, res) => {
  try {
    const result = await prisma.industryRecord.updateMany({
      where: { tenantId: req.tenantId, recordType: "notification", status: "UNREAD" },
      data: { status: "READ" }
    });

    await recordAuditLog(req, "NOTIFICATIONS_READ_ALL", "notification", null, {
      count: result.count
    });

    res.json({ updated: result.count });
  } catch (error) {
    console.error("Notifications read all error:", error);
    res.status(500).json({ error: "No se pudieron marcar las notificaciones" });
  }
});
