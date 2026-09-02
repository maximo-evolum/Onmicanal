ALTER TABLE "BrokerMaintenance"
  ADD COLUMN "priority" TEXT NOT NULL DEFAULT 'MEDIA',
  ADD COLUMN "workflowStage" TEXT NOT NULL DEFAULT 'REPORTE',
  ADD COLUMN "diagnosis" TEXT,
  ADD COLUMN "approvalStatus" TEXT NOT NULL DEFAULT 'PENDIENTE',
  ADD COLUMN "approvedAt" TIMESTAMP(3),
  ADD COLUMN "scheduledAt" TIMESTAMP(3),
  ADD COLUMN "completionEvidence" TEXT,
  ADD COLUMN "acceptedAt" TIMESTAMP(3),
  ADD COLUMN "checkpoints" JSONB;

CREATE TABLE "BrokerMaintenanceQuote" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "maintenanceId" TEXT NOT NULL,
  "providerId" TEXT,
  "legacyRecordId" TEXT,
  "reference" TEXT NOT NULL,
  "scope" TEXT,
  "amount" DECIMAL(18,2) NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'CLP',
  "validUntil" TIMESTAMP(3),
  "status" TEXT NOT NULL DEFAULT 'RECIBIDA',
  "selectedAt" TIMESTAMP(3),
  "evidence" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BrokerMaintenanceQuote_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "BrokerMaintenanceQuote_legacyRecordId_key" ON "BrokerMaintenanceQuote"("legacyRecordId");
CREATE INDEX "BrokerMaintenanceQuote_tenantId_status_idx" ON "BrokerMaintenanceQuote"("tenantId", "status");
CREATE INDEX "BrokerMaintenanceQuote_maintenanceId_status_idx" ON "BrokerMaintenanceQuote"("maintenanceId", "status");
CREATE INDEX "BrokerMaintenanceQuote_providerId_status_idx" ON "BrokerMaintenanceQuote"("providerId", "status");
ALTER TABLE "BrokerMaintenanceQuote" ADD CONSTRAINT "BrokerMaintenanceQuote_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BrokerMaintenanceQuote" ADD CONSTRAINT "BrokerMaintenanceQuote_maintenanceId_fkey" FOREIGN KEY ("maintenanceId") REFERENCES "BrokerMaintenance"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BrokerMaintenanceQuote" ADD CONSTRAINT "BrokerMaintenanceQuote_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "BrokerProvider"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "BrokerProject" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "propertyId" TEXT NOT NULL,
  "maintenanceId" TEXT,
  "legacyRecordId" TEXT,
  "name" TEXT NOT NULL,
  "projectType" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PLANIFICACION',
  "budget" DECIMAL(18,2),
  "approvedBudget" DECIMAL(18,2),
  "currency" TEXT NOT NULL DEFAULT 'CLP',
  "startAt" TIMESTAMP(3),
  "targetAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "scope" TEXT,
  "acceptanceNotes" TEXT,
  "checkpoints" JSONB,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BrokerProject_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "BrokerProject_legacyRecordId_key" ON "BrokerProject"("legacyRecordId");
CREATE INDEX "BrokerProject_tenantId_status_idx" ON "BrokerProject"("tenantId", "status");
CREATE INDEX "BrokerProject_propertyId_status_idx" ON "BrokerProject"("propertyId", "status");
CREATE INDEX "BrokerProject_maintenanceId_status_idx" ON "BrokerProject"("maintenanceId", "status");
ALTER TABLE "BrokerProject" ADD CONSTRAINT "BrokerProject_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BrokerProject" ADD CONSTRAINT "BrokerProject_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "BrokerProperty"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BrokerProject" ADD CONSTRAINT "BrokerProject_maintenanceId_fkey" FOREIGN KEY ("maintenanceId") REFERENCES "BrokerMaintenance"("id") ON DELETE SET NULL ON UPDATE CASCADE;
