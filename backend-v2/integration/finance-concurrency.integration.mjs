import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { qaEnvironment } from '../scripts/lib/qa-environment.mjs';
import { blockDotEnvReads } from '../scripts/lib/qa-runtime.mjs';

const env = qaEnvironment(process.env, { requireRedis: false });
for (const key of Object.keys(process.env)) delete process.env[key];
Object.assign(process.env, env);
blockDotEnvReads();
const { prisma } = await import('../src/lib/db.js');
const { createBankImportJob, analyzeBankImportJob, cancelBankImportJob, getBankImportJob, readBankImportPreview, runBankImportWorker, IMPORT_LEASE_MS } = await import('../src/services/finance-import-jobs.service.js');
const { analyzeStoredBankStatement } = await import('../src/routes/finance.routes.js');

function message(child) {
  return new Promise((resolve, reject) => {
    const cleanup = () => { clearTimeout(timer); child.off('message', receive); child.off('exit', exited); child.off('error', failed); };
    const receive = value => { cleanup(); resolve(value); };
    const exited = () => { cleanup(); reject(new Error('El proceso terminó antes de responder.')); };
    const failed = error => { cleanup(); reject(error); };
    const timer = setTimeout(() => { cleanup(); reject(new Error('El proceso no respondió en el tiempo de prueba.')); }, 15000);
    child.once('message', receive); child.once('exit', exited); child.once('error', failed);
  });
}
test('Concurrencia y recuperación: PostgreSQL real y terminación de procesos', { timeout: 90000 }, async t => {
  const children = new Set(); let tenantId;
  t.after(async () => {
    for (const child of children) if (child.exitCode === null && child.signalCode === null) { const ended = once(child, 'exit'); child.kill('SIGKILL'); await ended; }
    try { if (tenantId) await prisma.tenant.deleteMany({ where: { id: tenantId } }); }
    finally { await prisma.$disconnect(); }
  });
  const [identity] = await prisma.$queryRaw`SELECT current_database() AS db, current_user AS username`;
  assert.equal(identity.db, 'evolum_finance_test'); assert.equal(identity.username, 'evolum_test');
  const tenant = await prisma.tenant.create({ data: { name: 'Recuperación de prueba', slug: `recovery-${randomUUID()}`, industry: 'FINANCE' } });
  tenantId = tenant.id;
  const file = () => ({ originalname: 'Cartola de recuperación.csv', buffer: Buffer.from(`Fecha;Descripción;Abono;Cargo;Referencia\n02/01/2026;Ingreso de prueba;100;;${randomUUID()}`) });
  const create = (source = file()) => createBankImportJob(prisma, { tenantId, file: source, account: { bankKey: 'santander_chile', currency: 'CLP' } });
  const expire = id => prisma.financeBankImportJob.update({ where: { id }, data: { updatedAt: new Date(Date.now() - IMPORT_LEASE_MS - 1000) } });
  const parse = id => analyzeBankImportJob(prisma, { tenantId, id, analyze: analyzeStoredBankStatement, background: true });
  const start = async id => {
    const child = fork(new URL('./helpers/bank-import-child.mjs', import.meta.url), [tenantId, id], { env, execArgv: [], stdio: ['ignore', 'ignore', 'ignore', 'ipc'], windowsHide: true });
    children.add(child);
    assert.equal((await message(child)).type, 'claimed'); return child;
  };

  await t.test('cargas simultáneas conservan un original y una tarea', async () => {
    const source = file();
    const jobs = await Promise.all([create(source), create(source), create(source)]);
    assert.equal(new Set(jobs.map(j => j.id)).size, 1);
    assert.equal(await prisma.financeBankImportJob.count({ where: { tenantId } }), 1);
    assert.equal(await prisma.financeBankOriginal.count({ where: { tenantId } }), 1);
    await cancelBankImportJob(prisma, tenantId, jobs[0].id);
  });
  await t.test('dos procesos no toman una tarea con arrendamiento vigente', async () => {
    const job = await create(), child = await start(job.id);
    await assert.rejects(parse(job.id), error => error.status === 409);
    const response = message(child); child.send('finish');
    assert.equal((await response).type, 'result');
    assert.equal(await prisma.financeBankImportRevision.count({ where: { jobId: job.id } }), 1);
  });
  await t.test('una caída real del proceso conserva original y otro worker recupera el análisis', async () => {
    const source = file(), job = await create(source), child = await start(job.id);
    const ended = once(child, 'exit'); child.kill('SIGKILL'); await ended;
    assert.equal((await getBankImportJob(prisma, tenantId, job.id)).status, 'PROCESSING');
    // Advance the stored lease, not wall-clock sleeps of five minutes.
    await expire(job.id);
    const results = await runBankImportWorker(prisma, { analyze: analyzeStoredBankStatement });
    assert.ok(results.some(r => r.id === job.id && r.status === 'READY'));
    const recovered = await readBankImportPreview(prisma, tenantId, job.id);
    assert.equal(recovered.job.attempts, 2); assert.equal(recovered.job.revision, 2);
    assert.equal(recovered.preview.normalizedRows[0].amount, 100);
    const original = await getBankImportJob(prisma, tenantId, job.id, { original: true });
    assert.deepEqual(Buffer.from(original.original.content), source.buffer);
    assert.equal(await prisma.industryRecord.count({ where: { tenantId, recordType: 'bank_movement' } }), 0);
  });
  await t.test('un proceso antiguo no sobrescribe la revisión del nuevo propietario', async () => {
    const job = await create(), child = await start(job.id);
    await expire(job.id); const current = await parse(job.id);
    const response = message(child); child.send('finish');
    assert.deepEqual(await response, { type: 'error', status: 409 });
    const recovered = await readBankImportPreview(prisma, tenantId, job.id);
    assert.equal(recovered.job.status, 'READY'); assert.equal(recovered.job.revision, current.revision);
    assert.equal(recovered.preview.marker, undefined);
    assert.equal(await prisma.financeBankImportRevision.count({ where: { jobId: job.id } }), 1);
  });
  await t.test('cancelar durante el análisis impide publicar una revisión tardía', async () => {
    const job = await create(), child = await start(job.id);
    await cancelBankImportJob(prisma, tenantId, job.id);
    const response = message(child); child.send('finish');
    assert.equal((await response).status, 409);
    assert.equal((await getBankImportJob(prisma, tenantId, job.id)).status, 'CANCELLED');
    assert.equal(await prisma.financeBankImportRevision.count({ where: { jobId: job.id } }), 0);
  });
  await t.test('COMMIT confirmado con respuesta perdida se recupera sin duplicar revisión', async () => {
    const job = await create(); let transactions = 0, parses = 0;
    const db = new Proxy(prisma, { get(target, key) {
      if (key !== '$transaction') return target[key];
      return async (...args) => {
        const result = await prisma.$transaction(...args);
        if (++transactions === 2) throw Object.assign(new Error('Respuesta perdida simulada'), { code: 'P1017' });
        return result;
      };
    } });
    const result = await analyzeBankImportJob(db, { tenantId, id: job.id, analyze: async input => { parses++; return analyzeStoredBankStatement(input); } });
    assert.equal(result.revision, 1); assert.equal(parses, 1);
    assert.equal((await getBankImportJob(prisma, tenantId, job.id)).status, 'READY');
    assert.equal(await prisma.financeBankImportRevision.count({ where: { jobId: job.id } }), 1);
  });
  await t.test('fallo de persistencia conserva tarea y bytes para recuperar tras volver la conexión', async () => {
    const job = await create(); let transactions = 0;
    const db = new Proxy(prisma, { get(target, key) {
      if (key !== '$transaction') return target[key];
      return (...args) => { if (++transactions > 1) throw Object.assign(Error('Conexión interrumpida simulada'), { code: 'P1001' }); return prisma.$transaction(...args); };
    } });
    await assert.rejects(analyzeBankImportJob(db, { tenantId, id: job.id, analyze: analyzeStoredBankStatement }));
    assert.equal((await getBankImportJob(prisma, tenantId, job.id)).status, 'PROCESSING');
    await expire(job.id); await parse(job.id);
    assert.equal((await getBankImportJob(prisma, tenantId, job.id)).status, 'READY');
  });
  await t.test('al agotar intentos se detiene hasta reanudación manual', async () => {
    const job = await create();
    await prisma.financeBankImportJob.update({ where: { id: job.id }, data: { attempts: 3, updatedAt: new Date(Date.now() - 31000) } });
    await runBankImportWorker(prisma, { analyze: analyzeStoredBankStatement });
    assert.equal((await getBankImportJob(prisma, tenantId, job.id)).status, 'FAILED');
    await analyzeBankImportJob(prisma, { tenantId, id: job.id, queueOnly: true });
    await parse(job.id);
    const recovered = await getBankImportJob(prisma, tenantId, job.id);
    assert.equal(recovered.status, 'READY'); assert.equal(recovered.attempts, 1);
  });
});
