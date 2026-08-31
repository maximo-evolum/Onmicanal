-- Expediente tipado para el ciclo completo de venta de Broker OS.
CREATE TABLE "BrokerSaleCase" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "operationId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "buyerId" TEXT,
    "buyerName" TEXT,
    "reviewedById" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVA',
    "currentStage" TEXT NOT NULL DEFAULT 'EVALUACION_COMERCIAL',
    "buyerQualificationStatus" TEXT NOT NULL DEFAULT 'PENDIENTE',
    "preapprovalBank" TEXT,
    "preapprovalAmount" DECIMAL(18,2),
    "preapprovalExpiresAt" TIMESTAMP(3),
    "offerAmount" DECIMAL(18,2),
    "currency" TEXT NOT NULL DEFAULT 'CLP',
    "offerStatus" TEXT NOT NULL DEFAULT 'PENDIENTE',
    "offerReceivedAt" TIMESTAMP(3),
    "offerRespondedAt" TIMESTAMP(3),
    "offerConditions" TEXT,
    "promiseStatus" TEXT NOT NULL DEFAULT 'PENDIENTE',
    "promiseSignedAt" TIMESTAMP(3),
    "promiseAmount" DECIMAL(18,2),
    "promisePenaltyPct" DECIMAL(6,3),
    "titleStudyStatus" TEXT NOT NULL DEFAULT 'PENDIENTE',
    "titleStudyNotes" TEXT,
    "titleStudyReviewedAt" TIMESTAMP(3),
    "bankAppraisalStatus" TEXT NOT NULL DEFAULT 'PENDIENTE',
    "financingStatus" TEXT NOT NULL DEFAULT 'PENDIENTE',
    "deedStatus" TEXT NOT NULL DEFAULT 'PENDIENTE',
    "deedScheduledAt" TIMESTAMP(3),
    "deedSignedAt" TIMESTAMP(3),
    "cbrStatus" TEXT NOT NULL DEFAULT 'PENDIENTE',
    "cbrEntryNumber" TEXT,
    "cbrRegisteredAt" TIMESTAMP(3),
    "handoverStatus" TEXT NOT NULL DEFAULT 'PENDIENTE',
    "handoverAt" TIMESTAMP(3),
    "handoverRecipient" TEXT,
    "checkpoints" JSONB,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BrokerSaleCase_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BrokerSaleCase_operationId_key" ON "BrokerSaleCase"("operationId");
CREATE INDEX "BrokerSaleCase_tenantId_status_currentStage_idx" ON "BrokerSaleCase"("tenantId", "status", "currentStage");
CREATE INDEX "BrokerSaleCase_propertyId_status_idx" ON "BrokerSaleCase"("propertyId", "status");
CREATE INDEX "BrokerSaleCase_buyerId_status_idx" ON "BrokerSaleCase"("buyerId", "status");
CREATE INDEX "BrokerSaleCase_reviewedById_status_idx" ON "BrokerSaleCase"("reviewedById", "status");

ALTER TABLE "BrokerSaleCase" ADD CONSTRAINT "BrokerSaleCase_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BrokerSaleCase" ADD CONSTRAINT "BrokerSaleCase_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "BrokerProperty"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BrokerSaleCase" ADD CONSTRAINT "BrokerSaleCase_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "BrokerBuyer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "BrokerSaleCase" ADD CONSTRAINT "BrokerSaleCase_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "WorkspaceUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;
