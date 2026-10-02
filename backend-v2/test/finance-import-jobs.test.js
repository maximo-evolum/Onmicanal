import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createServer } from "node:http";
import { prisma } from "../src/lib/db.js";
import { financeRouter } from "../src/routes/finance.routes.js";
import { createBankImportJob, analyzeBankImportJob, readBankImportPreview, cancelBankImportJob, bankImportConfirmation, getBankImportJob, importJobView, IMPORT_LEASE_MS, runBankImportWorker, startBankImportWorker } from "../src/services/finance-import-jobs.service.js";
import { addPendingImportsToClose } from "../src/services/finance-monthly-close.service.js";
import { FinanceOperationError } from "../src/services/finance-integrity.service.js";

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
      findMany: async ({ where, take }) => state.jobs.filter((item) => where.OR.some((condition) => item.status === condition.status && new Date(item.updatedAt) <= condition.updatedAt.lte)).slice(0, take).map((row) => ({ ...row })),
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

test("cambiar tabla exige limpiar exclusiones y mapeos; conserva original y revisiones", async () => {
  const db = database(); const job = await create(db); await analyze(db, job.id);
  for (const reviewConfig of [
    { selection: { headerRow: 2 }, mapping: { date: "fecha" } },
    { selection: { headerRow: 2 }, excludedRows: [{ dataRow: 1, reason: "Exclusión anterior" }] }
  ]) await assert.rejects(analyzeBankImportJob(db, { tenantId: "empresa-a", id: job.id, reviewConfig, expectedRevision: 1, analyze: async () => preview }), /limpia/);
  const reviewConfig = { selection: { headerRow: 2 }, mapping: {}, excludedRows: [] };
  await analyzeBankImportJob(db, { tenantId: "empresa-a", id: job.id, reviewConfig, expectedRevision: 1, analyze: async (input) => ({ ...preview, reviewConfig: input.reviewConfig }) });
  assert.equal(db.state.revisions.length, 2); assert.deepEqual(db.state.originals[0].content, file.buffer);
  assert.deepEqual((await bankImportConfirmation(db, "empresa-a", job.id, 2)).preview.reviewConfig, reviewConfig);
  await assert.rejects(bankImportConfirmation(db, "empresa-a", job.id, 1), /cambió/);
});

test("un fallo al releer no elimina la revisión anterior y una selección posterior puede recuperarse", async () => {
  const db = database(); const job = await create(db); await analyze(db, job.id);
  await assert.rejects(analyzeBankImportJob(db, { tenantId: "empresa-a", id: job.id, expectedRevision: 1, reviewConfig: { selection: { sheet: "Otra" } }, analyze: async () => { throw new FinanceOperationError(400, "Hoja no encontrada"); } }), /Hoja/);
  assert.equal(db.state.jobs[0].status, "FAILED"); assert.deepEqual(db.state.revisions[0].preview.sourceRows, preview.sourceRows);
  await analyzeBankImportJob(db, { tenantId: "empresa-a", id: job.id, expectedRevision: 2, reviewConfig: { selection: { sheet: "Correcta" } }, analyze: async () => preview });
  assert.equal(db.state.jobs[0].status, "READY"); assert.equal(db.state.jobs[0].revision, 3);
});
test("el parser fallido conserva original y error para reintentar", async () => {
  const db = database(); const job = await create(db);
  await assert.rejects(() => analyze(db, job.id, async () => { throw new FinanceOperationError(400, "No hay fechas válidas"); }), /No hay fechas válidas/);
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

test("cola durable procesa originales recibidos sin navegador ni movimientos nuevos", async () => {
  const db = database(), job = await create(db);
  db.state.jobs[0].updatedAt = new Date(Date.now() - 31000);
  assert.deepEqual(await runBankImportWorker(db, { analyze: async () => preview }), [{ id: job.id, status: "READY" }]);
  assert.equal(db.state.jobs[0].attempts, 1); assert.equal(db.state.records.length, 0);
  assert.equal((await runBankImportWorker(db, { analyze: async () => { throw Error("no debe ejecutarse"); } })).length, 0);
});
test("reinicio recupera trabajo vencido y conserva bytes originales", async () => {
  const db = database(), job = await create(db);
  Object.assign(db.state.jobs[0], { status: "PROCESSING", runToken: "proceso-anterior", revision: 1, attempts: 1, updatedAt: new Date(Date.now() - IMPORT_LEASE_MS - 1) });
  await runBankImportWorker(db, { analyze: async ({ file: source }) => { assert.deepEqual(source.buffer, file.buffer); return preview; } });
  assert.equal(db.state.jobs[0].status, "READY"); assert.equal(db.state.jobs[0].attempts, 2);
});
test("tres interrupciones quedan fallidas y no forman un ciclo infinito", async () => {
  const db = database(); await create(db);
  Object.assign(db.state.jobs[0], { status: "PROCESSING", runToken: "anterior", attempts: 3, updatedAt: new Date(Date.now() - IMPORT_LEASE_MS - 1) });
  let calls = 0; await runBankImportWorker(db, { analyze: async () => { calls++; return preview; } });
  assert.equal(calls, 0); assert.equal(db.state.jobs[0].status, "FAILED"); assert.match(db.state.jobs[0].error, /tres veces/);
});
test("error transitorio reintenta con espera y máximo tres intentos", async () => {
  const db = database(); await create(db);
  for (let i = 1; i <= 3; i++) {
    db.state.jobs[0].updatedAt = new Date(Date.now() - 31000);
    await runBankImportWorker(db, { analyze: async () => { throw Object.assign(Error("secret DB URL"), { code: "P1001" }); } });
    assert.equal(db.state.jobs[0].attempts, i);
    assert.equal(db.state.jobs[0].status, i === 3 ? "FAILED" : "RECEIVED");
    assert.equal((await runBankImportWorker(db, { analyze: async () => preview })).length, 0);
    assert.doesNotMatch(db.state.jobs[0].error, /secret/);
  }
});
test("archivo inválido no impide procesar los otros y no reintenta automáticamente", async () => {
  const db = database(); await create(db); await create(db, "empresa-b");
  db.state.jobs.forEach((job) => { job.updatedAt = new Date(Date.now() - 31000); });
  const result = await runBankImportWorker(db, { analyze: async ({ tenantId }) => { if (tenantId === "empresa-a") throw new FinanceOperationError(400, "Archivo inválido"); return preview; } });
  assert.equal(result.length, 2); assert.equal(db.state.jobs[0].status, "FAILED"); assert.equal(db.state.jobs[1].status, "READY");
});
test("reanudar manualmente conserva selección y reinicia límite de intentos", async () => {
  const db = database(), job = await create(db); await analyze(db, job.id);
  Object.assign(db.state.jobs[0], { status: "FAILED", attempts: 3 });
  const queued = await analyzeBankImportJob(db, { tenantId: "empresa-a", id: job.id, queueOnly: true, reviewConfig: {}, expectedRevision: 1 });
  assert.equal(queued.status, "RECEIVED"); assert.equal(queued.attempts, 0); assert.equal(queued.revision, 2);
  await assert.rejects(bankImportConfirmation(db, "empresa-a", job.id, 1), /cambió/);
  await assert.rejects(analyzeBankImportJob(db, { tenantId: "empresa-a", id: job.id, queueOnly: true, reviewConfig: {}, expectedRevision: 1 }), /cambió/);
});
test("timeout deja error y un resultado tardío no puede publicar la revisión", async () => {
  const db = database(), job = await create(db); let finish;
  await assert.rejects(analyzeBankImportJob(db, { tenantId: "empresa-a", id: job.id, timeoutMs: 5, analyze: () => new Promise((r) => { finish = r; }) }), (e) => e.status === 408);
  finish(preview); await new Promise((r) => setTimeout(r, 10));
  assert.equal(db.state.jobs[0].status, "FAILED"); assert.equal(db.state.revisions.filter((r) => r.status === "READY").length, 0);
});
test("otro worker no vuelve a analizar un trabajo ya terminado", async () => {
  const db = database(), job = await create(db); await analyze(db, job.id);
  await assert.rejects(analyzeBankImportJob(db, { tenantId: "empresa-a", id: job.id, background: true, analyze: async () => { throw Error("no debe ejecutarse"); } }), (e) => e.status === 409);
});
test("fallo de infraestructura al guardar conserva el trabajo recuperable", async () => {
  const db = database(), job = await create(db); const transaction = db.$transaction; let count = 0;
  db.$transaction = async (...args) => { if (++count > 1) throw Object.assign(Error("offline"), { code: "P1001" }); return transaction(...args); };
  await assert.rejects(analyze(db, job.id));
  assert.equal(db.state.jobs[0].status, "PROCESSING"); assert.deepEqual(db.state.originals[0].content, file.buffer);
});
test("el temporizador no solapa ciclos y puede detenerse", async () => {
  let calls = 0, release;
  const db = { financeBankImportJob: { findMany: async () => { calls++; await new Promise((r) => { release = r; }); return []; } } };
  const stop = startBankImportWorker(db, async () => preview, { intervalMs: 2 });
  await new Promise((r) => setTimeout(r, 12)); assert.equal(calls, 1);
  stop(); release(); await new Promise((r) => setTimeout(r, 10)); assert.equal(calls, 1);
});

test("HTTP: recepción asíncrona, permisos, revisión obligatoria y aislamiento de empresa", async (t) => {
  const db = database(), originalTransaction = prisma.$transaction, originalModules = prisma.tenantModule.findMany;
  const originalFind = prisma.financeBankImportJob.findFirst;
  let allowed = true;
  prisma.$transaction = (...args) => db.$transaction(...args);
  prisma.financeBankImportJob.findFirst = (...args) => db.financeBankImportJob.findFirst(...args);
  prisma.tenantModule.findMany = async ({ where }) => where.module.in.map((module) => ({ module, enabled: allowed, source: "MANUAL" }));
  t.after(() => { prisma.$transaction = originalTransaction; prisma.tenantModule.findMany = originalModules; prisma.financeBankImportJob.findFirst = originalFind; });
  const app = express(); app.use(express.json());
app.use((req, _res, next) => { req.tenantId = req.headers["x-tenant"] || "empresa-a"; req.tenant = { id: req.tenantId, industry: "FINANCE" }; req.user = { tenantId: req.tenantId, id: "user", role: req.headers["x-role"] || "ADMIN" }; next(); });
  app.use(financeRouter);
  const server = createServer(app); await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}/finance/bank-import-jobs`;
  const upload = (headers = {}) => {
    const form = new FormData(); form.append("file", new Blob([file.buffer], { type: "text/csv" }), file.originalname);
    form.append("tenantId", "empresa-atacante");
    return fetch(`${base}/upload`, { method: "POST", body: form, headers, signal: AbortSignal.timeout(5000) });
  };
  const received = await upload(); assert.equal(received.status, 202); assert.equal(received.headers.get("cache-control"), "no-store");
  const { job } = await received.json(); assert.equal(job.status, "RECEIVED"); assert.equal(job.tenantId, "empresa-a"); assert.equal(db.state.revisions.length, 0); assert.equal(db.state.records.length, 0);
  assert.equal((await (await upload()).json()).job.id, job.id); assert.equal(db.state.originals.length, 1);
  assert.equal((await upload({ "x-role": "VIEWER" })).status, 403);
  allowed = false; assert.equal((await upload()).status, 403); allowed = true;
  const enqueue = (data, headers = {}) => fetch(`${base}/${job.id}/enqueue`, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(data), signal: AbortSignal.timeout(5000) });
  assert.equal((await enqueue({})).status, 428);
  assert.equal((await enqueue({ revision: 99 })).status, 409);
  assert.equal((await enqueue({ revision: 0 }, { "x-tenant": "empresa-b" })).status, 404);
  assert.equal((await enqueue({ revision: 0 })).status, 202);
  assert.equal(db.state.jobs[0].revision, 1); assert.equal(db.state.jobs[0].status, "RECEIVED");
});
