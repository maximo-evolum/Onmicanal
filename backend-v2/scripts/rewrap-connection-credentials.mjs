/** Archivo: Recifra de forma controlada las credenciales de conexiones durante una rotación de clave. */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { credentialEncryptionStatus, decryptSecretDetails, encryptSecret } from "../src/lib/credential-crypto.js";

const prisma = new PrismaClient();
const apply = process.argv.includes("--apply");
const requestedTenant = process.argv.find((argument) => argument.startsWith("--tenant="))?.slice("--tenant=".length) || null;
const confirmation = process.env.CONNECTIONS_ENCRYPTION_ROTATION_CONFIRM === "REWRAP_CONNECTION_SECRETS";

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

async function main() {
  const keyStatus = credentialEncryptionStatus();
  if (!keyStatus.configured || !keyStatus.previousConfigured) {
    if (apply) throw new Error("Configura CONNECTIONS_ENCRYPTION_KEY y CONNECTIONS_ENCRYPTION_PREVIOUS_KEY antes de recifrar credenciales.");
    console.log(JSON.stringify({
      dryRun: true,
      ready: false,
      applied: false,
      nextStep: "Configura la nueva clave en CONNECTIONS_ENCRYPTION_KEY y conserva la anterior temporalmente en CONNECTIONS_ENCRYPTION_PREVIOUS_KEY. No se leyó ni modificó ninguna credencial.",
    }, null, 2));
    return;
  }
  if (apply && !confirmation) {
    throw new Error("Para aplicar la recodificación define CONNECTIONS_ENCRYPTION_ROTATION_CONFIRM=REWRAP_CONNECTION_SECRETS.");
  }

  const configs = await prisma.tenantChannelConfig.findMany({
    where: {
      ...(requestedTenant ? { tenantId: requestedTenant } : {}),
      OR: [{ accessToken: { not: null } }, { verifyToken: { not: null } }],
    },
    select: { id: true, tenantId: true, channel: true, accessToken: true, verifyToken: true, metadata: true, updatedAt: true },
    orderBy: { id: "asc" },
  });

  const prepared = [];
  const errors = [];
  for (const config of configs) {
    const fields = {};
    for (const field of ["accessToken", "verifyToken"]) {
      const raw = config[field];
      if (!raw) continue;
      try {
        const details = decryptSecretDetails(raw);
        if (details.value && details.source !== "current") fields[field] = encryptSecret(details.value);
      } catch {
        // Deliberadamente no informa el texto cifrado ni detalles de la clave.
        errors.push({ configId: config.id, channel: config.channel, field });
      }
    }
    if (Object.keys(fields).length) prepared.push({ config, fields });
  }

  if (errors.length) {
    throw new Error(`Se detectaron ${errors.length} credencial(es) que no se pudieron abrir. No se aplicó ningún cambio.`);
  }

  if (apply && prepared.length) {
    const rotationAt = new Date().toISOString();
    await prisma.$transaction(async (tx) => {
      for (const item of prepared) {
        const saved = await tx.tenantChannelConfig.updateMany({
          where: { id: item.config.id, tenantId: item.config.tenantId, updatedAt: item.config.updatedAt },
          data: {
            ...item.fields,
            metadata: { ...object(item.config.metadata), credentialsRewrappedAt: rotationAt, credentialRotationSource: "CONNECTIONS_ENCRYPTION_PREVIOUS_KEY" },
          },
        });
        if (saved.count !== 1) throw new Error("Una conexión cambió durante la recodificación. No se aplicaron cambios parciales.");
        await tx.tenantAuditLog.create({
          data: { tenantId: item.config.tenantId, action: "CONNECTION_CREDENTIALS_REWRAPPED", entity: "tenant_channel_config", entityId: item.config.id, metadata: { channel: item.config.channel, fields: Object.keys(item.fields), rotatedAt: rotationAt } },
        });
      }
    }, { timeout: 60_000 });
  }

  console.log(JSON.stringify({
    dryRun: !apply,
    tenantScoped: Boolean(requestedTenant),
    scannedConnections: configs.length,
    connectionsToRewrap: prepared.length,
    fieldsToRewrap: prepared.reduce((total, item) => total + Object.keys(item.fields).length, 0),
    unreadableCredentials: errors.length,
    applied: apply,
    nextStep: apply ? "Verifica las conexiones y elimina CONNECTIONS_ENCRYPTION_PREVIOUS_KEY solo cuando el recuento de una nueva ejecución sea cero." : "Ejecuta con --apply y la confirmación explícita solo después de desplegar la nueva clave junto con la clave anterior.",
  }, null, 2));
}

try {
  await main();
} finally {
  await prisma.$disconnect();
}
