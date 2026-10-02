import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createServer } from "node:http";
import { prisma } from "../src/lib/db.js";
import { financeRouter } from "../src/routes/finance.routes.js";
import { industryRecordsRouter } from "../src/routes/industry-records.routes.js";
import { proposeFinanceDifference, approveFinanceDifference, rejectFinanceDifference, reverseFinanceDifference, listFinanceDifferences } from "../src/services/finance-differences.service.js";
import { auditDifference, differencesForClose, differenceFingerprint } from "../src/services/finance-difference-evidence.service.js";
import { financeDocumentState, financeDocumentAmounts } from "../src/services/finance-document-values.service.js";
import { buildFinanceMonthlyClosePreview } from "../src/services/finance-monthly-close.service.js";
import { getFinanceOverview } from "../src/services/finance.service.js";
import { buildFinancePlanning } from "../src/services/finance-planning.service.js";
import { applyFinanceAllocation, reverseFinanceAllocation } from "../src/services/finance-allocation.service.js";
import { canPerformFinanceAction, financeActionForRecordMutation, FINANCE_ACTIONS } from "../src/services/finance-security.service.js";
import { writeManualFinanceRecord } from "../src/services/finance-manual-writes.service.js";
import { assertWorkflowFinancialSafety } from "../src/services/finance-workflow-guard.service.js";
const row = (id, recordType, data = {}, status = "PENDING") => ({ id, tenantId: "a", recordType, title: id, status, data });
const bank = (amount = 98) => row("m", "bank_movement", { amount, direction: "CREDIT", currency: "CLP", transactionDate: "2025-01-10", rut: "11111111-1", bankKey: "santander_chile", description: "Transferencia cliente" });
const invoice = (id = "i", amount = 100, date = "2025-01-01") => row(id, "finance_invoice", { amount, balance: amount, paidAmount: 0, currency: "CLP", clientRut: "11111111-1", clientName: "Cliente de prueba", issueDate: date }, "OPEN");
function database(initial = [bank(), invoice()]) {
  let rows = structuredClone(initial), controls = [], audits = [], seq = 0, tail = Promise.resolve();
  const match = (r, where = {}) => Object.entries(where).every(([k, v]) => v?.in ? v.in.includes(r[k]) : v?.path ? v.path.reduce((o, key) => o?.[key], r[k]) === v.equals : r[k] === v);
  const db = { get rows() { return rows; }, get controls() { return controls; }, get audits() { return audits; },
    $transaction: (fn, opts) => { assert.equal(opts.isolationLevel, "Serializable"); const p = tail.then(async () => { const snapshot = structuredClone({ rows, controls, audits }); try { return await fn(db); } catch (e) { ({ rows, controls, audits } = snapshot); throw e; } }); tail = p.catch(() => {}); return p; },
    financePeriodControl: { upsert: async ({ where, create }) => { let r = controls.find((r) => match(r, where.tenantId_period)); if (!r) { r = structuredClone(create); controls.push(r); } else r.lockVersion++; return structuredClone(r); } },
    industryRecord: {
      findFirst: async ({ where }) => structuredClone(rows.find((r) => match(r, where)) || null),
      findMany: async ({ where, take = 500, cursor, skip = 0 }) => { const list = rows.filter((r) => match(r, where)).sort((a, b) => a.id.localeCompare(b.id)); const start = cursor ? list.findIndex((r) => r.id === cursor.id) + skip : 0; return structuredClone(list.slice(start, start + take)); },
      create: async ({ data }) => { const r = { id: `new-${++seq}`, ...structuredClone(data) }; rows.push(r); return structuredClone(r); },
      update: async ({ where, data }) => { const r = rows.find((r) => match(r, where)); assert.ok(r); Object.assign(r, structuredClone(data)); return structuredClone(r); }
    }, tenantAuditLog: { create: async ({ data }) => { audits.push(structuredClone(data)); return data; } }
  }; return db;
}

const propose = (db, extra = {}) => proposeFinanceDifference(db, { tenantId: "a", userId: "agent", movementId: "m", invoiceId: "i", settlementAmount: 100, category: "BANK_FEE", reason: "Comisión identificada en liquidación del intermediario", evidence: "Liquidación proveedor folio 123 disponible en expediente", ...extra });
const approve = (db, id, extra = {}) => approveFinanceDifference(db, { tenantId: "a", userId: "admin", id, confirmation: "APROBAR", expectedVersion: differenceFingerprint(db.rows.find((r) => r.id === id)), ...extra });
const reverse = (db, id) => reverseFinanceDifference(db, { tenantId: "a", userId: "admin", id, reason: "Corrección respaldada solicitada por administración" });
const saved = (db, id) => db.rows.find((r) => r.id === id);

test("propuesta conserva saldos y bloquea cierre hasta su resolución humana", async () => {
  const db = database(), { difference } = await propose(db);
  assert.equal(difference.status, "PROPOSED"); assert.equal(saved(db, "i").data.paidAmount, 0); assert.equal(saved(db, "i").data.balance, 100);
  assert.equal(db.rows.filter((r) => r.recordType === "finance_invoice_receipt").length, 0);
  assert.ok(buildFinanceMonthlyClosePreview(db.rows, "2025-01").blockers.some((b) => b.type === "DIFERENCIA_PENDIENTE"));
});
test("aprobación separa dinero, ajuste y saldo en factura, Dashboard, planificación y cierre", async () => {
  const db = database(), { difference } = await propose(db); await approve(db, difference.id);
  const state = financeDocumentState(saved(db, "i")); assert.equal(state.included, true); assert.equal(state.originalAmount, 100); assert.equal(state.paidAmount, 98); assert.equal(state.justifiedDifference, 2); assert.equal(state.balance, 0);
  assert.equal(financeDocumentAmounts(saved(db, "i")).justifiedDifferenceTotal, 2);
  assert.equal(auditDifference(saved(db, difference.id), db.rows).valid, true);
  const close = buildFinanceMonthlyClosePreview(db.rows, "2025-01");
  assert.equal(close.status, "READY_TO_CLOSE", JSON.stringify(close.blockers)); assert.equal(close.metrics.incoming, 98); assert.equal(close.metrics.collected, 98); assert.equal(close.metrics.justifiedDifferences, 2);
  const overview = await getFinanceOverview({ tenantId: "a", db, context: { period: "2025-01", currency: "CLP" } });
  assert.equal(overview.invoices.paid, 98); assert.equal(overview.invoices.justifiedDifferences, 2); assert.equal(overview.reconciliation.matchedMovements, 1);
  assert.equal(buildFinancePlanning(db.rows, "2025-01").totals.actualIncome, 98);
  assert.equal(db.rows.filter((r) => r.recordType === "bank_movement").length, 1);
});
for (const category of ["BANK_FEE", "WITHHOLDING", "DISCOUNT", "ROUNDING"]) test("causa respaldada " + category + " no modifica DTE ni inventa notas", async () => {
  const db = database(), { difference } = await propose(db, { category }); await approve(db, difference.id);
  const d = saved(db, "i").data; assert.equal(d.amount, 100); assert.equal(d.creditNotesTotal, undefined);
  assert.equal(differencesForClose(db.rows, "2025-01").byCategory[category], 2);
});
test("permite saldar parte de la factura y luego conciliar el resto sin duplicar diferencias", async () => {
  const other = bank(100); other.id = "m2"; const db = database([bank(), other, invoice("i", 200)]);
  const { difference } = await propose(db); await approve(db, difference.id);
  assert.equal(saved(db, "i").data.balance, 100);
  await applyFinanceAllocation(db, { tenantId: "a", userId: "admin", movementId: "m2", allocations: [{ invoiceId: "i", amount: 100 }], reason: "Segundo pago verificado con cliente", manual: true });
  assert.equal(saved(db, "i").data.paidAmount, 198); assert.equal(saved(db, "i").data.balance, 0); assert.equal(saved(db, "i").data.justifiedDifferenceTotal, 2);
  await reverse(db, difference.id);
  assert.equal(saved(db, "i").data.paidAmount, 100); assert.equal(saved(db, "i").data.balance, 100); assert.equal(saved(db, "i").data.justifiedDifferenceTotal, 0);
});
test("sobrepagos, diferencia cero, importes no enteros y exceso de saldo se rechazan", async () => {
  for (const settlementAmount of [0, -1, 98, 97, 101, 100.5, "100"]) { const db = database(); await assert.rejects(propose(db, { settlementAmount })); assert.equal(db.rows.length, 2); }
  const db = database([bank(101), invoice()]); await assert.rejects(propose(db), /saldo a favor/);
});
test("redondeo mayor a 100, causa libre y motivos vacíos no se aprueban", async () => {
  await assert.rejects(propose(database([bank(1), invoice("i", 200)]), { settlementAmount: 200, category: "ROUNDING" }), /100 CLP/);
  for (const extra of [{ category: "OTHER" }, { category: "toString" }, { category: "__proto__" }, { reason: "" }, { evidence: "" }, { reason: "x".repeat(1501) }]) await assert.rejects(propose(database(), extra));
});
test("rechaza cargos, traspasos, moneda, demo, RUT distinto y fechas incompatibles", async () => {
  for (const patch of [{ direction: "DEBIT" }, { currency: "USD" }, { movementKind: "INTERNAL_TRANSFER" }, { isDemo: true }, { rut: "22222222-2" }, { transactionDate: "2025-02-30" }, { transactionDate: "2024-12-31" }]) {
    const m = bank(); Object.assign(m.data, patch); const db = database([m, invoice()]); await assert.rejects(propose(db), undefined, JSON.stringify(patch)); assert.equal(db.rows.length, 2);
  }
  const i = invoice(); i.data.documentSide = "SUPPLIER"; await assert.rejects(propose(database([bank(), i])));
});
test("lecturas y escrituras no cruzan empresas", async () => {
  const db = database(); await assert.rejects(propose(db, { tenantId: "b" }), /empresa/);
  await propose(db); assert.equal((await listFinanceDifferences(db, { tenantId: "b" })).total, 0);
});
test("doble clic no duplica propuesta ni aprobación", async () => {
  const db = database(); const results = await Promise.allSettled([propose(db), propose(db)]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  const id = db.rows.find((r) => r.recordType === "finance_reconciliation_difference").id;
  const approvals = await Promise.allSettled([approve(db, id), approve(db, id)]);
  assert.equal(approvals.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(db.rows.filter((r) => r.recordType === "finance_invoice_receipt").length, 1);
});
test("cambios posteriores de fuente o versión exigen volver a preparar", async () => {
  for (const id of ["i", "m"]) {
    const db = database(), { difference } = await propose(db); saved(db, id).data.description = "Dato modificado";
    await assert.rejects(approve(db, difference.id), /Cambió el abono/); assert.equal(saved(db, "i").data.paidAmount, 0);
  }
  const db = database(), { difference } = await propose(db);
  await assert.rejects(approve(db, difference.id, { expectedVersion: "old" }), /cambió/);
  await assert.rejects(approve(db, difference.id, { confirmation: "" }), /APROBAR/);
});
test("rechazo conserva historial, no afecta saldos y libera nueva propuesta", async () => {
  const db = database(), { difference } = await propose(db);
  await rejectFinanceDifference(db, { tenantId: "a", userId: "admin", id: difference.id, reason: "Respaldo insuficiente para esta propuesta" });
  assert.equal(saved(db, difference.id).status, "REJECTED"); assert.equal(saved(db, "i").data.balance, 100);
  assert.equal(differencesForClose(db.rows, "2025-01").blockers.length, 0);
  await propose(db);
});
test("reversa restituye deuda, libera abono y conserva comprobantes auditados", async () => {
  const db = database(), { difference } = await propose(db); await approve(db, difference.id);
  const id = saved(db, difference.id).data.reconciliationId;
  await assert.rejects(reverseFinanceAllocation(db, { tenantId: "a", userId: "admin", reconciliationId: id, reason: "Corrección de conciliación equivocada" }), /Diferencias justificadas/);
  await reverse(db, difference.id);
  assert.equal(saved(db, "i").data.balance, 100); assert.equal(saved(db, "i").data.paidAmount, 0); assert.equal(saved(db, "i").data.justifiedDifferenceTotal, 0);
  assert.equal(saved(db, "m").status, "PENDING"); assert.equal(saved(db, id).status, "REVERSED");
  assert.equal(db.rows.find((r) => r.recordType === "finance_invoice_receipt").status, "REVERSED");
  assert.equal((await reverse(db, difference.id)).alreadyReversed, true);
  assert.equal(db.audits.length, 3);
});
test("período cerrado bloquea preparación, aprobación y reversa", async () => {
  const close = (db) => db.controls.push({ tenantId: "a", period: "2025-01", status: "CLOSED", lockVersion: 1 });
  const db1 = database(); close(db1); await assert.rejects(propose(db1), /cerrado/);
  const db2 = database(), { difference: p } = await propose(db2); db2.controls[0].status = "CLOSED"; await assert.rejects(approve(db2, p.id), /cerrado/);
  const db3 = database(), { difference: a } = await propose(db3); await approve(db3, a.id); db3.controls[0].status = "CLOSED"; await assert.rejects(reverse(db3, a.id), /cerrado/);
});
test("fallo de auditoría revierte cobro, ajuste, saldos y comprobantes juntos", async () => {
  const db = database(), { difference } = await propose(db), before = structuredClone(db.rows);
  db.tenantAuditLog.create = async () => { throw new Error("audit failed"); };
  await assert.rejects(approve(db, difference.id), /audit failed/); assert.deepEqual(db.rows, before);
});
test("evidencia adulterada bloquea cierre y reversa sin cambios parciales", async () => {
  for (const target of ["receipt", "difference", "invoice"]) {
    const db = database(), { difference } = await propose(db); await approve(db, difference.id);
    if (target === "receipt") db.rows.find((r) => r.recordType === "finance_invoice_receipt").data.amount = 99;
    if (target === "difference") saved(db, difference.id).data.amount = 3;
    if (target === "invoice") saved(db, "i").data.justifiedDifferenceTotal = 0;
    const before = structuredClone(db.rows);
    assert.equal(auditDifference(saved(db, difference.id), db.rows).valid, false);
    assert.ok(buildFinanceMonthlyClosePreview(db.rows, "2025-01").blockers.some((r) => r.type === "DIFERENCIA_INCONSISTENTE"));
    await assert.rejects(reverse(db, difference.id)); assert.deepEqual(db.rows, before);
  }
});
test("ajuste sin aprobación verificable impide certificar cierre", () => {
  const i = invoice(); Object.assign(i.data, { balance: 0, paidAmount: 98, justifiedDifferenceTotal: 2 });
  assert.ok(differencesForClose([i], "2025-01").blockers.length);
  assert.equal(auditDifference(undefined, []).valid, false);
});
test("registro genérico no puede inventar diferencias justificadas", async () => {
  const db = database(), i = saved(db, "i");
  await assert.rejects(writeManualFinanceRecord(db, { tenantId: "a", userId: "admin", recordType: "finance_invoice", existing: i, nextData: { ...i.data, balance: 98, justifiedDifferenceTotal: 2 }, nextStatus: "OPEN", operation: "update", write: () => { throw new Error("No debe escribir"); }, audit: async () => {} }), /diferencias justificadas/);
});
test("agentes preparan pero no aprueban; workflows no evaden controles", () => {
  assert.equal(canPerformFinanceAction("AGENT", FINANCE_ACTIONS.PREPARE), true);
  for (const role of ["AGENT", "SELLER", "VIEWER"]) assert.equal(canPerformFinanceAction(role, FINANCE_ACTIONS.APPROVE_RECONCILIATION), false);
  assert.equal(financeActionForRecordMutation("finance_reconciliation_difference"), FINANCE_ACTIONS.APPROVE_RECONCILIATION);
  assert.throws(() => assertWorkflowFinancialSafety([{ type: "create_record", recordType: "finance_reconciliation_difference" }], null), /financieros/);
  assert.throws(() => assertWorkflowFinancialSafety([{ type: "set_field", field: "status", value: "APPROVED" }], { recordType: "finance_reconciliation_difference" }), /financieros/);
});
test("consulta paginada no omite registros antiguos ni mezcla empresas", async () => {
  const records = Array.from({ length: 1001 }, (_, n) => row("p" + String(n).padStart(5, "0"), "finance_reconciliation_difference", { proposedAt: "2025-01-01", invoiceTitle: "Factura " + n }, "PROPOSED"));
  const db = database(records), page = await listFinanceDifferences(db, { tenantId: "a", query: "Factura 1000" });
  assert.equal(page.total, 1); assert.equal(page.records[0].data.invoiceTitle, "Factura 1000");
  assert.equal((await listFinanceDifferences(db, { tenantId: "a", page: 41 })).records.length, 1);
});

test("comprobantes duplicados, moneda alterada y fecha corrupta impiden certificar respaldo", async () => {
  for (const change of ["receipt", "currency", "date"]) {
    const db = database(), { difference } = await propose(db); await approve(db, difference.id);
    if (change === "receipt") db.rows.push({ ...structuredClone(db.rows.find((r) => r.recordType === "finance_invoice_receipt")), id: "duplicate" });
    if (change === "currency") db.rows.find((r) => r.recordType === "finance_invoice_receipt").data.currency = "USD";
    if (change === "date") saved(db, difference.id).data.transactionDate = "2025-99-99";
    assert.equal(auditDifference(saved(db, difference.id), db.rows).valid, false);
    assert.ok(differencesForClose(db.rows, "2025-01").blockers.length);
    await assert.rejects(reverse(db, difference.id));
  }
});
test("si falla auditoría de reversa conserva todos los saldos aprobados", async () => {
  const db = database(), { difference } = await propose(db); await approve(db, difference.id);
  const before = structuredClone(db.rows); db.tenantAuditLog.create = async () => { throw new Error("audit failed"); };
  await assert.rejects(reverse(db, difference.id), /audit failed/); assert.deepEqual(db.rows, before);
});

test("HTTP real de rutas: propuesta, consulta, aprobación y reversa; rechaza bypass genérico y rol agente", async (t) => {
  const db = database();
  const originalTransaction = prisma.$transaction, originalFindMany = prisma.industryRecord.findMany;
  const originalModules = prisma.tenantModule.findMany;
  prisma.tenantModule.findMany = async ({ where }) => where.module.in.map((module) => ({ module, enabled: true, source: "MANUAL" }));
  t.after(() => { prisma.tenantModule.findMany = originalModules; });
  const transactionStub = (fn, options) => db.$transaction(fn, options), readStub = (args) => db.industryRecord.findMany(args);
  prisma.$transaction = transactionStub; prisma.industryRecord.findMany = readStub;
  t.after(() => { prisma.$transaction = originalTransaction; prisma.industryRecord.findMany = originalFindMany; });
  assert.equal(prisma.$transaction, transactionStub); assert.equal(prisma.industryRecord.findMany, readStub);
  const app = express(); app.use(express.json());
  // Authentication is supplied by the test, not bypassed in production code.
  app.use((req, _res, next) => { req.user = { id: "test-user", role: req.headers["x-test-role"] || "SUPER_ADMIN", tenantId: "a" }; req.tenantId = "a"; req.tenant = { id: "a", industry: "FINANCE" }; next(); });
  app.use(financeRouter); app.use(industryRecordsRouter);
  const server = createServer(app); await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = async (path, body, role = "SUPER_ADMIN") => {
    const response = await fetch(base + path, { method: body === undefined ? "GET" : "POST", headers: { "Content-Type": "application/json", "x-test-role": role }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(5000) });
    return { status: response.status, data: await response.json() };
  };
  const proposal = await request("/finance/differences", { tenantId: "malicious-tenant", userId: "forged", movementId: "m", invoiceId: "i", settlementAmount: 100, category: "BANK_FEE", reason: "Comisión del intermediario verificada", evidence: "Respaldo liquidación de enero folio 12" });
  assert.equal(proposal.status, 200, JSON.stringify(proposal.data)); assert.equal(proposal.data.difference.tenantId, "a"); assert.equal(proposal.data.difference.data.proposedById, "test-user");
  const list = await request("/finance/differences"); assert.equal(list.status, 200); assert.equal(list.data.total, 1);
  const { id, version } = list.data.records[0];
  assert.equal((await request(`/finance/differences/${id}/approve`, { expectedVersion: version, confirmation: "APROBAR" }, "AGENT")).status, 403);
  assert.equal((await request("/finance/differences", {}, "VIEWER")).status, 403);
  assert.equal((await request("/finance/differences", undefined, "UNKNOWN")).status, 403);
  assert.equal((await request("/industry-records", { recordType: "finance_reconciliation_difference", title: "Bypass", status: "APPROVED", data: { amount: 1 } })).status, 409);
  assert.equal((await request(`/finance/differences/${id}/approve`, { expectedVersion: version, confirmation: "APROBAR" })).status, 200);
  assert.equal((await request(`/finance/differences/${id}/reverse`, { reason: "Corrección verificada de liquidación" })).status, 200);
  assert.equal(saved(db, "i").data.balance, 100);
});
