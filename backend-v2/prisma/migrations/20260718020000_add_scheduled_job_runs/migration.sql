-- Evidencia y exclusión de ejecuciones duplicadas para trabajos automáticos.
CREATE TABLE "ScheduledJobRun" (
    "id" TEXT NOT NULL,
    "jobKey" TEXT NOT NULL,
    "runKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "details" JSONB,
    "error" TEXT,

    CONSTRAINT "ScheduledJobRun_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ScheduledJobRun_runKey_key" ON "ScheduledJobRun"("runKey");
CREATE INDEX "ScheduledJobRun_jobKey_startedAt_idx" ON "ScheduledJobRun"("jobKey", "startedAt");
CREATE INDEX "ScheduledJobRun_status_startedAt_idx" ON "ScheduledJobRun"("status", "startedAt");
