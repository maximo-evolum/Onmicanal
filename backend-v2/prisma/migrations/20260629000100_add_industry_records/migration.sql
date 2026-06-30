CREATE TABLE "IndustryRecord" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "recordType" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "assignedToId" TEXT,
  "data" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "IndustryRecord_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "IndustryRecord_tenantId_recordType_status_idx" ON "IndustryRecord"("tenantId", "recordType", "status");
CREATE INDEX "IndustryRecord_tenantId_assignedToId_idx" ON "IndustryRecord"("tenantId", "assignedToId");
CREATE INDEX "IndustryRecord_tenantId_updatedAt_idx" ON "IndustryRecord"("tenantId", "updatedAt");

ALTER TABLE "IndustryRecord"
  ADD CONSTRAINT "IndustryRecord_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "IndustryRecord"
  ADD CONSTRAINT "IndustryRecord_assignedToId_fkey"
  FOREIGN KEY ("assignedToId") REFERENCES "WorkspaceUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;
