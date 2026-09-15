import test from "node:test";
import assert from "node:assert/strict";
import { prepareFinanceAgentExceptions, normalizeFinanceAgentPolicy } from "../src/services/finance-agents.service.js";
import { generateFinanceCollectionCases } from "../src/services/finance-agent-actions.service.js";
import { getFinanceReconciliationSuggestions } from "../src/services/finance.service.js";

function database() {
  let rows = [], controls = [], audits = [], seq = 0, tail = Promise.resolve();
  const match = (r, w = {}) => Object.entries(w).every(([k, v]) => v?.in ? v.in.includes(r[k]) : v?.path ? v.path.reduce((x, p) => x?.[p], r[k]) === v.equals : r[k] === v);
  const db = {
    get rows() { return rows; }, get controls() { return controls; }, get audits() { return audits; },
    $transaction: (fn, options) => {
      assert.equal(options.isolationLevel, "Serializable");
      const p = tail.then(async () => { const before = structuredClone({ rows, controls, audits }); try { return await fn(db); } catch (e) { ({ rows, controls, audits } = before); throw e; } });
      tail = p.catch(() => {}); return p;
    },
    financePeriodControl: { upsert: async ({ where, create }) => { let r = controls.find((x) => match(x, where.tenantId_period)); if (!r) { r = structuredClone(create); controls.push(r); } return structuredClone(r); } },
    industryRecord: {
      findFirst: async ({ where }) => structuredClone(rows.find((r) => match(r, where)) || null),
      findMany: async ({ where, cursor, skip = 0, take = 500 }) => { const list = rows.filter((r) => match(r, where)); const start = cursor ? list.findIndex((r) => r.id === cursor.id) + skip : 0; return structuredClone(list.slice(start, start + take)); },
      create: async ({ data }) => { const r = { id: `r-${++seq}`, ...structuredClone(data) }; rows.push(r); return structuredClone(r); },
      update: async ({ where, data }) => { const r = rows.find((x) => match(x, where)); assert.ok(r); Object.assign(r, structuredClone(data)); return structuredClone(r); }
    },
    tenant: { findUnique: async () => ({ aiSettings: { financeAgents: { autoCreateExceptions: db.enabled !== false } } }) },
    tenantAuditLog: { create: async ({ data }) => { audits.push(data); return data; } }
  }; return db;
}
const close = (db, period, tenantId = "a") => { const c = db.controls.find((r) => r.tenantId === tenantId && r.period === period); if (c) c.status = "CLOSED"; else db.controls.push({ tenantId, period, status: "CLOSED" }); };


const now = new Date("2026-09-10T12:00:00Z");
const inv = (id = "invoice-1", extra = {}, tenantId = "a") => ({ id, tenantId, recordType: "finance_invoice", title: "Factura 101 · Cliente Andes", status: "OPEN", data: { invoiceNumber: "101", customerName: "Cliente Andes", customerRut: "11111111-1", issueDate: "2026-01-01", dueDate: "2026-01-20", currency: "CLP", amount: 100, balance: 100, ...extra } });
const mov = (id = "movement-1", extra = {}, tenantId = "a") => ({ id, tenantId, recordType: "bank_movement", title: "Abono Cliente Andes", status: "PENDING", data: { amount: 40, transactionDate: "2026-09-02", date: "2026-09-02", direction: "CREDIT", currency: "CLP", rut: "11111111-1", reference: "101", description: "Abono Cliente Andes", ...extra } });
const prepare = (db, tenantId = "a") => prepareFinanceAgentExceptions({ tenantId, userId: "operator", db });
const collect = (db, tenantId = "a") => generateFinanceCollectionCases(db, { tenantId, userId: "operator", now });
const byType = (db, type) => db.rows.filter((r) => r.recordType === type);

test("política desactivada no crea excepciones ni auditoría", async () => {
  const db = database(); db.enabled = false; db.rows.push(mov()); assert.equal((await prepare(db)).skipped, "POLICY_DISABLED"); assert.equal(db.audits.length, 0);
});
test("texto false no activa políticas accidentalmente", () => {
  assert.equal(normalizeFinanceAgentPolicy({ autoCreateExceptions: "false" }).autoCreateExceptions, false);
  assert.equal(normalizeFinanceAgentPolicy({ autoCreateExceptions: "true" }).autoCreateExceptions, true);
});
test("prepara pago parcial con fecha de origen y auditoría atómica", async () => {
  const db = database(); db.rows.push(inv(), mov()); const r = await prepare(db); assert.equal(r.created.length, 1); assert.equal(r.created[0].data.type, "PARTIAL_PAYMENT"); assert.equal(r.created[0].data.transactionDate, "2026-09-02"); assert.equal(db.audits.length, 1);
});
test("coincidencias después de doscientas no se convierten en ingresos no identificados", async () => {
  const db = database(); db.rows.push(inv()); for (let i = 0; i < 205; i++) db.rows.push(mov("m-" + i, { amount: 100 }));
  const suggestions = await getFinanceReconciliationSuggestions({ tenantId: "a", limit: null, db }); assert.equal(suggestions.length, 205);
  const r = await prepare(db); assert.equal(r.created.length, 0); assert.equal(r.analyzedMovements, 205);
});
test("lee movimientos más allá de quinientos sin omitir el último", async () => {
  const db = database(); for (let i = 0; i < 501; i++) db.rows.push(mov("old-" + i, { direction: "DEBIT" })); db.rows.push(mov("last"));
  const r = await prepare(db); assert.equal(r.analyzedMovements, 502); assert.equal(r.created.length, 1); assert.equal(r.created[0].data.movementId, "last");
});
test("no recrea una excepción resuelta ubicada después de quinientos casos", async () => {
  const db = database(); db.rows.push(mov()); for (let i = 0; i < 501; i++) db.rows.push({ id: "e-" + i, tenantId: "a", recordType: "finance_exception", data: {} });
  db.rows.push({ id: "resolved", tenantId: "a", recordType: "finance_exception", status: "RESOLVED", data: { movementId: "movement-1", type: "UNIDENTIFIED_INCOME" } });
  assert.equal((await prepare(db)).created.length, 0);
});
test("período cerrado se informa y no impide preparar otro período abierto", async () => {
  const db = database(); db.rows.push(mov(), mov("open", { transactionDate: "2026-08-02" })); close(db, "2026-09");
  const r = await prepare(db); assert.equal(r.created.length, 1); assert.deepEqual(r.deferred, [{ id: "movement-1", period: "2026-09", reason: "CLOSED_PERIOD" }]);
});
test("no inventa la fecha de una excepción sin fecha bancaria", async () => {
  const db = database(); db.rows.push(mov("bad", { transactionDate: "", date: "" })); const r = await prepare(db); assert.equal(r.created.length, 0); assert.equal(r.deferred[0].reason, "INVALID_SOURCE_DATE");
});
test("omite egresos, traspasos, comisiones, demo y movimientos ya en revisión", async () => {
  const db = database(); db.rows.push(mov("1", { direction: "DEBIT" }), mov("2", { movementKind: "INTERNAL_TRANSFER" }), mov("3", { movementKind: "COMMISSION_OR_FEE" }), mov("4", { isDemo: true }), { ...mov("5"), status: "REVIEW" });
  assert.equal((await prepare(db)).created.length, 0);
});
test("dos análisis concurrentes no duplican excepciones", async () => {
  const db = database(); db.rows.push(mov()); const r = await Promise.all([prepare(db), prepare(db)]); assert.equal(r.reduce((s, x) => s + x.created.length, 0), 1); assert.equal(db.audits.length, 1);
});
test("fallo de auditoría revierte excepciones y controles nuevos", async () => {
  const db = database(); db.rows.push(mov()); db.tenantAuditLog.create = async () => { throw new Error("audit"); }; await assert.rejects(prepare(db), /audit/); assert.equal(db.rows.length, 1); assert.equal(db.controls.length, 0);
});
test("cobranza solo crea borradores vencidos con moneda, fecha y saldo válidos", async () => {
  const db = database(); db.rows.push(inv(), inv("future", { dueDate: "2026-10-10" }), inv("today", { dueDate: "2026-09-10" }), inv("paid", { balance: 0 }), { ...inv("void"), status: "ANNULLED" }, inv("supplier", { documentSide: "SUPPLIER" }), inv("demo", { isDemo: true }));
  const r = await collect(db); assert.equal(r.count, 1); assert.equal(r.created[0].data.requiresApproval, true); assert.equal(r.created[0].data.channel, "manual"); assert.equal(db.rows[0].data.balance, 100);
});
test("factura histórica cerrada puede tener gestión actual abierta sin alterar su documento", async () => {
  const db = database(); db.rows.push(inv()); close(db, "2026-01"); const before = structuredClone(db.rows[0]); const r = await collect(db); assert.equal(r.count, 1); assert.equal(r.created[0].data.operatingDate, "2026-09-10"); assert.deepEqual(db.rows[0], before);
});
test("no genera cobranzas si el período de gestión actual está cerrado", async () => {
  const db = database(); db.rows.push(inv()); close(db, "2026-09"); await assert.rejects(collect(db), /cerrado/); assert.equal(db.rows.length, 1);
});
test("documentos con fechas, moneda o saldo inválidos se informan sin generar casos", async () => {
  const db = database(); db.rows.push(inv("date", { dueDate: "" }), inv("currency", { currency: "USD" }), inv("balance", { balance: 101 }));
  const r = await collect(db); assert.equal(r.count, 0); assert.deepEqual(r.deferred.map((x) => x.reason), ["INVALID_DOCUMENT_DATES", "UNSUPPORTED_CURRENCY", "INVALID_BALANCE"]);
});
test("lee toda la cartera y no duplica un caso histórico cerrado", async () => {
  const db = database(); for (let i = 0; i < 501; i++) db.rows.push(inv("i-" + i));
  const first = await collect(db); assert.equal(first.count, 501); byType(db, "finance_collection_case").forEach((r) => { r.status = "CLOSED"; }); assert.equal((await collect(db)).count, 0);
});
test("generaciones concurrentes de cobranza crean solo un caso por factura", async () => {
  const db = database(); db.rows.push(inv()); const r = await Promise.all([collect(db), collect(db)]); assert.equal(r.reduce((s, x) => s + x.count, 0), 1); assert.equal(db.audits.length, 1);
});
test("fallo de auditoría de cobranza revierte todo el lote", async () => {
  const db = database(); db.rows.push(inv()); db.tenantAuditLog.create = async () => { throw new Error("audit"); }; await assert.rejects(collect(db), /audit/); assert.equal(db.rows.length, 1);
});
test("no mezcla facturas, movimientos ni cierres de otra empresa", async () => {
  const db = database(); db.rows.push(inv("other", {}, "b"), mov("other-mov", {}, "b")); close(db, "2026-09", "b");
  assert.equal((await prepare(db)).created.length, 0); assert.equal((await collect(db)).count, 0);
});
test("ninguno de los generadores modifica facturas o confirma movimientos", async () => {
  const db = database(); db.rows.push(inv(), mov()); const original = structuredClone(db.rows); await prepare(db); await collect(db); assert.deepEqual(db.rows.slice(0, 2), original);
});
test("la gestión de cobranza usa el día de Chile al cambiar de mes UTC", async () => {
  const db = database(); db.rows.push(inv()); close(db, "2026-08");
  await assert.rejects(generateFinanceCollectionCases(db, { tenantId: "a", now: new Date("2026-09-01T01:00:00Z") }), /2026-08/);
});
test("pago agrupado exacto no crea una falsa excepción de sobrepago", async () => {
  const db = database(); db.rows.push(inv("first", { amount: 60, balance: 60 }), inv("second", { invoiceNumber: "102", amount: 40, balance: 40 }), mov("group", { amount: 100, reference: "101 102" }));
  const suggestions = await getFinanceReconciliationSuggestions({ tenantId: "a", limit: null, db }); assert.equal(suggestions[0].grouped, true); assert.equal(suggestions[0].overpayment, false); assert.equal((await prepare(db)).created.length, 0);
});
