import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { qaEnvironment } from '../scripts/lib/qa-environment.mjs';
import { blockDotEnvReads } from '../scripts/lib/qa-runtime.mjs';

// Run only through the guarded QA command; no production .env is loaded.
const isolatedEnv = qaEnvironment(process.env, { requireRedis: false });
for (const key of Object.keys(process.env)) delete process.env[key];
Object.assign(process.env, isolatedEnv);
blockDotEnvReads();
const { PrismaClient, Prisma } = await import('@prisma/client');
const { prisma } = await import('../src/lib/db.js');
const { createBankImportJob, analyzeBankImportJob, readBankImportPreview, getBankImportJob } = await import('../src/services/finance-import-jobs.service.js');
const { withFinanceWrite } = await import('../src/services/finance-integrity.service.js');
const { financeRouter, analyzeStoredBankStatement } = await import('../src/routes/finance.routes.js');
const { authMiddleware, signAuthToken } = await import('../src/lib/auth.js');
const { MODULES } = await import('../src/lib/modules.js');
const { apiErrorHandler } = await import('../src/middleware/request-context.js');
const { default: express } = await import('express');

test('Finance QA: PostgreSQL real, migraciones y persistencia', { timeout: 90000 }, async (t) => {
  const ids = [];
  const run = `qa-${randomUUID()}`;
  let server;
  t.after(async () => {
    if (server) await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
    try {
      if (ids.length) await prisma.tenant.deleteMany({ where: { id: { in: ids } } });
    } finally { await prisma.$disconnect(); }
  });
  await prisma.$connect();

  await t.test('las importaciones del backend no cargaron credenciales de producción', () => {
    for (const key of ['OPENAI_API_KEY', 'NUBOX_API_BASE_URL', 'GOOGLE_CLIENT_SECRET', 'META_APP_SECRET']) {
      assert.ok(process.env[key] === undefined, `El entorno de pruebas heredó ${key}; valor omitido.`);
    }
    assert.equal(process.env.ENABLE_AUTOMATION, 'false');
    assert.equal(process.env.FINANCE_NUBOX_SYNC_ENABLED, 'false');
  });
  await t.test('la conexión apunta al usuario y base reservados de QA', async () => {
    const [identity] = await prisma.$queryRaw`SELECT current_database() AS database, current_user AS username`;
    assert.equal(identity.database, 'evolum_finance_test');
    assert.equal(identity.username, 'evolum_test');
  });
  await t.test('todas las migraciones finalizaron, incluida attempts', async () => {
    const expected = (await readdir(new URL('../prisma/migrations/', import.meta.url), { withFileTypes: true }))
      .filter(entry => entry.isDirectory()).map(entry => entry.name).sort();
    const applied = await prisma.$queryRaw`SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name`;
    assert.deepEqual(applied.map(row => row.migration_name), expected);
    const [attempts] = await prisma.$queryRaw`SELECT data_type, is_nullable, column_default FROM information_schema.columns WHERE table_schema='public' AND table_name='FinanceBankImportJob' AND column_name='attempts'`;
    assert.equal(attempts?.data_type, 'integer');
    assert.equal(attempts.is_nullable, 'NO');
    assert.ok(attempts.column_default.includes('0'));
  });
  await t.test('el esquema migrado contiene todas las columnas del cliente Prisma', async () => {
    const columns = await prisma.$queryRaw`SELECT table_name, column_name FROM information_schema.columns WHERE table_schema='public'`;
    const keys = new Set(columns.map(row => `${row.table_name}.${row.column_name}`));
    const missing = Prisma.dmmf.datamodel.models.flatMap(model => model.fields
      .filter(field => field.kind !== 'object' && !keys.has(`${model.dbName || model.name}.${field.dbName || field.name}`))
      .map(field => `${model.name}.${field.name}`));
    assert.deepEqual(missing, [], 'Hay diferencias reales entre las migraciones y schema.prisma');
  });

  const tenants = [];
  for (const suffix of ['a', 'b']) {
    const tenant = await prisma.tenant.create({ data: { name: `Empresa de prueba ${suffix}`, slug: `${run}-${suffix}`, industry: 'FINANCE', plan: 'ENTERPRISE' } });
    ids.push(tenant.id); tenants.push(tenant);
  }
  const [a, b] = tenants;
  const user = await prisma.workspaceUser.create({ data: { tenantId: a.id, name: 'Administrador de pruebas', email: `${run}@example.invalid`, role: 'ADMIN' } });
  const otherUser = await prisma.workspaceUser.create({ data: { tenantId: b.id, name: 'Otra empresa de prueba', email: `${run}-b@example.invalid`, role: 'ADMIN' } });
  await prisma.tenantModule.createMany({ data: Object.values(MODULES).map(module => ({ tenantId: a.id, module, enabled: true, source: 'MANUAL' })) });
  await prisma.tenantModule.createMany({ data: Object.values(MODULES).map(module => ({ tenantId: b.id, module, enabled: true, source: 'MANUAL' })) });
  const file = { originalname: 'Cartola de prueba enero.csv', buffer: Buffer.from('Fecha;Descripción;Abono;Cargo;Referencia\n02/01/2026;Pago cliente de prueba;125000;;QA-ABONO\n03/01/2026;Pago proveedor de prueba;;25000;QA-CARGO') };
  let job;

  await t.test('la tabla recuperada por la nueva migración acepta y conserva JSON', async () => {
    const row = await prisma.tenantOnboardingImport.create({ data: {
      tenantId: a.id, fileNames: ['Clientes de prueba.csv'], extractedData: { nombre: 'Empresa de prueba', moneda: 'CLP' }
    } });
    const read = await prisma.tenantOnboardingImport.findUniqueOrThrow({ where: { id: row.id } });
    assert.equal(read.status, 'DRAFT');
    assert.deepEqual(read.extractedData, { nombre: 'Empresa de prueba', moneda: 'CLP' });
  });

  await t.test('guarda el original exacto y aplica attempts=0 desde PostgreSQL', async () => {
    job = await createBankImportJob(prisma, { tenantId: a.id, userId: user.id, file, account: { bankKey: 'santander_chile', currency: 'CLP' } });
    assert.equal(job.attempts, 0);
    const original = await prisma.financeBankOriginal.findUniqueOrThrow({ where: { id: job.originalId } });
    assert.deepEqual(Buffer.from(original.content), file.buffer);
    assert.equal(original.sha256, createHash('sha256').update(file.buffer).digest('hex'));
  });
  await t.test('repetir una carga reutiliza el original y la tarea', async () => {
    const repeated = await createBankImportJob(prisma, { tenantId: a.id, userId: user.id, file });
    assert.equal(repeated.id, job.id);
    assert.equal(await prisma.financeBankOriginal.count({ where: { tenantId: a.id } }), 1);
  });
  await t.test('la FK compuesta impide enlazar el original de otra empresa', async () => {
    await assert.rejects(prisma.financeBankImportJob.create({ data: { tenantId: b.id, originalId: job.originalId, sourceFile: 'No debe crearse.csv' } }), error => error.code === 'P2003');
    await assert.rejects(getBankImportJob(prisma, b.id, job.id), error => error.status === 404);
  });
  await t.test('el CHECK de tamaño rechaza originales vacíos', async () => {
    await assert.rejects(prisma.financeBankOriginal.create({ data: { tenantId: a.id, sha256: 'invalid-empty', content: Buffer.alloc(0), size: 0 } }));
    assert.equal(await prisma.financeBankOriginal.count({ where: { tenantId: a.id } }), 1);
  });
  await t.test('analiza una cartola real y persiste la revisión, abono y cargo', async () => {
    const preview = await analyzeBankImportJob(prisma, { tenantId: a.id, id: job.id, analyze: analyzeStoredBankStatement });
    assert.equal(preview.revision, 1);
    const saved = await readBankImportPreview(prisma, a.id, job.id);
    assert.equal(saved.job.status, 'READY');
    assert.equal(saved.job.attempts, 1);
    assert.equal(saved.preview.sourceRows.length, 2);
    const rows = saved.preview.normalizedRows;
    assert.deepEqual(rows.map(row => row.direction), ['CREDIT', 'DEBIT']);
    assert.deepEqual(rows.map(row => row.amount), [125000, 25000]);
  });
  await t.test('otro cliente Prisma recupera el original y la revisión persistidos', async () => {
    const reader = new PrismaClient();
    try {
      const recovered = await getBankImportJob(reader, a.id, job.id, { original: true });
      assert.deepEqual(Buffer.from(recovered.original.content), file.buffer);
      assert.equal((await readBankImportPreview(reader, a.id, job.id)).preview.sourceRows.length, 2);
    } finally { await reader.$disconnect(); }
  });
  await t.test('rollback real revierte registro y auditoría en la misma transacción', async () => {
    const marker = `Rollback ${run}`;
    await assert.rejects(withFinanceWrite(prisma, async tx => {
      await tx.industryRecord.create({ data: { tenantId: a.id, recordType: 'finance_invoice', title: marker } });
      await tx.tenantAuditLog.create({ data: { tenantId: a.id, action: marker } });
      throw new Error('Fallo de prueba después de escribir');
    }), /Fallo de prueba/);
    assert.equal(await prisma.industryRecord.count({ where: { tenantId: a.id, title: marker } }), 0);
    assert.equal(await prisma.tenantAuditLog.count({ where: { tenantId: a.id, action: marker } }), 0);
  });
  await t.test('la API confirma una sola cartola aun con tres peticiones simultáneas', async () => {
    const app = express();
    app.use(express.json()); app.use('/api', authMiddleware, financeRouter); app.use(apiErrorHandler);
    server = createServer(app);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${server.address().port}/api/finance/bank-statements/import`;
    const headers = { Authorization: `Bearer ${signAuthToken(user)}`, 'Content-Type': 'application/json' };
    const body = JSON.stringify({ jobId: job.id, revision: 1 });
    await Promise.all(Array.from({ length: 3 }, async () => {
      const response = await fetch(url, { method: 'POST', headers, body, signal: AbortSignal.timeout(20000) });
      const result = await response.json();
      assert.ok(response.ok, JSON.stringify(result));
    }));
    assert.equal(await prisma.industryRecord.count({ where: { tenantId: a.id, recordType: 'bank_statement' } }), 1);
    assert.equal(await prisma.industryRecord.count({ where: { tenantId: a.id, recordType: 'bank_movement' } }), 2);
    assert.equal((await getBankImportJob(prisma, a.id, job.id)).status, 'IMPORTED');
    assert.equal(await prisma.tenantAuditLog.count({ where: { tenantId: a.id, action: 'FINANCE_BANK_STATEMENT_IMPORTED' } }), 1);
  });
  await t.test('la API no entrega la cartola ni permite confirmar sin sesión o desde otra empresa', async () => {
    const base = `http://127.0.0.1:${server.address().port}/api/finance`;
    const anonymous = await fetch(`${base}/bank-import-jobs/${job.id}/original`, { signal: AbortSignal.timeout(5000) });
    assert.equal(anonymous.status, 401);
    const headers = { Authorization: `Bearer ${signAuthToken(otherUser)}`, 'Content-Type': 'application/json' };
    const other = await fetch(`${base}/bank-import-jobs/${job.id}/original`, { headers, signal: AbortSignal.timeout(5000) });
    assert.equal(other.status, 404);
    const confirmation = await fetch(`${base}/bank-statements/import`, {
      method: 'POST', headers, body: JSON.stringify({ jobId: job.id, revision: 1 }), signal: AbortSignal.timeout(5000)
    });
    assert.equal(confirmation.status, 404);
    assert.equal(await prisma.industryRecord.count({ where: { tenantId: b.id } }), 0);
  });
});
