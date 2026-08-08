import { prisma } from "../lib/db.js";
import { env } from "../lib/env.js";
import { anonymizeExpiredSensitiveFields } from "../lib/metadata-retention.js";
import { listMetadataSchemas } from "./metadata-schemas.service.js";
import { runScheduledWorkflows } from "../routes/workflows.routes.js";
import { getRedisClient } from "../lib/redis.js";
import { runtimeAlertSnapshot } from "../lib/runtime-metrics.js";
import { publishObservabilityAlerts } from "./observability-alerts.service.js";

function boundedNumber(value, fallback, minimum, maximum) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, Math.floor(number))) : fallback;
}

export function jobIntervalMs(value, fallbackMs, minimumMs = 60_000, maximumMs = 86_400_000) {
  return boundedNumber(value, fallbackMs, minimumMs, maximumMs);
}

function runKeyFor(jobKey, intervalMs, now = new Date()) {
  return `${jobKey}:${Math.floor(now.getTime() / intervalMs)}`;
}

async function executeRecordedJob({ jobKey, intervalMs, task, now = new Date() }) {
  const runKey = runKeyFor(jobKey, intervalMs, now);
  let run;
  try {
    run = await prisma.scheduledJobRun.create({ data: { jobKey, runKey } });
  } catch (error) {
    // La restricción única garantiza una única corrida aunque Railway escale.
    if (error?.code === "P2002") return { status: "SKIPPED", jobKey, reason: "already_executed", runKey };
    throw error;
  }

  try {
    const details = await task();
    await prisma.scheduledJobRun.update({ where: { id: run.id }, data: { status: "COMPLETED", finishedAt: new Date(), details } });
    return { status: "COMPLETED", jobKey, runKey, details };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error desconocido";
    await prisma.scheduledJobRun.update({ where: { id: run.id }, data: { status: "FAILED", finishedAt: new Date(), error: message } }).catch(() => null);
    throw error;
  }
}

export async function runMetadataRetentionSweep({ now = new Date() } = {}) {
  if (!env.metadataRetentionEnabled) return { enabled: false, tenants: 0, updated: 0 };
  const tenants = await prisma.tenant.findMany({ select: { id: true } });
  let updated = 0;
  let reviewed = 0;
  for (const tenant of tenants) {
    const schemas = (await listMetadataSchemas(tenant.id)).filter((item) => item.status === "PUBLISHED");
    if (!schemas.length) continue;
    const byType = new Map(schemas.map((item) => [item.recordType, item]));
    const records = await prisma.industryRecord.findMany({
      where: { tenantId: tenant.id, recordType: { in: schemas.map((item) => item.recordType) } },
      take: 5000
    });
    reviewed += records.length;
    for (const record of records) {
      const result = anonymizeExpiredSensitiveFields(record, byType.get(record.recordType), now);
      if (!result.due.length) continue;
      await prisma.industryRecord.update({ where: { id: record.id }, data: { data: result.data } });
      updated += 1;
    }
  }
  return { enabled: true, tenants: tenants.length, reviewed, updated };
}

export async function runPlatformJobs({ now = new Date() } = {}) {
  const retentionIntervalMs = jobIntervalMs(process.env.METADATA_RETENTION_INTERVAL_MS, 86_400_000, 3_600_000);
  const workflowIntervalMs = jobIntervalMs(process.env.WORKFLOW_SCHEDULER_INTERVAL_MS, 300_000, 60_000);
  const observabilityIntervalMs = jobIntervalMs(process.env.OBSERVABILITY_MONITOR_INTERVAL_MS, 60_000, 60_000);
  const [retention, workflows, observability] = await Promise.all([
    executeRecordedJob({ jobKey: "metadata-retention", intervalMs: retentionIntervalMs, now, task: () => runMetadataRetentionSweep({ now }) }),
    executeRecordedJob({ jobKey: "scheduled-workflows", intervalMs: workflowIntervalMs, now, task: () => runScheduledWorkflows({ now }) }),
    executeRecordedJob({
      jobKey: "observability-monitor",
      intervalMs: observabilityIntervalMs,
      now,
      task: async () => {
        let database = false;
        let redis = process.env.REDIS_URL ? "unavailable" : "not_configured";
        try { await prisma.$queryRaw`SELECT 1`; database = true; } catch {}
        if (process.env.REDIS_URL) {
          try { redis = (await getRedisClient()) ? "connected" : "unavailable"; } catch { redis = "unavailable"; }
        }
        const snapshot = runtimeAlertSnapshot({ database, redis });
        const delivery = await publishObservabilityAlerts(snapshot);
        return { ok: snapshot.ok, alerts: snapshot.alerts.map((alert) => alert.code), delivery };
      }
    })
  ]);
  return { retention, workflows, observability };
}

export async function platformJobStatus(limit = 30) {
  const runs = await prisma.scheduledJobRun.findMany({
    orderBy: { startedAt: "desc" }, take: Math.min(100, Math.max(1, Number(limit) || 30))
  });
  return { generatedAt: new Date().toISOString(), runs };
}
