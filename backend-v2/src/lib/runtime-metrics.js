const startedAt = Date.now();
const requests = {
  total: 0,
  errors: 0,
  latencyMs: 0,
  statusClasses: { "2xx": 0, "3xx": 0, "4xx": 0, "5xx": 0 }
};

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
