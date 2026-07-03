import { Router } from "express";
import { prisma } from "../lib/db.js";
import { recordAuditLog } from "../lib/audit.js";
import { requireRole, ROLE_GROUPS } from "../middleware/tenant-access.js";

export const backupsRouter = Router();

async function tenantCounts(tenantId) {
  const [
    users,
    contacts,
    conversations,
    messages,
    leads,
    bookings,
    payments,
    campaigns,
    industryRecords,
    auditLogs
  ] = await Promise.all([
    prisma.workspaceUser.count({ where: { tenantId } }),
    prisma.contact.count({ where: { tenantId } }),
    prisma.conversation.count({ where: { tenantId } }),
    prisma.message.count({ where: { tenantId } }),
    prisma.lead.count({ where: { tenantId } }),
    prisma.booking.count({ where: { tenantId } }),
    prisma.payment.count({ where: { tenantId } }),
    prisma.campaign.count({ where: { tenantId } }),
    prisma.industryRecord.count({ where: { tenantId } }),
    prisma.tenantAuditLog.count({ where: { tenantId } })
  ]);

  return {
    users,
    contacts,
    conversations,
    messages,
    leads,
    bookings,
    payments,
    campaigns,
    industryRecords,
    auditLogs
  };
}

backupsRouter.get("/backups/summary", requireRole(ROLE_GROUPS.MANAGERS), async (req, res) => {
  try {
    res.json({
      tenantId: req.tenantId,
      counts: await tenantCounts(req.tenantId),
      generatedAt: new Date().toISOString()
    });
  } catch (error) {
    console.error("Backup summary error:", error);
    res.status(500).json({ error: "No se pudo cargar el resumen de respaldo" });
  }
});

backupsRouter.get("/backups/export", requireRole(ROLE_GROUPS.MANAGERS), async (req, res) => {
  try {
    const tenantId = req.tenantId;
    const [
      tenant,
      users,
      contacts,
      conversations,
      messages,
      leads,
      bookings,
      payments,
      campaigns,
      industryRecords,
      auditLogs
    ] = await Promise.all([
      prisma.tenant.findUnique({
        where: { id: tenantId },
        select: {
          id: true,
          name: true,
          slug: true,
          type: true,
          industry: true,
          plan: true,
          onboardingCompleted: true,
          billingLimits: true,
          createdAt: true,
          updatedAt: true
        }
      }),
      prisma.workspaceUser.findMany({
        where: { tenantId },
        select: {
          id: true,
          name: true,
          email: true,
          jobTitle: true,
          avatarUrl: true,
          role: true,
          isActive: true,
          createdAt: true,
          updatedAt: true
        }
      }),
      prisma.contact.findMany({ where: { tenantId }, take: 5000, orderBy: { updatedAt: "desc" } }),
      prisma.conversation.findMany({ where: { tenantId }, take: 5000, orderBy: { updatedAt: "desc" } }),
      prisma.message.findMany({ where: { tenantId }, take: 10000, orderBy: { createdAt: "desc" } }),
      prisma.lead.findMany({ where: { tenantId }, take: 5000, orderBy: { updatedAt: "desc" } }),
      prisma.booking.findMany({ where: { tenantId }, take: 5000, orderBy: { date: "desc" } }),
      prisma.payment.findMany({ where: { tenantId }, take: 5000, orderBy: { createdAt: "desc" } }),
      prisma.campaign.findMany({ where: { tenantId }, take: 1000, orderBy: { updatedAt: "desc" } }),
      prisma.industryRecord.findMany({ where: { tenantId }, take: 5000, orderBy: { updatedAt: "desc" } }),
      prisma.tenantAuditLog.findMany({ where: { tenantId }, take: 1000, orderBy: { createdAt: "desc" } })
    ]);

    const payload = {
      version: "tenant-export-v1",
      generatedAt: new Date().toISOString(),
      tenant,
      counts: await tenantCounts(tenantId),
      data: {
        users,
        contacts,
        conversations,
        messages,
        leads,
        bookings,
        payments,
        campaigns,
        industryRecords,
        auditLogs
      }
    };

    await recordAuditLog(req, "TENANT_BACKUP_EXPORTED", "tenant", tenantId, {
      counts: payload.counts
    });

    const safeSlug = String(tenant?.slug || tenantId).replace(/[^a-z0-9_-]/gi, "-");
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="evolum-${safeSlug}-backup.json"`);
    res.json(payload);
  } catch (error) {
    console.error("Backup export error:", error);
    res.status(500).json({ error: "No se pudo exportar el respaldo" });
  }
});
