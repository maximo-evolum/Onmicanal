import { prisma } from "../lib/db.js";
import { sendWhatsAppText } from "./whatsapp.service.js";
import { sendInstagramText } from "./instagram.service.js";

async function resolveTenant({ tenant, tenantId }) {
  if (tenant) return tenant;
  if (!tenantId) return null;
  return prisma.tenant.findUnique({ where: { id: tenantId } });
}

export async function sendChannelMessage({ channel, to, message, tenant = null, tenantId = null }) {
  const resolvedTenant = await resolveTenant({ tenant, tenantId });

  if (channel === "whatsapp") {
    return sendWhatsAppText({
      to,
      message,
      tenant: resolvedTenant,
      tenantId: resolvedTenant?.id || tenantId,
      phoneNumberId: resolvedTenant?.whatsappPhoneNumberId || undefined
    });
  }

  if (channel === "instagram") {
    return sendInstagramText({
      to,
      message,
      tenant: resolvedTenant,
      tenantId: resolvedTenant?.id || tenantId,
      instagramBusinessAccountId: resolvedTenant?.instagramBusinessAccountId || undefined
    });
  }

  throw new Error(`Canal no soportado: ${channel}`);
}
