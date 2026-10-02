import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createServer } from "node:http";
import { buildFinanceConnectionHealth, readFinanceConnectionHealth, editableConnectionMetadata, FINANCE_CONNECTION_SOURCES } from "../src/services/finance-connection-health.service.js";
import { MODULES } from "../src/lib/modules.js";
import { prisma } from "../src/lib/db.js";
import { financeRouter } from "../src/routes/finance.routes.js";

const now = new Date("2026-09-24T12:00:00Z"), recent = "2026-09-24T11:00:00Z";
const modules = [...new Set(FINANCE_CONNECTION_SOURCES.map((s) => s.module))];
const config = (metadata = {}, patch = {}) => ({ tenantId: "a", channel: "finance_nubox", isActive: true, updatedAt: recent, metadata, ...patch });
const health = (configs = [], options = {}) => buildFinanceConnectionHealth({ tenantId: "a", configs, now, allowedModules: modules, ...options });
const nubox = (m = {}, patch = {}) => health([config(m, patch)]).items.find((s) => s.key === "finance_nubox");

test("estado: no inventa conexiones ni infiere conectividad desde credenciales", () => {
  assert.equal(health().items.find((s) => s.key === "finance_nubox").status, "NOT_CONFIGURED");
  assert.equal(nubox({}, { accessToken: "secret", verifyToken: "secret" }).status, "CONFIGURED");
  assert.equal(nubox({ lastTestStatus: "OK" }).status, "CONFIGURED");
});
test("estado: prueba reciente, antigua, fallida y desactivada", () => {
  assert.equal(nubox({ lastTestStatus: "OK", lastTestedAt: recent }).status, "VERIFIED");
  assert.equal(nubox({ lastTestStatus: "OK", lastTestedAt: "2026-09-22T12:00:00Z" }).status, "STALE");
  assert.equal(nubox({ lastTestStatus: "ERROR", lastTestedAt: recent }).status, "ERROR");
  assert.equal(nubox({ lastTestStatus: "ERROR" }).status, "ERROR");
  assert.equal(nubox({ lastTestStatus: "OK", lastTestedAt: recent }, { isActive: false }).status, "DISCONNECTED");
});
test("estado: fechas inválidas o futuras no acreditan conectividad", () => {
  for (const lastTestedAt of ["incorrecta", "2027-01-01", null]) assert.equal(nubox({ lastTestStatus: "OK", lastTestedAt }).status, "CONFIGURED");
});
test("estado: nueva configuración invalida pruebas y sincronizaciones previas", () => {
  const r = nubox({ lastTestStatus: "OK", lastTestedAt: recent, lastSyncedAt: recent, connectionConfigChangedAt: "2026-09-24T11:30:00Z" });
  assert.equal(r.status, "CONFIGURED"); assert.equal(r.lastSuccessAt, null);
  assert.equal(nubox({ lastTestStatus: "PENDING", lastSyncedAt: recent }).status, "CONFIGURED");
});
test("estado: sincronización exitosa respalda acceso, pero fallo posterior no queda verde", () => {
  const r = nubox({ lastTestStatus: "ERROR", lastTestedAt: "2026-09-24T10:00:00Z", lastSyncedAt: recent, lastSyncStatus: "OK", lastSyncCompletedAt: recent, lastSyncPeriod: "2026-01" });
  assert.equal(r.status, "VERIFIED"); assert.equal(r.sync.period, "2026-01");
  assert.equal(nubox({ lastTestStatus: "OK", lastTestedAt: recent, lastSyncStatus: "ERROR", lastSyncCompletedAt: recent }).status, "ERROR");
});
test("estado: ejecución en curso y ejecución detenida se distinguen", () => {
  assert.equal(nubox({ lastSyncStatus: "RUNNING", lastSyncStartedAt: "2026-09-24T11:50:00Z" }).status, "SYNCING");
  assert.equal(nubox({ lastSyncStatus: "RUNNING", lastSyncStartedAt: recent }).status, "SYNC_STALLED");
  assert.equal(nubox({ lastSyncStatus: "RUNNING" }).status, "SYNC_STALLED");
  assert.equal(nubox({ lastSyncStatus: "RUNNING", lastSyncStartedAt: recent, connectionConfigChangedAt: "2026-09-24T11:30:00Z" }).status, "CONFIGURED");
});
test("estado: vencimiento OAuth no se confunde con garantía de renovación", () => {
  const r = health([config({ lastTestStatus: "OK", lastTestedAt: recent, oauthExpiresAt: recent, hasRefreshToken: true }, { channel: "gmail" })]).items.find((s) => s.key === "gmail");
  assert.equal(r.status, "EXPIRED"); assert.match(r.note, /renovación/);
});
test("estado: validación de campos de servicios sin prueba remota no significa conectado", () => {
  for (const channel of ["email_imap", "webpay"]) assert.equal(health([config({ lastTestStatus: "OK", lastTestedAt: recent }, { channel })]).items.find((s) => s.key === channel).status, "CONFIGURED");
  for (const channel of ["finance_sii", "finance_open_banking"]) assert.equal(health([config({ lastTestStatus: "OK", lastTestedAt: recent }, { channel })]).items.find((s) => s.key === channel).status, "PENDING_AUTH");
});
test("estado: manual y próximas conexiones nunca aparecen verificadas por API", () => {
  assert.equal(health().items.find((s) => s.key === "finance_bank_statements").status, "MANUAL");
  assert.equal(health().items.find((s) => s.key === "finance_defontana").status, "COMING_SOON");
});
test("estado: reconoce WhatsApp histórico y no revive un alias desactivado más reciente", () => {
  let items = health([config({ lastTestStatus: "OK", lastTestedAt: recent }, { channel: "whatsapp" })]).items;
  assert.equal(items.find((s) => s.key === "meta_whatsapp").status, "VERIFIED");
  items = health([config({ lastTestStatus: "OK", lastTestedAt: recent }, { channel: "whatsapp" }), config({}, { channel: "meta_whatsapp", updatedAt: "2026-09-24T11:30:00Z", isActive: false })]).items;
  assert.equal(items.find((s) => s.key === "meta_whatsapp").status, "DISCONNECTED");
});
test("estado: permisos y tenant filtran tanto conexiones como consentimientos", () => {
  const out = health([config({ lastTestStatus: "OK", lastTestedAt: recent }, { tenantId: "b" })], { allowedModules: [MODULES.FINANCE_BANK_SYNC], consents: [{ tenantId: "b", recordType: "finance_open_banking_consent", status: "SYNCED", data: { lastSyncAt: recent } }] });
  assert.equal(out.items.length, 2); assert.equal(out.items.find((s) => s.key === "finance_open_banking").banking.total, 0);
});
test("estado: lote bancario recibido no es consentimiento continuo ni conexión habilitada", () => {
  const r = health([config({}, { channel: "finance_open_banking" })], { consents: [{ tenantId: "a", recordType: "finance_open_banking_consent", status: "SYNCED", data: { lastSyncAt: recent } }] }).items.find((s) => s.key === "finance_open_banking");
  assert.equal(r.banking.received, 1); assert.equal(r.banking.lastReceivedAt, recent.replace("Z", ".000Z")); assert.equal(r.status, "PENDING_AUTH");
});
test("estado: no exporta mensajes crudos, tokens, identificadores de cuenta o configuración", () => {
  const r = health([config({ lastTestStatus: "ERROR", lastTestedAt: recent, lastTestMessage: "Bearer SECRET", lastSyncError: "https://secret.invalid", companyRut: "PRIVADO", bankAccounts: [{ accountNumber: "12345678" }] }, { accessToken: "SECRET" })]);
  assert.doesNotMatch(JSON.stringify(r), /SECRET|PRIVADO|12345678|secret.invalid/);
});
test("estado: campos de verificación no se aceptan desde formularios", () => {
  assert.deepEqual(editableConnectionMetadata({ lastTestStatus: "OK", lastSyncStatus: "OK", lastSyncedAt: recent, connectionConfigChangedAt: recent, oauthExpiresAt: recent, host: "mail.test", companyRut: "demo" }), { host: "mail.test", companyRut: "demo" });
});
test("estado: lectura usa empresa, proyección sin credenciales y todos los consentimientos", async () => {
  let calls = 0;
  const db = { tenantChannelConfig: { findMany: async (q) => { assert.equal(q.where.tenantId, "a"); assert.ok(!q.select.accessToken); assert.ok(!q.select.verifyToken); return []; } }, industryRecord: { findMany: async (q) => { assert.equal(q.where.tenantId, "a"); const start = q.cursor ? Number(q.cursor.id) + 1 : 0; calls++; return Array.from({ length: Math.min(500, 1001 - start) }, (_, i) => ({ id: String(start + i), tenantId: "a", recordType: "finance_open_banking_consent", status: "PENDING", data: {} })); } } };
  const out = await readFinanceConnectionHealth(db, { tenantId: "a", now, allowedModules: modules }); assert.equal(calls, 3); assert.equal(out.items.find((s) => s.key === "finance_open_banking").banking.total, 1001);
  await assert.rejects(readFinanceConnectionHealth({}, { allowedModules: [] }), (e) => e.status === 401);
});
test("HTTP: snapshot aislado, módulo deshabilitado y error de consulta sin secretos", async (t) => {
  const old = { configs: prisma.tenantChannelConfig.findMany, modules: prisma.tenantModule.findMany, records: prisma.industryRecord.findMany };
  let allowed = true, failed = false;
  prisma.tenantModule.findMany = async ({ where }) => where.module.in.map((module) => ({ module, enabled: allowed && [MODULES.FINANCE_ANALYTICS, MODULES.FINANCE_INVOICES].includes(module), source: "MANUAL" }));
  prisma.tenantChannelConfig.findMany = async ({ where }) => { if (failed) throw Error("SECRET"); return where.tenantId === "a" ? [config({ lastTestStatus: "OK", lastTestedAt: new Date().toISOString() })] : []; };
  prisma.industryRecord.findMany = async () => [];
  t.after(() => { prisma.tenantChannelConfig.findMany = old.configs; prisma.tenantModule.findMany = old.modules; prisma.industryRecord.findMany = old.records; });
const app = express(); app.use((req, _res, next) => { req.tenantId = req.headers["x-tenant"] || "a"; req.tenant = { id: req.tenantId, industry: "FINANCE" }; req.user = { tenantId: req.tenantId, id: "user", role: req.headers["x-role"] || "ADMIN" }; next(); }); app.use(financeRouter);
  const server = createServer(app); await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve)); t.after(() => { server.closeAllConnections(); server.close(); });
  const call = (headers = {}) => fetch(`http://127.0.0.1:${server.address().port}/finance/connection-health?tenantId=b&period=2020-01`, { headers, signal: AbortSignal.timeout(5000) });
  const response = await call(); assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "no-store"); const body = await response.json(); assert.equal(body.items.find((s) => s.key === "finance_nubox").status, "VERIFIED"); assert.ok(body.items.every((s) => s.key.startsWith("finance_"))); assert.equal(body.canManage, false);
  assert.equal((await (await call({ "x-tenant": "b" })).json()).items.find((s) => s.key === "finance_nubox").status, "NOT_CONFIGURED");
  assert.equal((await call({ "x-role": "VIEWER" })).status, 200);
  allowed = false; assert.equal((await call()).status, 403); allowed = true;
  failed = true; const failure = await call(); assert.equal(failure.status, 503); assert.doesNotMatch(await failure.text(), /SECRET/);
});
