import { prisma } from "./db.js";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const MAX_BATCH_SIZE = 100;

function validExpoToken(value) {
  return /^(Expo|Exponent)PushToken\[[^\]]+\]$/.test(String(value || "").trim());
}

function wantsNotification(preferences, type) {
  const settings = preferences && typeof preferences === "object" ? preferences : {};
  return settings.enabled !== false && settings[type] !== false;
}

export async function sendTenantPushNotification({ tenantId, assignedToId = null, title, body = "", type = "general", data = {} } = {}) {
  if (!tenantId || !title) return { attempted: 0, delivered: 0 };

  const devices = await prisma.mobilePushDevice.findMany({
    where: { tenantId, isActive: true, ...(assignedToId ? { userId: assignedToId } : {}) },
    select: { id: true, expoPushToken: true, preferences: true }
  });
  const messages = devices
    .filter((device) => validExpoToken(device.expoPushToken) && wantsNotification(device.preferences, type))
    .map((device) => ({
      to: device.expoPushToken,
      title: String(title).slice(0, 120),
      body: String(body || "").slice(0, 500),
      sound: "default",
      priority: "high",
      channelId: "evolum-alerts",
      data: { type, ...data }
    }));

  let delivered = 0;
  for (let index = 0; index < messages.length; index += MAX_BATCH_SIZE) {
    try {
      const response = await fetch(EXPO_PUSH_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(messages.slice(index, index + MAX_BATCH_SIZE))
      });
      if (response.ok) delivered += messages.slice(index, index + MAX_BATCH_SIZE).length;
    } catch (error) {
      console.warn("[PUSH_DELIVERY_WARNING]", { tenantId, type, error: error?.message || String(error) });
    }
  }
  return { attempted: messages.length, delivered };
}
