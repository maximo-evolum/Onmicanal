import { Router } from "express";
import { prisma } from "../lib/db.js";
import { getRedisClient } from "../lib/redis.js";
import { runtimeMetrics } from "../lib/runtime-metrics.js";
import { requireRole, ROLE_GROUPS } from "../middleware/tenant-access.js";

export const operationsRouter = Router();
operationsRouter.get("/operations/health", requireRole(ROLE_GROUPS.MANAGERS), async (_req, res) => {
  let database = false; let redis = false;
  try { await prisma.$queryRaw`SELECT 1`; database = true; } catch {}
  try { redis = Boolean(await getRedisClient()); } catch {}
  res.status(database ? 200 : 503).json({ ok: database, database, redis, ...runtimeMetrics(), timestamp: new Date().toISOString() });
});
