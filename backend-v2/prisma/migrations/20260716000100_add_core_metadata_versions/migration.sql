ALTER TABLE "Lead" ADD COLUMN "schemaVersion" INTEGER;
ALTER TABLE "Booking" ADD COLUMN "metadata" JSONB;
ALTER TABLE "Booking" ADD COLUMN "schemaVersion" INTEGER;
ALTER TABLE "Payment" ADD COLUMN "schemaVersion" INTEGER;
CREATE INDEX "Lead_tenantId_schemaVersion_idx" ON "Lead"("tenantId", "schemaVersion");
CREATE INDEX "Booking_tenantId_schemaVersion_idx" ON "Booking"("tenantId", "schemaVersion");
CREATE INDEX "Payment_tenantId_schemaVersion_idx" ON "Payment"("tenantId", "schemaVersion");
