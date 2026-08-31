import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const tenantSlug = process.env.BROKER_DEMO_TENANT_SLUG || "inmobiliaria";
const administratorEmail = process.env.BROKER_DEMO_HOLDING_ADMIN_EMAIL || "inmobiliaria@prueba.cl";

try {
  const tenant = await prisma.tenant.findUnique({ where: { slug: tenantSlug }, select: { id: true, name: true, slug: true } });
  const user = await prisma.workspaceUser.findUnique({ where: { email: administratorEmail }, select: { id: true, name: true, role: true, tenantId: true } });
  if (!tenant || !user || user.tenantId !== tenant.id) throw new Error("No se encontró el tenant o administrador de demostración solicitado.");

  const holding = await prisma.brokerHolding.upsert({
    where: { code: "broker-os-demo" },
    update: { name: "Broker OS - Ambiente de demostración", isActive: true },
    create: { code: "broker-os-demo", name: "Broker OS - Ambiente de demostración" },
  });

  await prisma.$transaction(async (tx) => {
    await tx.brokerHoldingTenant.upsert({ where: { tenantId: tenant.id }, update: { holdingId: holding.id }, create: { holdingId: holding.id, tenantId: tenant.id } });
    await tx.brokerHoldingAccess.upsert({ where: { holdingId_userId: { holdingId: holding.id, userId: user.id } }, update: { isActive: true }, create: { holdingId: holding.id, userId: user.id } });
    const profile = await tx.industryRecord.findFirst({ where: { tenantId: tenant.id, recordType: "broker_access_profile", data: { path: ["userId"], equals: user.id } } });
    const data = { ...(profile?.data || {}), userId: user.id, businessRole: "CEO", accessScope: "HOLDING", teamKey: "corretaje-demo", branchKey: "santiago", version: 1 };
    if (profile) await tx.industryRecord.update({ where: { id: profile.id }, data: { status: "ACTIVE", data } });
    else await tx.industryRecord.create({ data: { tenantId: tenant.id, recordType: "broker_access_profile", title: `Acceso Broker: ${user.name}`, status: "ACTIVE", assignedToId: user.id, data } });
    await tx.tenantAuditLog.create({ data: { tenantId: tenant.id, actorUserId: user.id, action: "BROKER_HOLDING_DEMO_CONFIGURED", entity: "broker_holding", entityId: holding.id, metadata: { holdingCode: holding.code, authorizedUserId: user.id } } });
  });

  console.log(JSON.stringify({ holding: { code: holding.code, name: holding.name }, tenant, administrator: { email: administratorEmail, role: user.role }, scope: "HOLDING", authorized: true }, null, 2));
} finally {
  await prisma.$disconnect();
}
