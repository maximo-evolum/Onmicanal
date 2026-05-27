
-- AI memory, decision panel and sales outcomes
ALTER TABLE "Conversation" ADD COLUMN IF NOT EXISTS "aiDecisionLabel" TEXT;
ALTER TABLE "Conversation" ADD COLUMN IF NOT EXISTS "aiDecisionReason" TEXT;
ALTER TABLE "Conversation" ADD COLUMN IF NOT EXISTS "aiNextActionCode" TEXT;
ALTER TABLE "Conversation" ADD COLUMN IF NOT EXISTS "aiCloseScore" INTEGER;
ALTER TABLE "Conversation" ADD COLUMN IF NOT EXISTS "aiHandoffRequired" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Conversation" ADD COLUMN IF NOT EXISTS "aiHandoffReason" TEXT;
ALTER TABLE "Conversation" ADD COLUMN IF NOT EXISTS "lastClosingAttempt" TIMESTAMP(3);

CREATE TABLE IF NOT EXISTS "ConversationMemory" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "guests" INTEGER,
  "location" TEXT,
  "date" TEXT,
  "intent" TEXT,
  "scenario" TEXT,
  "interestLevel" INTEGER DEFAULT 50,
  "urgencyLevel" INTEGER DEFAULT 20,
  "sentiment" TEXT DEFAULT 'neutral',
  "objections" JSONB,
  "customerProfile" JSONB,
  "summary" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ConversationMemory_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ConversationMemory_conversationId_key" ON "ConversationMemory"("conversationId");
CREATE INDEX IF NOT EXISTS "ConversationMemory_tenantId_updatedAt_idx" ON "ConversationMemory"("tenantId", "updatedAt");
CREATE INDEX IF NOT EXISTS "ConversationMemory_tenantId_interestLevel_urgencyLevel_idx" ON "ConversationMemory"("tenantId", "interestLevel", "urgencyLevel");

DO $$ BEGIN
  ALTER TABLE "ConversationMemory" ADD CONSTRAINT "ConversationMemory_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "ConversationMemory" ADD CONSTRAINT "ConversationMemory_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "SalesOutcome" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "leadId" TEXT,
  "outcome" TEXT NOT NULL,
  "reason" TEXT,
  "closeScore" INTEGER,
  "industry" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SalesOutcome_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "SalesOutcome_tenantId_outcome_idx" ON "SalesOutcome"("tenantId", "outcome");
CREATE INDEX IF NOT EXISTS "SalesOutcome_tenantId_createdAt_idx" ON "SalesOutcome"("tenantId", "createdAt");

DO $$ BEGIN
  ALTER TABLE "SalesOutcome" ADD CONSTRAINT "SalesOutcome_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
