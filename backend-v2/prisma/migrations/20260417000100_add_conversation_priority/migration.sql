-- Add priority and debug decision fields to Conversation
ALTER TABLE "Conversation"
ADD COLUMN IF NOT EXISTS "priorityLabel" TEXT DEFAULT 'medium',
ADD COLUMN IF NOT EXISTS "priorityScore" INTEGER DEFAULT 50,
ADD COLUMN IF NOT EXISTS "lastIntent" TEXT,
ADD COLUMN IF NOT EXISTS "lastConfidence" DOUBLE PRECISION,
ADD COLUMN IF NOT EXISTS "decisionSummary" TEXT;
