import { Router } from "express";
import { prisma } from "../lib/db.js";
import { MODULES, PLAN_DEFINITIONS } from "../lib/modules.js";
import { listIndustryTemplates } from "../lib/industries.js";
import { getTenantModules, setTenantModules, ensureTenantSubscriptionAndModules } from "../services/tenant-modules.service.js";
import { requireRole } from "../middleware/tenant-access.js";

export const modulesRouter = Router();

modulesRouter.get("/modules/catalog", (_req, res) => {
  res.json({ modules: MODULES, plans: PLAN_DEFINITIONS, industries: listIndustryTemplates() });
});

modulesRouter.get("/modules/me", async (req, res) => {
  try {
    const tenant = await prisma.tenant.findUnique({ where: { id: req.tenantId } });
    if (!tenant) return res.status(404).json({ error: "Tenant no encontrado" });
    await ensureTenantSubscriptionAndModules({ tenantId: tenant.id, planCode: tenant.plan || "STARTER" });
    const modules = await getTenantModules(tenant.id);
    const subscription = await prisma.subscription.findFirst({ where: { tenantId: tenant.id, status: "ACTIVE" }, orderBy: { createdAt: "desc" } });
    res.json({ tenantId: tenant.id, plan: tenant.plan || subscription?.planCode || "STARTER", modules, subscription });
  } catch (error) {
    console.error("Get modules error:", error);
    res.status(500).json({ error: "No se pudieron obtener módulos" });
  }
});

modulesRouter.patch("/modules/tenant/:tenantId", requireRole("OWNER", "ADMIN"), async (req, res) => {
  try {
    const { tenantId } = req.params;
    if (req.user.role !== "SUPER_ADMIN" && req.tenantId !== tenantId) {
      return res.status(403).json({ error: "No puedes modificar otro tenant" });
    }
    const modules = await setTenantModules({ tenantId, modules: req.body.modules || [], source: "MANUAL" });
    res.json({ tenantId, modules });
  } catch (error) {
    console.error("Set modules error:", error);
    res.status(500).json({ error: "No se pudieron actualizar módulos" });
  }
});
