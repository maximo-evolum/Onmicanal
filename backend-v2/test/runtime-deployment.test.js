/** Archivo: Verifica mediante pruebas automatizadas el comportamiento de runtime deployment.test. */
import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import express from "express";
import { Server as SocketServer } from "socket.io";
import { createRuntimeLifecycle, closeHttpServer } from "../src/lib/runtime-lifecycle.js";
import { createReadinessProbe } from "../src/lib/readiness.js";
import { loadOptions, runLoad } from "../scripts/load-test.mjs";
import { basicRateLimit } from "../src/middleware/rate-limit.js";

test("healthchecks: no consumen cuota ni dependen de Redis en el limitador", async () => {
  const middleware = basicRateLimit({ max: 0 });
  for (const path of ["/health", "/api/health", "/health/live", "/health/ready"]) {
    let continued = 0;
    await middleware({ method: "GET", path }, {}, () => { continued++; });
    assert.equal(continued, 1);
  }
});

test("apagado: espera HTTP y trabajos antes de cerrar recursos, señales idempotentes", async () => {
  const calls = []; let finish;
  const life = createRuntimeLifecycle({ timeoutMs: 500, exit: code => calls.push(`exit:${code}`), log: () => {} });
  const job = life.run("job", () => new Promise(resolve => { finish = resolve; })); await Promise.resolve();
  assert.deepEqual(await life.run("job", () => assert.fail()), { skipped: true });
  life.onStop(() => calls.push("stop"));
  const shutdown = life.shutdown({ signal: "SIGTERM", closeHttp: async () => calls.push("http"), closeResources: async () => calls.push("resources") });
  assert.equal(life.draining, true); assert.equal(life.shutdown({}), shutdown);
  assert.deepEqual(await life.run("late", () => assert.fail()), { skipped: true });
  assert.ok(!calls.includes("resources")); finish(); await job; await shutdown;
  assert.deepEqual(calls, ["stop", "http", "resources", "exit:0"]);
});

test("apagado: plazo agotado o fallo nunca anuncian cierre limpio", async () => {
  for (const closeHttp of [() => new Promise(() => {}), async () => { throw Error("PRIVATE"); }]) {
    let code, resources = false; const life = createRuntimeLifecycle({ timeoutMs: 10, exit: c => { code = c; }, log: () => {} });
    await life.shutdown({ signal: "SIGTERM", closeHttp, closeResources: async () => { resources = true; } });
    assert.equal(code, 1); assert.equal(resources, false);
  }
});

test("readiness: comprueba Redis requerido, fallos y caché", async () => {
  let reads = 0;
  const probe = createReadinessProbe({ databaseProbe: async () => { reads++; }, redisConfigured: true, redisProbe: async () => false, requireRedis: true });
  assert.equal((await probe()).ok, false); assert.equal((await probe()).redis, "unavailable"); assert.equal(reads, 1);
  assert.equal((await createReadinessProbe({ databaseProbe: async () => {}, requireRedis: true })()).ok, false);
  assert.equal((await createReadinessProbe({ databaseProbe: async () => {}, redisConfigured: true, redisProbe: async () => true, requireRedis: true })()).ok, true);
});

test("readiness: dependencia colgada no acumula consultas y responde acotado", async () => {
  let calls = 0;
  const probe = createReadinessProbe({ databaseProbe: () => { calls++; return new Promise(() => {}); }, timeoutMs: 10 });
  const results = await Promise.all(Array.from({ length: 10 }, () => probe()));
  assert.ok(results.every(r => !r.ok && r.timedOut)); await probe(); assert.equal(calls, 1);
});

test("carga: producción, credenciales en URL y parámetros inválidos se rechazan", () => {
  for (const url of ["https://onmicanal-backend-v2.up.railway.app/health/live", "http://localhost/health/live", "http://user:pass@127.0.0.1/health/live", "http://127.0.0.1/api/payments"]) assert.throws(() => loadOptions({ LOAD_TEST_CONFIRM: "YES", LOAD_TEST_URL: url }));
  assert.throws(() => loadOptions({ LOAD_TEST_CONFIRM: "YES", LOAD_TEST_URL: "http://127.0.0.1/health/live", LOAD_TEST_MAX_ERROR_RATE: "NaN" }));
});

test("HTTP: mide cuerpo completo, no sigue redirects y no filtra token", async t => {
  const server = createServer((_req, res) => { res.writeHead(200); res.write('{"ok":'); setTimeout(() => res.end('true}'), 20); });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const options = loadOptions({ LOAD_TEST_CONFIRM: "YES", LOAD_TEST_URL: `http://127.0.0.1:${server.address().port}/health/ready`, LOAD_TEST_MAX_REQUESTS: "4", LOAD_TEST_RPS: "100", LOAD_TEST_TOKEN: "TEST_PRIVATE" });
  const result = await runLoad(options); assert.equal(result.totalRequests, 4); assert.equal(result.passed, true); assert.ok(result.latencyMs.p50 >= 15); assert.doesNotMatch(JSON.stringify(result), /TEST_PRIVATE/);
  const redirect = await runLoad(options, async (_url, init) => { assert.equal(init.redirect, "manual"); return new Response(null, { status: 302 }); });
  assert.equal(redirect.failures, 4); assert.equal(redirect.passed, false);
});

test("HTTP: al drenar rechaza nuevas operaciones y mantiene liveness", async t => {
  let finish;
  const life = createRuntimeLifecycle({ timeoutMs: 1000, exit: () => {}, log: () => {} });
  const app = express(); app.use(life.middleware); app.get("/health/live", (_req, res) => res.json({ ok: true }));
  const server = app.listen(0, "127.0.0.1"); await new Promise(resolve => server.on("listening", resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const shutdown = life.shutdown({ signal: "SIGTERM", closeHttp: () => new Promise(resolve => { finish = resolve; }), closeResources: async () => {} });
  const base = `http://127.0.0.1:${server.address().port}`;
  const response = await fetch(base + "/api/finance/overview"); assert.equal(response.status, 503); assert.equal(response.headers.get("retry-after"), "5");
  assert.equal((await fetch(base + "/health/ready")).status, 503); assert.equal((await fetch(base + "/health/live")).status, 200);
  finish(); await shutdown;
});

test("despliegue: Socket.IO cierra HTTP sin interrumpir una respuesta aceptada", async t => {
  let accepted, finish;
  const arrived = new Promise(resolve => { accepted = resolve; });
  const app = express();
  app.get("/work", (_req, res) => { finish = () => res.json({ saved: true }); accepted(); });
  const server = createServer(app), io = new SocketServer(server);
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const response = fetch(`http://127.0.0.1:${server.address().port}/work`).then(res => res.json());
  await arrived;
  let resourcesClosed = false, exitCode;
  const life = createRuntimeLifecycle({ timeoutMs: 2000, log: () => {}, exit: code => { exitCode = code; } });
  const shutdown = life.shutdown({ signal: "SIGTERM", closeHttp: () => closeHttpServer(server, io),
    closeResources: async () => { resourcesClosed = true; } });
  await new Promise(resolve => setTimeout(resolve, 25));
  assert.equal(resourcesClosed, false);
  finish();
  assert.deepEqual(await response, { saved: true });
  await shutdown; assert.equal(resourcesClosed, true); assert.equal(exitCode, 0);
});
