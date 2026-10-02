import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { previewCollectionDelivery, sendCollectionDelivery, listCollectionDeliveries } from "../src/services/finance-collection-delivery.service.js";
import { collectionRecipient, prepareCollectionTransport, dispatchCollectionMessage } from "../src/services/finance-collection-transport.service.js";
import { canPerformFinanceAction, FINANCE_ACTIONS } from "../src/services/finance-security.service.js";
import express from "express";
import { createServer } from "node:http";
import { financeRouter } from "../src/routes/finance.routes.js";
import { prisma } from "../src/lib/db.js";
import { MODULES } from "../src/lib/modules.js";

const now = new Date("2026-09-25T15:00:00Z");
const ctx = { tenantId: "a", userId: "admin", role: "ADMIN", now };
const input = { caseId: "case", channel: "gmail", recipient: "cliente@example.test", consentConfirmed: true, consentNote: "Autorización del cliente registrada en el contrato." };
const transport = { channel: "gmail", sender: "empresa@example.test", configId: "config", token: "private-test-token" };
const deps = { prepare: async () => transport, dispatch: async () => ({ status: "ACCEPTED", providerMessageId: "provider-1", detail: "Aceptado, entrega no confirmada." }) };
function database() {
  let rows = [
    { id: "invoice", tenantId: "a", recordType: "finance_invoice", title: "Factura 25", status: "OPEN", data: { amount: 10000, balance: 10000, currency: "CLP", customerName: "Cliente de prueba", customerRut: "11111111-1", invoiceNumber: "25", issueDate: "2026-09-01", dueDate: "2026-09-20" } },
    { id: "case", tenantId: "a", recordType: "finance_collection_case", status: "PENDING", title: "Cobranza 25", data: { invoiceId: "invoice", workflowVersion: 0 } }
  ], audits = [], controls = [], seq = 0, tail = Promise.resolve();
  const configs = [{ id: "config", tenantId: "a", isActive: true, channel: "gmail", accessToken: "private-test-token", metadata: { oauthExpiresAt: "2099-01-01" } }];
  const matches = (r, w) => Object.entries(w || {}).every(([k, v]) => v?.in ? v.in.includes(r[k]) : v?.path ? v.path.reduce((x, p) => x?.[p], r[k]) === v.equals : r[k] === v);
  const db = {
    get rows() { return rows; }, get audits() { return audits; }, configs, controls,
    $transaction: (fn, options) => {
      assert.equal(options.isolationLevel, "Serializable");
      const p = tail.then(async () => { const before = structuredClone({ rows, audits }); try { return await fn(db); } catch (e) { ({ rows, audits } = before); throw e; } }); tail = p.catch(() => {}); return p;
    },
    industryRecord: {
      findFirst: async ({ where }) => structuredClone(rows.find((r) => matches(r, where)) || null),
      findMany: async ({ where, cursor, skip = 0, take = 500 }) => { const list = rows.filter((r) => matches(r, where)); return structuredClone(list.slice(cursor ? list.findIndex((r) => r.id === cursor.id) + skip : 0, (cursor ? list.findIndex((r) => r.id === cursor.id) + skip : 0) + take)); },
      create: async ({ data }) => { const row = { id: `r${++seq}`, createdAt: now, ...structuredClone(data) }; rows.push(row); return structuredClone(row); },
      update: async ({ where, data }) => { const row = rows.find((r) => matches(r, where)); assert.ok(row); Object.assign(row, structuredClone(data)); return structuredClone(row); },
      updateMany: async ({ where, data }) => { const list = rows.filter((r) => matches(r, where)); for (const row of list) Object.assign(row, structuredClone(data)); return { count: list.length }; }
    },
    tenantChannelConfig: {
      findFirst: async ({ where }) => structuredClone(configs.find((r) => matches(r, where)) || null),
      updateMany: async ({ where, data }) => { const list = configs.filter((r) => matches(r, where)); list.forEach((r) => Object.assign(r, data)); return { count: list.length }; }
    },
    financePeriodControl: { upsert: async ({ where, create }) => controls.find((r) => matches(r, where.tenantId_period)) || create },
    tenantAuditLog: { create: async ({ data }) => { audits.push(data); return data; } }
  }; return db;
}
const preview = (db, changes = {}, extra = {}) => previewCollectionDelivery(db, { ...ctx, ...extra, input: { ...input, ...changes } }, deps);
const send = (db, p, extra = {}, dependencies = deps) => sendCollectionDelivery(db, { ...ctx, id: p.id, input: { approved: true, previewHash: p.previewHash }, ...extra }, dependencies);
const rejects = (p, status) => assert.rejects(p, (e) => e.status === status);

test("vista previa realista en español no envía y no expone credenciales", async () => {
  const db = database(), p = await preview(db);
  assert.equal(p.status, "DRAFT"); assert.match(p.body, /10\.000 CLP/); assert.match(p.body, /Cliente de prueba/);
  assert.equal(JSON.stringify(p).includes("private-test-token"), false); assert.equal(db.rows.length, 3); assert.equal(db.audits.length, 1);
});
test("aprobación envía una vez y conserva documento sin registrar pago", async () => {
  const db = database(), invoice = structuredClone(db.rows[0]), p = await preview(db); let calls = 0;
  const d = { ...deps, dispatch: async (...args) => { calls++; return deps.dispatch(...args); } };
  assert.equal((await send(db, p, {}, d)).status, "ACCEPTED");
  assert.equal((await send(db, p, {}, d)).status, "ACCEPTED");
  assert.equal(calls, 1); assert.deepEqual(db.rows[0], invoice);
  assert.equal(db.rows[1].data.history[0].type, "DELIVERY_ACCEPTED"); assert.equal(db.audits.length, 3);
});
test("dos clics simultáneos no duplican el POST al proveedor", async () => {
  const db = database(), p = await preview(db); let calls = 0;
  const d = { ...deps, dispatch: async () => { calls++; await new Promise((r) => setTimeout(r, 10)); return deps.dispatch(); } };
  await Promise.all([send(db, p, {}, d), send(db, p, {}, d)]); assert.equal(calls, 1);
});
test("dos borradores no permiten dos envíos para la misma deuda", async () => {
  const db = database(), p = await preview(db), q = await preview(db); let calls = 0;
  const d = { ...deps, dispatch: async () => { calls++; return deps.dispatch(); } };
  const results = await Promise.allSettled([send(db, p, {}, d), send(db, q, {}, d)]);
  assert.equal(calls, 1); assert.equal(results.filter((r) => r.status === "rejected").length, 1);
});
test("saldo cambiado obliga a generar y aprobar otra vista previa", async () => { const db = database(), p = await preview(db); db.rows[0].data.balance = 5000; await rejects(send(db, p), 409); });
test("no envía deuda saldada luego de preparar", async () => { const db = database(), p = await preview(db); db.rows[0].data.balance = 0; await rejects(send(db, p), 409); });
test("no acepta aprobación omitida o hash alterado", async () => { const db = database(), p = await preview(db); await rejects(send(db, p, { input: { approved: false } }), 422); await rejects(send(db, p, { input: { approved: true, previewHash: "forged" } }), 409); });
test("vista previa vence a los quince minutos", async () => { const db = database(), p = await preview(db); await rejects(send(db, p, { now: new Date(now.getTime() + 900001) }), 409); });
test("aislamiento de empresa en preparar enviar e historial", async () => { const db = database(), p = await preview(db); await rejects(preview(db, {}, { tenantId: "other" }), 404); await rejects(send(db, p, { tenantId: "other" }), 404); await rejects(listCollectionDeliveries(db, { ...ctx, tenantId: "other", caseId: "case" }), 404); });
test("agentes pueden preparar pero solo administradores envían", async () => { const db = database(), p = await preview(db, {}, { role: "AGENT" }); await rejects(send(db, p, { role: "AGENT" }), 403); await rejects(preview(db, {}, { role: "VIEWER" }), 403); assert.equal(canPerformFinanceAction("SUPER_ADMIN", FINANCE_ACTIONS.SEND_COLLECTION), true); });
test("consentimiento explícito, destinatario seguro y respaldo son obligatorios", async () => { const db = database(); await rejects(preview(db, { consentConfirmed: false }), 422); await rejects(preview(db, { consentNote: "sí" }), 422); await rejects(preview(db, { recipient: "cliente@test.cl\r\nBcc: otro@test.cl" }), 422); });
for (const field of ["contactOptOut", "doNotContact"]) test(`revocación ${field} bloquea incluso después del borrador`, async () => { const db = database(), p = await preview(db); db.rows[0].data[field] = true; await rejects(send(db, p), 409); });
for (const changes of [{ demoOnly: true }, { documentSide: "SUPPLIER" }, { currency: "USD" }, { dueDate: "2026-02-30" }]) test(`bloquea documentos no aptos ${JSON.stringify(changes)}`, async () => { const db = database(); Object.assign(db.rows[0].data, changes); await rejects(preview(db), 409); });
test("respeta período operativo cerrado", async () => { const db = database(), p = await preview(db); db.controls.push({ tenantId: "a", period: "2026-09", status: "CLOSED" }); await rejects(send(db, p), 409); });
test("canal desconectado no usa credenciales globales", async () => { const db = database(), p = await preview(db); db.configs[0].isActive = false; await rejects(send(db, p), 409); await rejects(prepareCollectionTransport(db, { tenantId: "a", channel: "gmail" }, async () => { throw Error("no fetch"); }), 409); });
test("timeout persiste UNKNOWN y bloquea reenvío aunque se prepare otro borrador", async () => {
  const db = database(), p = await preview(db); let calls = 0;
  const d = { ...deps, dispatch: async () => { calls++; throw Error("secret payload"); } };
  assert.equal((await send(db, p, {}, d)).status, "UNKNOWN"); await send(db, p, {}, d);
  const q = await preview(db); await rejects(send(db, q), 409); assert.equal(calls, 1);
});
test("fallo de persistencia luego del envío conserva SENDING y nunca reenvía", async () => {
  const db = database(), p = await preview(db); let calls = 0;
  const update = db.industryRecord.update;
  db.industryRecord.update = async () => { throw Error("database down"); };
  const d = { ...deps, dispatch: async () => { calls++; return deps.dispatch(); } };
  await assert.rejects(send(db, p, {}, d)); db.industryRecord.update = update;
  assert.equal((await send(db, p, {}, d)).status, "SENDING"); assert.equal(calls, 1);
});
test("rechazo se registra sin declararlo enviado y permite otra preparación", async () => {
  const db = database(), p = await preview(db);
  const rejected = await send(db, p, {}, { ...deps, dispatch: async () => ({ status: "REJECTED", detail: "Permiso insuficiente" }) }); assert.equal(rejected.status, "REJECTED");
  const q = await preview(db); assert.equal((await send(db, q)).status, "ACCEPTED");
});
test("Gmail genera MIME UTF8 base64url con único destinatario y sin reintentos", async () => {
  let calls = 0;
  const result = await dispatchCollectionMessage(transport, { id: "r1", recipient: input.recipient, subject: "Cobranza válida", body: "Saldo $10.000 y atención" }, async (url, opts) => {
    calls++; assert.equal(url, "https://gmail.googleapis.com/gmail/v1/users/me/messages/send");
    const mime = Buffer.from(JSON.parse(opts.body).raw, "base64url").toString(); assert.match(mime, /To: cliente@example.test/); assert.doesNotMatch(mime, /Bcc:/); assert.match(mime, /Subject: =\?UTF-8\?B\?/);
    return { ok: true, status: 200, json: async () => ({ id: "gmail-1" }) };
  }); assert.equal(calls, 1); assert.equal(result.status, "ACCEPTED");
});
for (const status of [400, 401, 403, 429, 500, 502, 408]) test(`respuesta HTTP ${status} sin reintento ni exposición de secretos`, async () => {
  let calls = 0; const result = await dispatchCollectionMessage(transport, { id: "r1", recipient: input.recipient, subject: "Aviso", body: "Saldo" }, async () => { calls++; return { ok: false, status, json: async () => ({ error: "secret-token" }) }; });
  assert.equal(result.status, status < 500 && status !== 408 ? "REJECTED" : "UNKNOWN"); assert.equal(calls, 1); assert.equal(JSON.stringify(result).includes("secret-token"), false);
});
test("HTTP OK sin identificador no confirma envío", async () => { const r = await dispatchCollectionMessage(transport, { id: "r1", recipient: input.recipient, subject: "Aviso", body: "Saldo" }, async () => ({ ok: true, json: async () => ({}) })); assert.equal(r.status, "UNKNOWN"); });
test("preflight Gmail verifica remitente sin enviar", async () => { const db = database(); let calls = 0; const r = await prepareCollectionTransport(db, { tenantId: "a", channel: "gmail" }, async (url) => { calls++; assert.match(url, /\/profile$/); return { ok: true, json: async () => ({ emailAddress: "empresa@example.test" }) }; }); assert.equal(r.sender, "empresa@example.test"); assert.equal(calls, 1); });
test("WhatsApp exige y verifica plantilla aprobada con sus cuatro variables", async () => {
  const db = database(); Object.assign(db.configs[0], { channel: "whatsapp", phoneNumberId: "123", businessAccountId: "456" });
  const template = { name: "cobranza", language: "es", status: "APPROVED", components: [{ type: "BODY", text: "Hola {{1}} documento {{2}} saldo {{3}} vence {{4}}" }] };
  const fetcher = async () => ({ ok: true, json: async () => ({ data: [template] }) });
  const r = await prepareCollectionTransport(db, { tenantId: "a", channel: "whatsapp", templateName: "cobranza" }, fetcher); assert.match(r.templateBody, /Hola/);
  template.status = "PENDING"; await rejects(prepareCollectionTransport(db, { tenantId: "a", channel: "whatsapp", templateName: "cobranza" }, fetcher), 409);
  assert.equal(collectionRecipient("whatsapp", "+56912345678"), "+56912345678");
});
test("WhatsApp envía plantilla, no texto libre ni token compartido", async () => {
  const result = await dispatchCollectionMessage({ ...transport, channel: "whatsapp", sender: "123", templateName: "cobranza", language: "es" }, { recipient: "+56912345678", parameters: ["Ana", "25", "$10.000 CLP", "2026-09-20"] }, async (url, opts) => {
    assert.equal(url, "https://graph.facebook.com/v23.0/123/messages"); const p = JSON.parse(opts.body); assert.equal(p.type, "template"); assert.equal(p.template.components[0].parameters.length, 4); return { ok: true, json: async () => ({ messages: [{ id: "wamid.test" }] }) };
  }); assert.equal(result.status, "ACCEPTED");
});
test("la cola offline y la API genérica no permiten saltar las acciones de envío", () => {
  const offline = readFileSync(new URL("../../frontend/lib/offline-queue.ts", import.meta.url), "utf8"); assert.match(offline, /collection-deliveries/);
  const generic = readFileSync(new URL("../src/routes/industry-records.routes.js", import.meta.url), "utf8"); assert.match(generic, /\["finance_exception", "finance_collection_case", "finance_reminder_batch", "finance_collection_delivery"\]\.includes/);
});

test("renovación Gmail usa credencial cifrada y no envía correos en el preflight", async (t) => {
  const oldId = process.env.GOOGLE_CLIENT_ID, oldSecret = process.env.GOOGLE_CLIENT_SECRET;
  process.env.GOOGLE_CLIENT_ID = "test-client"; process.env.GOOGLE_CLIENT_SECRET = "test-secret";
  t.after(() => { if (oldId === undefined) delete process.env.GOOGLE_CLIENT_ID; else process.env.GOOGLE_CLIENT_ID = oldId; if (oldSecret === undefined) delete process.env.GOOGLE_CLIENT_SECRET; else process.env.GOOGLE_CLIENT_SECRET = oldSecret; });
  const db = database(); db.configs[0].metadata.oauthExpiresAt = "2020-01-01"; db.configs[0].verifyToken = "test-refresh";
  const urls = [];
  const r = await prepareCollectionTransport(db, { tenantId: "a", channel: "gmail" }, async (url) => {
    urls.push(url); return { ok: true, json: async () => url.includes("/token") ? { access_token: "new-private-token", expires_in: 3600 } : { emailAddress: "empresa@example.test" } };
  });
  assert.equal(r.token, "new-private-token"); assert.match(db.configs[0].accessToken, /^enc:v1:/); assert.equal(urls.length, 2); assert.ok(urls.every((u) => !u.includes("/messages/send")));
});
test("plantilla cambiada desde vista previa exige nueva aprobación", async () => {
  const db = database(), t1 = { ...transport, channel: "whatsapp", templateName: "cobranza", language: "es", templateBody: "Hola {{1}} {{2}} {{3}} {{4}}", footer: "" };
  const d = { ...deps, prepare: async () => t1 };
  const p = await previewCollectionDelivery(db, { ...ctx, input: { ...input, channel: "whatsapp", recipient: "+56912345678" } }, d);
  t1.templateBody = "Texto cambiado {{1}} {{2}} {{3}} {{4}}";
  await rejects(send(db, p, {}, d), 409);
});
test("reintento Serializable de la finalización no reenvía el mensaje", async () => {
  const db = database(), p = await preview(db); let calls = 0, writes = 0;
  const update = db.industryRecord.update;
  db.industryRecord.update = async (q) => { if (++writes === 1) throw Object.assign(Error("conflict"), { code: "P2034" }); return update(q); };
  const result = await send(db, p, {}, { ...deps, dispatch: async () => { calls++; return deps.dispatch(); } });
  assert.equal(result.status, "ACCEPTED"); assert.equal(calls, 1); assert.equal(db.rows[1].data.history.length, 1);
});
test("HTTP real: módulo, rol y tenant protegen historial, previsualización y envío", async (t) => {
  const old = { modules: prisma.tenantModule.findMany, records: prisma.industryRecord.findMany, record: prisma.industryRecord.findFirst };
  let allowed = true, gmailAllowed = false, calls = 0;
  prisma.tenantModule.findMany = async ({ where }) => where.module.in.map((module) => ({ module, enabled: allowed && (module === MODULES.FINANCE_COLLECTIONS || module === MODULES.FINANCE_INVOICES || (module === MODULES.GMAIL && gmailAllowed)), source: "MANUAL" }));
  prisma.industryRecord.findMany = async ({ where }) => { calls++; assert.equal(where.tenantId, "a"); return []; };
  prisma.industryRecord.findFirst = async ({ where }) => where.tenantId === "a" && where.id === "delivery" ? { data: { channel: "gmail" } } : null;
  t.after(() => { prisma.tenantModule.findMany = old.modules; prisma.industryRecord.findMany = old.records; prisma.industryRecord.findFirst = old.record; });
const app = express(); app.use(express.json()); app.use((req, _res, next) => { req.tenantId = req.headers["x-tenant"] || "a"; req.tenant = { id: req.tenantId, industry: "FINANCE" }; req.user = { tenantId: req.tenantId, id: "user", role: req.headers["x-role"] || "ADMIN" }; next(); }); app.use(financeRouter);
  const server = createServer(app); await new Promise((r) => server.listen(0, "127.0.0.1", r)); t.after(() => { server.closeAllConnections(); server.close(); });
  const call = (path, body, headers = {}) => fetch(`http://127.0.0.1:${server.address().port}/finance/collection-deliveries${path}`, { method: body ? "POST" : "GET", headers: { "Content-Type": "application/json", ...headers }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(5000) });
  const list = await call("?tenantId=other"); assert.equal(list.status, 200); assert.equal(list.headers.get("cache-control"), "no-store"); assert.deepEqual(await list.json(), { deliveries: [] }); assert.equal(calls, 1);
  assert.equal((await call("/preview", input)).status, 403); // Gmail module disabled.
  assert.equal((await call("/delivery/send", { approved: true }, { "x-role": "AGENT" })).status, 403);
  assert.equal((await call("/delivery/send", { approved: true }, { "x-tenant": "other" })).status, 404);
  assert.equal((await call("/preview", input, { "x-role": "VIEWER" })).status, 403);
  allowed = false; assert.equal((await call("")).status, 403);
});
