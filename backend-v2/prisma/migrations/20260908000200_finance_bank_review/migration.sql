ALTER TABLE "FinanceBankImportJob" ADD COLUMN "reviewConfig" JSONB;
CREATE TABLE "FinanceBankMappingTemplate" (
  "id" TEXT NOT NULL, "tenantId" TEXT NOT NULL, "name" TEXT NOT NULL,
  "bankKey" TEXT NOT NULL, "columns" JSONB NOT NULL, "mapping" JSONB NOT NULL,
  "createdById" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FinanceBankMappingTemplate_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "FinanceBankMappingTemplate_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "FinanceBankMappingTemplate_tenantId_bankKey_name_key" ON "FinanceBankMappingTemplate"("tenantId", "bankKey", "name");
