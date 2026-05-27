import { Router } from "express";
import { prisma } from "../lib/db.js";
import { authMiddleware } from "../lib/auth.js";
import { loginUser, registerTenantOwner } from "../services/auth.service.js";
import { ensureTenantSubscriptionAndModules, getTenantModules } from "../services/tenant-modules.service.js";

export const authRouter = Router();

authRouter.post("/auth/register", async (req, res) => {
  try {
    const { companyName, name, email, password, type = "PERSONAL", industry = "" } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ error: "name, email y password son requeridos" });
    }
    const result = await registerTenantOwner({ companyName, name, email, password, type, industry });
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message || "No se pudo registrar" });
  }
});

authRouter.post("/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email) return res.status(400).json({ error: "email es requerido" });
    const result = await loginUser({ email, password });
    res.json(result);
  } catch {
    res.status(401).json({ error: "Credenciales inválidas" });
  }
});

authRouter.get("/auth/me", authMiddleware, async (req, res) => {
  const user = await prisma.workspaceUser.findUnique({
    where: { id: req.user.userId },
    include: { tenant: true }
  });
  if (!user) return res.status(404).json({ error: "Usuario no encontrado" });
  await ensureTenantSubscriptionAndModules({ tenantId: user.tenantId, planCode: user.tenant.plan || "STARTER" });
  const modules = await getTenantModules(user.tenantId);
  res.json({
    user: { id: user.id, tenantId: user.tenantId, name: user.name, email: user.email, role: user.role },
    tenant: user.tenant,
    modules
  });
});
