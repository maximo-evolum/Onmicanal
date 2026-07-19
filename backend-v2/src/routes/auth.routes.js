import { Router } from "express";
import { prisma } from "../lib/db.js";
import { authMiddleware, clearBrowserSession, setBrowserSession } from "../lib/auth.js";
import { loginUser, registerTenantOwner } from "../services/auth.service.js";
import { ensureTenantSubscriptionAndModules, getTenantModules } from "../services/tenant-modules.service.js";
import { basicRateLimit } from "../middleware/rate-limit.js";
import { recordAuditLog } from "../lib/audit.js";

export const authRouter = Router();

function isMobileClient(req) {
  return String(req.get("x-auth-client") || "").toLowerCase() === "mobile";
}

function loginRateLimitKey(req) {
  // Una red corporativa o móvil puede compartir una misma IP. Añadir el correo
  // normalizado evita que la actividad legítima de otra cuenta bloquee este
  // acceso, manteniendo protección contra fuerza bruta por cuenta e IP.
  const email = String(req.body?.email || "unknown").trim().toLowerCase().slice(0, 320);
  const ip = String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "ip")
    .split(",")[0]
    .trim();
  return `${email}:${ip}`;
}

function sendAuthenticatedSession(req, res, result) {
  if (isMobileClient(req)) return res.json(result);
  setBrowserSession(res, result.token);
  const { token, ...session } = result;
  // Cookie HTTP-only + token de sesión: el segundo evita que una cookie
  // antigua firmada antes de un deploy bloquee módulos en dominios separados.
  return res.json({ ...session, accessToken: token });
}

function cleanText(value, fallback = "") {
  if (typeof value !== "string") return fallback;
  return value.trim().slice(0, 240);
}

function cleanAvatarUrl(value) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, 3_500_000);
}

authRouter.post("/auth/register", async (req, res) => {
  try {
    const { companyName, name, email, password, type = "PERSONAL", industry = "" } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ error: "name, email y password son requeridos" });
    }
    const result = await registerTenantOwner({ companyName, name, email, password, type, industry });
    return sendAuthenticatedSession(req, res, result);
  } catch (error) {
    res.status(400).json({ error: error.message || "No se pudo registrar" });
  }
});

authRouter.post("/auth/login", basicRateLimit({
  windowMs: 15 * 60_000,
  max: Number(process.env.AUTH_LOGIN_RATE_LIMIT || 12),
  keyPrefix: "auth-login",
  keyForRequest: loginRateLimitKey
}), async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || typeof password !== "string" || !password) {
      return res.status(400).json({ error: "email y password son requeridos" });
    }
    const result = await loginUser({ email, password });
    await recordAuditLog({ ...req, user: result.user, tenantId: result.user.tenantId }, "AUTH_LOGIN_SUCCESS", "workspace_user", result.user.id, {
      authMethod: "password",
      client: isMobileClient(req) ? "mobile" : "browser"
    });
    return sendAuthenticatedSession(req, res, result);
  } catch {
    res.status(401).json({ error: "Credenciales inválidas" });
  }
});

authRouter.post("/auth/logout", (_req, res) => {
  clearBrowserSession(res);
  return res.status(204).end();
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
    user: {
      id: user.id,
      tenantId: user.tenantId,
      name: user.name,
      email: user.email,
      jobTitle: user.jobTitle || null,
      avatarUrl: user.avatarUrl || null,
      role: user.role
    },
    tenant: user.tenant,
    modules
  });
});

authRouter.patch("/auth/me/profile", authMiddleware, async (req, res) => {
  const current = await prisma.workspaceUser.findUnique({
    where: { id: req.user.userId },
    include: { tenant: true }
  });
  if (!current) return res.status(404).json({ error: "Usuario no encontrado" });

  const name = cleanText(req.body?.name, current.name);
  const jobTitle = cleanText(req.body?.jobTitle, "");
  const avatarUrl = cleanAvatarUrl(req.body?.avatarUrl);

  if (!name) return res.status(400).json({ error: "El nombre no puede quedar vacio" });

  const user = await prisma.workspaceUser.update({
    where: { id: current.id },
    data: {
      name,
      jobTitle: jobTitle || null,
      avatarUrl: avatarUrl || null
    },
    include: { tenant: true }
  });

  res.json({
    user: {
      id: user.id,
      tenantId: user.tenantId,
      name: user.name,
      email: user.email,
      jobTitle: user.jobTitle || null,
      avatarUrl: user.avatarUrl || null,
      role: user.role
    },
    tenant: user.tenant
  });
});
