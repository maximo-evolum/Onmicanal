import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { qaEnvironment } from '../scripts/lib/qa-environment.mjs';
import { blockDotEnvReads } from '../scripts/lib/qa-runtime.mjs';

const isolatedEnv = qaEnvironment();
for (const key of Object.keys(process.env)) delete process.env[key];
Object.assign(process.env, isolatedEnv);
blockDotEnvReads();
const { getRedisClient, withDistributedLock } = await import('../src/lib/redis.js');

test('Finance QA: Redis real, almacenamiento y candados', { timeout: 15000 }, async t => {
  const redis = await getRedisClient();
  assert.ok(redis, 'Redis no está conectado: esta etapa no se considera aprobada');
  const key = `finance-qa:${randomUUID()}`;
  t.after(async () => { await redis.del(key); await redis.quit(); });
  assert.equal(await redis.ping(), 'PONG');
  await t.test('almacena y recupera datos con vencimiento', async () => {
    await redis.set(key, 'dato de prueba', { EX: 60 });
    assert.equal(await redis.get(key), 'dato de prueba');
    assert.ok(await redis.ttl(key) > 0);
  });
  await t.test('evita dos ejecuciones del mismo candado y lo libera', async () => {
    let release, acquired;
    const entered = new Promise(resolve => { acquired = resolve; });
    const wait = new Promise(resolve => { release = resolve; });
    const first = withDistributedLock(key, { ttlMs: 10000 }, async context => {
      assert.equal(context.coordinated, true); acquired(); await wait; return 'primero';
    });
    try {
      await entered;
      const second = await withDistributedLock(key, {}, () => assert.fail('No debe ejecutarse dos veces'));
      assert.equal(second.skipped, 'already_running');
    } finally { release(); await first; }
    assert.equal(await withDistributedLock(key, {}, async () => 'liberado'), 'liberado');
  });
  await t.test('una excepción de tarea no deja el candado retenido', async () => {
    await assert.rejects(withDistributedLock(key, {}, async () => { throw new Error('fallo esperado'); }), /fallo esperado/);
    assert.equal(await redis.get(`evolum:lock:${key}`), null);
  });
});
