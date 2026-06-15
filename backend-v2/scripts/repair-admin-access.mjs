import "dotenv/config";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const targetEmail = String(
  process.env.RECOVERY_ADMIN_EMAIL ||
  process.env.SUPER_ADMIN_EMAIL ||
  "maximo.jara@evolum.cl"
).trim().toLowerCase();

const newPassword = process.env.RECOVERY_ADMIN_PASSWORD || process.env.SUPER_ADMIN_PASSWORD || null;

async function main() {
  const user = await prisma.workspaceUser.findUnique({
    where: { email: targetEmail },
    include: { tenant: true }
  });

  if (!user) {
    throw new Error(`No existe usuario con email ${targetEmail}. Define RECOVERY_ADMIN_EMAIL con un correo existente.`);
  }

  const data = {
    role: "SUPER_ADMIN",
    isActive: true
  };

  if (newPassword) {
    if (newPassword.length < 12) {
      throw new Error("RECOVERY_ADMIN_PASSWORD debe tener al menos 12 caracteres.");
    }
    data.passwordHash = await bcrypt.hash(newPassword, 10);
  }

  const updated = await prisma.workspaceUser.update({
    where: { id: user.id },
    data,
    select: { id: true, tenantId: true, name: true, email: true, role: true, isActive: true }
  });

  console.log(JSON.stringify({
    ok: true,
    repairedUser: updated,
    passwordUpdated: Boolean(newPassword)
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error.message || error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
