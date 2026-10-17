/** Archivo: Verifica mediante pruebas automatizadas el comportamiento de lazy ai client.test. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createLazyAIClient } from '../src/lib/lazy-ai-client.js';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { qaEnvironment } from '../scripts/lib/qa-environment.mjs';

test('IA opcional: construir el proveedor no exige clave ni instancia el SDK', () => {
  let calls = 0;
  const get = createLazyAIClient({ readApiKey: () => '', createClient: () => { calls++; } });
  assert.equal(calls, 0);
  for (let i = 0; i < 2; i++) assert.throws(get, e => e.status === 503 && e.code === 'AI_NOT_CONFIGURED');
  assert.equal(calls, 0);
});

test('IA opcional: reutiliza cliente, respeta cambio de clave y revocación', () => {
  let key = 'ficticia-a', calls = 0;
  const get = createLazyAIClient({ readApiKey: () => key, createClient: () => ({ serial: ++calls }) });
  assert.equal(get(), get()); assert.equal(calls, 1);
  key = 'ficticia-b'; assert.equal(get().serial, 2);
  key = ' '; assert.throws(get, e => e.code === 'AI_NOT_CONFIGURED');
  key = 'ficticia-b'; assert.equal(get().serial, 3);
});

test('wrapper real sin clave: importa sin fallar y rechaza sólo la operación IA', () => {
  const env = qaEnvironment({ ...process.env, NODE_ENV: 'test', CONFIRM_FINANCE_QA: 'YES',
    QA_DATABASE_URL: 'postgresql://evolum_test:local-only@127.0.0.1:55432/evolum_finance_test' }, { requireRedis: false });
  const code = `import assert from 'node:assert/strict';
    globalThis.fetch = () => { throw Error('No debe llamar una API'); };
    const {chatComplete, estimateTokens} = await import('./src/lib/openai.js');
    assert.equal(estimateTokens('hola'), 1);
    await assert.rejects(chatComplete({messages:[]}), e => e.code === 'AI_NOT_CONFIGURED' && e.status === 503);`;
  const result = spawnSync(process.execPath, ['--import', new URL('../scripts/lib/qa-preload.mjs', import.meta.url).href,
    '--input-type=module', '--eval', code], { cwd: fileURLToPath(new URL('../', import.meta.url)), env,
    encoding: 'utf8', timeout: 15000, windowsHide: true });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
});
