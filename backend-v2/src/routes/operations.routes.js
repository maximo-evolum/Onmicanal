import { Router } from "express";
import { prisma } from "../lib/db.js";
import { getRedisClient } from "../lib/redis.js";
import { runtimeAlertSnapshot, runtimeMetrics } from "../lib/runtime-metrics.js";
import { requireRole, ROLE_GROUPS } from "../middleware/tenant-access.js";
import { env } from "../lib/env.js";

export const operationsRouter = Router();
operationsRouter.get("/operations/health", requireRole(ROLE_GROUPS.MANAGERS), async (_req, res) => {
  let database = false; let redis = false;
  try { await prisma.$queryRaw`SELECT 1`; database = true; } catch {}
  try { redis = Boolean(await getRedisClient()); } catch {}
  res.status(database ? 200 : 503).json({ ok: database, database, redis, ...runtimeMetrics(), timestamp: new Date().toISOString() });
});

operationsRouter.get("/operations/metrics", requireRole(ROLE_GROUPS.MANAGERS), (_req, res) => {
  res.json({ ok: true, ...runtimeMetrics(), timestamp: new Date().toISOString() });
});

operationsRouter.get("/operations/alerts", requireRole(ROLE_GROUPS.MANAGERS), async (_req, res) => {
  let database = false;
  let redis = "not_configured";
  try { await prisma.$queryRaw`SELECT 1`; database = true; } catch {}
  if (process.env.REDIS_URL) {
    try { redis = (await getRedisClient()) ? "connected" : "unavailable"; } catch { redis = "unavailable"; }
  }
  res.status(database ? 200 : 503).json(runtimeAlertSnapshot({ database, redis }));
});

// Verificación de controles sin devolver valores de variables ni credenciales.
operationsRouter.get("/operations/security-posture", requireRole(ROLE_GROUPS.MANAGERS), async (req, res) => {
  const [auditEvents, backupPolicy] = await Promise.all([
    prisma.tenantAuditLog.count({ where: { tenantId: req.tenantId } }).catch(() => 0),
    prisma.industryRecord.findFirst({ where: { tenantId: req.tenantId, recordType: "backup_config", title: "tenant_backup_policy" }, select: { updatedAt: true, data: true } }).catch(() => null)
  ]);
  const controls = [
    { key: "transport", status: env.nodeEnv === "production" ? "active" : "review", label: "HTTPS y HSTS en producción" },
    { key: "session", status: "active", label: "Sesiones HTTP-only y validación de origen" },
    { key: "rate_limit", status: "active", label: "Límite de solicitudes y protección de acceso" },
    { key: "credential_encryption", status: process.env.CONNECTIONS_ENCRYPTION_KEY ? "active" : "review", label: "Cifrado de credenciales de integraciones" },
    { key: "audit", status: auditEvents ? "active" : "review", label: "Trazabilidad de acciones administrativas", evidenceCount: auditEvents },
    { key: "backup", status: backupPolicy?.data?.encryptedAtRest ? "active" : "review", label: "Política de respaldo cifrado", configuredAt: backupPolicy?.updatedAt || null }
  ];
  res.json({
    generatedAt: new Date().toISOString(),
    score: Math.round((controls.filter((control) => control.status === "active").length / controls.length) * 100),
    controls,
    nextSteps: controls.filter((control) => control.status !== "active").map((control) => control.key)
  });
});
