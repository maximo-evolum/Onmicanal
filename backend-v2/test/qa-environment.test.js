import test from 'node:test';
import assert from 'node:assert/strict';
import { qaEnvironment } from '../scripts/lib/qa-environment.mjs';
import { spawnSync } from 'node:child_process';

const input = {
  CONFIRM_FINANCE_QA: 'YES',
  QA_DATABASE_URL: 'postgresql://evolum_test:test@127.0.0.1:55432/evolum_finance_test',
  QA_REDIS_URL: 'redis://:test@127.0.0.1:56379/0'
};
test('QA rechaza bases remotas/productivas y falta de confirmación', () => {
  for (const change of [
    { CONFIRM_FINANCE_QA: '' }, { NODE_ENV: 'production' }, { QA_DATABASE_URL: '' },
    { QA_DATABASE_URL: input.QA_DATABASE_URL.replace('127.0.0.1', 'db.railway.internal') },
    { QA_DATABASE_URL: input.QA_DATABASE_URL.replace('evolum_finance_test', 'railway') },
    { QA_DATABASE_URL: input.QA_DATABASE_URL.replace('evolum_test:', 'postgres:') },
    { QA_DATABASE_URL: input.QA_DATABASE_URL.replace('55432', '5432') },
    { QA_DATABASE_URL: input.QA_DATABASE_URL + '?options=unsafe' },
    { QA_DATABASE_URL: input.QA_DATABASE_URL + '?schema=other' },
    { QA_DATABASE_URL: input.QA_DATABASE_URL + '#other' },
    { QA_REDIS_URL: input.QA_REDIS_URL + '#other' },
    { QA_REDIS_URL: 'redis://production:6379' }, { QA_REDIS_URL: '' }
  ]) assert.throws(() => qaEnvironment({ ...input, ...change }));
});
test('QA no hereda secretos, conexiones ni automatizaciones del entorno', () => {
  const env = qaEnvironment({ ...input, DATABASE_URL: 'production', REDIS_URL: 'production',
    OPENAI_API_KEY: 'secret', NUBOX_API_BASE_URL: 'remote', ENABLE_AUTOMATION: 'true', PATH: 'tools' });
  assert.equal(env.DATABASE_URL, input.QA_DATABASE_URL);
  assert.equal(env.REDIS_URL, input.QA_REDIS_URL);
  assert.equal(env.OPENAI_API_KEY, undefined);
  assert.equal(env.NUBOX_API_BASE_URL, undefined);
  assert.equal(env.ENABLE_AUTOMATION, 'false');
  assert.equal(env.PATH, 'tools');
});
test('la comprobación solo PostgreSQL es explícita y no finge validar Redis', () => {
  assert.equal(qaEnvironment({ ...input, QA_REDIS_URL: '' }, { requireRedis: false }).REDIS_URL, '');
});

test('el proceso QA impide lecturas implícitas de .env sin impedir leer el código', () => {
  const moduleUrl = new URL('../scripts/lib/qa-runtime.mjs', import.meta.url).href;
  const result = spawnSync(process.execPath, ['--input-type=module', '--eval', `
    import fs from 'node:fs';
    import assert from 'node:assert/strict';
    import { blockDotEnvReads } from ${JSON.stringify(moduleUrl)};
    blockDotEnvReads();
    assert.equal(fs.existsSync('.env'), false);
    assert.throws(() => fs.readFileSync('.env'), { code: 'ENOENT' });
    await assert.rejects(fs.promises.readFile('.env.production'), { code: 'ENOENT' });
    await new Promise(resolve => fs.readFile('.env.local', error => {
      assert.equal(error.code, 'ENOENT'); resolve();
    }));
    assert.ok(fs.readFileSync(new URL(${JSON.stringify(moduleUrl)}), 'utf8').includes('blockDotEnvReads'));
  `], { encoding: 'utf8', timeout: 10000, windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
});
