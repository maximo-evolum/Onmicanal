import test from "node:test";
import assert from "node:assert/strict";
import { bankPeriodImpact, bankPeriodRestrictions, assertBankPeriodsOpen, deleteBankStatementInOpenPeriods } from "../src/services/finance-bank-periods.service.js";
import { withFinanceWrite } from "../src/services/finance-integrity.service.js";

function database() {
  let records = [], controls = [], audits = [];
  const locks = [];
  const match = (row, where = {}) => Object.entries(where).every(([key, value]) => value?.in ? value.in.includes(row[key]) : value?.path ? value.path.reduce((obj, part) => obj?.[part], row[key]) === value.equals : row[key] === value);
  const db = {
    locks, get records() { return records; }, get controls() { return controls; }, get audits() { return audits; },
    $transaction: async (fn, options) => {
      assert.equal(options.isolationLevel, "Serializable");
      const before = structuredClone({ records, controls, audits });
      try { return await fn(db); } catch (error) { records = before.records; controls = before.controls; audits = before.audits; throw error; }
    },
    financePeriodControl: {
      findMany: async ({ where }) => structuredClone(controls.filter((row) => match(row, where))),
      upsert: async ({ where, create }) => {
        locks.push(where.tenantId_period.period);
        let row = controls.find((item) => match(item, where.tenantId_period));
        if (!row) { row = structuredClone(create); controls.push(row); } else row.lockVersion = (row.lockVersion || 0) + 1;
        return structuredClone(row);
      }
    },
    industryRecord: {
      findFirst: async ({ where }) => structuredClone(records.find((row) => match(row, where)) || null),
      findMany: async ({ where, cursor, skip = 0, take }) => {
        const rows = records.filter((row) => match(row, where));
        const start = cursor ? rows.findIndex((row) => row.id === cursor.id) + skip : 0;
        return structuredClone(rows.slice(start, start + take));
      },
      deleteMany: async ({ where }) => { const count = records.filter((row) => match(row, where)).length; records = records.filter((row) => !match(row, where)); return { count }; },
      delete: async ({ where }) => { records = records.filter((row) => !match(row, where)); }
    },
    tenantAuditLog: { create: async ({ data }) => { audits.push(data); return data; } }
  };
  return db;
}
const movement = (id = "m1", date = "2026-01-10", tenantId = "a") => ({ id, tenantId, recordType: "bank_movement", status: "PENDING", data: { transactionDate: date, importBatchId: "batch" } });
function seeded(count = 1) {
  const db = database();
  db.records.push({ id: "batch", tenantId: "a", recordType: "bank_statement", status: "IMPORTED", data: { sourceFile: "Cartola enero.xlsx", originalId: "original", importJobId: "job" } });
  for (let i = 0; i < count; i++) db.records.push(movement(`m${i}`));
  return db;
}
const remove = (db) => deleteBankStatementInOpenPeriods(db, { tenantId: "a", userId: "admin", batchId: "batch" });
const closed = (db, period = "2026-01", tenantId = "a") => db.controls.push({ tenantId, period, status: "CLOSED", version: 1, lockVersion: 0 });

test("extrae meses únicos ordenados de movimientos y excepciones", () => {
  assert.deepEqual(bankPeriodImpact([{ date: "2026-02-01" }, movement(), { data: { movement: { transactionDate: "2026-01-31" } } }, { transactionDate: new Date("2026-03-01T00:00:00Z") }]), { periods: ["2026-01", "2026-02", "2026-03"], undatedRows: [] });
});
test("no adivina períodos ni utiliza createdAt cuando la fecha es inválida", () => {
  const result = bankPeriodImpact([{ id: "sin-fecha", createdAt: "2026-01-01" }, { date: "2026-02-30" }, { date: new Date("invalid") }, { date: "2026-13-01" }]);
  assert.deepEqual(result.periods, []); assert.equal(result.undatedRows.length, 4);
});
test("consulta preventiva es de sólo lectura y aislada por empresa", async () => {
  const db = database(); closed(db, "2026-01", "otra"); closed(db, "2026-02");
  const result = await bankPeriodRestrictions(db, "a", [movement()]);
  assert.equal(result.blocked, false); assert.deepEqual(db.locks, []);
});
test("informa tanto meses cerrados como filas sin fecha", async () => {
  const db = database(); closed(db);
  const result = await bankPeriodRestrictions(db, "a", [movement(), { id: "inválida" }]);
  assert.equal(result.blocked, true); assert.deepEqual(result.closedPeriods, ["2026-01"]); assert.match(result.message, /sin fecha válida/);
});
test("bloquea toda una cartola multimes y revierte los cerrojos de meses abiertos", async () => {
  const db = database(); closed(db, "2026-02");
  await assert.rejects(withFinanceWrite(db, async (tx) => { await assertBankPeriodsOpen(tx, "a", [movement("feb", "2026-02-01"), movement()], "Dos meses.xlsx"); db.records.push(movement()); }), /Dos meses.xlsx.*No se modificó/);
  assert.equal(db.records.length, 0); assert.equal(db.controls.length, 1); assert.equal(db.controls[0].lockVersion, 0);
  assert.deepEqual(db.locks, ["2026-01", "2026-02"]);
});
test("permite un período reabierto sin alterar fotografías históricas", async () => {
  const db = database(); db.controls.push({ tenantId: "a", period: "2026-01", status: "OPEN", version: 2 });
  db.records.push({ id: "cierre-antiguo", recordType: "finance_monthly_close", status: "CLOSED" });
  await withFinanceWrite(db, (tx) => assertBankPeriodsOpen(tx, "a", [movement()]));
  assert.equal(db.records[0].status, "CLOSED"); assert.equal(db.controls[0].version, 2);
});
test("al reprocesar protege también el mes original aunque la revisión cambie la fecha", async () => {
  const db = database(); closed(db);
  await assert.rejects(withFinanceWrite(db, async (tx) => {
    await assertBankPeriodsOpen(tx, "a", [movement("nueva", "2026-02-10")]);
    await assertBankPeriodsOpen(tx, "a", [{ data: { movement: { transactionDate: "2026-01-10" } } }]);
    db.records.push(movement());
  }), /cerrado/);
  assert.equal(db.records.length, 0); assert.equal(db.controls.length, 1);
});
test("elimina movimientos y excepciones en una transacción con auditoría", async () => {
  const db = seeded(); db.records.push({ id: "ex", tenantId: "a", recordType: "finance_exception", data: { importBatchId: "batch", movement: { date: "2026-01-10" } } });
  const result = await remove(db);
  assert.deepEqual(result.deleted, { statementId: "batch", movements: 1, exceptions: 1 });
  assert.equal(db.records.length, 0); assert.equal(db.audits.length, 1);
  assert.equal(db.audits[0].metadata.originalId, "original"); assert.deepEqual(db.audits[0].metadata.periods, ["2026-01"]);
});
test("la eliminación recorre todas las páginas sin afectar otra empresa", async () => {
  const db = seeded(1001); db.records.push(movement("ajeno", "2026-01-10", "b"));
  const result = await remove(db); assert.equal(result.deleted.movements, 1001);
  assert.deepEqual(db.records.map((row) => row.id), ["ajeno"]);
});
test("rechaza eliminación de meses cerrados sin borrar ni auditar cambios", async () => {
  const db = seeded(); closed(db); await assert.rejects(remove(db), /cerrado/);
  assert.equal(db.records.length, 2); assert.equal(db.audits.length, 0);
});
test("rechaza eliminar cartola con fechas desconocidas", async () => {
  const db = seeded(); delete db.records[1].data.transactionDate;
  await assert.rejects(remove(db), /determinar el período/); assert.equal(db.records.length, 2);
});
test("conserva cartolas conciliadas", async () => {
  const db = seeded(); db.records[1].status = "MATCHED";
  await assert.rejects(remove(db), /conciliados/); assert.equal(db.records.length, 2);
});
test("conserva evidencia de conciliaciones revertidas", async () => {
  const db = seeded(); db.records.push({ id: "rec", tenantId: "a", recordType: "finance_reconciliation", status: "REVERSED", data: { movementId: "m0" } });
  await assert.rejects(remove(db), /historial/); assert.equal(db.records.length, 3);
});
test("fallo de auditoría revierte toda la eliminación", async () => {
  const db = seeded(); db.tenantAuditLog.create = async () => { throw new Error("auditoría caída"); };
  await assert.rejects(remove(db), /auditoría/); assert.equal(db.records.length, 2); assert.equal(db.controls.length, 0);
});
test("no elimina cartolas inexistentes ni las de otra empresa", async () => {
  const db = seeded(); await assert.rejects(deleteBankStatementInOpenPeriods(db, { tenantId: "b", batchId: "batch" }), /no encontrada/);
  assert.equal(db.records.length, 2);
});
test("no vuelve a eliminar una cartola reprocesada", async () => {
  const db = seeded(); db.records[0].status = "REPROCESSED";
  await assert.rejects(remove(db), /activa/); assert.equal(db.records.length, 2);
});
