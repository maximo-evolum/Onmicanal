/** Archivo: Provisiona cuentas temporales y perfiles de acceso para pruebas controladas de Broker OS. */
import "dotenv/config";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const apply = process.argv.includes("--apply");
const resetPasswords = process.argv.includes("--reset-passwords");
const tenantSlug = process.env.BROKER_QA_TENANT_SLUG || "inmobiliaria";

const accounts = [
  { key: "admin", name: "QA Broker Administración", email: "qa.broker.admin@evolum.test", role: "ADMIN", jobTitle: "Administrador de pruebas", businessRole: "CEO", accessScope: "COMPANY" },
  { key: "coordinacion", name: "QA Broker Coordinación", email: "qa.broker.coordinacion@evolum.test", role: "AGENT", jobTitle: "Coordinador comercial de pruebas", businessRole: "COORDINADOR_COMERCIAL", accessScope: "TEAM", teamKey: "qa-broker", branchKey: "santiago" },
  { key: "corredor", name: "QA Broker Corredor", email: "qa.broker.corredor@evolum.test", role: "SELLER", jobTitle: "Corredor de pruebas", businessRole: "CORREDOR", accessScope: "ASSIGNED", teamKey: "qa-broker", branchKey: "santiago" },
  { key: "finanzas", name: "QA Broker Finanzas", email: "qa.broker.finanzas@evolum.test", role: "AGENT", jobTitle: "Analista financiero de pruebas", businessRole: "FINANZAS", accessScope: "COMPANY" },
  { key: "lectura", name: "QA Broker Solo lectura", email: "qa.broker.lectura@evolum.test", role: "VIEWER", jobTitle: "Revisor de pruebas", businessRole: "LECTURA", accessScope: "COMPANY" },
];

function temporaryPassword() {
  return `BkrQA-${crypto.randomBytes(9).toString("base64url")}!a9`;
}

function profileData(account, userId) {
  return {
    userId,
    businessRole: account.businessRole,
    accessScope: account.accessScope,
    teamKey: account.teamKey || null,
    branchKey: account.branchKey || null,
    version: 1,
    source: "BROKER_QA_PROVISIONING",
  };
}

async function main() {
  const tenant = await prisma.tenant.findUnique({ where: { slug: tenantSlug }, select: { id: true, name: true, slug: true } });
  if (!tenant) throw new Error(`No existe el tenant Broker OS con slug '${tenantSlug}'.`);

  const existing = await prisma.workspaceUser.findMany({ where: { email: { in: accounts.map((account) => account.email) } }, select: { id: true, email: true, passwordHash: true } });
  const existingByEmail = new Map(existing.map((user) => [user.email, user]));

  if (!apply) {
    console.log(JSON.stringify({
      dryRun: true,
      tenant,
      accounts: accounts.map((account) => ({ email: account.email, technicalRole: account.role, businessRole: account.businessRole, scope: account.accessScope, exists: existingByEmail.has(account.email) })),
      instruction: "Ejecuta con --apply para crear las cuentas. Usa --apply --reset-passwords para rotar sus contraseñas.",
    }, null, 2));
    return;
  }

  const output = [];
  await prisma.$transaction(async (tx) => {
    for (const account of accounts) {
      const previous = existingByEmail.get(account.email);
      const mustSetPassword = !previous || resetPasswords || !previous.passwordHash;
      const password = mustSetPassword ? temporaryPassword() : null;
      const passwordHash = password ? await bcrypt.hash(password, 12) : undefined;
      const user = previous
        ? await tx.workspaceUser.update({
          where: { id: previous.id },
          data: { tenantId: tenant.id, name: account.name, role: account.role, jobTitle: account.jobTitle, isActive: true, ...(passwordHash ? { passwordHash } : {}) },
        })
        : await tx.workspaceUser.create({
          data: { tenantId: tenant.id, name: account.name, email: account.email, role: account.role, jobTitle: account.jobTitle, passwordHash, isActive: true },
        });

      const latestProfile = await tx.industryRecord.findFirst({
        where: { tenantId: tenant.id, recordType: "broker_access_profile", data: { path: ["userId"], equals: user.id } },
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      });
      const data = profileData(account, user.id);
      if (latestProfile) {
        await tx.industryRecord.update({ where: { id: latestProfile.id }, data: { title: `Acceso Broker QA: ${account.name}`, status: "ACTIVE", assignedToId: user.id, data } });
      } else {
        await tx.industryRecord.create({ data: { tenantId: tenant.id, recordType: "broker_access_profile", title: `Acceso Broker QA: ${account.name}`, status: "ACTIVE", assignedToId: user.id, data } });
      }

      await tx.tenantAuditLog.create({
        data: { tenantId: tenant.id, actorUserId: user.id, action: "BROKER_QA_ACCOUNT_PROVISIONED", entity: "workspace_user", entityId: user.id, metadata: { email: account.email, technicalRole: account.role, businessRole: account.businessRole, accessScope: account.accessScope, passwordRotated: Boolean(password) } },
      });
      output.push({ name: account.name, email: account.email, temporaryPassword: password, technicalRole: account.role, businessRole: account.businessRole, accessScope: account.accessScope, status: previous ? (password ? "actualizada_y_clave_rotada" : "actualizada") : "creada" });
    }
  }, { timeout: 30000 });

  console.log(JSON.stringify({ tenant, resetPasswords, accounts: output, securityNotice: "Las contraseñas temporales se muestran solamente en esta ejecución. Rótalas o desactiva las cuentas al finalizar las pruebas." }, null, 2));
}

try {
  await main();
} finally {
  await prisma.$disconnect();
}
