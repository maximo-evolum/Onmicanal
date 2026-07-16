ALTER TABLE "IndustryRecord" ADD COLUMN "schemaVersion" INTEGER;
CREATE INDEX "IndustryRecord_tenantId_recordType_schemaVersion_idx" ON "IndustryRecord"("tenantId", "recordType", "schemaVersion");
