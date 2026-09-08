CREATE TABLE "FinanceBankOriginal" (
  "id" TEXT NOT NULL, "tenantId" TEXT NOT NULL, "sha256" TEXT NOT NULL,
  "content" BYTEA NOT NULL, "size" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FinanceBankOriginal_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "FinanceBankOriginal_size_check" CHECK ("size" > 0 AND "size" <= 12582912),
  CONSTRAINT "FinanceBankOriginal_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "FinanceBankOriginal_tenantId_sha256_key" ON "FinanceBankOriginal"("tenantId", "sha256");
CREATE UNIQUE INDEX "FinanceBankOriginal_id_tenantId_key" ON "FinanceBankOriginal"("id", "tenantId");

CREATE TABLE "FinanceBankImportJob" (
  "id" TEXT NOT NULL, "tenantId" TEXT NOT NULL, "originalId" TEXT NOT NULL,
  "sourceFile" TEXT NOT NULL, "createdById" TEXT, "status" TEXT NOT NULL DEFAULT 'RECEIVED',
  "revision" INTEGER NOT NULL DEFAULT 0, "runToken" TEXT, "account" JSONB, "periodRange" JSONB, "error" TEXT, "batchId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "FinanceBankImportJob_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "FinanceBankImportJob_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "FinanceBankImportJob_originalId_tenantId_fkey" FOREIGN KEY ("originalId", "tenantId") REFERENCES "FinanceBankOriginal"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "FinanceBankImportJob_tenantId_status_createdAt_idx" ON "FinanceBankImportJob"("tenantId", "status", "createdAt");
CREATE UNIQUE INDEX "FinanceBankImportJob_tenantId_batchId_key" ON "FinanceBankImportJob"("tenantId", "batchId");

CREATE TABLE "FinanceBankImportRevision" (
  "id" TEXT NOT NULL, "jobId" TEXT NOT NULL, "revision" INTEGER NOT NULL,
  "status" TEXT NOT NULL, "preview" JSONB, "error" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FinanceBankImportRevision_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "FinanceBankImportRevision_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "FinanceBankImportJob"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "FinanceBankImportRevision_jobId_revision_key" ON "FinanceBankImportRevision"("jobId", "revision");
