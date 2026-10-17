/** Archivo: Automatiza una tarea operativa, de calidad o mantenimiento relacionada con load test. */
import { pathToFileURL } from "node:url";
import { performance } from "node:perf_hooks";

const number = (env, key, fallback, min, max) => {
  const value = env[key] === undefined ? fallback : Number(env[key]);
  if (!Number.isFinite(value) || value < min || value > max) throw Error(`${key} debe estar entre ${min} y ${max}.`);
  return value;
};
export function loadOptions(env) {
  if (env.LOAD_TEST_CONFIRM !== "YES") throw Error("Define LOAD_TEST_CONFIRM=YES para ejecutar una prueba local controlada.");
  let url;
  try { url = new URL(env.LOAD_TEST_URL); } catch { throw Error("Define LOAD_TEST_URL con una URL local válida."); }
  if (!["127.0.0.1", "[::1]"].includes(url.hostname) || !["http:", "https:"].includes(url.protocol) || url.username || url.password || url.hash) {
    throw Error("Sólo se permiten 127.0.0.1 o [::1]. No se permite probar producción ni hosts remotos.");
  }
  if (!/^\/health(?:\/live|\/ready)?$/.test(url.pathname) && !/^\/api\/finance\//.test(url.pathname)) throw Error("Usa un healthcheck o una ruta de lectura /api/finance/.");
  return { url: url.href, concurrency: Math.floor(number(env, "LOAD_TEST_CONCURRENCY", 5, 1, 50)),
    durationSeconds: number(env, "LOAD_TEST_DURATION_SECONDS", 10, 1, 60),
    timeoutMs: number(env, "LOAD_TEST_TIMEOUT_MS", 5000, 100, 10000),
    rps: number(env, "LOAD_TEST_RPS", 20, 1, 200), maxRequests: Math.floor(number(env, "LOAD_TEST_MAX_REQUESTS", 2000, 1, 12000)),
    maxErrorRate: number(env, "LOAD_TEST_MAX_ERROR_RATE", .02, 0, 1), maxP95Ms: number(env, "LOAD_TEST_MAX_P95_MS", 2000, 1, 60000),
    token: env.LOAD_TEST_TOKEN || "" };
}

export async function runLoad(options, fetchImpl = fetch) {
  const started = performance.now(), deadline = started + options.durationSeconds * 1000;
  const latencies = [], statuses = {}; let launched = 0, failures = 0, halted = false;
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  async function worker() {
    while (!halted && performance.now() < deadline && launched < options.maxRequests) {
      const slot = launched++, due = started + slot * 1000 / options.rps;
      if (due >= deadline) break;
      await pause(Math.max(0, due - performance.now()));
      if (halted || performance.now() >= deadline) break;
      const begin = performance.now(); let status = "network_error", good = false;
      try {
        const response = await fetchImpl(options.url, { method: "GET", redirect: "manual", signal: AbortSignal.timeout(options.timeoutMs),
          headers: { Accept: "application/json", ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}) } });
        status = String(response.status); let bytes = 0;
        if (response.body) for await (const chunk of response.body) { bytes += chunk.byteLength; if (bytes > 1024 * 1024) throw Error("response_too_large"); }
        good = response.ok;
      } catch { status = "network_error"; }
      latencies.push(performance.now() - begin); statuses[status] = (statuses[status] || 0) + 1;
      if (!good) failures++;
      if (latencies.length >= 20 && failures / latencies.length > options.maxErrorRate) halted = true;
    }
  }
  await Promise.all(Array.from({ length: options.concurrency }, worker));
  const elapsedSeconds = (performance.now() - started) / 1000;
  latencies.sort((a, b) => a - b);
  const percentile = p => Math.round(latencies[Math.max(0, Math.ceil(latencies.length * p) - 1)] || 0);
  const p95 = percentile(.95), total = latencies.length, url = new URL(options.url);
  return { scope: "Prueba HTTP local. No equivale a usuarios simultáneos ni capacidad productiva.", target: url.origin + url.pathname,
    concurrency: options.concurrency, requestedRps: options.rps, elapsedSeconds: +elapsedSeconds.toFixed(3),
    totalRequests: total, requestsPerSecond: +(total / elapsedSeconds).toFixed(2), failures,
    errorRatePercent: total ? +(failures / total * 100).toFixed(2) : 100,
    latencyMs: { p50: percentile(.5), p95, p99: percentile(.99), max: percentile(1) }, statuses, stoppedEarly: halted,
    passed: Boolean(total && !halted && failures / total <= options.maxErrorRate && p95 <= options.maxP95Ms) };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { const result = await runLoad(loadOptions(process.env)); console.log(JSON.stringify(result, null, 2)); process.exitCode = result.passed ? 0 : 1; }
  catch (error) { console.error(error.message); process.exitCode = 2; }
}
