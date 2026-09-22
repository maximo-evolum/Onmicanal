import test from "node:test";
import assert from "node:assert/strict";
import { closeFinancePeriod, reopenFinancePeriod, getFinancePeriodWorkspace, assertFinancePeriodOpen } from "../src/services/finance-period-control.service.js";
import { buildFinanceMonthlyClosePreview } from "../src/services/finance-monthly-close.service.js";

const preview = { period: "2026-01", generatedAt: "2026-02-01T12:00:00Z", status: "READY_TO_CLOSE", coverage: { complete: true }, blockers: [], metrics: { issued: 100, collected: 100, paidPayables: 0, netBankFlow: 100 }, rows: [{ fecha: "2026-01-20", documento: "F-1", monto: 100, saldo: 0 }] };
function database() {
  let records = [], controls = [], audits = []; let sequence = 0; let tail = Promise.resolve();
  const match = (row, where = {}) => Object.entries(where).every(([key, value]) => value?.in ? value.in.includes(row[key]) : value?.path ? value.path.reduce((obj, part) => obj?.[part], row[key]) === value.equals : row[key] === value);
  const apply = (row, data) => { for (const [key, value] of Object.entries(data)) row[key] = value?.increment !== undefined ? Number(row[key] || 0) + value.increment : structuredClone(value); return structuredClone(row); };
  const db = {
    tenantChannelConfig: { findMany: async () => [] },
    get records() { return records; }, get controls() { return controls; }, get audits() { return audits; },
    // Deterministic serialization for lifecycle tests, not a PostgreSQL stress test.
    $transaction: (fn, options) => {
      assert.equal(options.isolationLevel, "Serializable");
      const result = tail.then(async () => { const old = structuredClone({ records, controls, audits }); try { return await fn(db); } catch (e) { records = old.records; controls = old.controls; audits = old.audits; throw e; } });
      tail = result.catch(() => {}); return result;
    },
    financePeriodControl: {
      findUnique: async ({ where }) => structuredClone(controls.find((row) => match(row, where.tenantId_period)) || null),
      upsert: async ({ where, create, update }) => { let row = controls.find((item) => match(item, where.tenantId_period)); if (row) return apply(row, update); row = structuredClone(create); controls.push(row); return structuredClone(row); },
      update: async ({ where, data }) => { const row = controls.find((item) => match(item, where.tenantId_period)); assert.ok(row); return apply(row, data); }
    },
    industryRecord: {
      findFirst: async ({ where }) => structuredClone(records.find((row) => match(row, where)) || null),
      findMany: async ({ where, take = 500, cursor, skip = 0 }) => { const list = records.filter((row) => match(row, where)); const start = cursor ? list.findIndex((row) => row.id === cursor.id) + skip : 0; return structuredClone(list.slice(start, start + take)); },
      create: async ({ data }) => { const row = { id: `record-${++sequence}`, createdAt: new Date().toISOString(), ...structuredClone(data) }; records.push(row); return structuredClone(row); }
    },
    tenantAuditLog: { create: async ({ data }) => { audits.push(structuredClone(data)); return data; } }
  }; return db;
}
const close = (db, extra = {}) => closeFinancePeriod(db, { tenantId: "a", userId: "admin", period: "2026-01", confirmation: "CERRAR", expectedVersion: 0, previewBuilder: async () => structuredClone(preview), ...extra });
const reopen = (db, result, extra = {}) => reopenFinancePeriod(db, { tenantId: "a", userId: "admin", period: "2026-01", closeId: result.close.id, confirmation: "REABRIR", expectedVersion: result.periodControl.version, reason: "Corrección de cartola validada por administración", ...extra });
const workspace = (db, extra = {}) => getFinancePeriodWorkspace(db, { tenantId: "a", period: "2026-01", previewBuilder: async () => structuredClone(preview), ...extra });

test("la consulta de un período nuevo no crea registros", async () => {
  const db = database(); const result = await workspace(db);
  assert.equal(result.periodControl.status, "OPEN"); assert.equal(result.periodControl.version, 0);
  assert.equal(db.records.length + db.controls.length + db.audits.length, 0);
});

test("no guarda cierre ni auditoría si el recálculo detecta monto o tipo inválido", async () => {
  for (const data of [{ amount: 100 }, { amount: null, direction: "CREDIT" }]) {
    const db = database();
    await assert.rejects(close(db, { previewBuilder: async () => buildFinanceMonthlyClosePreview([
      { id: "m", recordType: "bank_movement", status: "MATCHED", data: { transactionDate: "2026-01-05", ...data } }
    ], "2026-01") }), /Resuelve los pendientes/);
    assert.equal(db.records.length + db.controls.length + db.audits.length, 0);
  }
});

test("el cierre real recalcula vínculos y rechaza MATCHED sin respaldo en su transacción", async () => {
  const db = database();
  await db.industryRecord.create({ data: { tenantId: "a", recordType: "bank_movement", status: "MATCHED", data: { transactionDate: "2026-01-05", amount: 100, direction: "CREDIT", reconciliationId: "missing" } } });
  db.financeBankImportJob = { findMany: async () => [] };
  await assert.rejects(close(db, { previewBuilder: undefined }), (error) => {
    assert.equal(error.status, 409);
    assert.ok(error.details.preview.blockers.some((b) => b.type === "CONCILIACION_INCONSISTENTE")); return true;
  });
  assert.equal(db.records.length, 1); assert.equal(db.controls.length + db.audits.length, 0);
});
test("cierra con fotografía, referencia activa y auditoría atómica", async () => {
  const db = database(); const result = await close(db);
  assert.equal(result.periodControl.status, "CLOSED"); assert.equal(result.periodControl.version, 1);
  assert.equal(db.audits[0].action, "FINANCE_MONTHLY_CLOSE_REGISTERED");
  assert.deepEqual(result.close.data.rows, preview.rows);
});
test("un cierre conserva su fotografía aunque cambien los datos vivos", async () => {
  const db = database(); await close(db);
  const result = await workspace(db, { previewBuilder: async () => { throw new Error("No debe recalcular"); } });
  assert.equal(result.status, "CLOSED_SNAPSHOT"); assert.equal(result.metrics.issued, 100);
});
test("reabre con evento separado y sin alterar el cierre original", async () => {
  const db = database(); const result = await close(db); const original = structuredClone(db.records[0]);
  await reopen(db, result);
  assert.deepEqual(db.records[0], original); assert.equal(db.controls[0].status, "OPEN"); assert.equal(db.controls[0].version, 2);
  assert.equal(db.records[1].recordType, "finance_period_reopening"); assert.equal(db.audits[1].action, "FINANCE_PERIOD_REOPENED");
});
test("recerrar crea nueva fotografía y enlaza la anterior", async () => {
  const db = database(); const first = await close(db); await reopen(db, first);
  const second = await close(db, { expectedVersion: 2, previewBuilder: async () => ({ ...structuredClone(preview), metrics: { ...preview.metrics, issued: 200 } }) });
  assert.notEqual(first.close.id, second.close.id); assert.equal(second.close.data.previousCloseId, first.close.id); assert.equal(second.periodControl.version, 3);
  assert.equal((await workspace(db, { snapshotId: first.close.id })).metrics.issued, 100);
  const current = await workspace(db); assert.equal(current.metrics.issued, 200); assert.equal(current.history.filter((event) => event.active).length, 1);
});
test("bloquea versiones antiguas y confirmaciones ausentes", async () => {
  const db = database(); await assert.rejects(close(db, { confirmation: "" }), /CERRAR/);
  await assert.rejects(close(db, { expectedVersion: undefined }), /Actualiza/);
  const result = await close(db);
  await assert.rejects(close(db), /cambió/); await assert.rejects(reopen(db, result, { expectedVersion: 0 }), /cambió/);
  await assert.rejects(reopen(db, result, { confirmation: "" }), /REABRIR/);
  await assert.rejects(reopen(db, result, { reason: "corto" }), /motivo/);
});
test("no reabre un cierre de otra empresa, período o versión histórica", async () => {
  const db = database(); const first = await close(db);
  await assert.rejects(reopen(db, first, { tenantId: "b" }), /cambió/);
  await assert.rejects(workspace(db, { tenantId: "b", snapshotId: first.close.id }), /no pertenece/);
  await assert.rejects(workspace(db, { period: "2026-02", snapshotId: first.close.id }), /no pertenece/);
  await reopen(db, first); const second = await close(db, { expectedVersion: 2 });
  await assert.rejects(reopen(db, second, { closeId: first.close.id }), /ya no es/);
});
test("fallar la auditoría revierte cierre y control de estado", async () => {
  const db = database(); db.tenantAuditLog.create = async () => { throw new Error("auditoría caída"); };
  await assert.rejects(close(db), /auditoría/); assert.equal(db.records.length, 0); assert.equal(db.controls.length, 0);
});
test("fallar la auditoría de reapertura mantiene cerrado el período", async () => {
  const db = database(); const result = await close(db);
  db.tenantAuditLog.create = async () => { throw new Error("auditoría caída"); };
  await assert.rejects(reopen(db, result), /auditoría/); assert.equal(db.records.length, 1); assert.equal(db.controls[0].status, "CLOSED");
});
test("no cierra si quedan bloqueos o la vista previa es de otro período", async () => {
  for (const bad of [{ ...preview, status: "REQUIRES_REVIEW" }, { ...preview, blockers: [{ id: "pendiente" }] }, { ...preview, period: "2026-02" }]) {
    const db = database(); await assert.rejects(close(db, { previewBuilder: async () => bad }), /pendientes/); assert.equal(db.records.length, 0);
  }
});
test("dos cierres o reaperturas concurrentes producen un solo evento válido", async () => {
  const db = database(); const results = await Promise.allSettled([close(db), close(db)]);
  assert.equal(results.filter((item) => item.status === "fulfilled").length, 1);
  const result = results.find((item) => item.status === "fulfilled").value;
  const reopenings = await Promise.allSettled([reopen(db, result), reopen(db, result)]);
  assert.equal(reopenings.filter((item) => item.status === "fulfilled").length, 1); assert.equal(db.records.length, 2);
});
test("la reapertura libera conciliaciones sin considerar cierres históricos como activos", async () => {
  const db = database(); const result = await close(db);
  await assert.rejects(db.$transaction((tx) => assertFinancePeriodOpen(tx, "a", "2026-01"), { isolationLevel: "Serializable" }), /cerrado/);
  await reopen(db, result);
  const open = await db.$transaction((tx) => assertFinancePeriodOpen(tx, "a", "2026-01"), { isolationLevel: "Serializable" });
  assert.equal(open.status, "OPEN"); assert.equal(db.records[0].status, "CLOSED");
});
test("bloqueo de enero no bloquea operaciones de febrero", async () => {
  const db = database(); await close(db);
  const open = await db.$transaction((tx) => assertFinancePeriodOpen(tx, "a", "2026-02"), { isolationLevel: "Serializable" });
  assert.equal(open.status, "OPEN");
});
test("rechaza estados inconsistentes y fotografías incompletas sin modificarlos", async () => {
  const db = database(); const result = await close(db); delete db.records[0].data.rows;
  await assert.rejects(workspace(db), /detalle completo/);
  db.controls[0].latestCloseId = null; await assert.rejects(workspace(db), /falta su referencia/);
  assert.equal(db.records[0].id, result.close.id);
});
