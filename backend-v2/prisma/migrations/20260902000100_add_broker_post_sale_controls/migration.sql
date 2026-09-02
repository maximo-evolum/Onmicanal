CREATE TABLE "BrokerInspection" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "legacyRecordId" TEXT,
    "inspectionType" TEXT NOT NULL DEFAULT 'PRE_ENTREGA',
    "status" TEXT NOT NULL DEFAULT 'PROGRAMACION',
    "workflowStage" TEXT NOT NULL DEFAULT 'PROGRAMACION',
    "scheduledAt" TIMESTAMP(3),
    "inspectedAt" TIMESTAMP(3),
    "inspectorName" TEXT,
    "conditionSummary" TEXT,
    "checklist" JSONB,
    "evidence" JSONB,
    "observations" TEXT,
    "requiresAction" BOOLEAN NOT NULL DEFAULT false,
    "actionPlan" TEXT,
    "actionDueAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "checkpoints" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "BrokerInspection_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BrokerHandover" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "legacyRecordId" TEXT,
    "direction" TEXT NOT NULL DEFAULT 'ENTREGA',
    "status" TEXT NOT NULL DEFAULT 'PROGRAMACION',
    "workflowStage" TEXT NOT NULL DEFAULT 'PROGRAMACION',
    "scheduledAt" TIMESTAMP(3),
    "handoverAt" TIMESTAMP(3),
    "recipientName" TEXT,
    "recipientRole" TEXT,
    "inventoryReference" TEXT,
    "actaReference" TEXT,
    "observations" TEXT,
    "evidence" JSONB,
    "acceptedAt" TIMESTAMP(3),
    "checkpoints" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "BrokerHandover_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BrokerPostSaleCase" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "legacyRecordId" TEXT,
    "title" TEXT NOT NULL,
    "caseType" TEXT NOT NULL DEFAULT 'POSTVENTA',
    "priority" TEXT NOT NULL DEFAULT 'MEDIA',
    "status" TEXT NOT NULL DEFAULT 'INGRESO',
    "workflowStage" TEXT NOT NULL DEFAULT 'INGRESO',
    "description" TEXT NOT NULL,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "responseDueAt" TIMESTAMP(3),
    "responsibleName" TEXT,
    "diagnosis" TEXT,
    "actionPlan" TEXT,
    "resolution" TEXT,
    "evidence" JSONB,
    "resolvedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "checkpoints" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "BrokerPostSaleCase_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BrokerWarrantyCase" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "postSaleCaseId" TEXT,
    "legacyRecordId" TEXT,
    "coverageType" TEXT NOT NULL DEFAULT 'OTRA',
    "providerName" TEXT,
    "warrantyUntil" TIMESTAMP(3),
    "description" TEXT NOT NULL,
    "priority" TEXT NOT NULL DEFAULT 'MEDIA',
    "status" TEXT NOT NULL DEFAULT 'INGRESO',
    "workflowStage" TEXT NOT NULL DEFAULT 'INGRESO',
    "claimReference" TEXT,
    "submittedAt" TIMESTAMP(3),
    "reviewedAt" TIMESTAMP(3),
    "resolution" TEXT,
    "evidence" JSONB,
    "resolvedAt" TIMESTAMP(3),
    "checkpoints" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "BrokerWarrantyCase_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BrokerInspection_legacyRecordId_key" ON "BrokerInspection"("legacyRecordId");
CREATE UNIQUE INDEX "BrokerHandover_legacyRecordId_key" ON "BrokerHandover"("legacyRecordId");
CREATE UNIQUE INDEX "BrokerPostSaleCase_legacyRecordId_key" ON "BrokerPostSaleCase"("legacyRecordId");
CREATE UNIQUE INDEX "BrokerWarrantyCase_legacyRecordId_key" ON "BrokerWarrantyCase"("legacyRecordId");
CREATE INDEX "BrokerInspection_tenantId_workflowStage_idx" ON "BrokerInspection"("tenantId", "workflowStage");
CREATE INDEX "BrokerInspection_propertyId_workflowStage_idx" ON "BrokerInspection"("propertyId", "workflowStage");
CREATE INDEX "BrokerHandover_tenantId_workflowStage_idx" ON "BrokerHandover"("tenantId", "workflowStage");
CREATE INDEX "BrokerHandover_propertyId_workflowStage_idx" ON "BrokerHandover"("propertyId", "workflowStage");
CREATE INDEX "BrokerPostSaleCase_tenantId_workflowStage_priority_idx" ON "BrokerPostSaleCase"("tenantId", "workflowStage", "priority");
CREATE INDEX "BrokerPostSaleCase_propertyId_workflowStage_idx" ON "BrokerPostSaleCase"("propertyId", "workflowStage");
CREATE INDEX "BrokerWarrantyCase_tenantId_workflowStage_warrantyUntil_idx" ON "BrokerWarrantyCase"("tenantId", "workflowStage", "warrantyUntil");
CREATE INDEX "BrokerWarrantyCase_propertyId_workflowStage_idx" ON "BrokerWarrantyCase"("propertyId", "workflowStage");
CREATE INDEX "BrokerWarrantyCase_postSaleCaseId_idx" ON "BrokerWarrantyCase"("postSaleCaseId");

ALTER TABLE "BrokerInspection" ADD CONSTRAINT "BrokerInspection_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BrokerInspection" ADD CONSTRAINT "BrokerInspection_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "BrokerProperty"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BrokerHandover" ADD CONSTRAINT "BrokerHandover_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BrokerHandover" ADD CONSTRAINT "BrokerHandover_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "BrokerProperty"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BrokerPostSaleCase" ADD CONSTRAINT "BrokerPostSaleCase_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BrokerPostSaleCase" ADD CONSTRAINT "BrokerPostSaleCase_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "BrokerProperty"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BrokerWarrantyCase" ADD CONSTRAINT "BrokerWarrantyCase_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BrokerWarrantyCase" ADD CONSTRAINT "BrokerWarrantyCase_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "BrokerProperty"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BrokerWarrantyCase" ADD CONSTRAINT "BrokerWarrantyCase_postSaleCaseId_fkey" FOREIGN KEY ("postSaleCaseId") REFERENCES "BrokerPostSaleCase"("id") ON DELETE SET NULL ON UPDATE CASCADE;
