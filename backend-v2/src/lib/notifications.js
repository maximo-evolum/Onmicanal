import { prisma } from "./db.js";
import { normalizeMetadata } from "./metadata.js";

export async function createTenantNotification({
  tenantId,
  title,
  body = "",
  severity = "info",
  targetUrl = null,
  assignedToId = null,
  metadata = {}
} = {}) {
  if (!tenantId || !title) return null;

  return prisma.industryRecord.create({
    data: {
      tenantId,
      recordType: "notification",
      title: String(title).trim(),
      status: "UNREAD",
      assignedToId,
      data: normalizeMetadata({
        body: String(body || "").trim(),
        severity: String(severity || "info").trim().toLowerCase(),
        targetUrl,
        ...metadata
      }, {})
    }
  });
}
