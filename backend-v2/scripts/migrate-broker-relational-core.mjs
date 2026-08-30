import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { normalizeLegacyBrokerProperty } from "../src/services/broker-relational-data.service.js";

const prisma = new PrismaClient();
const args = new Set(process.argv.slice(2));
const apply = args.has("--apply");
const slugIndex = process.argv.indexOf("--tenant-slug");
const tenantSlug = slugIndex >= 0 ? process.argv[slugIndex + 1] : null;

if (!tenantSlug) {
  console.error("Uso: npm run migrate:broker-relational -- --tenant-slug inmobiliaria [--apply]");
  process.exitCode = 1;
} else {
  const tenant = await prisma.tenant.findUnique({ where: { slug: tenantSlug }, select: { id: true, name: true, slug: true } });
  if (!tenant) throw new Error(`No existe el tenant '${tenantSlug}'.`);

  const legacyProperties = await prisma.industryRecord.findMany({
    where: { tenantId: tenant.id, recordType: "property" },
    select: { id: true, title: true, status: true, assignedToId: true, data: true },
    orderBy: { createdAt: "asc" },
  });
  const summary = { tenant: tenant.name, mode: apply ? "apply" : "dry-run", legacyProperties: legacyProperties.length, migrated: 0, existing: 0, skipped: [] };

  for (const legacy of legacyProperties) {
    const normalized = normalizeLegacyBrokerProperty(legacy);
    if (normalized.errors.length) {
      summary.skipped.push({ id: legacy.id, title: legacy.title, errors: normalized.errors });
      continue;
    }
    if (!apply) { summary.migrated += 1; continue; }
    const existing = await prisma.brokerProperty.findUnique({ where: { legacyRecordId: legacy.id }, select: { id: true } });
    if (existing) { summary.existing += 1; continue; }

    const ownerData = normalized.owner;
    let owner = ownerData.rut
      ? await prisma.brokerOwner.findUnique({ where: { tenantId_rut: { tenantId: tenant.id, rut: ownerData.rut } } })
      : await prisma.brokerOwner.findFirst({ where: { tenantId: tenant.id, name: ownerData.name } });
    if (!owner) owner = await prisma.brokerOwner.create({ data: { tenantId: tenant.id, ...ownerData } });
    await prisma.brokerProperty.create({ data: { tenantId: tenant.id, ownerId: owner.id, legacyRecordId: legacy.id, ...normalized.property } });
    summary.migrated += 1;
  }
  if (apply) {
    summary.strictProperties = await prisma.brokerProperty.count({ where: { tenantId: tenant.id } });
    summary.owners = await prisma.brokerOwner.count({ where: { tenantId: tenant.id } });
  } else {
    summary.strictProperties = "se calcula después de ejecutar la migración Prisma";
    summary.owners = "se calcula después de ejecutar la migración Prisma";
  }
  console.log(JSON.stringify(summary, null, 2));
}

await prisma.$disconnect();
