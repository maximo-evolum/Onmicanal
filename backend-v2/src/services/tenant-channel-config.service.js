import { prisma } from "../lib/db.js";
import { env } from "../lib/env.js";

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
  if (whatsappPhoneNumberId) {
    const config = await prisma.tenantChannelConfig.findFirst({
      where: { channel: "whatsapp", phoneNumberId: String(whatsappPhoneNumberId), isActive: true },
      include: { tenant: true }
    });
    if (config?.tenant) return { tenant: config.tenant, source: "tenant_channel_config_whatsapp", config };
  }

  if (instagramBusinessAccountId) {
    const config = await prisma.tenantChannelConfig.findFirst({
      where: { channel: "instagram", externalAccountId: String(instagramBusinessAccountId), isActive: true },
      include: { tenant: true }
    });
    if (config?.tenant) return { tenant: config.tenant, source: "tenant_channel_config_instagram", config };
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
