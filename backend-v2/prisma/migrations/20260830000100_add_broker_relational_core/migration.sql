-- Núcleo relacional de Broker OS. No elimina IndustryRecord: la tabla
-- histórica queda activa durante la migración gradual por tenant.

CREATE TABLE "BrokerOwner" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "rut" TEXT,
  "legalType" TEXT NOT NULL DEFAULT 'PERSONA_NATURAL',
  "phone" TEXT,
  "email" TEXT,
  "contactAddress" TEXT,
  "legacyRecordId" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BrokerOwner_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BrokerCommunity" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "address" TEXT,
  "averageCommonExpenses" DECIMAL(18,2),
  "administratorName" TEXT,
  "administratorPhone" TEXT,
  "rulesDocumentUrl" TEXT,
  "amenities" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BrokerCommunity_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BrokerBuyer" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "rut" TEXT,
  "phone" TEXT,
  "email" TEXT,
  "budgetMin" DECIMAL(18,2),
  "budgetMax" DECIMAL(18,2),
  "financingType" TEXT,
  "status" TEXT NOT NULL DEFAULT 'INTERESADO',
  "legacyRecordId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BrokerBuyer_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BrokerLeaseTenant" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "rut" TEXT,
  "phone" TEXT,
  "email" TEXT,
  "taxEvaluationStatus" TEXT NOT NULL DEFAULT 'PENDIENTE',
  "declaredIncome" DECIMAL(18,2),
  "guarantorName" TEXT,
  "legacyRecordId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BrokerLeaseTenant_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BrokerProvider" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "rut" TEXT,
  "contactName" TEXT,
  "phone" TEXT,
  "email" TEXT,
  "specialties" JSONB,
  "averageRating" DECIMAL(4,2),
  "status" TEXT NOT NULL DEFAULT 'ACTIVO',
  "legacyRecordId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BrokerProvider_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BrokerProperty" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "communityId" TEXT,
  "assignedBrokerId" TEXT,
  "legacyRecordId" TEXT,
  "address" TEXT NOT NULL,
  "comuna" TEXT NOT NULL,
  "region" TEXT,
  "propertyType" TEXT NOT NULL,
  "bedrooms" INTEGER,
  "bathrooms" INTEGER,
  "usableSquareMeters" DECIMAL(12,2),
  "totalSquareMeters" DECIMAL(12,2),
  "parkingSpaces" INTEGER,
  "storageRooms" INTEGER,
  "ageYears" INTEGER,
  "conservationStatus" TEXT,
  "askingPrice" DECIMAL(18,2),
  "currency" TEXT NOT NULL DEFAULT 'CLP',
  "operationalStatus" TEXT NOT NULL DEFAULT 'CAPTACION',
  "siiAssessmentRole" TEXT,
  "cbrInscription" TEXT,
  "coverImageUrl" TEXT,
  "metadata" JSONB,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BrokerProperty_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BrokerContract" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "propertyId" TEXT NOT NULL,
  "ownerId" TEXT,
  "leaseTenantId" TEXT,
  "legacyRecordId" TEXT,
  "type" TEXT NOT NULL,
  "startDate" TIMESTAMP(3) NOT NULL,
  "endDate" TIMESTAMP(3),
  "exclusivity" BOOLEAN NOT NULL DEFAULT false,
  "commissionRatePct" DECIMAL(6,3),
  "managementRatePct" DECIMAL(6,3),
  "monthlyRent" DECIMAL(18,2),
  "currency" TEXT NOT NULL DEFAULT 'CLP',
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "signedDocumentUrl" TEXT,
  "businessReference" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BrokerContract_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BrokerFinancing" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "propertyId" TEXT NOT NULL,
  "assignedToId" TEXT,
  "legacyRecordId" TEXT,
  "businessReference" TEXT NOT NULL,
  "clientType" TEXT,
  "clientReference" TEXT,
  "purpose" TEXT NOT NULL,
  "requestedAmount" DECIMAL(18,2) NOT NULL,
  "approvedAmount" DECIMAL(18,2),
  "currency" TEXT NOT NULL DEFAULT 'CLP',
  "interestRatePct" DECIMAL(6,3),
  "commissionAmount" DECIMAL(18,2),
  "guaranteeSummary" TEXT,
  "expectedRecoveryAt" TIMESTAMP(3),
  "recoveredAt" TIMESTAMP(3),
  "disbursedAt" TIMESTAMP(3),
  "status" TEXT NOT NULL DEFAULT 'DIAGNOSTICO_FINANCIERO',
  "evidence" JSONB,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BrokerFinancing_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BrokerDocument" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "propertyId" TEXT,
  "contractId" TEXT,
  "financingId" TEXT,
  "legacyRecordId" TEXT,
  "type" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDIENTE',
  "storageKey" TEXT,
  "fileUrl" TEXT,
  "expiresAt" TIMESTAMP(3),
  "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reviewedAt" TIMESTAMP(3),
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BrokerDocument_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BrokerPayment" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "propertyId" TEXT,
  "contractId" TEXT,
  "financingId" TEXT,
  "legacyRecordId" TEXT,
  "type" TEXT NOT NULL,
  "amount" DECIMAL(18,2) NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'CLP',
  "dueDate" TIMESTAMP(3),
  "paidAt" TIMESTAMP(3),
  "status" TEXT NOT NULL DEFAULT 'PENDIENTE',
  "payerType" TEXT,
  "payerReference" TEXT,
  "evidenceReference" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BrokerPayment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BrokerCommission" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "propertyId" TEXT NOT NULL,
  "contractId" TEXT,
  "brokerUserId" TEXT,
  "legacyRecordId" TEXT,
  "type" TEXT NOT NULL,
  "baseAmount" DECIMAL(18,2) NOT NULL,
  "appliedRatePct" DECIMAL(6,3) NOT NULL,
  "commissionAmount" DECIMAL(18,2) NOT NULL,
  "brokerSplitPct" DECIMAL(6,3) NOT NULL,
  "companySplitPct" DECIMAL(6,3) NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PROYECTADA',
  "payableAt" TIMESTAMP(3),
  "paidAt" TIMESTAMP(3),
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BrokerCommission_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BrokerMaintenance" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "propertyId" TEXT NOT NULL,
  "providerId" TEXT,
  "legacyRecordId" TEXT,
  "category" TEXT NOT NULL,
  "specificType" TEXT,
  "description" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'ABIERTA',
  "reportedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolvedAt" TIMESTAMP(3),
  "estimatedCost" DECIMAL(18,2),
  "actualCost" DECIMAL(18,2),
  "evidence" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BrokerMaintenance_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BrokerVisit" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "propertyId" TEXT NOT NULL,
  "buyerId" TEXT,
  "leaseTenantId" TEXT,
  "brokerUserId" TEXT,
  "legacyRecordId" TEXT,
  "scheduledAt" TIMESTAMP(3) NOT NULL,
  "type" TEXT NOT NULL,
  "result" TEXT,
  "notes" TEXT,
  "status" TEXT NOT NULL DEFAULT 'PROGRAMADA',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BrokerVisit_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BrokerOwner_legacyRecordId_key" ON "BrokerOwner"("legacyRecordId");
CREATE UNIQUE INDEX "BrokerOwner_tenantId_rut_key" ON "BrokerOwner"("tenantId", "rut");
CREATE INDEX "BrokerOwner_tenantId_name_idx" ON "BrokerOwner"("tenantId", "name");
CREATE INDEX "BrokerOwner_tenantId_isActive_idx" ON "BrokerOwner"("tenantId", "isActive");
CREATE INDEX "BrokerCommunity_tenantId_name_idx" ON "BrokerCommunity"("tenantId", "name");
CREATE UNIQUE INDEX "BrokerProperty_legacyRecordId_key" ON "BrokerProperty"("legacyRecordId");
CREATE INDEX "BrokerProperty_tenantId_operationalStatus_isActive_idx" ON "BrokerProperty"("tenantId", "operationalStatus", "isActive");
CREATE INDEX "BrokerProperty_tenantId_comuna_propertyType_idx" ON "BrokerProperty"("tenantId", "comuna", "propertyType");
CREATE INDEX "BrokerProperty_tenantId_assignedBrokerId_idx" ON "BrokerProperty"("tenantId", "assignedBrokerId");
CREATE INDEX "BrokerProperty_ownerId_isActive_idx" ON "BrokerProperty"("ownerId", "isActive");
CREATE UNIQUE INDEX "BrokerProperty_active_owner_address_comuna_key" ON "BrokerProperty"("tenantId", "ownerId", "address", "comuna") WHERE "isActive" = true;
CREATE UNIQUE INDEX "BrokerBuyer_legacyRecordId_key" ON "BrokerBuyer"("legacyRecordId");
CREATE UNIQUE INDEX "BrokerBuyer_tenantId_rut_key" ON "BrokerBuyer"("tenantId", "rut");
CREATE INDEX "BrokerBuyer_tenantId_status_idx" ON "BrokerBuyer"("tenantId", "status");
CREATE INDEX "BrokerBuyer_tenantId_budgetMin_budgetMax_idx" ON "BrokerBuyer"("tenantId", "budgetMin", "budgetMax");
CREATE UNIQUE INDEX "BrokerLeaseTenant_legacyRecordId_key" ON "BrokerLeaseTenant"("legacyRecordId");
CREATE UNIQUE INDEX "BrokerLeaseTenant_tenantId_rut_key" ON "BrokerLeaseTenant"("tenantId", "rut");
CREATE INDEX "BrokerLeaseTenant_tenantId_taxEvaluationStatus_idx" ON "BrokerLeaseTenant"("tenantId", "taxEvaluationStatus");
CREATE UNIQUE INDEX "BrokerProvider_legacyRecordId_key" ON "BrokerProvider"("legacyRecordId");
CREATE UNIQUE INDEX "BrokerProvider_tenantId_rut_key" ON "BrokerProvider"("tenantId", "rut");
CREATE INDEX "BrokerProvider_tenantId_status_idx" ON "BrokerProvider"("tenantId", "status");
CREATE UNIQUE INDEX "BrokerContract_legacyRecordId_key" ON "BrokerContract"("legacyRecordId");
CREATE INDEX "BrokerContract_tenantId_type_status_idx" ON "BrokerContract"("tenantId", "type", "status");
CREATE INDEX "BrokerContract_propertyId_status_idx" ON "BrokerContract"("propertyId", "status");
CREATE INDEX "BrokerContract_leaseTenantId_status_idx" ON "BrokerContract"("leaseTenantId", "status");
CREATE INDEX "BrokerContract_tenantId_endDate_idx" ON "BrokerContract"("tenantId", "endDate");
CREATE UNIQUE INDEX "BrokerFinancing_legacyRecordId_key" ON "BrokerFinancing"("legacyRecordId");
CREATE INDEX "BrokerFinancing_tenantId_status_expectedRecoveryAt_idx" ON "BrokerFinancing"("tenantId", "status", "expectedRecoveryAt");
CREATE INDEX "BrokerFinancing_propertyId_status_idx" ON "BrokerFinancing"("propertyId", "status");
CREATE INDEX "BrokerFinancing_assignedToId_status_idx" ON "BrokerFinancing"("assignedToId", "status");
CREATE INDEX "BrokerFinancing_tenantId_businessReference_idx" ON "BrokerFinancing"("tenantId", "businessReference");
CREATE UNIQUE INDEX "BrokerDocument_legacyRecordId_key" ON "BrokerDocument"("legacyRecordId");
CREATE INDEX "BrokerDocument_tenantId_type_status_idx" ON "BrokerDocument"("tenantId", "type", "status");
CREATE INDEX "BrokerDocument_propertyId_expiresAt_idx" ON "BrokerDocument"("propertyId", "expiresAt");
CREATE INDEX "BrokerDocument_contractId_expiresAt_idx" ON "BrokerDocument"("contractId", "expiresAt");
CREATE INDEX "BrokerDocument_financingId_expiresAt_idx" ON "BrokerDocument"("financingId", "expiresAt");
CREATE UNIQUE INDEX "BrokerPayment_legacyRecordId_key" ON "BrokerPayment"("legacyRecordId");
CREATE INDEX "BrokerPayment_tenantId_status_dueDate_idx" ON "BrokerPayment"("tenantId", "status", "dueDate");
CREATE INDEX "BrokerPayment_propertyId_dueDate_idx" ON "BrokerPayment"("propertyId", "dueDate");
CREATE INDEX "BrokerPayment_contractId_dueDate_idx" ON "BrokerPayment"("contractId", "dueDate");
CREATE UNIQUE INDEX "BrokerCommission_legacyRecordId_key" ON "BrokerCommission"("legacyRecordId");
CREATE INDEX "BrokerCommission_tenantId_type_status_idx" ON "BrokerCommission"("tenantId", "type", "status");
CREATE INDEX "BrokerCommission_propertyId_status_idx" ON "BrokerCommission"("propertyId", "status");
CREATE INDEX "BrokerCommission_brokerUserId_status_idx" ON "BrokerCommission"("brokerUserId", "status");
CREATE UNIQUE INDEX "BrokerMaintenance_legacyRecordId_key" ON "BrokerMaintenance"("legacyRecordId");
CREATE INDEX "BrokerMaintenance_tenantId_status_reportedAt_idx" ON "BrokerMaintenance"("tenantId", "status", "reportedAt");
CREATE INDEX "BrokerMaintenance_propertyId_status_idx" ON "BrokerMaintenance"("propertyId", "status");
CREATE INDEX "BrokerMaintenance_providerId_status_idx" ON "BrokerMaintenance"("providerId", "status");
CREATE UNIQUE INDEX "BrokerVisit_legacyRecordId_key" ON "BrokerVisit"("legacyRecordId");
CREATE INDEX "BrokerVisit_tenantId_scheduledAt_status_idx" ON "BrokerVisit"("tenantId", "scheduledAt", "status");
CREATE INDEX "BrokerVisit_propertyId_scheduledAt_idx" ON "BrokerVisit"("propertyId", "scheduledAt");
CREATE INDEX "BrokerVisit_brokerUserId_scheduledAt_idx" ON "BrokerVisit"("brokerUserId", "scheduledAt");

ALTER TABLE "BrokerOwner" ADD CONSTRAINT "BrokerOwner_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BrokerCommunity" ADD CONSTRAINT "BrokerCommunity_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BrokerBuyer" ADD CONSTRAINT "BrokerBuyer_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BrokerLeaseTenant" ADD CONSTRAINT "BrokerLeaseTenant_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BrokerProvider" ADD CONSTRAINT "BrokerProvider_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BrokerProperty" ADD CONSTRAINT "BrokerProperty_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BrokerProperty" ADD CONSTRAINT "BrokerProperty_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "BrokerOwner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BrokerProperty" ADD CONSTRAINT "BrokerProperty_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "BrokerCommunity"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "BrokerProperty" ADD CONSTRAINT "BrokerProperty_assignedBrokerId_fkey" FOREIGN KEY ("assignedBrokerId") REFERENCES "WorkspaceUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "BrokerContract" ADD CONSTRAINT "BrokerContract_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BrokerContract" ADD CONSTRAINT "BrokerContract_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "BrokerProperty"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BrokerContract" ADD CONSTRAINT "BrokerContract_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "BrokerOwner"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "BrokerContract" ADD CONSTRAINT "BrokerContract_leaseTenantId_fkey" FOREIGN KEY ("leaseTenantId") REFERENCES "BrokerLeaseTenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "BrokerFinancing" ADD CONSTRAINT "BrokerFinancing_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BrokerFinancing" ADD CONSTRAINT "BrokerFinancing_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "BrokerProperty"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BrokerFinancing" ADD CONSTRAINT "BrokerFinancing_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "WorkspaceUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "BrokerDocument" ADD CONSTRAINT "BrokerDocument_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BrokerDocument" ADD CONSTRAINT "BrokerDocument_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "BrokerProperty"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BrokerDocument" ADD CONSTRAINT "BrokerDocument_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "BrokerContract"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BrokerDocument" ADD CONSTRAINT "BrokerDocument_financingId_fkey" FOREIGN KEY ("financingId") REFERENCES "BrokerFinancing"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BrokerPayment" ADD CONSTRAINT "BrokerPayment_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BrokerPayment" ADD CONSTRAINT "BrokerPayment_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "BrokerProperty"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "BrokerPayment" ADD CONSTRAINT "BrokerPayment_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "BrokerContract"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "BrokerPayment" ADD CONSTRAINT "BrokerPayment_financingId_fkey" FOREIGN KEY ("financingId") REFERENCES "BrokerFinancing"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "BrokerCommission" ADD CONSTRAINT "BrokerCommission_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BrokerCommission" ADD CONSTRAINT "BrokerCommission_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "BrokerProperty"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BrokerCommission" ADD CONSTRAINT "BrokerCommission_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "BrokerContract"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "BrokerCommission" ADD CONSTRAINT "BrokerCommission_brokerUserId_fkey" FOREIGN KEY ("brokerUserId") REFERENCES "WorkspaceUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "BrokerMaintenance" ADD CONSTRAINT "BrokerMaintenance_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BrokerMaintenance" ADD CONSTRAINT "BrokerMaintenance_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "BrokerProperty"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BrokerMaintenance" ADD CONSTRAINT "BrokerMaintenance_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "BrokerProvider"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "BrokerVisit" ADD CONSTRAINT "BrokerVisit_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BrokerVisit" ADD CONSTRAINT "BrokerVisit_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "BrokerProperty"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BrokerVisit" ADD CONSTRAINT "BrokerVisit_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "BrokerBuyer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "BrokerVisit" ADD CONSTRAINT "BrokerVisit_leaseTenantId_fkey" FOREIGN KEY ("leaseTenantId") REFERENCES "BrokerLeaseTenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "BrokerVisit" ADD CONSTRAINT "BrokerVisit_brokerUserId_fkey" FOREIGN KEY ("brokerUserId") REFERENCES "WorkspaceUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;
