/** Archivo: Verifica mediante pruebas automatizadas el comportamiento de nubox http.test. */
import test from "node:test";
import assert from "node:assert/strict";
import { requestNubox, nuboxEnvironment } from "../src/services/nubox-http.service.js";

const options = { baseUrl: "https://api.test-nubox.com/nbxpymapi-uat", apiKey: "FAKE_COMPANY_KEY", token: "FAKE_PARTNER_TOKEN", path: "/v1/sales?period=2026-01&page=1&size=100" };
const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

test("Nubox: headers por empresa, base de ambiente y listado vacío válido", async () => {
  const result = await requestNubox({ ...options, extraHeaders: { Authorization: "ATTACK", "X-Api-Key": "OTHER" }, fetchImpl: async (url, init) => {
    assert.equal(url, options.baseUrl + options.path); assert.equal(init.redirect, "manual");
    assert.equal(init.headers.Authorization, "Bearer FAKE_PARTNER_TOKEN"); assert.equal(init.headers["X-Api-Key"], "FAKE_COMPANY_KEY");
    return json([], 200, { "x-total-count": "0" });
  } });
  assert.deepEqual(result, { payload: [], total: 0 });
});

test("Nubox: no hace red con URL, recurso o secretos ausentes", async () => {
  for (const patch of [{ token: "" }, { token: "Bearer " }, { apiKey: "" }, { token: "x\r\ny" }, { baseUrl: "http://example.com" }, { baseUrl: "https://user:secret@example.com" }, { baseUrl: "https://example.com/?key=SECRET" }, { path: "//other.invalid/v1/sales" }, { path: "/v1/../admin" }]) {
    await assert.rejects(requestNubox({ ...options, ...patch, fetchImpl: async () => { assert.fail("No debe consultar al proveedor"); } }), e => ["CONFIGURATION", "CREDENTIALS"].includes(e.code) && !e.retryable);
  }
});

test("Nubox: rechaza redirecciones sin reenviar los secretos", async () => {
  let calls = 0;
  await assert.rejects(requestNubox({ ...options, fetchImpl: async (_url, init) => { calls++; assert.equal(init.redirect, "manual"); return new Response(null, { status: 302, headers: { location: "https://other.invalid" } }); } }), e => e.code === "REDIRECT" && !e.retryable);
  assert.equal(calls, 1);
});

test("Nubox: errores no filtran cuerpo externo, secretos ni datos de clientes", async () => {
  for (const status of [400, 401, 403, 404, 429, 500, 503]) {
    await assert.rejects(requestNubox({ ...options, fetchImpl: async () => json({ message: "FAKE_PARTNER_TOKEN CLIENTE_PRIVADO" }, status, { "retry-after": "10" }) }), e => {
      assert.doesNotMatch(e.message, /FAKE_|CLIENTE_PRIVADO/); assert.equal(e.status, status);
      assert.equal(e.retryable, status === 429 || status >= 500);
      if (status === 429) assert.equal(e.retryAfterMs, 10000);
      return true;
    });
  }
});

test("Nubox: no verifica respuestas HTML, JSON malformado o objetos sin listado", async () => {
  for (const response of [new Response("<html>Login</html>"), new Response("{"), json(null), json({ message: "ok" }), json("ok"), new Response(null, { status: 204 })]) {
    await assert.rejects(requestNubox({ ...options, fetchImpl: async () => response }), e => ["INVALID_JSON", "INVALID_SALES", "EMPTY_RESPONSE"].includes(e.code));
  }
  await assert.rejects(requestNubox({ ...options, fetchImpl: async () => json([], 200, { "x-total-count": "NaN" }) }), e => e.code === "INVALID_TOTAL");
});

test("Nubox: todos los envoltorios de listado admitidos conservan los documentos", async () => {
  for (const key of ["content", "items", "data", "results"]) {
    const result = await requestNubox({ ...options, fetchImpl: async () => json({ [key]: [{ id: "sale-1" }] }) });
    assert.equal(result.payload[key][0].id, "sale-1");
  }
});

test("Nubox: límite de tamaño comprobado con y sin Content-Length", async () => {
  for (const headers of [{}, { "content-length": "500" }]) {
    await assert.rejects(requestNubox({ ...options, maxBytes: 10, fetchImpl: async () => json([{ id: "larger-than-limit" }], 200, headers) }), e => e.code === "RESPONSE_TOO_LARGE");
  }
});

test("Nubox: tiempo de espera y fallo de red tienen diagnóstico seguro", async () => {
  await assert.rejects(requestNubox({ ...options, timeoutMs: 10, fetchImpl: async (_url, { signal }) => new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(Error("SECRET_TIMEOUT")), { once: true })) }), e => e.code === "TIMEOUT" && e.retryable && !e.message.includes("SECRET"));
  await assert.rejects(requestNubox({ ...options, fetchImpl: async () => { throw Error("FAKE_PARTNER_TOKEN"); } }), e => e.code === "NETWORK" && !e.message.includes("FAKE"));
});

test("Nubox: descarga valida contenido PDF/XML y rechaza HTML de acceso", async () => {
  for (const [format, body, mime] of [["pdf", "%PDF-1.7 demo", "application/pdf"], ["xml", '<?xml version="1.0"?><DTE/>', "application/xml"]]) {
    const result = await requestNubox({ ...options, path: `/v1/sales/doc_1/${format}${format === "pdf" ? "?template=TEMPLATE_A4" : ""}`, responseType: "binary", fetchImpl: async (_url, init) => { assert.equal(init.headers.Accept, mime); return new Response(body); } });
    assert.equal(result.contentType, mime); assert.equal(result.payload.toString(), body);
    await assert.rejects(requestNubox({ ...options, path: `/v1/sales/doc_1/${format}`, responseType: "binary", fetchImpl: async () => new Response("<html>Acceso</html>") }), e => e.code === "INVALID_FILE");
  }
});

test("Nubox: una emisión fallida no es reintentable automáticamente", async () => {
  let calls = 0;
  await assert.rejects(requestNubox({ ...options, method: "POST", path: "/v1/sales/issuance", body: [{ document: "demo" }], extraHeaders: { "X-Idempotence-Id": "demo-000000000001" }, fetchImpl: async (_url, init) => {
    calls++; assert.equal(init.headers["X-Idempotence-Id"], "demo-000000000001"); assert.equal(init.body, '[{"document":"demo"}]');
    return json({}, 503);
  } }), e => !e.retryable);
  assert.equal(calls, 1);
});

test("Nubox: ambiente no expone la URL ni supone producción para otro host", () => {
  assert.equal(nuboxEnvironment(options.baseUrl), "CERTIFICATION");
  assert.equal(nuboxEnvironment("https://api.pyme.nubox.com/nbxpymapi-environment-pyme"), "PRODUCTION");
  assert.equal(nuboxEnvironment("https://another-provider.invalid"), "UNCONFIRMED");
});
