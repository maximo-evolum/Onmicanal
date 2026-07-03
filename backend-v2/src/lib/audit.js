import { prisma } from "./db.js";
import { normalizeMetadata } from "./metadata.js";

export async function recordAuditLog(req, action, entity, entityId, metadata = {}) {
  const tenantId = metadata?.auditTenantId || req?.tenantId || req?.user?.tenantId || metadata?.tenantId;
  if (!tenantId || !action) return null;

  return prisma.tenantAuditLog.create({
    data: {
      tenantId,
      actorUserId: req?.user?.id || null,
      action: String(action).trim().toUpperCase(),
      entity: entity ? String(entity).trim() : null,
      entityId: entityId ? String(entityId).trim() : null,
      metadata: normalizeMetadata({
        ...metadata,
        requestId: req?.requestId || null,
        path: req?.originalUrl || req?.url || null,
        method: req?.method || null
      }, {})
    }
  }).catch((error) => {
    console.warn("[AUDIT_LOG_FAILED]", {
      action,
      entity,
      entityId,
      tenantId,
      error: error?.message
    });
    return null;
  });
}
