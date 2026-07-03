import { Router } from "express";
import { prisma } from "../lib/db.js";
import { requireRole, ROLE_GROUPS } from "../middleware/tenant-access.js";

export const auditRouter = Router();

auditRouter.get("/audit/logs", requireRole(ROLE_GROUPS.MANAGERS), async (req, res) => {
  try {
    const where = {
      tenantId: req.user?.role === "SUPER_ADMIN" && req.query?.tenantId ? String(req.query.tenantId) : req.tenantId,
      ...(req.query.action ? { action: String(req.query.action).trim().toUpperCase() } : {}),
      ...(req.query.entity ? { entity: String(req.query.entity).trim() } : {}),
      ...(req.query.entityId ? { entityId: String(req.query.entityId).trim() } : {})
    };

    const logs = await prisma.tenantAuditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: Math.min(Number(req.query.limit || 100), 300)
    });

    res.json({ logs });
  } catch (error) {
    console.error("Audit logs error:", error);
    res.status(500).json({ error: "No se pudo cargar auditoria" });
  }
});
