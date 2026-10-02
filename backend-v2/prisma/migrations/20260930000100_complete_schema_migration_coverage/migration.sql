-- Additive repair: these models existed in schema.prisma without a migration.
-- Existing databases previously synchronized with db push keep their data.
BEGIN;

ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "customFields" JSONB;

CREATE TABLE IF NOT EXISTS "TenantOnboardingImport" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL DEFAULT 'mixed',
    "fileNames" JSONB,
    "rawText" TEXT,
    "extractedData" JSONB,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "appliedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TenantOnboardingImport_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "TenantOnboardingImport_tenantId_status_idx" ON "TenantOnboardingImport"("tenantId", "status");
CREATE INDEX IF NOT EXISTS "TenantOnboardingImport_tenantId_createdAt_idx" ON "TenantOnboardingImport"("tenantId", "createdAt");
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = '"TenantOnboardingImport"'::regclass AND conname = 'TenantOnboardingImport_tenantId_fkey') THEN
        ALTER TABLE "TenantOnboardingImport" ADD CONSTRAINT "TenantOnboardingImport_tenantId_fkey"
            FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- Keep the useful indexes/defaults already deployed in earlier migrations.
CREATE INDEX IF NOT EXISTS "Booking_tenantId_schemaVersion_idx" ON "Booking"("tenantId", "schemaVersion");
CREATE INDEX IF NOT EXISTS "IndustryRecord_tenantId_recordType_schemaVersion_idx" ON "IndustryRecord"("tenantId", "recordType", "schemaVersion");
CREATE INDEX IF NOT EXISTS "Lead_tenantId_schemaVersion_idx" ON "Lead"("tenantId", "schemaVersion");
CREATE INDEX IF NOT EXISTS "Payment_tenantId_schemaVersion_idx" ON "Payment"("tenantId", "schemaVersion");
ALTER TABLE "FinancePeriodControl" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "Payment" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;

-- PostgreSQL truncated the old >63-character identifier; use Prisma's name.
DO $$ BEGIN
    IF to_regclass('"BrokerPropertyCapture_tenantId_intendedService_publicationReadi"') IS NOT NULL
       AND to_regclass('"BrokerPropertyCapture_tenantId_intendedService_publicationR_idx"') IS NULL THEN
        ALTER INDEX "BrokerPropertyCapture_tenantId_intendedService_publicationReadi"
            RENAME TO "BrokerPropertyCapture_tenantId_intendedService_publicationR_idx";
    END IF;
END $$;

COMMIT;
