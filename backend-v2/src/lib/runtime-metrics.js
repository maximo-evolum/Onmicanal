const startedAt = Date.now();
const requests = {
  total: 0,
  errors: 0,
  latencyMs: 0,
  statusClasses: { "2xx": 0, "3xx": 0, "4xx": 0, "5xx": 0 }
};
const recentFailures = [];
const MAX_RECENT_FAILURES = 50;

function statusClass(statusCode) {
  const value = `${Math.floor(Number(statusCode || 0) / 100)}xx`;
  return Object.hasOwn(requests.statusClasses, value) ? value : null;
}

function safePath(req) {
  // No incluimos query params: pueden contener datos personales, tokens o IDs.
  return String(req.baseUrl || "") + String(req.path || req.url || "").split("?")[0];
}

export function observeRequest(req, res, next) {
  const started = Date.now();
  res.on("finish", () => {
    const durationMs = Date.now() - started;
    const group = statusClass(res.statusCode);
    requests.total += 1;
    requests.latencyMs += durationMs;
    if (group) requests.statusClasses[group] += 1;
    if (res.statusCode >= 500) requests.errors += 1;

    if (res.statusCode >= 500) {
      recentFailures.unshift({
        at: new Date().toISOString(),
        requestId: req.requestId || null,
        method: req.method,
        path: safePath(req),
        status: res.statusCode,
        durationMs
      });
      if (recentFailures.length > MAX_RECENT_FAILURES) recentFailures.pop();
    }

    // Los 5xx siempre dejan evidencia. El detalle de cada request se puede
    // habilitar temporalmente sin registrar cuerpos, cookies ni tokens.
    if (res.statusCode >= 500 || process.env.ENABLE_TRACE_LOGS === "true") {
      console.log(JSON.stringify({
        event: "http.request.completed",
        requestId: req.requestId || null,
        method: req.method,
        path: safePath(req),
        status: res.statusCode,
        durationMs,
        tenantId: req.tenantId || null,
        userId: req.user?.id || null
      }));
    }
  });
  next();
}

export function runtimeMetrics() {
  const memory = process.memoryUsage();
  return {
    uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
    requests: {
      total: requests.total,
      errors: requests.errors,
      averageLatencyMs: requests.total ? Math.round(requests.latencyMs / requests.total) : 0,
      statusClasses: { ...requests.statusClasses }
    },
    memory: {
      rssBytes: memory.rss,
      heapUsedBytes: memory.heapUsed,
      heapTotalBytes: memory.heapTotal
    }
  };
}

export function runtimeAlertSnapshot({ database = true, redis = "not_configured" } = {}) {
  const metrics = runtimeMetrics();
  const alerts = [];
  const minimumRequests = Math.max(1, Number(process.env.OBSERVABILITY_MIN_REQUESTS || 20));
  const errorRateThreshold = Math.min(1, Math.max(0.01, Number(process.env.OBSERVABILITY_ERROR_RATE_THRESHOLD || 0.05)));
  const latencyThresholdMs = Math.max(100, Number(process.env.OBSERVABILITY_LATENCY_THRESHOLD_MS || 1500));
  const heapRatio = metrics.memory.heapTotalBytes ? metrics.memory.heapUsedBytes / metrics.memory.heapTotalBytes : 0;
  const errorRate = metrics.requests.total ? metrics.requests.errors / metrics.requests.total : 0;

  if (!database) alerts.push({ severity: "critical", code: "DATABASE_UNAVAILABLE", message: "La base de datos no responde." });
  if (redis === "unavailable") alerts.push({ severity: "warning", code: "REDIS_UNAVAILABLE", message: "Redis está configurado pero no responde; se usa modo degradado." });
  if (metrics.requests.total >= minimumRequests && errorRate >= errorRateThreshold) {
    alerts.push({ severity: "warning", code: "HIGH_5XX_RATE", message: "La tasa de errores 5xx superó el umbral configurado.", errorRate: Math.round(errorRate * 10_000) / 100 });
  }
  if (metrics.requests.total >= minimumRequests && metrics.requests.averageLatencyMs >= latencyThresholdMs) {
    alerts.push({ severity: "warning", code: "HIGH_LATENCY", message: "La latencia promedio superó el umbral configurado.", averageLatencyMs: metrics.requests.averageLatencyMs });
  }
  if (heapRatio >= 0.85) alerts.push({ severity: "warning", code: "HIGH_MEMORY", message: "El heap del proceso supera el 85% de uso.", heapPercent: Math.round(heapRatio * 100) });

  return {
    ok: !alerts.some((alert) => alert.severity === "critical"),
    generatedAt: new Date().toISOString(),
    thresholds: { minimumRequests, errorRatePercent: errorRateThreshold * 100, latencyThresholdMs },
    alerts,
    recentFailures: recentFailures.slice(0, 20),
    metrics
  };
}
