import { Router } from "express";
import bcrypt from "bcryptjs";
import { prisma } from "../lib/db.js";
import { requireRole } from "../middleware/tenant-access.js";
import { runAutonomousSalesFollowUps } from "../services/autonomous-sales-followup.service.js";
import {
  auditTenantAction,
  buildSaasOverview,
  getAISettings,
  getCommercialAnalytics,
  getOnboardingState,
  getTenantUsageSummary,
  updateAISettings,
  updateOnboardingState
} from "../services/saas-commercial.service.js";

export const saasRouter = Router();

const TEAM_ROLES = new Set(["OWNER", "ADMIN", "AGENT", "SELLER", "VIEWER"]);

function cleanText(value) {
  const text = String(value ?? "").trim();
  return text || null;
}

function cleanEmail(value) {
  return String(value ?? "").trim().toLowerCase();
}

function handleTeamError(res, error, fallback = "No se pudo procesar el equipo") {
  console.error(fallback, error);
  if (error?.code === "P2002") return res.status(409).json({ error: "Ya existe un usuario con ese email" });
  if (error?.code === "P2025") return res.status(404).json({ error: "Usuario no encontrado" });
  return res.status(500).json({ error: fallback, detail: process.env.NODE_ENV === "production" ? undefined : error?.message });
}

saasRouter.get("/saas/overview", async (req, res, next) => {
  try {
    res.json(await buildSaasOverview(req.tenantId));
  } catch (error) { next(error); }
});

saasRouter.get("/saas/usage", async (req, res, next) => {
  try {
    res.json(await getTenantUsageSummary(req.tenantId));
  } catch (error) { next(error); }
});

saasRouter.get("/saas/analytics", async (req, res, next) => {
  try {
    res.json(await getCommercialAnalytics(req.tenantId));
  } catch (error) { next(error); }
});

saasRouter.get("/saas/ai-config", async (req, res, next) => {
  try {
    res.json({ settings: await getAISettings(req.tenantId) });
  } catch (error) { next(error); }
});

saasRouter.patch("/saas/ai-config", requireRole("OWNER", "ADMIN"), async (req, res, next) => {
  try {
    const settings = await updateAISettings({ tenantId: req.tenantId, settings: req.body || {}, actorUserId: req.user?.id });
    res.json({ settings });
  } catch (error) { next(error); }
});

saasRouter.get("/saas/onboarding", async (req, res, next) => {
  try {
    res.json(await getOnboardingState(req.tenantId));
  } catch (error) { next(error); }
});

saasRouter.patch("/saas/onboarding", requireRole("OWNER", "ADMIN"), async (req, res, next) => {
  try {
    res.json(await updateOnboardingState({ tenantId: req.tenantId, patch: req.body || {}, actorUserId: req.user?.id }));
  } catch (error) { next(error); }
});

saasRouter.get("/saas/team", requireRole("OWNER", "ADMIN"), async (req, res, next) => {
  try {
    const users = await prisma.workspaceUser.findMany({
      where: { tenantId: req.tenantId },
      select: { id: true, name: true, email: true, role: true, isActive: true, createdAt: true, updatedAt: true },
      orderBy: { createdAt: "desc" }
    });
    res.json({ users });
  } catch (error) { next(error); }
});

saasRouter.post("/saas/team", requireRole("OWNER", "ADMIN"), async (req, res, next) => {
  try {
    const { name, email, role = "SELLER", password } = req.body || {};
    const userName = cleanText(name);
    const normalizedEmail = cleanEmail(email);
    const normalizedRole = String(role || "SELLER").trim().toUpperCase();

    if (!userName || !normalizedEmail) return res.status(400).json({ error: "Nombre y email son requeridos" });
    if (!normalizedEmail.includes("@")) return res.status(400).json({ error: "El email del usuario no es válido" });
    if (!TEAM_ROLES.has(normalizedRole)) return res.status(400).json({ error: "Rol inválido para el usuario" });

    const existing = await prisma.workspaceUser.findUnique({ where: { email: normalizedEmail } });
    if (existing) return res.status(409).json({ error: "Ya existe un usuario con ese email" });

    const hashPassword = async (value) => await bcrypt.hash(value, 10);

    const user = await prisma.workspaceUser.create({
      data: {
        tenantId: req.tenantId,
        name: userName,
        email: normalizedEmail,
        role: normalizedRole,
        passwordHash: password ? await hashPassword(password) : null,
        isActive: true
      },
      select: { id: true, name: true, email: true, role: true, isActive: true, createdAt: true, updatedAt: true }
    });

    await auditTenantAction({ tenantId: req.tenantId, actorUserId: req.user?.id, action: "TEAM_USER_CREATED", entity: "WorkspaceUser", entityId: user.id, metadata: { email: user.email, role: user.role } }).catch(() => null);
    res.status(201).json({ user });
  } catch (error) {
    return handleTeamError(res, error, "No se pudo crear el usuario");
  }
});

saasRouter.delete("/saas/team/:userId", requireRole("OWNER", "ADMIN"), async (req, res, next) => {
  try {
    const { userId } = req.params;
    const user = await prisma.workspaceUser.findFirst({ where: { id: userId, tenantId: req.tenantId } });
    if (!user) return res.status(404).json({ error: "Usuario no encontrado" });
    if (user.role === "OWNER") return res.status(400).json({ error: "No puedes eliminar un OWNER desde esta vista" });

    await prisma.workspaceUser.delete({ where: { id: userId } });
    await auditTenantAction({ tenantId: req.tenantId, actorUserId: req.user?.id, action: "TEAM_USER_DELETED", entity: "WorkspaceUser", entityId: userId, metadata: { email: user.email } }).catch(() => null);
    res.json({ ok: true, deletedUserId: userId });
  } catch (error) { next(error); }
});

saasRouter.get("/saas/audit", requireRole("OWNER", "ADMIN"), async (req, res, next) => {
  try {
    const logs = await prisma.tenantAuditLog.findMany({ where: { tenantId: req.tenantId }, orderBy: { createdAt: "desc" }, take: 50 }).catch(() => []);
    res.json({ logs });
  } catch (error) { next(error); }
});

saasRouter.post("/saas/audit", requireRole("OWNER", "ADMIN"), async (req, res, next) => {
  try {
    const log = await auditTenantAction({ tenantId: req.tenantId, actorUserId: req.user?.id, action: req.body?.action || "MANUAL_NOTE", metadata: req.body?.metadata || null });
    res.status(201).json({ log });
  } catch (error) { next(error); }
});


saasRouter.get("/saas/followups/preview", requireRole("OWNER", "ADMIN"), async (req, res, next) => {
  try {
    res.json(await runAutonomousSalesFollowUps({ tenantId: req.tenantId, dryRun: true, limit: 100 }));
  } catch (error) { next(error); }
});

saasRouter.post("/saas/followups/run", requireRole("OWNER", "ADMIN"), async (req, res, next) => {
  try {
    res.json(await runAutonomousSalesFollowUps({ tenantId: req.tenantId, dryRun: false, limit: 100 }));
  } catch (error) { next(error); }
});
