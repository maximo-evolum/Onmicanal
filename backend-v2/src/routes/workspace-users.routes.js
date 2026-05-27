import { Router } from "express";
import { prisma } from "../lib/db.js";
import { env } from "../lib/env.js";
import { ensureTenantSubscriptionAndModules } from "../services/tenant-modules.service.js";

export const workspaceUsersRouter = Router();

async function ensureDemoTenantAndUsers() {
  const tenant = await prisma.tenant.upsert({
    where: { slug: env.defaultTenantSlug },
    update: {},
    create: {
      name: "Demo Inmobiliaria",
      slug: env.defaultTenantSlug,
      type: "BUSINESS",
      industry: "inmobiliaria",
      plan: "FREE",
      businessPrompt: "Atiendes clientes interesados en productos, servicios o propiedades. Tu foco es orientar, calificar y avanzar hacia una venta o reunión.",
      onboardingCompleted: true
    }
  });

  const count = await prisma.workspaceUser.count({ where: { tenantId: tenant.id, isActive: true } });
  if (count === 0) {
    await prisma.workspaceUser.createMany({
      data: [
        { tenantId: tenant.id, name: "Agente Demo", email: "agente@demo.cl", role: "AGENT" },
        { tenantId: tenant.id, name: "Supervisión", email: "supervision@demo.cl", role: "ADMIN" }
      ],
      skipDuplicates: true
    });
  }

  await ensureTenantSubscriptionAndModules({ tenantId: tenant.id, planCode: tenant.plan || "BUSINESS" });
  return tenant;
}

workspaceUsersRouter.get("/workspace-users", async (_req, res) => {
  try {
    const tenant = await ensureDemoTenantAndUsers();

    const users = await prisma.workspaceUser.findMany({
      where: {
        isActive: true,
        OR: [
          { tenantId: tenant.id },
          { role: "SUPER_ADMIN" }
        ]
      },
      select: { id: true, tenantId: true, name: true, email: true, role: true },
      orderBy: [{ role: "desc" }, { name: "asc" }]
    });

    res.json(users);
  } catch (error) {
    console.error("List workspace users error:", error);
    res.status(500).json({ error: "No se pudieron obtener los agentes" });
  }
});
