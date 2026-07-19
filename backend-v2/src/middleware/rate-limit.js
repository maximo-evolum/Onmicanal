
import { getRedisClient } from "../lib/redis.js";

const buckets = new Map();
const MAX_BUCKETS = 20_000;

function clientIp(req) {
  return String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "ip")
    .split(",")[0]
    .trim();
}

function keyFor(req) {
  const user = req.user?.id || req.user?.email || "anon";
  const tenant = req.tenantId || req.user?.tenantId || "public";
  const ip = clientIp(req);
  return `${tenant}:${user}:${ip}`;
}

/**
 * Límite reutilizable con espacios de nombres independientes. No se deben
 * compartir contadores entre el límite global de API y rutas sensibles como
 * login: de lo contrario, actividad normal puede bloquear un inicio válido.
 */
export function basicRateLimit({ windowMs = 60_000, max = 240, keyPrefix = "api", keyForRequest } = {}) {
  return async (req, res, next) => {
    // No limitar preflight ni health.
    if (req.method === "OPTIONS" || req.path === "/health" || req.path === "/api/health") return next();

    const now = Date.now();
    const key = String(keyForRequest?.(req) || keyFor(req));
    const bucketKey = `${keyPrefix}:${key}`;
    const redis = await getRedisClient();
    if (redis) {
      const redisKey = `rate-limit:${bucketKey}:${Math.floor(now / windowMs)}`;
      const current = await redis.incr(redisKey);
      if (current === 1) await redis.pExpire(redisKey, windowMs);
      const ttl = Math.max(0, await redis.pTTL(redisKey));
      res.setHeader("X-RateLimit-Limit", String(max));
      res.setHeader("X-RateLimit-Remaining", String(Math.max(0, max - current)));
      res.setHeader("X-RateLimit-Reset", String(Math.ceil((now + ttl) / 1000)));
      if (current > max) return res.status(429).json({ error: "Demasiadas solicitudes. Intenta nuevamente en unos segundos.", retryAfterSeconds: Math.ceil(ttl / 1000) });
      return next();
    }
    if (buckets.size >= MAX_BUCKETS) {
      for (const [bucketKey, bucket] of buckets) {
        if (bucket.resetAt <= now) buckets.delete(bucketKey);
      }
      if (buckets.size >= MAX_BUCKETS) buckets.delete(buckets.keys().next().value);
    }
    const current = buckets.get(bucketKey) || { count: 0, resetAt: now + windowMs };

    if (now > current.resetAt) {
      current.count = 0;
      current.resetAt = now + windowMs;
    }

    current.count += 1;
    buckets.set(bucketKey, current);

    res.setHeader("X-RateLimit-Limit", String(max));
    res.setHeader("X-RateLimit-Remaining", String(Math.max(0, max - current.count)));
    res.setHeader("X-RateLimit-Reset", String(Math.ceil(current.resetAt / 1000)));

    if (current.count > max) {
      return res.status(429).json({
        error: "Demasiadas solicitudes. Intenta nuevamente en unos segundos.",
        retryAfterSeconds: Math.ceil((current.resetAt - now) / 1000)
      });
    }

    next();
  };
}
