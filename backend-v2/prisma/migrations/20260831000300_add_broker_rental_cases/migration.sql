CREATE TABLE "BrokerRentalCase" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "operationId" TEXT NOT NULL,
  "propertyId" TEXT NOT NULL,
  "leaseTenantId" TEXT,
  "tenantName" TEXT,
  "reviewedById" TEXT,
  "status" TEXT NOT NULL DEFAULT 'ACTIVA',
  "currentStage" TEXT NOT NULL DEFAULT 'CAPTACION',
  "applicantTaxStatus" TEXT NOT NULL DEFAULT 'PENDIENTE',
  "applicantCommercialStatus" TEXT NOT NULL DEFAULT 'PENDIENTE',
  "declaredIncome" DECIMAL(18,2),
  "guarantorName" TEXT,
  "guarantorEvaluationStatus" TEXT NOT NULL DEFAULT 'PENDIENTE',
  "applicationReceivedAt" TIMESTAMP(3),
  "applicationReviewedAt" TIMESTAMP(3),
  "reservationStatus" TEXT NOT NULL DEFAULT 'PENDIENTE',
  "reservationAmount" DECIMAL(18,2),
  "reservationExpiresAt" TIMESTAMP(3),
  "contractStatus" TEXT NOT NULL DEFAULT 'PENDIENTE',
  "monthlyRent" DECIMAL(18,2),
  "currency" TEXT NOT NULL DEFAULT 'CLP',
  "contractStartAt" TIMESTAMP(3),
  "contractEndAt" TIMESTAMP(3),
  "paymentDay" INTEGER,
  "depositAmount" DECIMAL(18,2),
  "contractSignedAt" TIMESTAMP(3),
  "initialPaymentStatus" TEXT NOT NULL DEFAULT 'PENDIENTE',
  "initialPaymentAmount" DECIMAL(18,2),
  "initialPaymentReceivedAt" TIMESTAMP(3),
  "handoverStatus" TEXT NOT NULL DEFAULT 'PENDIENTE',
  "handoverAt" TIMESTAMP(3),
  "handoverRecipient" TEXT,
  "checkpoints" JSONB,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BrokerRentalCase_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BrokerRentalCase_operationId_key" ON "BrokerRentalCase"("operationId");
CREATE INDEX "BrokerRentalCase_tenantId_status_currentStage_idx" ON "BrokerRentalCase"("tenantId", "status", "currentStage");
CREATE INDEX "BrokerRentalCase_propertyId_status_idx" ON "BrokerRentalCase"("propertyId", "status");
CREATE INDEX "BrokerRentalCase_leaseTenantId_status_idx" ON "BrokerRentalCase"("leaseTenantId", "status");
CREATE INDEX "BrokerRentalCase_reviewedById_status_idx" ON "BrokerRentalCase"("reviewedById", "status");

ALTER TABLE "BrokerRentalCase" ADD CONSTRAINT "BrokerRentalCase_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BrokerRentalCase" ADD CONSTRAINT "BrokerRentalCase_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "BrokerProperty"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BrokerRentalCase" ADD CONSTRAINT "BrokerRentalCase_leaseTenantId_fkey" FOREIGN KEY ("leaseTenantId") REFERENCES "BrokerLeaseTenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "BrokerRentalCase" ADD CONSTRAINT "BrokerRentalCase_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "WorkspaceUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;
