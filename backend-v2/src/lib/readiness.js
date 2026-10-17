/** Archivo: Proporciona infraestructura y utilidades compartidas para readiness. */
// Una sonda se comparte hasta que termina la operación de E/S subyacente, incluso tras un tiempo de espera.
// Los healthchecks repetidos no deben acumular consultas ilimitadas a la base durante una caída.
export function createReadinessProbe({ databaseProbe, redisProbe, redisConfigured = false, requireRedis = false, timeoutMs = 2500, cacheMs = 1000 }) {
  let pending, cached, cachedAt = 0;
  return async function readiness() {
    if (cached && Date.now() - cachedAt < cacheMs) return { ...cached, timestamp: new Date().toISOString() };
    if (!pending) {
      pending = Promise.all([
        Promise.resolve().then(databaseProbe).then(() => true, () => false),
        redisConfigured ? Promise.resolve().then(redisProbe).then(value => value === true ? "connected" : "unavailable", () => "unavailable") : Promise.resolve("not_configured")
      ]).then(([database, redis]) => ({ ok: database && (!requireRedis || redis === "connected"), database, redis }));
      pending.then(result => { cached = result; cachedAt = Date.now(); pending = null; });
    }
    let timer;
    const timeout = new Promise(resolve => { timer = setTimeout(() => resolve({ ok: false, database: false, redis: redisConfigured ? "unavailable" : "not_configured", timedOut: true }), timeoutMs); });
    try { return { ...await Promise.race([pending, timeout]), timestamp: new Date().toISOString() }; }
    finally { clearTimeout(timer); }
  };
}
