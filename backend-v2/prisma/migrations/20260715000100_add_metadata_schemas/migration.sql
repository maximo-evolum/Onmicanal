CREATE TABLE "MetadataSchema" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "recordType" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "label" TEXT NOT NULL,
  "fields" JSONB NOT NULL,
  "policies" JSONB,
  "publishedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MetadataSchema_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "MetadataSchema_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "MetadataSchema_tenantId_recordType_version_key" ON "MetadataSchema"("tenantId", "recordType", "version");
CREATE INDEX "MetadataSchema_tenantId_recordType_status_idx" ON "MetadataSchema"("tenantId", "recordType", "status");
