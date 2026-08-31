-- Ficha estructurada para el proceso de captación de Broker OS.
CREATE TABLE "BrokerPropertyCapture" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "captureOrigin" TEXT,
    "intendedService" TEXT NOT NULL DEFAULT 'VENTA',
    "status" TEXT NOT NULL DEFAULT 'PROSPECTO',
    "captureBrokerId" TEXT,
    "firstContactAt" TIMESTAMP(3),
    "siteVisitAt" TIMESTAMP(3),
    "ownerExpectedPrice" DECIMAL(18,2),
    "suggestedPrice" DECIMAL(18,2),
    "preliminaryAppraisal" DECIMAL(18,2),
    "currency" TEXT NOT NULL DEFAULT 'CLP',
    "marketAnalysisAt" TIMESTAMP(3),
    "comparableSummary" TEXT,
    "priceGapPct" DECIMAL(7,3),
    "ownerAcceptedEvaluationAt" TIMESTAMP(3),
    "preliminaryTitleStatus" TEXT NOT NULL DEFAULT 'PENDIENTE',
    "titleReviewNotes" TEXT,
    "regularizationStatus" TEXT NOT NULL DEFAULT 'POR_REVISAR',
    "irregularConstructionNote" TEXT,
    "ownershipStatus" TEXT NOT NULL DEFAULT 'POR_CONFIRMAR',
    "propertyConditionAtHandover" TEXT,
    "kitchenType" TEXT,
    "heatingSystem" TEXT,
    "gasSystem" TEXT,
    "buildingFloors" INTEGER,
    "unitsPerFloor" INTEGER,
    "elevators" INTEGER,
    "commonExpenses" DECIMAL(18,2),
    "commonAreas" JSONB,
    "photoUrls" JSONB,
    "videoUrls" JSONB,
    "floorPlanUrl" TEXT,
    "documentChecklist" JSONB,
    "publicationReadiness" TEXT NOT NULL DEFAULT 'PENDIENTE',
    "rejectionReason" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BrokerPropertyCapture_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BrokerPropertyCapture_propertyId_key" ON "BrokerPropertyCapture"("propertyId");
CREATE INDEX "BrokerPropertyCapture_tenantId_status_idx" ON "BrokerPropertyCapture"("tenantId", "status");
CREATE INDEX "BrokerPropertyCapture_tenantId_intendedService_publicationReadiness_idx" ON "BrokerPropertyCapture"("tenantId", "intendedService", "publicationReadiness");
CREATE INDEX "BrokerPropertyCapture_captureBrokerId_status_idx" ON "BrokerPropertyCapture"("captureBrokerId", "status");

ALTER TABLE "BrokerPropertyCapture" ADD CONSTRAINT "BrokerPropertyCapture_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BrokerPropertyCapture" ADD CONSTRAINT "BrokerPropertyCapture_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "BrokerProperty"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BrokerPropertyCapture" ADD CONSTRAINT "BrokerPropertyCapture_captureBrokerId_fkey" FOREIGN KEY ("captureBrokerId") REFERENCES "WorkspaceUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;
