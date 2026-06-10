
const buckets = new Map();

function keyFor(req) {
  const user = req.user?.id || req.user?.email || "anon";
  const tenant = req.tenantId || req.user?.tenantId || "public";
  const ip = req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "ip";
  return `${tenant}:${user}:${ip}`;
}

export function basicRateLimit({ windowMs = 60_000, max = 240 } = {}) {
  return (req, res, next) => {
    // No limitar preflight ni health.
    if (req.method === "OPTIONS" || req.path === "/health" || req.path === "/api/health") return next();

    const now = Date.now();
    const key = keyFor(req);
    const current = buckets.get(key) || { count: 0, resetAt: now + windowMs };

    if (now > current.resetAt) {
      current.count = 0;
      current.resetAt = now + windowMs;
    }

    current.count += 1;
    buckets.set(key, current);

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
