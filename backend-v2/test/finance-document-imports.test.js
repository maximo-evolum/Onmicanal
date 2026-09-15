import test from "node:test";
import assert from "node:assert/strict";
import { importHistoricalDocuments, importSiiDocuments } from "../src/services/finance-document-imports.service.js";
import { documentImportRestrictions } from "../src/services/finance-document-periods.service.js";
import { normalizeHistoricalFinanceRows, MAX_MIGRATION_ROWS } from "../src/services/finance-migration.service.js";
import { parseSiiDteFiles, MAX_SII_DTE_FILES } from "../src/services/finance-sii-dte.service.js";

function database() {
  let rows = [], controls = [], audits = [], seq = 0; let tail = Promise.resolve();
  const match = (row, where = {}) => Object.entries(where).every(([key, v]) => v?.in ? v.in.includes(row[key]) : v?.path ? v.path.reduce((x, p) => x?.[p], row[key]) === v.equals : row[key] === v);
  const db = {
    get rows() { return rows; }, get controls() { return controls; }, get audits() { return audits; },
    $transaction: (fn, options) => {
      assert.equal(options.isolationLevel, "Serializable");
      const result = tail.then(async () => { const before = structuredClone({ rows, controls, audits }); try { return await fn(db); } catch (e) { rows = before.rows; controls = before.controls; audits = before.audits; throw e; } });
      tail = result.catch(() => {}); return result;
    },
    financePeriodControl: {
      findMany: async ({ where }) => structuredClone(controls.filter((row) => match(row, where))),
      upsert: async ({ where, create }) => { let row = controls.find((r) => match(r, where.tenantId_period)); if (!row) { row = structuredClone(create); controls.push(row); } else row.lockVersion = (row.lockVersion || 0) + 1; return structuredClone(row); }
    },
    industryRecord: {
      findMany: async ({ where, cursor, skip = 0, take = 500 }) => { const list = rows.filter((r) => match(r, where)); const start = cursor ? list.findIndex((r) => r.id === cursor.id) + skip : 0; return structuredClone(list.slice(start, start + take)); },
      create: async ({ data }) => { const row = { id: `r-${++seq}`, ...structuredClone(data) }; rows.push(row); return structuredClone(row); },
      createMany: async ({ data }) => { for (const row of data) await db.industryRecord.create({ data: row }); },
      update: async ({ where, data }) => { const row = rows.find((r) => match(r, where)); assert.ok(row); Object.assign(row, structuredClone(data)); return structuredClone(row); }
    },
    tenantAuditLog: { create: async ({ data }) => { audits.push(data); return data; } }
  }; return db;
}
const historical = (extra = {}) => ({ folio: "101", cliente: "Cliente de prueba", rut: "11111111-1", monto: 100, saldo: 100, fecha_emision: "2026-01-10", estado: "pendiente", ...extra });
const migrate = (db, rows = [historical()], tenantId = "a") => importHistoricalDocuments(db, { tenantId, userId: "admin", sourceFile: "historial.csv", rows });
const doc = (extra = {}) => ({ sourceFile: "factura.xml", emitterRut: "76123456-7", receiverRut: "11111111-1", emitterName: "Empresa de prueba", receiverName: "Cliente", documentTypeCode: "33", documentNumber: "101", issueDate: "2026-01-10", amount: 100, ...extra });
const note = (extra = {}) => doc({ documentTypeCode: "61", documentNumber: "NC-1", issueDate: "2026-02-01", amount: 20, referenceDocumentType: "33", referenceDocumentNumber: "101", ...extra });
const dte = (db, documents = [doc()], tenantId = "a") => importSiiDocuments(db, { tenantId, userId: "admin", sii: { companyRut: "76123456-7", environment: "certification" }, documents });
const close = (db, period, tenantId = "a") => { const existing = db.controls.find((row) => row.tenantId === tenantId && row.period === period); if (existing) existing.status = "CLOSED"; else db.controls.push({ tenantId, period, status: "CLOSED" }); };
const byType = (db, type) => db.rows.filter((r) => r.recordType === type);

test("migra documentos abiertos con auditoría", async () => {
  const db = database(); const result = await migrate(db); assert.equal(result.imported, 1); assert.equal(byType(db, "finance_invoice").length, 1); assert.equal(db.audits.length, 1);
});
test("historial multimes bloquea todo el lote si uno está cerrado", async () => {
  const db = database(); close(db, "2026-02"); await assert.rejects(migrate(db, [historical(), historical({ folio: "102", fecha_emision: "2026-02-10" })]), /cerrado/); assert.equal(db.rows.length, 0);
});
test("un pago histórico conserva su fecha y valida ese período", async () => {
  const rows = [historical({ pagado: 40, saldo: 60, fecha_pago: "2026-02-10", estado: "parcial" })];
  const db = database(); await migrate(db, rows); assert.equal(byType(db, "finance_invoice_receipt")[0].data.paymentDate, "2026-02-10");
  const blocked = database(); close(blocked, "2026-02"); await assert.rejects(migrate(blocked, rows), /cerrado/); assert.equal(blocked.rows.length, 0);
});
test("pago histórico sin fecha queda como apertura y no inventa ingreso", async () => {
  const db = database(); await migrate(db, [historical({ pagado: 40, saldo: 60, estado: "parcial" })]);
  assert.equal(byType(db, "finance_invoice_receipt").length, 0); const opening = byType(db, "finance_opening_balance")[0]; assert.equal(opening.data.paymentDate, null); assert.equal(opening.data.amount, 40);
});
test("fechas históricas desconocidas o imposibles bloquean sin asumir hoy", async () => {
  for (const date of ["", "30/02/2026"]) { const db = database(); await assert.rejects(migrate(db, [historical({ fecha_emision: date })]), /fechas/); assert.equal(db.rows.length, 0); }
});
test("límites rechazan lotes completos sin recortarlos", async () => {
  assert.throws(() => normalizeHistoricalFinanceRows(Array(MAX_MIGRATION_ROWS + 1).fill(historical())), /supera/);
  await assert.rejects(dte(database(), Array(MAX_SII_DTE_FILES + 1).fill(doc())), /supera/);
});
test("reintento histórico idéntico no duplica lote documentos ni auditoría", async () => {
  const db = database(); await migrate(db); const count = db.rows.length; const retry = await migrate(db);
  assert.equal(retry.duplicateRows, 1); assert.equal(retry.imported, 0); assert.equal(db.rows.length, count); assert.equal(db.audits.length, 1);
});
test("no duplica historial del mismo documento con monto distinto", async () => {
  const db = database(); await migrate(db); await assert.rejects(migrate(db, [historical({ monto: 120, saldo: 120 })]), /datos diferentes/);
});
test("DTE de cliente y proveedor quedan separados", async () => {
  const db = database(); await dte(db, [doc(), doc({ emitterRut: "11111111-1", receiverRut: "76123456-7", documentNumber: "201" })]);
  assert.equal(byType(db, "finance_invoice").length, 1); assert.equal(byType(db, "finance_payable").length, 1);
});
test("DTE fechado en mes cerrado no crea lote ni documentos", async () => {
  const db = database(); close(db, "2026-01"); await assert.rejects(dte(db), /cerrado/); assert.equal(db.rows.length, 0);
});
test("nota nueva no modifica un documento objetivo de mes cerrado", async () => {
  const db = database(); await dte(db); close(db, "2026-01"); const before = structuredClone(db.rows);
  await assert.rejects(dte(db, [note()]), /cerrado/); assert.deepEqual(db.rows, before);
});
test("dos notas sobre la misma factura acumulan sus cambios", async () => {
  const db = database(); await dte(db, [doc(), note(), note({ documentNumber: "NC-2", amount: 30 })]);
  const invoice = byType(db, "finance_invoice")[0]; assert.equal(invoice.data.balance, 50); assert.equal(invoice.data.creditNotesTotal, 50);
});
test("notas también afectan cuentas de proveedor con identidad exacta", async () => {
  const db = database(); const supplier = { emitterRut: "11111111-1", receiverRut: "76123456-7" };
  await dte(db, [doc(supplier), note(supplier)]); assert.equal(byType(db, "finance_payable")[0].data.balance, 80); assert.ok(byType(db, "finance_document_adjustment")[0].data.payableId);
});
test("mismo folio con otro receptor no recibe la nota", async () => {
  const db = database(); const result = await dte(db, [doc(), note({ receiverRut: "22222222-2" })]);
  assert.equal(byType(db, "finance_invoice")[0].data.balance, 100); assert.equal(result.requiresReview, 1);
});
test("nota que supera saldo queda en revisión sin perder diferencia", async () => {
  const db = database(); const result = await dte(db, [doc(), note({ amount: 150 })]);
  assert.equal(result.requiresReview, 1); assert.equal(byType(db, "finance_invoice")[0].data.balance, 100); assert.equal(byType(db, "finance_exception").length, 1);
});
test("reimportar notas aplicadas no vuelve a descontar", async () => {
  const db = database(); await dte(db, [doc(), note()]); const n = db.rows.length; const result = await dte(db, [note()]);
  assert.equal(result.duplicates, 1); assert.equal(db.rows.length, n); assert.equal(byType(db, "finance_invoice")[0].data.balance, 80);
});
test("DTE con identidad repetida y monto diferente se rechaza", async () => {
  const db = database(); await dte(db); await assert.rejects(dte(db, [doc({ amount: 200 })]), /monto diferente/);
});
test("fallo de auditoría revierte ambas importaciones", async () => {
  for (const run of [migrate, dte]) { const db = database(); db.tenantAuditLog.create = async () => { throw new Error("audit"); }; await assert.rejects(run(db), /audit/); assert.equal(db.rows.length, 0); assert.equal(db.controls.length, 0); }
});
test("dos confirmaciones concurrentes no duplican DTE", async () => {
  const db = database(); const results = await Promise.all([dte(db), dte(db)]); assert.equal(results.reduce((s, r) => s + r.imported, 0), 1); assert.equal(db.audits.length, 1);
});
test("otra empresa no hereda documentos ni cierres", async () => {
  const db = database(); await dte(db); close(db, "2026-01"); await dte(db, [doc()], "b"); assert.equal(byType(db, "finance_invoice").length, 2);
});
test("la vista previa consulta el cierre del objetivo sin escribir controles", async () => {
  const db = database(); await dte(db); close(db, "2026-01"); const before = structuredClone(db.controls);
  const result = await documentImportRestrictions(db, "a", [{ ...note(), side: "CUSTOMER" }], "DTE");
  assert.deepEqual(result.closedPeriods, ["2026-01"]); assert.deepEqual(db.controls, before);
});
test("XML con varios documentos se rechaza sin omitir el segundo", () => {
  assert.throws(() => parseSiiDteFiles([{ originalname: "lote.xml", buffer: Buffer.from("<EnvioDTE><Documento></Documento><Documento></Documento></EnvioDTE>") }], { companyRut: "76123456-7" }), /varios DTE/);
});

test("fecha de pago mal escrita no se convierte en saldo sin fecha", async () => {
  const db = database(); await assert.rejects(migrate(db, [historical({ pagado: 40, saldo: 60, estado: "parcial", fecha_pago: "30/02/2026" })]), /fechas/); assert.equal(db.rows.length, 0);
});
test("la consulta completa encuentra duplicados después de mil documentos", async () => {
  const db = database();
  for (let i = 0; i < 1001; i++) db.rows.push({ id: `old-${i}`, tenantId: "a", recordType: "finance_invoice", status: "OPEN", data: { ...doc({ documentNumber: `old-${i}` }), balance: 100, documentSide: "CUSTOMER" } });
  await dte(db); const retry = await dte(db); assert.equal(retry.duplicates, 1); assert.equal(byType(db, "finance_invoice").length, 1002);
});
test("un lote idéntico ya registrado no se reescribe al cerrar su período", async () => {
  for (const run of [migrate, dte]) { const db = database(); await run(db); close(db, "2026-01"); const before = structuredClone(db.rows); const result = await run(db); assert.equal(result.imported, 0); assert.deepEqual(db.rows, before); }
});
