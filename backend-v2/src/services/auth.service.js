import bcrypt from "bcryptjs";
import { prisma } from "../lib/db.js";
import { signAuthToken } from "../lib/auth.js";
import { generateBusinessPrompt } from "./ai-personalization.service.js";
import { ensureTenantSubscriptionAndModules } from "./tenant-modules.service.js";

function makeSlug(value) {
  return String(value || "workspace")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "") || "workspace";
}

async function hashPassword(password) {
  return await bcrypt.hash(password, 10);
}

async function verifyPassword(password, stored) {
  if (!stored) return false;
  return await bcrypt.compare(password, stored);
}

function sanitizeUser(user) {
  return {
    id: user.id,
    tenantId: user.tenantId,
    name: user.name,
    email: user.email,
    role: user.role
  };
}

export async function registerTenantOwner({ companyName, name, email, password, type = "PERSONAL", industry = "" }) {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  const existing = await prisma.workspaceUser.findUnique({ where: { email: normalizedEmail } });
  if (existing) throw new Error("El email ya está registrado");

  const prompt = await generateBusinessPrompt({ name: companyName, type, industry });
  const baseSlug = makeSlug(companyName || name);
  const slug = `${baseSlug}-${Date.now()}`;

  const result = await prisma.$transaction(async (tx) => {
    const tenant = await tx.tenant.create({
      data: {
        name: companyName || `${name} workspace`,
        slug,
        type,
        industry: industry || null,
        plan: "STARTER",
        businessPrompt: prompt,
        onboardingCompleted: true
      }
    });

    const user = await tx.workspaceUser.create({
      data: {
        tenantId: tenant.id,
        name,
        email: normalizedEmail,
        passwordHash: await hashPassword(password),
        role: "OWNER"
      }
    });

    return { tenant, user };
  });

  await ensureTenantSubscriptionAndModules({ tenantId: result.tenant.id, planCode: result.tenant.plan || "STARTER" });
  const token = signAuthToken(result.user);
  return { token, user: sanitizeUser(result.user), tenant: result.tenant };
}

export async function loginUser({ email, password }) {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  const user = await prisma.workspaceUser.findUnique({
    where: { email: normalizedEmail },
    include: { tenant: true }
  });

  if (!user || !user.isActive) throw new Error("Credenciales inválidas");

  if (user.passwordHash) {
    const ok = await verifyPassword(password || "", user.passwordHash);
    if (!ok) throw new Error("Credenciales inválidas");
  } else if (password) {
    throw new Error("Credenciales inválidas");
  }

  const token = signAuthToken(user);
  return { token, user: sanitizeUser(user), tenant: user.tenant };
}
