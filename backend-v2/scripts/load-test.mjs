/**
 * Prueba HTTP de carga controlada, sin dependencias externas.
 * Nunca se ejecuta por accidente: exige LOAD_TEST_CONFIRM=YES.
 *
 * Ejemplo seguro:
 *   $env:LOAD_TEST_CONFIRM="YES"
 *   $env:LOAD_TEST_URL="https://onmicanal-backend-v2.up.railway.app/health/live"
 *   $env:LOAD_TEST_CONCURRENCY="10"
 *   $env:LOAD_TEST_DURATION_SECONDS="60"
 *   npm run load:test
 */
const confirm = String(process.env.LOAD_TEST_CONFIRM || "").trim().toUpperCase();
if (confirm !== "YES") {
  console.error("Para ejecutar la prueba define LOAD_TEST_CONFIRM=YES.");
  process.exit(2);
}

const url = String(process.env.LOAD_TEST_URL || "").trim();
if (!/^https:\/\//i.test(url)) {
  console.error("Define LOAD_TEST_URL con un endpoint HTTPS, por ejemplo /health/live.");
  process.exit(2);
}

function boundedNumber(name, fallback, minimum, maximum) {
  const value = Number(process.env[name] || fallback);
  return Number.isFinite(value) ? Math.max(minimum, Math.min(maximum, Math.floor(value))) : fallback;
}

const concurrency = boundedNumber("LOAD_TEST_CONCURRENCY", 5, 1, 200);
const durationSeconds = boundedNumber("LOAD_TEST_DURATION_SECONDS", 30, 5, 900);
const timeoutMs = boundedNumber("LOAD_TEST_TIMEOUT_MS", 10_000, 1_000, 60_000);
const maxErrorRate = Math.max(0, Math.min(1, Number(process.env.LOAD_TEST_MAX_ERROR_RATE || 0.02)));
const maxP95Ms = boundedNumber("LOAD_TEST_MAX_P95_MS", 2_000, 100, 60_000);
const deadline = Date.now() + durationSeconds * 1000;
const latencies = [];
const statusCounts = new Map();
let failures = 0;

async function oneRequest() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = performance.now();
  try {
    const response = await fetch(url, { method: "GET", signal: controller.signal, headers: { Accept: "application/json" } });
    const elapsed = Math.round(performance.now() - started);
    latencies.push(elapsed);
    statusCounts.set(String(response.status), (statusCounts.get(String(response.status)) || 0) + 1);
    if (!response.ok) failures += 1;
  } catch {
    const elapsed = Math.round(performance.now() - started);
    latencies.push(elapsed);
    statusCounts.set("network_error", (statusCounts.get("network_error") || 0) + 1);
    failures += 1;
  } finally {
    clearTimeout(timer);
  }
}

async function worker() {
  while (Date.now() < deadline) await oneRequest();
}

await Promise.all(Array.from({ length: concurrency }, worker));
latencies.sort((a, b) => a - b);
const total = latencies.length;
const percentile = (value) => total ? latencies[Math.min(total - 1, Math.max(0, Math.ceil(total * value) - 1))] : 0;
const result = {
  target: url,
  durationSeconds,
  concurrency,
  totalRequests: total,
  requestsPerSecond: Number((total / durationSeconds).toFixed(2)),
  failures,
  errorRatePercent: total ? Number(((failures / total) * 100).toFixed(2)) : 100,
  latencyMs: { p50: percentile(0.5), p95: percentile(0.95), max: percentile(1) },
  statuses: Object.fromEntries([...statusCounts.entries()].sort(([a], [b]) => a.localeCompare(b)))
};
console.log(JSON.stringify(result, null, 2));

if (!total || failures / total > maxErrorRate || result.latencyMs.p95 > maxP95Ms) {
  console.error(`La prueba no cumple los umbrales: error <= ${maxErrorRate * 100}% y p95 <= ${maxP95Ms} ms.`);
  process.exitCode = 1;
}
