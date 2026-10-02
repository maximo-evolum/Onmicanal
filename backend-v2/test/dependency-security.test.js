import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import express from "express";
import multer from "multer";
import { Server } from "socket.io";
import { loadConfigFromFile } from "@prisma/config";
import { uploadLimits } from "../src/lib/upload-limits.js";
import { apiErrorHandler } from "../src/middleware/request-context.js";

async function serve(t, app) {
  const server = createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => {
    server.close(resolve);
    server.closeAllConnections();
  }));
  return { server, url: `http://127.0.0.1:${server.address().port}` };
}

test("Prisma 6 carga la configuración con deepmerge-ts corregido", async () => {
  const root = fileURLToPath(new URL("./fixtures/", import.meta.url));
  const result = await loadConfigFromFile({ configRoot: root, configFile: "prisma-security.config.ts" });
  assert.equal(result.error, undefined);
  assert.ok(result.config.schema.endsWith("schema.prisma"));
  assert.equal(result.config.migrations.seed, "node seed.js");
});

test("las dos ramas de glob conservan expansión de nombres de archivos", () => {
  const require = createRequire(import.meta.url);
  const fromArchiver = createRequire(require.resolve("archiver"));
  const fromUtils = createRequire(fromArchiver.resolve("archiver-utils"));
  const fromGlob = createRequire(fromUtils.resolve("glob"));
  const minimatch3 = fromGlob("minimatch");
  const fromReaddir = createRequire(fromArchiver.resolve("readdir-glob"));
  const minimatch5 = fromReaddir("minimatch");
  for (const match of [minimatch3, minimatch5]) {
    assert.equal(match("cartola.xlsx", "*.{xlsx,csv}"), true);
    assert.equal(match("cartola.exe", "*.{xlsx,csv}"), false);
  }
});

test("Express y qs procesan formularios y no contaminan prototipos", async (t) => {
  const app = express();
  app.use(express.urlencoded({ extended: true, limit: "16kb", parameterLimit: 100 }));
  app.post("/form", (req, res) => res.json({ body: req.body }));
  const { url } = await serve(t, app);
  const response = await fetch(`${url}/form`, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: "account[name]=Recaudacion&amount=1000&__proto__[polluted]=true&isBuffer=texto",
    signal: AbortSignal.timeout(5000)
  });
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.body.account.name, "Recaudacion");
  assert.equal(data.body.amount, "1000");
  assert.equal({}.polluted, undefined);
});

test("Engine.IO rechaza revisión de protocolo inválida y sigue atendiendo", async (t) => {
  const { server, url } = await serve(t, (_req, res) => res.end("ok"));
  const io = new Server(server, { transports: ["polling"] });
  t.after(() => io.close());
  const bad = await fetch(`${url}/socket.io/?EIO=999&transport=polling`, { signal: AbortSignal.timeout(5000) });
  assert.equal(bad.status, 400);
  const good = await fetch(`${url}/socket.io/?EIO=4&transport=polling`, { signal: AbortSignal.timeout(5000) });
  assert.equal(good.status, 200);
  assert.ok((await good.text()).startsWith('0{"sid":'));
});

test("cargas multipart válidas y límites de seguridad", async (t) => {
  const app = express();
  const upload = multer({ storage: multer.memoryStorage(), limits: uploadLimits({ fileSize: 32, files: 1 }) });
  app.post("/upload", upload.single("file"), (req, res) => res.json({ bytes: req.file?.size, bank: req.body.bank }));
  app.use(apiErrorHandler);
  const { url } = await serve(t, app);
  const send = (body) => fetch(`${url}/upload`, { method: "POST", body, signal: AbortSignal.timeout(5000) });
  const valid = new FormData();
  valid.set("bank", "Santander");
  valid.set("file", new Blob(["fecha;monto\n2026-01-02;100"]), "cartola.csv");
  assert.equal((await send(valid)).status, 200);

  for (const [name, fields, expectedStatus, text] of [
    ["índice desmesurado", [["items[1001]", "1"]], 400, "no está permitida"],
    ["anidación excesiva", [["a" + "[a]".repeat(9), "1"]], 400, "profunda"],
    ["nombre excesivo", [["a".repeat(101), "1"]], 400, "largo"],
    ["demasiados campos", Array.from({ length: 65 }, (_, i) => [`campo${i}`, "1"]), 413, "demasiados"],
    ["valor excesivo", [["description", "a".repeat(1024 * 1024 + 1)]], 413, "tamaño"]
  ]) {
    await t.test(name, async () => {
      const form = new FormData();
      fields.forEach(([key, value]) => form.append(key, value));
      const response = await send(form);
      assert.equal(response.status, expectedStatus);
      assert.ok((await response.json()).error.includes(text));
    });
  }
  await t.test("rechaza archivo excesivo y conserva el límite exacto", async () => {
    for (const size of [32, 33]) {
      const form = new FormData();
      form.set("file", new Blob(["a".repeat(size)]), "cartola.csv");
      const response = await send(form);
      assert.equal(response.status, size === 32 ? 200 : 413);
    }
  });
  assert.equal((await send(valid)).status, 200, "el servidor sigue disponible tras rechazar cargas");
});
