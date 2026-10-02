import test from "node:test";
import assert from "node:assert/strict";
import { collectNuboxSales, importNuboxDocuments, importFloidBankMovements, nuboxScheduledOutcome, externalDocumentDate } from "../src/services/finance-external-imports.service.js";

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
    tenantAuditLog: { create: async ({ data }) => { audits.push(data); return data; } }
  }; return db;
}
const close = (db, period, tenantId = "a") => { const c = db.controls.find((r) => r.tenantId === tenantId && r.period === period); if (c) c.status = "CLOSED"; else db.controls.push({ tenantId, period, status: "CLOSED" }); };
const invoice = (extra = {}) => ({ externalDocumentId: "nb-1", title: "Factura 101 · Cliente de prueba", status: "OPEN", data: { source: "nubox", nuboxDocumentId: "nb-1", invoiceNumber: "101", documentTypeCode: "33", issueDate: "2026-01-10", amount: 100, balance: 100, ...extra } });
const nubox = (db, invoices = [invoice()], tenantId = "a") => importNuboxDocuments(db, { tenantId, configId: "config", period: "2026-01", invoices });
const transactions = [{ id: "mov-1", date: "2026-01-15", description: "Abono cliente de prueba", in: 100, out: 0, currency: "CLP" }];
const payload = (items = transactions) => ({ caseId: "case-1", status: "successful", transactions: items });
const consent = (db, tenantId = "a") => db.rows.push({ id: "consent-1", tenantId, recordType: "finance_open_banking_consent", status: "PENDING", data: { caseId: "case-1", account: { bankKey: "bancoestado", accountAlias: "Recaudación", accountLast4: "1234" } } });
const floid = (db, body = payload(), tenantId = "a") => importFloidBankMovements(db, { tenantId, consentId: "consent-1", payload: body });
const byType = (db, type) => db.rows.filter((r) => r.recordType === type);

test("Nubox consulta todas las páginas, no solo las primeras cien ventas", async () => {
  const all = Array.from({ length: 251 }, (_, i) => ({ id: `n-${i}` })); const paths = [];
  const result = await collectNuboxSales(async (path) => { paths.push(path); const p = Number(new URL(`https://example.test${path}`).searchParams.get("page")); return { payload: { content: all.slice((p - 1) * 100, p * 100) }, total: 251 }; }, { period: "2026-01" });
  assert.equal(result.length, 251); assert.equal(paths.length, 3);
});
test("paginación sin total termina con una página vacía", async () => {
  let n = 0; const rows = await collectNuboxSales(async () => ({ payload: ++n === 1 ? [{ id: "1" }, { id: "2" }] : [] }), { period: "2026-01", limit: 2 }); assert.equal(rows.length, 2); assert.equal(n, 2);
});
test("Nubox rechaza páginas repetidas, formato desconocido y totales incompletos", async () => {
  for (const request of [async () => ({ payload: [{ id: "1" }], total: 2 }), async () => ({ payload: { unexpected: [] } }), async () => ({ payload: [], total: 10 })]) await assert.rejects(collectNuboxSales(request, { period: "2026-01", limit: 1 }));
});
test("Nubox no recorta documentos al superar límite seguro", async () => {
  await assert.rejects(collectNuboxSales(async () => ({ payload: [{ id: "1" }], total: 10 }), { period: "2026-01", maxRows: 2 }), /límite/);
});
test("Nubox importa y audita de forma idempotente", async () => {
  const db = database(); assert.equal((await nubox(db)).created, 1); assert.equal((await nubox(db)).ignored, 1); assert.equal(db.audits.length, 1);
});
test("Nubox bloquea lote completo si una fecha de origen está cerrada", async () => {
  const db = database(); close(db, "2026-01"); await assert.rejects(nubox(db), /cerrado/); assert.equal(db.rows.length, 0); assert.equal(db.audits.length, 0);
});
test("Nubox valida la fecha anterior al cambiar documento de período", async () => {
  const db = database(); await nubox(db); close(db, "2026-01"); await assert.rejects(nubox(db, [invoice({ issueDate: "2026-02-10" })]), /cerrado/); assert.equal(db.rows[0].data.issueDate, "2026-01-10");
});
test("Nubox permite repetir lote idéntico sin reescribir un mes cerrado", async () => {
  const db = database(); await nubox(db); close(db, "2026-01"); assert.equal((await nubox(db)).ignored, 1); assert.equal(db.audits.length, 1);
});
test("Nubox no sobrescribe saldos con pago local o evidencia enlazada", async () => {
  for (const mode of ["balance", "receipt"]) { const db = database(); await nubox(db); const row = db.rows[0]; if (mode === "balance") { row.data.paidAmount = 40; row.data.balance = 60; } else db.rows.push({ id: "receipt", tenantId: "a", recordType: "finance_invoice_receipt", data: { invoiceId: row.id } }); const before = structuredClone(db.rows); await assert.rejects(nubox(db, [invoice({ balance: 80 })]), /locales/); assert.deepEqual(db.rows, before); }
});
test("Nubox rechaza montos inválidos y fechas desconocidas", async () => {
  for (const extra of [{ amount: NaN }, { balance: 101 }, { issueDate: "" }]) { const db = database(); await assert.rejects(nubox(db, [invoice(extra)])); assert.equal(db.rows.length, 0); }
});

const note = (code = '61', extra = {}) => ({ ...invoice(), externalDocumentId: `note-${code}`, title: `Nota ${code} · Cliente de prueba`, data: { ...invoice().data, nuboxDocumentId: `note-${code}`, invoiceNumber: `N-${code}`, documentTypeCode: code, amount: 20, balance: 0, ...extra } });

test('Nubox importa facturas con NC y ND sin bloquear ni aplicar dos veces los ajustes', async () => {
  const db = database(); const result = await nubox(db, [note(), invoice({ balance: 80 }), note('56')]);
  assert.equal(result.created, 1); assert.equal(result.adjustmentsCreated, 2); assert.equal(result.adjustmentsPending, 2);
  assert.equal(byType(db, 'finance_invoice').length, 1);
  assert.equal(byType(db, 'finance_invoice')[0].data.balance, 80);
  assert.equal(byType(db, 'finance_invoice')[0].data.creditNotesTotal, undefined);
  assert.deepEqual(byType(db, 'finance_document_adjustment').map(r => r.data.adjustmentType), ['CREDIT_NOTE', 'DEBIT_NOTE']);
  assert.ok(byType(db, 'finance_document_adjustment').every(r => r.status === 'PENDING_REVIEW'));
  assert.equal(byType(db, 'finance_exception').length, 2);
  assert.ok(byType(db, 'finance_exception').every(r => r.data.issueDate === '2026-01-10' && r.data.adjustmentId));
});

test('reintentar notas idénticas no duplica notas ni excepciones, incluso en período cerrado', async () => {
  const db = database(); await nubox(db, [note()]); close(db, '2026-01');
  const result = await nubox(db, [note()]);
  assert.equal(result.ignored, 1); assert.equal(result.adjustmentsPending, 1);
  assert.equal(db.rows.length, 2); assert.equal(db.audits.length, 1);
});

test('nota modificada actualiza una sola revisión y nunca altera el saldo de factura', async () => {
  const db = database(); await nubox(db, [invoice(), note()]);
  const result = await nubox(db, [note('61', { amount: 30 })]);
  assert.equal(result.adjustmentsUpdated, 1); assert.equal(byType(db, 'finance_exception').length, 1);
  assert.equal(byType(db, 'finance_exception')[0].data.amount, 30);
  assert.equal(byType(db, 'finance_invoice')[0].data.balance, 100);
});

test('nota ya aplicada no se sobrescribe si Nubox cambia su contenido', async () => {
  const db = database(); await nubox(db, [note()]);
  byType(db, 'finance_document_adjustment')[0].status = 'APPLIED'; const before = structuredClone(db.rows);
  await assert.rejects(nubox(db, [note('61', { amount: 30 })]), /locales/);
  assert.deepEqual(db.rows, before);
});

test('notas conservan atomicidad, protección de períodos y validación de montos y fechas', async () => {
  for (const extra of [{ amount: NaN }, { amount: -20 }, { issueDate: '' }]) {
    const db = database(); await assert.rejects(nubox(db, [invoice(), note('61', extra)])); assert.equal(db.rows.length, 0);
  }
  const db = database(); close(db, '2026-02');
  await assert.rejects(nubox(db, [invoice(), note('61', { issueDate: '2026-02-10' })]), /cerrado/);
  assert.equal(db.rows.length, 0);
});

test('fallo al auditar lote mixto revierte facturas, notas y excepciones juntas', async () => {
  const db = database(); db.tenantAuditLog.create = async () => { throw new Error('audit'); };
  await assert.rejects(nubox(db, [invoice(), note()]), /audit/); assert.equal(db.rows.length, 0);
});

test('notas del mismo Nubox ID en empresas diferentes permanecen aisladas', async () => {
  const db = database(); await nubox(db, [note()], 'a'); await nubox(db, [note()], 'b');
  assert.equal(byType(db, 'finance_document_adjustment').length, 2);
  assert.deepEqual(byType(db, 'finance_exception').map(r => r.tenantId), ['a', 'b']);
});

test('dos importaciones simultáneas del mismo lote mixto no duplican notas', async () => {
  const db = database(); await Promise.all([nubox(db, [invoice(), note()]), nubox(db, [invoice(), note()])]);
  assert.equal(byType(db, 'finance_invoice').length, 1); assert.equal(byType(db, 'finance_document_adjustment').length, 1);
  assert.equal(byType(db, 'finance_exception').length, 1); assert.equal(db.audits.length, 1);
});
test("Nubox encuentra documento más allá de mil registros", async () => {
  const db = database(); for (let i = 0; i < 1001; i++) db.rows.push({ id: `old-${i}`, tenantId: "a", recordType: "finance_invoice", data: {} }); await nubox(db); assert.equal((await nubox(db)).ignored, 1); assert.equal(db.rows.length, 1002);
});
test("Nubox respeta aislamiento entre empresas y cierres", async () => {
  const db = database(); close(db, "2026-01"); await nubox(db, [invoice()], "b"); assert.equal(db.rows[0].tenantId, "b");
});
test("banca abierta importa cargos y abonos con vínculo a cartola", async () => {
  const db = database(); consent(db); const result = await floid(db, payload([...transactions, { ...transactions[0], id: "mov-2", in: 0, out: 30 }])); assert.equal(result.imported, 2); assert.deepEqual(byType(db, "bank_movement").map((r) => r.data.direction), ["CREDIT", "DEBIT"]); assert.ok(byType(db, "bank_movement").every((r) => r.data.importBatchId === result.batch.id)); assert.equal(db.audits.length, 1);
});
test("banca abierta cerrada no crea lote ni consume consentimiento", async () => {
  const db = database(); consent(db); close(db, "2026-01"); await assert.rejects(floid(db), /cerrado/); assert.equal(db.rows.length, 1); assert.equal(db.rows[0].status, "PENDING");
});
test("reintento de webhook no duplica movimientos, lote ni auditoría incluso cerrado", async () => {
  const db = database(); consent(db); await floid(db); close(db, "2026-01"); const count = db.rows.length; assert.equal((await floid(db)).replay, true); assert.equal(db.rows.length, count); assert.equal(db.audits.length, 1);
});
test("webhook cambiado no reutiliza consentimiento consumido", async () => {
  const db = database(); consent(db); await floid(db); await assert.rejects(floid(db, payload([{ ...transactions[0], in: 200 }])), /procesado/);
});
test("webhook rechaza empresa incorrecta, caso incorrecto y consentimiento revocado", async () => {
  const db = database(); consent(db); await assert.rejects(floid(db, payload(), "b"), /encontrado/); await assert.rejects(floid(db, { ...payload(), caseId: "otro" }), /corresponde/); db.rows[0].status = "REVOKED"; await assert.rejects(floid(db), /activo/);
});
test("banca abierta no inventa fecha, moneda ni signo", async () => {
  for (const extra of [{ date: "" }, { currency: "USD" }, { in: -100 }, { in: "importe inválido" }, { in: 100, out: 40 }]) { const db = database(); consent(db); await assert.rejects(floid(db, payload([{ ...transactions[0], ...extra }]))); assert.equal(db.rows.length, 1); }
});
test("respuesta bancaria pendiente no importa movimientos", async () => {
  const db = database(); consent(db); await assert.rejects(floid(db, { ...payload(), status: "pending" }), /completada/); assert.equal(db.rows[0].status, "PENDING");
});
test("ausencia de glosa se conserva como excepción, no se inventa", async () => {
  const db = database(); consent(db); const result = await floid(db, payload([{ ...transactions[0], description: "" }])); assert.equal(result.requiresReview, 1); assert.equal(result.imported, 0); assert.ok(byType(db, "finance_exception")[0].data.importBatchId);
});
test("fallo de auditoría revierte documentos y consentimiento", async () => {
  for (const run of [nubox, floid]) { const db = database(); consent(db); const before = structuredClone(db.rows); db.tenantAuditLog.create = async () => { throw new Error("audit"); }; await assert.rejects(run(db), /audit/); assert.deepEqual(db.rows, before); }
});
test("dos importaciones concurrentes no duplican Nubox ni banca abierta", async () => {
  for (const run of [nubox, floid]) { const db = database(); consent(db); await Promise.all([run(db), run(db)]); assert.equal(db.audits.length, 1); }
});

test("tarea Nubox con empresas fallidas o análisis pendiente no anuncia éxito completo", () => {
  assert.equal(nuboxScheduledOutcome({ failed: 0, results: [{ ok: true }] }).status, "COMPLETED");
  assert.equal(nuboxScheduledOutcome({ failed: 1, results: [{ ok: false }] }).status, "FAILED");
  assert.equal(nuboxScheduledOutcome({ failed: 0, results: [{ ok: true, warning: "Análisis pendiente" }] }).status, "FAILED");
});
test("duplicado con signo contrario se bloquea sin omitir el cargo", async () => {
  const db = database(); consent(db); await assert.rejects(floid(db, payload([...transactions, { ...transactions[0], in: 0, out: 100 }])), /cargo\/abono/); assert.equal(db.rows.length, 1);
});
test("fechas ISO de Nubox conservan mes del emisor sin desplazar por zona horaria", () => {
  assert.equal(externalDocumentDate("2026-01-31T23:00:00-03:00"), "2026-01-31");
  assert.equal(externalDocumentDate("2026-01-10"), "2026-01-10");
  assert.throws(() => externalDocumentDate("2026-02-30T00:00:00Z"), /válida/);
});
test("una nueva autorización con movimientos ya existentes no crea cartola vacía", async () => {
  const db = database(); consent(db); await floid(db);
  const original = db.rows.find((r) => r.id === "consent-1"); original.status = "PENDING"; delete original.data.lastPayloadHash;
  const result = await floid(db); assert.equal(result.imported, 0); assert.equal(result.duplicates, 1); assert.equal(result.batch, null); assert.equal(byType(db, "bank_statement").length, 1);
});
