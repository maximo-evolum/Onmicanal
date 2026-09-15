CREATE TABLE "FinancePeriodControl" (
  "tenantId" TEXT NOT NULL,
  "period" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'OPEN',
  "version" INTEGER NOT NULL DEFAULT 0,
  "lockVersion" INTEGER NOT NULL DEFAULT 0,
  "latestCloseId" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FinancePeriodControl_pkey" PRIMARY KEY ("tenantId", "period"),
  CONSTRAINT "FinancePeriodControl_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "FinancePeriodControl_period_check" CHECK ("period" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  CONSTRAINT "FinancePeriodControl_status_check" CHECK ("status" IN ('OPEN', 'CLOSED')),
  CONSTRAINT "FinancePeriodControl_closed_reference_check" CHECK ("status" <> 'CLOSED' OR "latestCloseId" IS NOT NULL)
);

-- Preserve all historic snapshots. If there are several closed snapshots for
-- a period, select the latest one as its active pointer; delete no evidence.
INSERT INTO "FinancePeriodControl" ("tenantId", "period", "status", "version", "latestCloseId", "updatedAt")
SELECT DISTINCT ON ("tenantId", "data"->>'period')
  "tenantId", "data"->>'period', 'CLOSED', 1, "id", CURRENT_TIMESTAMP
FROM "IndustryRecord"
WHERE "recordType" = 'finance_monthly_close' AND "status" = 'CLOSED'
  AND ("data"->>'period') ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'
ORDER BY "tenantId", "data"->>'period', "createdAt" DESC, "id" DESC;
