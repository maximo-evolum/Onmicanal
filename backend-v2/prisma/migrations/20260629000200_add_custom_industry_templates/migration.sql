CREATE TABLE "CustomIndustryTemplate" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "summary" TEXT,
  "modules" JSONB NOT NULL,
  "entities" JSONB,
  "workflows" JSONB,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "CustomIndustryTemplate_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CustomIndustryTemplate_code_key" ON "CustomIndustryTemplate"("code");
CREATE INDEX "CustomIndustryTemplate_isActive_name_idx" ON "CustomIndustryTemplate"("isActive", "name");
