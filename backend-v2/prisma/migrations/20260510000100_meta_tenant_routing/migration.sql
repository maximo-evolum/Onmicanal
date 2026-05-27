-- Add Meta channel identifiers per tenant for production multi-tenant webhooks.
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "whatsappPhoneNumberId" TEXT;
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "instagramBusinessAccountId" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "Tenant_whatsappPhoneNumberId_key" ON "Tenant"("whatsappPhoneNumberId");
CREATE UNIQUE INDEX IF NOT EXISTS "Tenant_instagramBusinessAccountId_key" ON "Tenant"("instagramBusinessAccountId");
