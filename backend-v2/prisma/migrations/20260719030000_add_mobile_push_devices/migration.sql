CREATE TABLE "MobilePushDevice" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expoPushToken" TEXT NOT NULL,
    "platform" TEXT,
    "deviceName" TEXT,
    "preferences" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MobilePushDevice_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MobilePushDevice_expoPushToken_key" ON "MobilePushDevice"("expoPushToken");
CREATE INDEX "MobilePushDevice_tenantId_userId_isActive_idx" ON "MobilePushDevice"("tenantId", "userId", "isActive");
CREATE INDEX "MobilePushDevice_tenantId_isActive_idx" ON "MobilePushDevice"("tenantId", "isActive");

ALTER TABLE "MobilePushDevice" ADD CONSTRAINT "MobilePushDevice_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MobilePushDevice" ADD CONSTRAINT "MobilePushDevice_userId_fkey" FOREIGN KEY ("userId") REFERENCES "WorkspaceUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;
