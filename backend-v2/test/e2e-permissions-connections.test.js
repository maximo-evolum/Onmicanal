import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import express from "express";
import { createRequireModule, requireRole, ROLE_GROUPS } from "../src/middleware/tenant-access.js";
import { requestContext } from "../src/middleware/request-context.js";

function request(app, { method = "GET", path, headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const payload = body ? JSON.stringify(body) : null;
      const req = http.request({
        host: "127.0.0.1",
        port: address.port,
        path,
        method,
        headers: {
          ...(payload ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) } : {}),
          ...headers
        }
      }, (res) => {
        let raw = "";
        res.on("data", (chunk) => { raw += chunk; });
        res.on("end", () => {
          server.close();
          resolve({ status: res.statusCode, headers: res.headers, body: raw ? JSON.parse(raw) : null });
        });
      });
      req.on("error", (error) => { server.close(); reject(error); });
      if (payload) req.write(payload);
      req.end();
    });
  });
}

function testIdentity(req, _res, next) {
  const role = req.headers["x-test-role"];
  if (role) {
    req.user = { id: "user-e2e", tenantId: "tenant-e2e", role };
    req.tenantId = "tenant-e2e";
    req.tenant = { id: "tenant-e2e", plan: "STARTER", industry: "GENERAL" };
  }
  next();
}

function createAccessApp({ moduleEnabled = false } = {}) {
  const app = express();
  app.use(requestContext);
  app.use(testIdentity);
  app.get("/manager", requireRole(ROLE_GROUPS.MANAGERS), (_req, res) => res.json({ ok: true }));
  app.get("/marketing", createRequireModule("marketing", {
    hasTenantModule: async () => moduleEnabled,
    ensureTenantModuleEligibility: async () => false,
    getTenantModules: async () => moduleEnabled ? ["marketing"] : ["inbox"],
    findTenant: async () => ({ id: "tenant-e2e", plan: "STARTER", industry: "GENERAL" })
  }), (_req, res) => res.json({ ok: true }));
  app.get("/reports", createRequireModule("reports", {
    hasTenantModule: async () => false,
    ensureTenantModuleEligibility: async () => false,
    getTenantModules: async () => []
  }), (_req, res) => res.json({ ok: true }));
  return app;
}

test("E2E permisos: admin y super admin conservan acceso, agente no puede administrar", async () => {
  const app = createAccessApp({ moduleEnabled: true });
  const admin = await request(app, { path: "/manager", headers: { "x-test-role": "ADMIN", "x-request-id": "e2e-admin" } });
  const agent = await request(app, { path: "/manager", headers: { "x-test-role": "AGENT" } });
  const superAdmin = await request(app, { path: "/manager", headers: { "x-test-role": "SUPER_ADMIN" } });

  assert.equal(admin.status, 200);
  assert.equal(admin.headers["x-request-id"], "e2e-admin");
  assert.equal(agent.status, 403);
  assert.equal(superAdmin.status, 200);
});

test("E2E módulos: respeta módulos habilitados, bypass de super admin y Dashboard ejecutivo", async () => {
  const blockedApp = createAccessApp({ moduleEnabled: false });
  const allowedApp = createAccessApp({ moduleEnabled: true });

  const blocked = await request(blockedApp, { path: "/marketing", headers: { "x-test-role": "ADMIN" } });
  const allowed = await request(allowedApp, { path: "/marketing", headers: { "x-test-role": "ADMIN" } });
  const superAdmin = await request(blockedApp, { path: "/marketing", headers: { "x-test-role": "SUPER_ADMIN" } });
  const reports = await request(blockedApp, { path: "/reports", headers: { "x-test-role": "ADMIN" } });

  assert.equal(blocked.status, 403);
  assert.equal(blocked.body.module, "marketing");
  assert.deepEqual(blocked.body.availableModules, ["inbox"]);
  assert.equal(allowed.status, 200);
  assert.equal(superAdmin.status, 200);
  assert.equal(reports.status, 200);
});

test("E2E conexiones: OAuth sin habilitar no revela variables técnicas al cliente", async () => {
  const originalId = process.env.GOOGLE_CLIENT_ID;
  const originalSecret = process.env.GOOGLE_CLIENT_SECRET;
  process.env.GOOGLE_CLIENT_ID = "";
  process.env.GOOGLE_CLIENT_SECRET = "";
  const { connectionsRouter } = await import("../src/routes/connections.routes.js");
  const app = express();
  app.use(express.json());
  app.use(requestContext);
  app.use(testIdentity);
  app.use("/api", connectionsRouter);

  const response = await request(app, {
    method: "POST",
    path: "/api/connections/gmail/oauth-url",
    headers: { "x-test-role": "ADMIN" }
  });

  if (originalId === undefined) delete process.env.GOOGLE_CLIENT_ID; else process.env.GOOGLE_CLIENT_ID = originalId;
  if (originalSecret === undefined) delete process.env.GOOGLE_CLIENT_SECRET; else process.env.GOOGLE_CLIENT_SECRET = originalSecret;

  assert.equal(response.status, 503);
  assert.match(response.body.error, /EVOLUM/i);
  assert.doesNotMatch(JSON.stringify(response.body), /GOOGLE_CLIENT_ID|GOOGLE_CLIENT_SECRET/i);
});
