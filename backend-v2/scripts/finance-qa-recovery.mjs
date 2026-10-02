import { spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { qaEnvironment } from './lib/qa-environment.mjs';
import { blockDotEnvReads } from './lib/qa-runtime.mjs';

// Deliberately no DROP, reset or --clean option: the destination must be empty.
async function main() {
  const sourceEnv = qaEnvironment(process.env, { requireRedis: false });
  const targetEnv = qaEnvironment({ ...process.env, QA_DATABASE_URL: process.env.QA_RECOVERY_DATABASE_URL }, { requireRedis: false });
  const sourceUrl = new URL(sourceEnv.DATABASE_URL);
  const targetUrl = new URL(targetEnv.DATABASE_URL);
  if (sourceUrl.port === targetUrl.port) throw new Error('La restauración exige otra instancia local, en el otro puerto QA.');
  if (!process.env.QA_BACKUP_DIR || !path.isAbsolute(process.env.QA_BACKUP_DIR)) throw new Error('Define QA_BACKUP_DIR como carpeta absoluta de evidencias, fuera del repositorio.');
  const directory = path.resolve(process.env.QA_BACKUP_DIR);
  const repository = fileURLToPath(new URL('../../', import.meta.url));
  const relative = path.relative(repository, directory);
  if (!relative || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))) {
    throw new Error('Los respaldos y las evidencias deben guardarse fuera del repositorio.');
  }
  const pgBin = process.env.QA_PG_BIN || '';
  const run = `qa-recovery-${randomUUID()}`;
  const backup = path.join(directory, `${run}.dump`);
  for (const key of Object.keys(process.env)) delete process.env[key];
  Object.assign(process.env, sourceEnv);
  blockDotEnvReads();
  const { PrismaClient } = await import('@prisma/client');
  const source = new PrismaClient({ datasources: { db: { url: sourceUrl.href } } });
  const target = new PrismaClient({ datasources: { db: { url: targetUrl.href } } });
  let tenantId;
  let restored = false;
  const steps = [];
  const pg = (name, args, url) => {
    const executable = path.join(pgBin, `${name}${process.platform === 'win32' ? '.exe' : ''}`);
    const result = spawnSync(executable, args, {
      env: { ...sourceEnv, PGHOST: url.hostname, PGPORT: url.port, PGUSER: decodeURIComponent(url.username),
        PGPASSWORD: decodeURIComponent(url.password), PGDATABASE: 'evolum_finance_test', PGCONNECT_TIMEOUT: '5' },
      encoding: 'utf8', windowsHide: true, timeout: 120000, maxBuffer: 1024 * 1024
    });
    if (result.error || result.status !== 0) throw new Error(`${name} falló: ${result.error?.message || result.stderr}`);
  };
  const counts = async db => {
    const tables = await db.$queryRaw`SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename`;
    const result = {};
    for (const { tablename } of tables) {
      const [row] = await db.$queryRawUnsafe(`SELECT count(*)::int AS total FROM public."${tablename.replaceAll('"', '""')}"`);
      result[tablename] = row.total;
    }
    return result;
  };
  try {
    const tables = await target.$queryRaw`SELECT tablename FROM pg_tables WHERE schemaname='public'`;
    if (tables.length) throw new Error('La base destino ya tiene tablas. Se aborta para no sobrescribir datos.');
    await mkdir(directory, { recursive: true });
    const tenant = await source.tenant.create({ data: { name: 'Empresa ficticia de recuperación', slug: run, industry: 'FINANCE' } });
    tenantId = tenant.id;
    const bytes = Buffer.from('Fecha;Descripción;Abono\n02/01/2026;Pago de prueba de recuperación;25000');
    const original = await source.financeBankOriginal.create({ data: {
      tenantId, content: bytes, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex')
    } });
    const job = await source.financeBankImportJob.create({ data: { tenantId, originalId: original.id, sourceFile: 'Cartola de recuperación.csv' } });
    const record = await source.industryRecord.create({ data: { tenantId, recordType: 'finance_invoice', title: 'Factura ficticia de recuperación',
      data: { currency: 'CLP', total: 25000, demo: true } } });
    await source.tenantAuditLog.create({ data: { tenantId, action: 'QA_RECOVERY_FIXTURE', entityId: record.id } });
    const before = await counts(source);
    pg('pg_dump', ['--format=custom', '--no-owner', '--file', backup], sourceUrl);
    steps.push('Respaldo pg_dump completado con datos ficticios, archivo original y migraciones.');
    pg('pg_restore', ['--no-owner', '--no-privileges', '--exit-on-error', '--dbname', 'evolum_finance_test', backup], targetUrl);
    restored = true;
    const after = await counts(target);
    if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error('Los recuentos de las tablas no coinciden después de restaurar.');
    const recovered = await target.financeBankOriginal.findUniqueOrThrow({ where: { id: original.id } });
    if (!Buffer.from(recovered.content).equals(bytes)) throw new Error('El archivo original restaurado no coincide byte a byte.');
    if ((await target.financeBankImportJob.findUniqueOrThrow({ where: { id: job.id } })).attempts !== 0) throw new Error('El valor attempts no se conservó.');
    if ((await target.industryRecord.findUniqueOrThrow({ where: { id: record.id } })).data.total !== 25000) throw new Error('El documento restaurado cambió.');
    steps.push(`Restauración verificada: ${Object.keys(before).length} tablas con recuentos iguales, JSON y archivo idénticos.`);
    const result = { ok: true, sourcePort: sourceUrl.port, targetPort: targetUrl.port, backup, steps, tables: before };
    await writeFile(path.join(directory, `${run}.json`), JSON.stringify(result, null, 2));
    console.log(JSON.stringify({ ok: true, backup, steps }, null, 2));
  } finally {
    // Only delete this script's synthetic tenant. The restored database is kept.
    try {
      if (tenantId) await source.tenant.deleteMany({ where: { id: tenantId } });
      if (tenantId && restored) await target.tenant.deleteMany({ where: { id: tenantId } });
    } finally { await Promise.all([source.$disconnect(), target.$disconnect()]); }
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
