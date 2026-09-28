import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createServer } from "node:http";
import { prisma } from "../src/lib/db.js";
import { financeRouter } from "../src/routes/finance.routes.js";
import { industryRecordsRouter } from "../src/routes/industry-records.routes.js";
import { previewFinanceGroup, approveFinanceGroup, reverseFinanceGroup, listFinanceGroups, planFinanceGroup } from "../src/services/finance-group-allocation.service.js";
import { auditFinanceGroup, financeGroupCloseBlockers } from "../src/services/finance-group-evidence.service.js";
import { reverseFinanceAllocation, applyFinanceAllocation } from "../src/services/finance-allocation.service.js";
import { buildFinanceMonthlyClosePreview } from "../src/services/finance-monthly-close.service.js";
import { getFinanceOverview } from "../src/services/finance.service.js";
import { financeActionForRecordMutation, FINANCE_ACTIONS } from "../src/services/finance-security.service.js";
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


const movement = (id, amount, date = "2025-01-10") => { const r = bank(amount); r.id = id; r.title = "Abono " + id; r.data.transactionDate = date; return r; };
const initial = () => [movement("m", 60), movement("n", 40), invoice()];
const cells = [{ movementId: "m", invoiceId: "i", amount: 60 }, { movementId: "n", invoiceId: "i", amount: 40 }];
const preview = (db, allocations = cells, extra = {}) => previewFinanceGroup(db, { tenantId: "a", userId: "agent", allocations, ...extra });
const approve = async (db, allocations = cells, extra = {}) => { const p = await preview(db, allocations); return approveFinanceGroup(db, { tenantId: "a", userId: "admin", allocations, expectedVersion: p.version, confirmation: "APROBAR", reason: "Distribución confirmada en comprobantes del cliente", ...extra }); };
const reverse = (db, id) => reverseFinanceGroup(db, { tenantId: "a", userId: "admin", id, reason: "Corrección solicitada por administración con respaldo" });
const saved = (db, id) => db.rows.find((r) => r.id === id);

test("vista previa valida varios abonos sin modificar saldos ni crear cobros", async () => {
  const db = database(initial()), before = structuredClone(db.rows), p = await preview(db);
  assert.equal(p.total, 100); assert.equal(p.documents[0].remaining, 0); assert.equal(p.movements.length, 2);
  assert.deepEqual(db.rows, before); assert.equal(db.audits.length, 0);
});
test("muchos a uno: grupo íntegro y totales consistentes en Dashboard y cierre", async () => {
  const db = database(initial()), { group } = await approve(db);
  assert.equal(saved(db, "i").data.paidAmount, 100); assert.equal(saved(db, "i").data.balance, 0);
  assert.equal(group.data.reconciliationIds.length, 2); assert.equal(db.rows.filter((r) => r.recordType === "finance_invoice_receipt").length, 2);
  assert.equal(auditFinanceGroup(group, db.rows).valid, true);
  const close = buildFinanceMonthlyClosePreview(db.rows, "2025-01");
  assert.equal(close.status, "READY_TO_CLOSE", JSON.stringify(close.blockers)); assert.equal(close.metrics.incoming, 100); assert.equal(close.metrics.collected, 100); assert.equal(close.metrics.reconciliations, 2);
  const dashboard = await getFinanceOverview({ tenantId: "a", db, context: { period: "2025-01", currency: "CLP" } });
  assert.equal(dashboard.invoices.paid, 100); assert.equal(dashboard.reconciliation.matchedMovements, 2);
});
test("muchos a muchos preserva deuda parcial y distribución por cada cruce", async () => {
  const db = database([movement("m", 100), movement("n", 50), invoice("i", 120), invoice("j", 80)]);
  const a = [{ movementId: "m", invoiceId: "i", amount: 100 }, { movementId: "n", invoiceId: "i", amount: 20 }, { movementId: "n", invoiceId: "j", amount: 30 }];
  const { group } = await approve(db, a);
  assert.equal(saved(db, "i").data.balance, 0); assert.equal(saved(db, "j").data.balance, 50); assert.equal(saved(db, "j").data.paidAmount, 30);
  assert.equal(auditFinanceGroup(group, db.rows).valid, true);
  await reverse(db, group.id); assert.equal(saved(db, "i").data.balance, 120); assert.equal(saved(db, "j").data.balance, 80);
});
test("uno a muchos también utiliza el grupo sin pagos artificiales", async () => {
  const db = database([movement("m", 100), invoice("i", 60), invoice("j", 40)]);
  const { group } = await approve(db, [{ movementId: "m", invoiceId: "i", amount: 60 }, { movementId: "m", invoiceId: "j", amount: 40 }]);
  assert.equal(auditFinanceGroup(group, db.rows).valid, true); assert.equal(db.rows.filter((r) => r.recordType === "bank_movement").length, 1);
});
test("diferentes cuentas y períodos conservan fechas originales; cierre no usa fecha de creación", async () => {
  const rows = initial(); rows[1].data.transactionDate = "2025-02-10"; rows[1].data.bankKey = "banco_estado";
  const db = database(rows), { group } = await approve(db); saved(db, group.id).createdAt = "2025-03-01";
  assert.deepEqual(group.data.periods, ["2025-01", "2025-02"]);
  assert.equal(buildFinanceMonthlyClosePreview(db.rows, "2025-01").metrics.incoming, 60);
  assert.equal(buildFinanceMonthlyClosePreview(db.rows, "2025-02").metrics.incoming, 40);
  assert.ok(buildFinanceMonthlyClosePreview(db.rows, "2025-03").blockers.some((r) => r.type === "SIN_DATOS_DEL_PERIODO"));
  assert.equal((await listFinanceGroups(db, { tenantId: "a", period: "2025-02" })).total, 1);
});
test("bloquea sobrantes, cruces repetidos, decimales, cero y saldo excedido por la suma", async () => {
  const invalid = [[], [...cells, cells[0]], [{ ...cells[0], amount: 59 }, cells[1]], [{ ...cells[0], amount: 60.1 }, cells[1]], [{ ...cells[0], amount: 0 }, cells[1]], [{ ...cells[0], amount: "60" }, cells[1]]];
  for (const a of invalid) await assert.rejects(preview(database(initial()), a));
  await assert.rejects(preview(database([movement("m", 60), movement("n", 40), invoice("i", 90)])), /suma de abonos/);
});
test("no agrupa clientes distintos ni RUT ausentes; no cruza empresa, proveedor o moneda", async () => {
  for (const patch of [{ clientRut: "22222222-2" }, { clientRut: "" }, { currency: "USD" }, { documentSide: "SUPPLIER" }]) {
    const rows = [movement("m", 60), movement("n", 40), invoice("i", 60), invoice("j", 40)];
    Object.assign(rows[3].data, patch);
    await assert.rejects(preview(database(rows), [{ movementId: "m", invoiceId: "i", amount: 60 }, { movementId: "n", invoiceId: "j", amount: 40 }]));
  }
  await assert.rejects(preview(database(initial()), cells, { tenantId: "other" }), /empresa/);
  const mixed = initial(); mixed[1].tenantId = "other"; assert.throws(() => planFinanceGroup(mixed, cells), /empresa/);
});
test("rechaza cargos, traspasos, excluidos, demo, fecha inválida o pago anterior a factura", async () => {
  for (const patch of [{ direction: "DEBIT" }, { movementKind: "INTERNAL_TRANSFER" }, { excluded: true }, { isDemo: true }, { currency: "USD" }, { transactionDate: "2024-12-01" }, { transactionDate: "2025-02-30" }]) {
    const rows = initial(); Object.assign(rows[0].data, patch); await assert.rejects(preview(database(rows)));
  }
});
test("bloquea reutilización por comprobante, conciliación y propuesta de diferencia pendiente", async () => {
  for (const [type, status] of [["finance_invoice_receipt", "REGISTERED"], ["finance_reconciliation", "APPROVED"], ["finance_reconciliation_difference", "PROPOSED"]]) {
    const db = database([...initial(), row("e", type, { movementId: "m" }, status)]); await assert.rejects(preview(db), /Resuélvelos/);
  }
});
test("un período cerrado bloquea todo el grupo antes de modificar una sola factura", async () => {
  const rows = initial(); rows[1].data.transactionDate = "2025-02-10";
  const db = database(rows); db.controls.push({ tenantId: "a", period: "2025-02", status: "CLOSED" }); const before = structuredClone(db.rows);
  await assert.rejects(approve(db), /cerrado/); assert.deepEqual(db.rows, before);
});
test("versión cambia al editar saldo, fuente o matriz y exige nueva vista previa", async () => {
  const db = database(initial()), p = await preview(db); saved(db, "m").data.description = "Nueva descripción";
  await assert.rejects(approveFinanceGroup(db, { tenantId: "a", userId: "admin", allocations: cells, expectedVersion: p.version, confirmation: "APROBAR", reason: "Comprobantes respaldados y revisados" }), /vista previa/);
  assert.equal(saved(db, "i").data.paidAmount, 0);
  await assert.rejects(approve(db, cells, { confirmation: "" }), /APROBAR/);
});
test("doble aprobación concurrente aplica el grupo una sola vez", async () => {
  const db = database(initial()), p = await preview(db);
  const action = () => approveFinanceGroup(db, { tenantId: "a", userId: "admin", allocations: cells, expectedVersion: p.version, confirmation: "APROBAR", reason: "Confirmación documentada del cliente" });
  const results = await Promise.allSettled([action(), action()]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1); assert.equal(saved(db, "i").data.paidAmount, 100);
  assert.equal(db.rows.filter((r) => r.recordType === "finance_reconciliation_group").length, 1);
});
test("la operación usa una transacción y falla por completo si falla el segundo abono", async () => {
  const db = database(initial()), p = await preview(db), before = structuredClone(db.rows);
  let txs = 0, approvals = 0; const transact = db.$transaction; db.$transaction = (fn, opts) => { txs++; return transact(fn, opts); };
  db.tenantAuditLog.create = async ({ data }) => { if (data.action === "FINANCE_RECONCILIATION_APPROVED" && ++approvals === 2) throw new Error("segundo abono"); return data; };
  await assert.rejects(approveFinanceGroup(db, { tenantId: "a", userId: "admin", allocations: cells, expectedVersion: p.version, confirmation: "APROBAR", reason: "Confirmación documentada del cliente" }), /segundo abono/);
  assert.equal(txs, 1); assert.deepEqual(db.rows, before);
});
test("reversa completa conserva evidencia y es idempotente; reversa individual no se permite", async () => {
  const db = database(initial()), { group } = await approve(db);
  await assert.rejects(reverseFinanceAllocation(db, { tenantId: "a", userId: "admin", reconciliationId: group.data.reconciliationIds[0], groupId: group.id, reason: "Intento de reversión individual" }), /grupo completo/);
  await reverse(db, group.id); assert.equal(saved(db, "i").data.balance, 100); assert.equal(saved(db, "i").data.paidAmount, 0);
  assert.equal(saved(db, "m").status, "PENDING"); assert.equal(saved(db, "n").status, "PENDING");
  assert.equal((await reverse(db, group.id)).alreadyReversed, true);
  assert.equal(db.rows.filter((r) => r.recordType === "finance_invoice_receipt" && r.status === "REVERSED").length, 2);
});
test("reversa bloqueada si cualquiera de los períodos está cerrado", async () => {
  const rows = initial(); rows[1].data.transactionDate = "2025-02-01"; const db = database(rows), { group } = await approve(db);
  db.controls.find((r) => r.period === "2025-02").status = "CLOSED"; const before = structuredClone(db.rows);
  await assert.rejects(reverse(db, group.id), /cerrado/); assert.deepEqual(db.rows, before);
});
test("fallo en auditoría final de reversa restaura todo el grupo aprobado", async () => {
  const db = database(initial()), { group } = await approve(db), before = structuredClone(db.rows);
  db.tenantAuditLog.create = async ({ data }) => { if (data.action === "FINANCE_GROUP_REVERSED") throw new Error("audit fail"); return data; };
  await assert.rejects(reverse(db, group.id), /audit fail/); assert.deepEqual(db.rows, before);
});
test("otro pago posterior se conserva al revertir el grupo", async () => {
  const db = database([movement("m", 60), movement("n", 40), movement("o", 50), invoice("i", 200)]), { group } = await approve(db);
  await applyFinanceAllocation(db, { tenantId: "a", userId: "admin", movementId: "o", allocations: [{ invoiceId: "i", amount: 50 }], manual: true, reason: "Pago posterior respaldado de cliente" });
  await reverse(db, group.id); assert.equal(saved(db, "i").data.paidAmount, 50); assert.equal(saved(db, "i").data.balance, 150); assert.equal(saved(db, "o").status, "MATCHED");
});
test("evidencia corrupta, factura ausente o parte revertida bloquea reversa y cierre", async () => {
  for (const corrupt of ["receipt", "invoice", "child", "matrix", "periods", "extraChild", "receiptDate", "receiptCurrency", "childDate", "childCurrency"]) {
    const db = database(initial()), { group } = await approve(db);
    if (corrupt === "receipt") db.rows.find((r) => r.recordType === "finance_invoice_receipt").data.amount++;
    if (corrupt === "invoice") db.rows.splice(db.rows.findIndex((r) => r.id === "i"), 1);
    if (corrupt === "child") saved(db, group.data.reconciliationIds[0]).status = "REVERSED";
    if (corrupt === "matrix") saved(db, group.id).data.allocations[0].amount++;
    if (corrupt === "periods") saved(db, group.id).data.periods = ["2030-01"];
    if (corrupt === "extraChild") db.rows.push({ ...structuredClone(saved(db, group.data.reconciliationIds[0])), id: "extra-child" });
    if (corrupt === "receiptDate") db.rows.find((r) => r.recordType === "finance_invoice_receipt").data.paymentDate = "2025-02-01";
    if (corrupt === "receiptCurrency") db.rows.find((r) => r.recordType === "finance_invoice_receipt").data.currency = "USD";
    if (corrupt === "childDate") saved(db, group.data.reconciliationIds[0]).data.transactionDate = "2025-02-01";
    if (corrupt === "childCurrency") saved(db, group.data.reconciliationIds[0]).data.currency = "USD";
    assert.equal(auditFinanceGroup(saved(db, group.id), db.rows).valid, false);
    assert.ok(buildFinanceMonthlyClosePreview(db.rows, "2025-01").blockers.length); await assert.rejects(reverse(db, group.id));
  }
});

test("dos grupos sobre una factura exigen saldo pagado que respalde todos los cobros", async () => {
  const db = database([movement("m", 60), movement("n", 40), movement("o", 50), invoice("i", 200)]);
  const { group } = await approve(db);
  await approve(db, [{ movementId: "o", invoiceId: "i", amount: 50 }]);
  assert.equal(auditFinanceGroup(group, db.rows).valid, true);
  saved(db, "i").data.paidAmount = 100; saved(db, "i").data.balance = 100;
  assert.equal(auditFinanceGroup(group, db.rows).valid, false);
  await assert.rejects(reverse(db, group.id));
});
test("grupo huérfano no acredita cierre y cliente de otra empresa no puede consultarlo", async () => {
  const db = database(initial()), { group } = await approve(db);
  db.rows.splice(0, db.rows.length, group); assert.ok(financeGroupCloseBlockers(db.rows, "2025-01").length);
  assert.equal((await listFinanceGroups(db, { tenantId: "other" })).total, 0); assert.equal(auditFinanceGroup(undefined, []).valid, false);
});
test("no trunca límites de entrada y exige revisión de todos los registros", () => {
  assert.throws(() => planFinanceGroup([], Array.from({ length: 201 }, () => cells[0])), /200/);
  assert.throws(() => planFinanceGroup([], Array.from({ length: 11 }, (_, n) => ({ movementId: "m" + n, invoiceId: "i", amount: 1 }))), /10 abonos/);
  assert.throws(() => planFinanceGroup([], Array.from({ length: 21 }, (_, n) => ({ movementId: "m", invoiceId: "i" + n, amount: 1 }))), /20 facturas/);
});
test("consulta completa paginada encuentra grupos antiguos más allá de mil filas", async () => {
  const rows = Array.from({ length: 1001 }, (_, n) => row("g" + String(n).padStart(4, "0"), "finance_reconciliation_group", { customerRut: "111111111", reason: "Prueba de búsqueda " + n, documents: [], periods: ["2025-01"] }, "REVERSED"));
  const result = await listFinanceGroups(database(rows), { tenantId: "a", query: "búsqueda 1000" }); assert.equal(result.total, 1);
});
test("workflow y permiso genérico no autorizan escrituras de grupos", () => {
  assert.equal(financeActionForRecordMutation("finance_reconciliation_group"), FINANCE_ACTIONS.APPROVE_RECONCILIATION);
  assert.throws(() => assertWorkflowFinancialSafety([{ type: "create_record", recordType: "finance_reconciliation_group" }], null), /financieros/);
});
test("HTTP: vista previa, aprobación y reversa reales con DB simulada; permisos y bypass protegidos", async (t) => {
  const db = database(initial()), oldTx = prisma.$transaction, oldRead = prisma.industryRecord.findMany;
  const tx = (fn, opts) => db.$transaction(fn, opts), read = (args) => db.industryRecord.findMany(args);
  prisma.$transaction = tx; prisma.industryRecord.findMany = read;
  t.after(() => { prisma.$transaction = oldTx; prisma.industryRecord.findMany = oldRead; });
  assert.equal(prisma.$transaction, tx); assert.equal(prisma.industryRecord.findMany, read);
  const app = express(); app.use(express.json()); app.use((req, _res, next) => { req.tenantId = "a"; req.tenant = { id: "a", industry: "FINANCE" }; req.user = { id: "http-user", tenantId: "a", role: req.headers["x-test-role"] || "SUPER_ADMIN" }; next(); }); app.use(financeRouter); app.use(industryRecordsRouter);
  const server = createServer(app); await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve)); t.after(() => { server.closeAllConnections(); server.close(); });
  const request = async (path, body, role = "SUPER_ADMIN") => { const res = await fetch("http://127.0.0.1:" + server.address().port + path, { method: body === undefined ? "GET" : "POST", headers: { "Content-Type": "application/json", "x-test-role": role }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(5000) }); return { status: res.status, data: await res.json() }; };
  const p = await request("/finance/reconciliation-groups/preview", { allocations: cells }); assert.equal(p.status, 200);
  const payload = { tenantId: "other", userId: "forged", allocations: cells, expectedVersion: p.data.version, confirmation: "APROBAR", reason: "Confirmación de distribución respaldada" };
  assert.equal((await request("/finance/reconciliation-groups/approve", payload, "AGENT")).status, 403);
  assert.equal((await request("/finance/reconciliation-groups/preview", payload, "VIEWER")).status, 403);
  assert.equal((await request("/industry-records", { recordType: "finance_reconciliation_group" })).status, 409);
  const a = await request("/finance/reconciliation-groups/approve", payload); assert.equal(a.status, 200, JSON.stringify(a.data)); assert.equal(a.data.group.tenantId, "a"); assert.equal(a.data.group.data.approvedById, "http-user");
  const list = await request("/finance/reconciliation-groups"); assert.equal(list.data.total, 1); assert.equal(list.data.records[0].validation.valid, true);
  assert.equal((await request("/finance/reconciliation-groups/" + a.data.group.id + "/reverse", { reason: "Corrección solicitada y respaldada" })).status, 200);
});
