import { prisma } from "../lib/db.js";
import { env } from "../lib/env.js";
import { getDefaultTenant } from "./conversation.service.js";
import { findTenantByInboundMetaIds } from "./tenant-channel-config.service.js";

export function extractMetaRoutingIds(body = {}) {
  const entry = body?.entry?.[0] || null;
  const change = entry?.changes?.[0] || null;
  const value = change?.value || null;
  const messaging = entry?.messaging?.[0] || null;

  const whatsappPhoneNumberId =
    value?.metadata?.phone_number_id ||
    value?.metadata?.phoneNumberId ||
    null;

  const instagramBusinessAccountId =
    entry?.id ||
    messaging?.recipient?.id ||
    value?.metadata?.instagram_business_account_id ||
    value?.metadata?.instagramBusinessAccountId ||
    null;

  return {
    whatsappPhoneNumberId: whatsappPhoneNumberId ? String(whatsappPhoneNumberId) : null,
    instagramBusinessAccountId: instagramBusinessAccountId ? String(instagramBusinessAccountId) : null
  };
}

export async function resolveTenantFromMetaWebhook(body = {}) {
  const ids = extractMetaRoutingIds(body);

  const byConfig = await findTenantByInboundMetaIds(ids);
  if (byConfig.tenant) return { tenant: byConfig.tenant, source: byConfig.source, ids };

  // Compatibilidad con la configuración anterior guardada directo en Tenant.
  if (ids.whatsappPhoneNumberId) {
    const tenant = await prisma.tenant.findFirst({
      where: { whatsappPhoneNumberId: ids.whatsappPhoneNumberId }
    });
    if (tenant) return { tenant, source: "tenant_legacy_whatsapp_phone_number_id", ids };
  }

  if (ids.instagramBusinessAccountId) {
    const tenant = await prisma.tenant.findFirst({
      where: { instagramBusinessAccountId: ids.instagramBusinessAccountId }
    });
    if (tenant) return { tenant, source: "tenant_legacy_instagram_business_account_id", ids };
  }

  // Fallback controlado solo para desarrollo/local. En producción debe existir mapeo.
  if (process.env.NODE_ENV !== "production" && env.defaultTenantSlug) {
    const tenant = await getDefaultTenant();
    return { tenant, source: "default_tenant_dev_fallback", ids };
  }

  return { tenant: null, source: "not_found", ids };
}
