import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createServer } from "node:http";
import { prisma } from "../src/lib/db.js";
import { financeRouter } from "../src/routes/finance.routes.js";
import { industryRecordsRouter } from "../src/routes/industry-records.routes.js";
import { registerManualSettlement } from "../src/services/finance-manual-writes.service.js";
import { listManualSettlements, previewManualSettlementReversal, reverseManualSettlement, planManualSettlementReversal } from "../src/services/finance-manual-reversals.service.js";
import { financeDocumentState } from "../src/services/finance-document-values.service.js";
import { buildFinanceMonthlyClosePreview } from "../src/services/finance-monthly-close.service.js";
import { getFinanceOverview } from "../src/services/finance.service.js";
import { assertWorkflowFinancialSafety } from "../src/services/finance-workflow-guard.service.js";

function database(kind = "RECEIPT") {
  let rows = [{ id: "doc", tenantId: "a", recordType: kind === "RECEIPT" ? "finance_invoice" : "finance_payable", title: "Factura de prueba", status: "OPEN", data: { amount: 200, balance: 200, paidAmount: 0, issueDate: "2025-01-01", currency: "CLP", clientName: "Cliente", clientRut: "11111111-1", supplierName: kind === "PAYMENT" ? "Proveedor" : undefined } }], controls = [], audits = [], seq = 0, tail = Promise.resolve();
  const match = (r, w = {}) => Object.entries(w).every(([k, v]) => v?.in ? v.in.includes(r[k]) : v?.path ? v.path.reduce((o, p) => o?.[p], r[k]) === v.equals : r[k] === v);
  const db = { get rows() { return rows; }, get controls() { return controls; }, get audits() { return audits; },
    $transaction: (fn, opts) => { assert.equal(opts.isolationLevel, "Serializable"); const p = tail.then(async () => { const before = structuredClone({ rows, controls, audits }); try { return await fn(db); } catch (e) { ({ rows, controls, audits } = before); throw e; } }); tail = p.catch(() => {}); return p; },
    financePeriodControl: { upsert: async ({ where, create }) => { let r = controls.find((r) => match(r, where.tenantId_period)); if (!r) { r = structuredClone(create); controls.push(r); } else r.lockVersion++; return structuredClone(r); } },
    industryRecord: {
      findFirst: async ({ where }) => structuredClone(rows.find((r) => match(r, where)) || null),
      findMany: async ({ where, take = 500, cursor, skip = 0 }) => { const all = rows.filter((r) => match(r, where)).sort((a, b) => a.id.localeCompare(b.id)); const start = cursor ? all.findIndex((r) => r.id === cursor.id) + skip : 0; return structuredClone(all.slice(start, start + take)); },
      create: async ({ data }) => { const r = { id: `new-${++seq}`, ...structuredClone(data) }; rows.push(r); return structuredClone(r); },
      update: async ({ where, data }) => { const r = rows.find((r) => match(r, where)); assert.ok(r); Object.assign(r, structuredClone(data)); return structuredClone(r); }
    }, tenantAuditLog: { create: async ({ data }) => { audits.push(structuredClone(data)); return data; } }
  }; return db;
}
const pay = (db, kind = "RECEIPT", extra = {}) => registerManualSettlement(db, { tenantId: "a", userId: "admin", documentId: "doc", kind, amount: 60, paymentDate: "2025-02-02", reference: "Comprobante", idempotencyKey: "operacion-manual-0001", ...extra });
const entry = (r) => r.receipt || r.payment;
const saved = (db, id) => db.rows.find((r) => r.id === id);
const preview = (db, id, kind = "RECEIPT", extra = {}) => previewManualSettlementReversal(db, { tenantId: "a", userId: "admin", kind, id, ...extra });
const payload = (id, p, kind = "RECEIPT") => ({ tenantId: "a", userId: "admin", id, kind, expectedVersion: p.version, reason: "Corrección de comprobante ingresado por error", confirmation: "REVERTIR" });
const reverse = async (db, id, kind = "RECEIPT") => reverseManualSettlement(db, payload(id, await preview(db, id, kind), kind));
const close = (db, period) => { const r = db.controls.find((r) => r.period === period); if (r) r.status = "CLOSED"; else db.controls.push({ tenantId: "a", period, status: "CLOSED" }); };

for (const kind of ["RECEIPT", "PAYMENT"]) {
  test(`${kind}: vista previa sin saldos modificados y reversa con evidencia conservada`, async () => {
    const db = database(kind), id = entry(await pay(db, kind)).id, before = structuredClone(db.rows), p = await preview(db, id, kind);
    assert.deepEqual(db.rows, before); assert.equal(p.before.balance, 140); assert.equal(p.after.balance, 200);
    const result = await reverseManualSettlement(db, payload(id, p, kind));
    assert.equal(result.document.data.paidAmount, 0); assert.equal(result.document.data.balance, 200); assert.equal(result.document.data.paidAt, null);
    assert.equal(saved(db, id).status, "REVERSED"); assert.equal(saved(db, id).data.amount, 60); assert.equal(saved(db, id).data.paymentDate, "2025-02-02");
    assert.equal(result.document.data.history.at(-1).type, `${kind}_REVERSED`); assert.equal(db.audits.at(-1).action, `FINANCE_MANUAL_${kind}_REVERSED`);
  });
  test(`${kind}: revertir un pago anterior preserva los posteriores y los saldos históricos`, async () => {
    const db = database(kind); Object.assign(db.rows[0].data, { amount: 300, creditNotesTotal: 30, debitNotesTotal: 10, justifiedDifferenceTotal: 10, balance: 170, paidAmount: 100 });
    const id = entry(await pay(db, kind)).id;
    await pay(db, kind, { amount: 40, idempotencyKey: "operacion-manual-0002" });
    await reverse(db, id, kind); const s = financeDocumentState(saved(db, "doc"));
    assert.equal(s.included, true); assert.equal(s.paidAmount, 140); assert.equal(s.balance, 130); assert.equal(s.creditNotes, 30); assert.equal(s.justifiedDifference, 10);
  });
  test(`${kind}: documento totalmente pagado recupera saldo y deja de estar pagado`, async () => {
    const db = database(kind), id = entry(await pay(db, kind, { amount: 200 })).id;
    assert.equal(saved(db, "doc").status, "PAID"); await reverse(db, id, kind);
    assert.equal(saved(db, "doc").status, "OPEN"); assert.equal(saved(db, "doc").data.balance, 200);
  });
}

test("período efectivo cerrado bloquea reversa; mes de emisión cerrado no la bloquea", async () => {
  const db = database(), id = entry(await pay(db)).id; close(db, "2025-02");
  await assert.rejects(preview(db, id), /cerrado/); db.controls.find((r) => r.period === "2025-02").status = "OPEN";
  const p = await preview(db, id); close(db, "2025-02"); await assert.rejects(reverseManualSettlement(db, payload(id, p)), /cerrado/);
  db.controls.find((r) => r.period === "2025-02").status = "OPEN"; close(db, "2025-01"); await reverse(db, id);
  assert.equal(saved(db, "doc").data.balance, 200);
});
test("sesión, empresa y tipo de comprobante no se pueden falsificar", async () => {
  const db = database(), id = entry(await pay(db)).id;
  await assert.rejects(preview(db, id, "RECEIPT", { userId: null }), /sesión/);
  await assert.rejects(preview(db, id, "RECEIPT", { tenantId: "b" }), /no encontrado/);
  await assert.rejects(preview(db, id, "PAYMENT"), /no encontrado/);
  await assert.rejects(preview(db, id, "OTHER"), /Selecciona/);
});
test("conciliados, vinculados y fuentes no manuales deben usar su flujo de origen", async () => {
  for (const patch of [{ source: "bank_reconciliation" }, { movementId: "m" }, { reconciliationId: "r" }, { groupId: "g" }, { creditId: "c" }, { applicationId: "a" }, { settlementId: "s" }]) {
    const db = database(), id = entry(await pay(db)).id; Object.assign(saved(db, id).data, patch); await assert.rejects(preview(db, id));
  }
  const db = database(), id = entry(await pay(db)).id;
  db.rows.push({ id: "r", tenantId: "a", recordType: "finance_reconciliation", status: "APPROVED", data: { receiptId: id } });
  await assert.rejects(preview(db, id), /operación vigente/);
});
test("historial alterado, documento ausente o anulado y saldo insuficiente bloquean", async () => {
  for (const corruption of ["amount", "date", "missing", "annulled", "history", "paid", "currency", "side", "duplicate"]) {
    const db = database(), id = entry(await pay(db)).id;
    if (corruption === "amount") saved(db, id).data.amount++;
    if (corruption === "date") saved(db, id).data.paymentDate = "2025-02-30";
    if (corruption === "missing") db.rows.splice(0, 1);
    if (corruption === "annulled") saved(db, "doc").status = "ANNULLED";
    if (corruption === "history") saved(db, "doc").data.history = [];
    if (corruption === "paid") Object.assign(saved(db, "doc").data, { paidAmount: 0, balance: 200 });
    if (corruption === "currency") saved(db, id).data.currency = "USD";
    if (corruption === "side") saved(db, "doc").data.documentSide = "SUPPLIER";
    if (corruption === "duplicate") db.rows.push({ ...structuredClone(saved(db, id)), id: "other" });
    await assert.rejects(preview(db, id));
  }
});
test("saldo modificado después de la vista previa exige revisar nuevamente", async () => {
  const db = database(), id = entry(await pay(db)).id, p = await preview(db, id);
  await pay(db, "RECEIPT", { amount: 20, idempotencyKey: "operacion-manual-0002" });
  await assert.rejects(reverseManualSettlement(db, payload(id, p)), /cambió/);
  assert.equal(saved(db, id).status, "REGISTERED"); assert.equal(saved(db, "doc").data.balance, 120);
});
test("doble reversa concurrente y reintento tras cerrar son idempotentes", async () => {
  const db = database(), id = entry(await pay(db)).id, p = await preview(db, id), input = payload(id, p);
  const results = await Promise.all([reverseManualSettlement(db, input), reverseManualSettlement(db, input)]);
  assert.equal(results.filter((r) => r.alreadyReversed).length, 1); assert.equal(db.audits.filter((r) => r.action.endsWith("REVERSED")).length, 1);
  close(db, "2025-02"); assert.equal((await reverseManualSettlement(db, input)).alreadyReversed, true);
  await assert.rejects(reverseManualSettlement(db, { ...input, reason: "Motivo diferente para la misma reversa" }), /ya fue revertido/);
});
test("reintento del registro original revertido no revive ni anuncia un cobro guardado", async () => {
  const db = database(), id = entry(await pay(db)).id; await reverse(db, id);
  await assert.rejects(pay(db), /fue revertida/); assert.equal(saved(db, "doc").data.balance, 200);
  await pay(db, "RECEIPT", { idempotencyKey: "operacion-manual-0002" }); assert.equal(saved(db, "doc").data.balance, 140);
});
test("motivo y confirmación obligatorios sin efectos parciales", async () => {
  const db = database(), id = entry(await pay(db)).id, p = await preview(db, id);
  for (const patch of [{ reason: "corto" }, { reason: "x".repeat(1001) }, { confirmation: "" }, { expectedVersion: "" }]) await assert.rejects(reverseManualSettlement(db, { ...payload(id, p), ...patch }));
  assert.equal(saved(db, "doc").data.balance, 140);
});
test("fallo después de restaurar documento o al auditar hace rollback completo", async () => {
  for (const failure of ["entry", "audit"]) {
    const db = database(), id = entry(await pay(db)).id, p = await preview(db, id), before = structuredClone(db.rows);
    const update = db.industryRecord.update;
    if (failure === "entry") db.industryRecord.update = async (args) => { if (args.where.id === id) throw new Error("fallo simulado"); return update(args); };
    else db.tenantAuditLog.create = async () => { throw new Error("fallo simulado"); };
    await assert.rejects(reverseManualSettlement(db, payload(id, p)), /fallo simulado/); assert.deepEqual(db.rows, before);
  }
});
test("documentos, Dashboard y cierre reflejan la reversa sin borrar registros", async () => {
  const db = database(), id = entry(await pay(db)).id; await reverse(db, id);
  const close = buildFinanceMonthlyClosePreview(db.rows, "2025-01"); assert.equal(close.metrics.collected, 0);
  const overview = await getFinanceOverview({ tenantId: "a", db, context: { period: "2025-01", currency: "CLP" } }); assert.equal(overview.invoices.paid, 0);
  assert.equal(db.rows.length, 2); assert.equal(financeDocumentState(saved(db, "doc")).balance, 200);
});
test("historial filtra por período efectivo, contraparte, estado y empresa", async () => {
  const db = database(), id = entry(await pay(db)).id;
  assert.equal((await listManualSettlements(db, { tenantId: "a", kind: "RECEIPT", period: "2025-01" })).total, 0);
  assert.equal((await listManualSettlements(db, { tenantId: "a", kind: "RECEIPT", period: "2025-02", query: "11111111" })).total, 1);
  assert.equal((await listManualSettlements(db, { tenantId: "b", kind: "RECEIPT" })).total, 0);
  await reverse(db, id);
  const r = await listManualSettlements(db, { tenantId: "a", kind: "RECEIPT", status: "REVERSED" }); assert.equal(r.total, 1); assert.equal(r.records[0].canReverse, false);
});
test("historial no trunca comprobantes más allá de mil registros", async () => {
  const db = database(), original = entry(await pay(db));
  for (let n = 0; n < 1001; n++) db.rows.push({ ...structuredClone(original), id: `copy-${n}`, status: "REVERSED", data: { ...original.data, reference: `buscar-${n}` } });
  assert.equal((await listManualSettlements(db, { tenantId: "a", kind: "RECEIPT", query: "buscar-1000" })).total, 1);
  await assert.rejects(listManualSettlements(db, { tenantId: "a", kind: "RECEIPT", page: -1 }), /Filtros/);
});
test("workflow no puede fabricar cobros o pagos", () => {
  for (const recordType of ["finance_invoice_receipt", "finance_payable_payment"]) assert.throws(() => assertWorkflowFinancialSafety([{ type: "create_record", recordType }], null), /financieros/);
});
test("HTTP: permisos, aislamiento, preview y reversa para clientes y proveedores", async (t) => {
  const db = database(), originalTx = prisma.$transaction, originalRead = prisma.industryRecord.findMany;
  const originalModules = prisma.tenantModule.findMany;
  let modulesEnabled = true;
  prisma.tenantModule.findMany = async ({ where }) => where.module.in.map((module) => ({ module, enabled: modulesEnabled, source: "MANUAL" }));
  prisma.$transaction = (fn, opts) => db.$transaction(fn, opts); prisma.industryRecord.findMany = (args) => db.industryRecord.findMany(args);
  t.after(() => { prisma.$transaction = originalTx; prisma.industryRecord.findMany = originalRead; prisma.tenantModule.findMany = originalModules; });
  const app = express(); app.use(express.json()); app.use((req, _res, next) => { req.tenantId = req.headers["x-test-tenant"] || "a"; req.tenant = { id: req.tenantId, industry: "FINANCE" }; req.user = { id: "http-admin", tenantId: req.tenantId, role: req.headers["x-test-role"] || "SUPER_ADMIN" }; next(); }); app.use(financeRouter); app.use(industryRecordsRouter);
  const server = createServer(app); await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve)); t.after(() => { server.closeAllConnections(); server.close(); });
  const call = async (path, body, role = "SUPER_ADMIN", tenant = "a") => { const res = await fetch(`http://127.0.0.1:${server.address().port}${path}`, { method: body === undefined ? "GET" : "POST", headers: { "Content-Type": "application/json", "x-test-role": role, "x-test-tenant": tenant }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(5000) }); return { status: res.status, data: await res.json() }; };
  for (const kind of ["RECEIPT", "PAYMENT"]) {
    if (kind === "PAYMENT") db.rows.push({ ...structuredClone(database("PAYMENT").rows[0]), id: "supplier" });
    const id = entry(await pay(db, kind, { documentId: kind === "PAYMENT" ? "supplier" : "doc" })).id, base = `/finance/manual-settlements/${kind === "RECEIPT" ? "receipts" : "payments"}`;
    assert.equal((await call(base, undefined, "VIEWER")).status, 200);
    modulesEnabled = false;
    assert.equal((await call(base, undefined, "ADMIN")).status, 403);
    assert.equal((await call(`${base}/${id}/preview-reversal`, {}, "ADMIN")).status, 403);
    modulesEnabled = true;
    assert.equal((await call(`${base}/${id}/preview-reversal`, {}, "AGENT")).status, 403);
    assert.equal((await call(`${base}/${id}/preview-reversal`, {}, "SUPER_ADMIN", "b")).status, 404);
    const p = await call(`${base}/${id}/preview-reversal`, {}); assert.equal(p.status, 200);
    const body = { ...payload(id, p.data, kind), tenantId: "forged", userId: "forged" };
    assert.equal((await call(`${base}/${id}/reverse`, body, "VIEWER")).status, 403);
    assert.equal((await call(`${base}/${id}/reverse`, body)).status, 200); assert.equal(saved(db, id).data.reversedById, "http-admin");
    assert.equal((await call("/industry-records", { recordType: kind === "RECEIPT" ? "finance_invoice_receipt" : "finance_payable_payment" })).status, 409);
  }
});
