import test from "node:test";
import assert from "node:assert/strict";
import { createBankImportJob, analyzeBankImportJob, readBankImportPreview, cancelBankImportJob, bankImportConfirmation, getBankImportJob, importJobView, IMPORT_LEASE_MS } from "../src/services/finance-import-jobs.service.js";
import { addPendingImportsToClose } from "../src/services/finance-monthly-close.service.js";

// In-memory adapter tests lifecycle and tenant filtering; it does not replace
// an integration test of the PostgreSQL migration and Serializable isolation.
function database() {
  const state = { originals: [], jobs: [], revisions: [], records: [] };
  let sequence = 0;
  const matches = (row, where) => Object.entries(where || {}).every(([key, value]) =>
    value && typeof value === "object" && "in" in value ? value.in.includes(row[key]) : row[key] === value);
  const db = {
    state,
    $transaction: async (fn, options) => {
      assert.equal(options.isolationLevel, "Serializable");
      return fn(db);
    },
    financeBankOriginal: {
      findUnique: async ({ where }) => state.originals.find((item) => matches(item, where.tenantId_sha256)) || null,
      aggregate: async ({ where }) => ({ _sum: { size: state.originals.filter((item) => matches(item, where)).reduce((sum, item) => sum + item.size, 0) } }),
      create: async ({ data }) => { const row = { id: `original-${++sequence}`, ...data }; state.originals.push(row); return row; }
    },
    financeBankImportJob: {
      findFirst: async ({ where, include }) => {
        const row = state.jobs.find((item) => matches(item, where));
        return row ? { ...row, ...(include?.original ? { original: state.originals.find((item) => item.id === row.originalId) } : {}) } : null;
      },
      count: async ({ where }) => state.jobs.filter((item) => matches(item, where)).length,
      create: async ({ data }) => {
        const row = { id: `job-${++sequence}`, status: "RECEIVED", revision: 0, updatedAt: new Date(), ...data };
        state.jobs.push(row); return { ...row };
      },
      update: async ({ where, data }) => {
        const row = state.jobs.find((item) => matches(item, where));
        assert.ok(row); Object.assign(row, data, { updatedAt: new Date() }); return { ...row };
      },
      updateMany: async ({ where, data }) => {
        const rows = state.jobs.filter((item) => matches(item, where));
        rows.forEach((item) => Object.assign(item, data, { updatedAt: new Date() })); return { count: rows.length };
      }
    },
    financeBankImportRevision: {
      findUnique: async ({ where }) => state.revisions.find((item) => matches(item, where.jobId_revision)) || null,
      create: async ({ data }) => { state.revisions.push(structuredClone(data)); return data; }
    },
    industryRecord: { findFirst: async ({ where }) => state.records.find((item) => matches(item, where)) || null }
  };
  return db;
}
const file = { buffer: Buffer.from("fecha;monto;descripcion\n2026-01-02;100;Transferencia"), originalname: "Enero.csv" };
const preview = { sourceRows: [{ fecha: "2026-01-02", monto: 100 }], account: { bankKey: "santander" }, periodRange: { from: "2026-01-02", to: "2026-01-02" } };
const create = (db, tenantId = "empresa-a") => createBankImportJob(db, { tenantId, userId: "admin", file, account: { bankKey: "santander" } });
const analyze = (db, id, run = async () => preview) => analyzeBankImportJob(db, { tenantId: "empresa-a", id, analyze: run });

test("conserva original exacto, revisión y recuperación sin reenviar archivo", async () => {
  const db = database(); const job = await create(db);
  assert.equal(job.status, "RECEIVED");
  const result = await analyze(db, job.id, async ({ file: original }) => { assert.deepEqual(original.buffer, file.buffer); return preview; });
  const recovered = await readBankImportPreview(db, "empresa-a", job.id);
  assert.equal(recovered.job.status, "READY");
  assert.deepEqual(recovered.preview, result);
  assert.equal(recovered.preview.revision, 1);
  assert.equal("original" in recovered.job, false);
  assert.equal("runToken" in recovered.job, false);
});
test("un doble clic reutiliza una carga pendiente y no duplica bytes", async () => {
  const db = database(); const first = await create(db); const second = await create(db);
  assert.equal(first.id, second.id); assert.equal(db.state.originals.length, 1); assert.equal(db.state.jobs.length, 1);
});
test("la deduplicación y el acceso están aislados por empresa", async () => {
  const db = database(); const job = await create(db); await create(db, "empresa-b");
  assert.equal(db.state.originals.length, 2);
  for (const action of [() => getBankImportJob(db, "empresa-b", job.id, { original: true }), () => readBankImportPreview(db, "empresa-b", job.id), () => cancelBankImportJob(db, "empresa-b", job.id), () => bankImportConfirmation(db, "empresa-b", job.id, 1)]) {
    await assert.rejects(action, (error) => error.status === 404);
  }
});
test("una sesión sin empresa no puede consultar ni guardar originales", async () => {
  const db = database(); const job = await create(db);
  await assert.rejects(() => getBankImportJob(db, undefined, job.id), (error) => error.status === 403);
  await assert.rejects(() => createBankImportJob(db, { file }), (error) => error.status === 403);
});
test("reutiliza la carga confirmada por otra solicitud ante un conflicto único del original", async () => {
  const db = database(); const job = await create(db);
  db.$transaction = async () => { throw Object.assign(new Error("unique"), { code: "P2002" }); };
  assert.equal((await create(db)).id, job.id);
});
test("reanálisis crea revisión nueva y rechaza confirmar la revisión obsoleta", async () => {
  const db = database(); const job = await create(db); await analyze(db, job.id); await analyze(db, job.id);
  assert.deepEqual(db.state.revisions.map((item) => item.revision), [1, 2]);
  await assert.rejects(() => bankImportConfirmation(db, "empresa-a", job.id, 1), (error) => error.status === 409);
  const confirmed = await bankImportConfirmation(db, "empresa-a", job.id, 2);
  assert.deepEqual(confirmed.preview.sourceRows, preview.sourceRows);
});
test("el mapeo y las exclusiones se guardan con revisión y no se pierden en un reintento", async () => {
  const db = database(); const job = await create(db);
  const reviewPreview = { ...preview, sourceRows: [{ "Fecha bancaria": "02/01/2026" }, { "Fecha bancaria": "03/01/2026" }] };
  await analyze(db, job.id, async () => reviewPreview);
  const reviewConfig = { mapping: { date: "Fecha bancaria" }, excludedRows: [{ dataRow: 1, reason: "Registro duplicado del extracto" }] };
  await analyzeBankImportJob(db, { tenantId: "empresa-a", id: job.id, expectedRevision: 1, reviewConfig,
    analyze: async (input) => { assert.deepEqual(input.reviewConfig, reviewConfig); return { ...reviewPreview, reviewConfig: input.reviewConfig }; } });
  assert.deepEqual(db.state.jobs[0].reviewConfig, reviewConfig);
  assert.deepEqual((await bankImportConfirmation(db, "empresa-a", job.id, 2)).preview.reviewConfig, reviewConfig);
  await analyzeBankImportJob(db, { tenantId: "empresa-a", id: job.id, analyze: async (input) => { assert.deepEqual(input.reviewConfig, reviewConfig); return reviewPreview; } });
  await assert.rejects(() => analyzeBankImportJob(db, { tenantId: "empresa-a", id: job.id, expectedRevision: 1, reviewConfig, analyze: async () => preview }), (e) => e.status === 409);
});
test("rechazar mapeo inválido o exclusión total no destruye la revisión lista", async () => {
  const db = database(); const job = await create(db); await analyze(db, job.id);
  for (const reviewConfig of [{ mapping: { date: "No existe" } }, { excludedRows: [{ dataRow: 1, reason: "Exclusión total" }] }]) {
    await assert.rejects(() => analyzeBankImportJob(db, { tenantId: "empresa-a", id: job.id, reviewConfig, expectedRevision: 1, analyze: async () => preview }), (e) => e.status === 400);
    assert.equal(db.state.jobs[0].status, "READY"); assert.equal(db.state.jobs[0].revision, 1);
  }
});
test("el parser fallido conserva original y error para reintentar", async () => {
  const db = database(); const job = await create(db);
  await assert.rejects(() => analyze(db, job.id, async () => { throw new Error("No hay fechas válidas"); }), /No hay fechas válidas/);
  assert.equal(db.state.jobs[0].status, "FAILED"); assert.equal(db.state.revisions[0].status, "FAILED");
  assert.deepEqual(db.state.originals[0].content, file.buffer);
  await analyze(db, job.id); assert.equal(db.state.jobs[0].status, "READY");
});
test("impide análisis paralelo; permite recuperar uno interrumpido después del plazo", async () => {
  const db = database(); const job = await create(db);
  Object.assign(db.state.jobs[0], { status: "PROCESSING", runToken: "viejo", updatedAt: new Date() });
  await assert.rejects(() => analyze(db, job.id), (error) => error.status === 409);
  db.state.jobs[0].updatedAt = new Date(Date.now() - IMPORT_LEASE_MS - 1000);
  assert.equal(importJobView(db.state.jobs[0]).recoverable, true);
  await analyze(db, job.id); assert.equal(db.state.jobs[0].status, "READY");
});
test("una cancelación durante el análisis impide que el resultado tardío lo reactive", async () => {
  const db = database(); const job = await create(db);
  await assert.rejects(() => analyze(db, job.id, async () => { await cancelBankImportJob(db, "empresa-a", job.id); return preview; }), (error) => error.status === 409);
  assert.equal(db.state.jobs[0].status, "CANCELLED"); assert.equal(db.state.revisions.length, 0);
  await assert.rejects(() => bankImportConfirmation(db, "empresa-a", job.id, 1), (error) => error.status === 409);
});
test("verifica integridad del original antes de volver a analizarlo", async () => {
  const db = database(); const job = await create(db); db.state.originals[0].content = Buffer.from("alterado");
  await assert.rejects(() => analyze(db, job.id), /integridad/);
  assert.equal(db.state.jobs[0].status, "FAILED");
});
test("reintentar confirmación importada devuelve el lote y no solicita nuevos movimientos", async () => {
  const db = database(); const job = await create(db); await analyze(db, job.id);
  Object.assign(db.state.jobs[0], { status: "IMPORTED", batchId: "lote-1" });
  db.state.records.push({ id: "lote-1", tenantId: "empresa-a", recordType: "bank_statement", status: "IMPORTED", data: { importedRows: 1 } });
  const result = await bankImportConfirmation(db, "empresa-a", job.id, 1);
  assert.equal(result.batch.id, "lote-1"); assert.equal(result.preview, undefined);
  db.state.records[0].status = "DELETED";
  await assert.rejects(() => bankImportConfirmation(db, "empresa-a", job.id, 1), /eliminada o reemplazada/);
});
test("rechaza confirmación sin revisión guardada y archivos vacíos o mayores de 12 MB", async () => {
  const db = database();
  await assert.rejects(() => bankImportConfirmation(db, "empresa-a", undefined, undefined), (error) => error.status === 400);
  for (const buffer of [Buffer.alloc(0), Buffer.alloc(12 * 1024 * 1024 + 1)]) await assert.rejects(() => createBankImportJob(db, { tenantId: "empresa-a", file: { buffer } }), (error) => error.status === 400);
  assert.equal(db.state.originals.length, 0);
});
test("limita el almacenamiento y las importaciones activas por empresa", async () => {
  const db = database();
  db.state.originals.push({ id: "otro", tenantId: "empresa-a", size: 256 * 1024 * 1024, sha256: "otro" });
  await assert.rejects(() => create(db), (error) => error.status === 413);
  db.state.originals.length = 0;
  db.state.jobs.push(...Array.from({ length: 100 }, (_, index) => ({ id: `${index}`, tenantId: "empresa-a", status: "READY" })));
  await assert.rejects(() => create(db), (error) => error.status === 409);
});
test("el cierre avisa de cargas del período y de cargas cuyo período se desconoce", () => {
  const base = { period: "2026-01", status: "READY_TO_CLOSE", blockers: [] };
  const jobs = [
    { id: "enero", status: "READY", periodRange: preview.periodRange, sourceFile: "Enero.csv" },
    { id: "fallida", status: "FAILED", sourceFile: "Sin-fecha.csv" },
    { id: "cancelada", status: "CANCELLED" },
    { id: "otra", status: "READY", periodRange: { from: "2026-02-01", to: "2026-02-28" } }
  ];
  const result = addPendingImportsToClose(base, jobs);
  assert.equal(result.status, "REQUIRES_REVIEW"); assert.deepEqual(result.blockers.map((item) => item.id), ["enero", "fallida"]);
});
