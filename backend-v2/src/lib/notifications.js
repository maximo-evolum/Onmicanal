import { prisma } from "./db.js";
import { normalizeMetadata } from "./metadata.js";
import { sendTenantPushNotification } from "./push-notifications.js";

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

  const notification = await prisma.industryRecord.create({
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

  // La creación del aviso interno no depende del proveedor push. Si Expo/FCM
  // no responde, el aviso sigue disponible dentro de EVOLUM.
  void sendTenantPushNotification({
    tenantId,
    assignedToId,
    title: notification.title,
    body,
    type: String(metadata?.notificationType || "general"),
    data: {
      notificationId: notification.id,
      targetUrl,
      screen: metadata?.screen || null
    }
  });

  return notification;
}
