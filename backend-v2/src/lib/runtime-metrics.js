const startedAt = Date.now();
const requests = { total: 0, errors: 0, latencyMs: 0 };

export function observeRequest(req, res, next) {
  const started = Date.now();
  res.on("finish", () => {
    requests.total += 1;
    requests.latencyMs += Date.now() - started;
    if (res.statusCode >= 500) requests.errors += 1;
  });
  next();
}

export function runtimeMetrics() {
  return { uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000), requests: { total: requests.total, errors: requests.errors, averageLatencyMs: requests.total ? Math.round(requests.latencyMs / requests.total) : 0 }, memory: process.memoryUsage() };
}
