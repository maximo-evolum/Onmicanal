import { prisma } from "../lib/db.js";
import { normalizeMetadata } from "../lib/metadata.js";

export async function listMetadataSchemas(tenantId, recordType = "") {
  return prisma.metadataSchema.findMany({
    where: { tenantId, ...(recordType ? { recordType } : {}) },
    orderBy: [{ recordType: "asc" }, { version: "desc" }]
  });
}

export async function getPublishedMetadataSchema(tenantId, recordType) {
  return prisma.metadataSchema.findFirst({
    where: { tenantId, recordType, status: "PUBLISHED" },
    orderBy: { version: "desc" }
  });
}

export async function createMetadataSchemaDraft({ tenantId, recordType, label, fields, policies }) {
  const latest = await prisma.metadataSchema.findFirst({
    where: { tenantId, recordType },
    orderBy: { version: "desc" }
  });
  return prisma.metadataSchema.create({
    data: {
      tenantId,
      recordType,
      version: (latest?.version || 0) + 1,
      label,
      fields: normalizeMetadata(fields, {}),
      policies: normalizeMetadata(policies, {})
    }
  });
}

export async function publishMetadataSchema({ tenantId, id }) {
  return prisma.$transaction(async (tx) => {
    const draft = await tx.metadataSchema.findFirst({ where: { id, tenantId, status: "DRAFT" } });
    if (!draft) return null;
    await tx.metadataSchema.updateMany({
      where: { tenantId, recordType: draft.recordType, status: "PUBLISHED" },
      data: { status: "ARCHIVED" }
    });
    return tx.metadataSchema.update({
      where: { id: draft.id },
      data: { status: "PUBLISHED", publishedAt: new Date() }
    });
  });
}
