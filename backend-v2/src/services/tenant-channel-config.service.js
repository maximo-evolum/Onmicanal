import { prisma } from "../lib/db.js";
import { env } from "../lib/env.js";

function logTenantConfig(message, data) {
  if (env.nodeEnv === "production" && !env.enableTraceLogs) return;
  console.log(message, data);
}

export function normalizeChannel(channel = "") {
  return String(channel || "").trim().toLowerCase();
}

export async function getTenantChannelConfig({ tenantId, channel }) {
  if (!tenantId || !channel) return null;
  return prisma.tenantChannelConfig.findFirst({
    where: { tenantId, channel: normalizeChannel(channel), isActive: true },
    orderBy: { updatedAt: "desc" }
  }).catch(() => null);
}

export async function resolveOutboundChannelConfig({ tenant, tenantId, channel }) {
  const resolvedTenantId = tenant?.id || tenantId;
  const normalized = normalizeChannel(channel);
  const config = await getTenantChannelConfig({ tenantId: resolvedTenantId, channel: normalized });

  if (normalized === "whatsapp") {
    return {
      config,
      phoneNumberId: config?.phoneNumberId || tenant?.whatsappPhoneNumberId || env.whatsappPhoneNumberId,
      accessToken: config?.accessToken || env.whatsappToken || env.metaAccessToken
    };
  }

  if (normalized === "instagram") {
    return {
      config,
      instagramBusinessAccountId: config?.externalAccountId || config?.businessAccountId || tenant?.instagramBusinessAccountId || env.instagramBusinessAccountId,
      accessToken: config?.accessToken || env.metaAccessToken
    };
  }

  return { config };
}

export async function findTenantByInboundMetaIds({ whatsappPhoneNumberId, instagramBusinessAccountId }) {
  logTenantConfig("[TENANT_CONFIG_LOOKUP] inbound ids", {
    whatsappPhoneNumberId: whatsappPhoneNumberId ? String(whatsappPhoneNumberId) : null,
    instagramBusinessAccountId: instagramBusinessAccountId ? String(instagramBusinessAccountId) : null
  });

  if (whatsappPhoneNumberId) {
    const config = await prisma.tenantChannelConfig.findFirst({
      where: { channel: "whatsapp", phoneNumberId: String(whatsappPhoneNumberId), isActive: true },
      include: { tenant: true }
    });
    if (config?.tenant) {
      logTenantConfig("[TENANT_CONFIG_LOOKUP] whatsapp config match", {
        tenantId: config.tenantId,
        tenantSlug: config.tenant?.slug,
        phoneNumberId: config.phoneNumberId
      });
      return { tenant: config.tenant, source: "tenant_channel_config_whatsapp", config };
    }

    const candidates = await prisma.tenantChannelConfig.findMany({
      where: { channel: "whatsapp", isActive: true },
      select: { tenantId: true, phoneNumberId: true, label: true },
      take: 10
    }).catch(() => []);
    logTenantConfig("[TENANT_CONFIG_LOOKUP] no whatsapp config match. Active candidates:", candidates);
  }

  if (instagramBusinessAccountId) {
    const config = await prisma.tenantChannelConfig.findFirst({
      where: { channel: "instagram", externalAccountId: String(instagramBusinessAccountId), isActive: true },
      include: { tenant: true }
    });
    if (config?.tenant) {
      logTenantConfig("[TENANT_CONFIG_LOOKUP] instagram config match", {
        tenantId: config.tenantId,
        tenantSlug: config.tenant?.slug,
        externalAccountId: config.externalAccountId
      });
      return { tenant: config.tenant, source: "tenant_channel_config_instagram", config };
    }

    const candidates = await prisma.tenantChannelConfig.findMany({
      where: { channel: "instagram", isActive: true },
      select: { tenantId: true, externalAccountId: true, businessAccountId: true, label: true },
      take: 10
    }).catch(() => []);
    logTenantConfig("[TENANT_CONFIG_LOOKUP] no instagram config match. Active candidates:", candidates);
  }

  return { tenant: null, source: "not_found", config: null };
}


export async function isKnownVerifyToken(token) {
  if (!token) return false;
  const count = await prisma.tenantChannelConfig.count({
    where: { verifyToken: String(token), isActive: true }
  }).catch(() => 0);
  return count > 0;
}
