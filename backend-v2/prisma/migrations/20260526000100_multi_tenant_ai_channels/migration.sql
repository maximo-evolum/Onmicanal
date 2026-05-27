-- Multi-tenant AI profiles and per-tenant channel credentials.
CREATE TABLE "TenantAiProfile" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL DEFAULT 'default',
    "name" TEXT NOT NULL DEFAULT 'IA principal',
    "industry" TEXT,
    "basePersona" TEXT,
    "tone" TEXT,
    "objective" TEXT,
    "responseStyle" TEXT,
    "businessRules" JSONB,
    "knowledge" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenantAiProfile_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TenantChannelConfig" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "label" TEXT,
    "phoneNumberId" TEXT,
    "businessAccountId" TEXT,
    "externalAccountId" TEXT,
    "accessToken" TEXT,
    "verifyToken" TEXT,
    "metadata" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenantChannelConfig_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TenantAiProfile_tenantId_code_key" ON "TenantAiProfile"("tenantId", "code");
CREATE INDEX "TenantAiProfile_tenantId_isActive_idx" ON "TenantAiProfile"("tenantId", "isActive");

CREATE UNIQUE INDEX "TenantChannelConfig_phoneNumberId_key" ON "TenantChannelConfig"("phoneNumberId");
CREATE UNIQUE INDEX "TenantChannelConfig_externalAccountId_key" ON "TenantChannelConfig"("externalAccountId");
CREATE UNIQUE INDEX "TenantChannelConfig_tenantId_channel_key" ON "TenantChannelConfig"("tenantId", "channel");
CREATE INDEX "TenantChannelConfig_tenantId_channel_isActive_idx" ON "TenantChannelConfig"("tenantId", "channel", "isActive");
CREATE INDEX "TenantChannelConfig_channel_isActive_idx" ON "TenantChannelConfig"("channel", "isActive");

ALTER TABLE "TenantAiProfile" ADD CONSTRAINT "TenantAiProfile_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TenantChannelConfig" ADD CONSTRAINT "TenantChannelConfig_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
