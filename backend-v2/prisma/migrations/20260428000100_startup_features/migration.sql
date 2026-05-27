-- Startup features: tenant type/onboarding, AI expert fields, lead automation/prediction and campaigns
ALTER TABLE "WorkspaceUser" ADD COLUMN IF NOT EXISTS "passwordHash" TEXT;
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "type" TEXT NOT NULL DEFAULT 'BUSINESS';
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "industry" TEXT;
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "onboardingCompleted" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "Conversation" ADD COLUMN IF NOT EXISTS "aiSummary" TEXT;
ALTER TABLE "Conversation" ADD COLUMN IF NOT EXISTS "aiNextAction" TEXT;
ALTER TABLE "Conversation" ADD COLUMN IF NOT EXISTS "aiSuggestedReply" TEXT;
ALTER TABLE "Conversation" ADD COLUMN IF NOT EXISTS "aiLeadScore" INTEGER;
ALTER TABLE "Conversation" ADD COLUMN IF NOT EXISTS "aiReason" TEXT;

ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "tenantId" TEXT;
UPDATE "Lead" SET "tenantId" = "Conversation"."tenantId"
FROM "Conversation"
WHERE "Lead"."conversationId" = "Conversation"."id" AND "Lead"."tenantId" IS NULL;
ALTER TABLE "Lead" ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "closeProbability" INTEGER DEFAULT 0;
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "closeReason" TEXT;
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "lastContactAt" TIMESTAMP(3);
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "nextFollowUpAt" TIMESTAMP(3);
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "followUpCount" INTEGER NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Lead_tenantId_fkey') THEN
    ALTER TABLE "Lead" ADD CONSTRAINT "Lead_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS "Lead_tenantId_status_idx" ON "Lead"("tenantId", "status");
CREATE INDEX IF NOT EXISTS "Lead_tenantId_nextFollowUpAt_idx" ON "Lead"("tenantId", "nextFollowUpAt");

CREATE TABLE IF NOT EXISTS "Campaign" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "segment" TEXT NOT NULL DEFAULT 'all',
  "template" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "scheduledAt" TIMESTAMP(3),
  "sentAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "Campaign_tenantId_status_idx" ON "Campaign"("tenantId", "status");
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Campaign_tenantId_fkey') THEN
    ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
