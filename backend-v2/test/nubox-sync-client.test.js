import test from 'node:test';
import assert from 'node:assert/strict';
import { isNuboxSyncRequest, requestTimeoutMs, nuboxPeriodsBetween, runNuboxHistory } from '../../frontend/lib/nubox-sync-client.mjs';

test('Nubox dispone de dos minutos sin alargar solicitudes comunes', () => {
  assert.equal(requestTimeoutMs('/finance/sync/nubox'), 120000);
  assert.equal(requestTimeoutMs('/finance/sync/nubox/history'), 120000);
  assert.equal(requestTimeoutMs('/finance/overview'), 15000);
  assert.equal(isNuboxSyncRequest('/finance/sync/nubox?period=2026-01'), true);
  assert.equal(isNuboxSyncRequest('/finance/sync/nubox-other'), false);
});

test('historial valida meses, orden y máximo de 24 antes de enviar', () => {
  assert.deepEqual(nuboxPeriodsBetween('2025-12', '2026-02'), ['2025-12', '2026-01', '2026-02']);
  assert.equal(nuboxPeriodsBetween('2025-01', '2026-12').length, 24);
  for (const [a, b] of [['2025-01','2027-01'], ['2026-02','2026-01'], ['2026-00','2026-01'], ['','2026-01']]) assert.throws(() => nuboxPeriodsBetween(a,b));
});

test('historial ejecuta un mes a la vez y conserva avisos de notas pendientes', async () => {
  let active = 0; const calls = [], progress = [];
  const result = await runNuboxHistory({ startPeriod: '2026-01', endPeriod: '2026-03', onProgress: p => progress.push(p), syncPeriod: async period => {
    assert.equal(active++, 0); calls.push(period); await Promise.resolve(); active--;
    return { ok: true, created: 2, updated: 1, warning: 'Notas por revisar' };
  } });
  assert.deepEqual(calls, ['2026-01','2026-02','2026-03']);
  assert.equal(result.succeeded, 3); assert.equal(result.created, 6); assert.equal(result.updated, 3);
  assert.equal(result.ok, true); assert.equal(result.unprocessed, 0);
  assert.equal(result.results[0].warning, 'Notas por revisar');
  assert.deepEqual(progress.map(p => p.completed), [0,1,1,2,2,3]);
});

test('timeout no reintenta ni inicia otro mes y conserva resultados confirmados', async () => {
  const calls = [];
  const result = await runNuboxHistory({ startPeriod: '2026-01', endPeriod: '2026-03', syncPeriod: async period => {
    calls.push(period); if (period === '2026-02') throw new Error('Resultado no confirmado');
    return { ok: true, created: 5 };
  } });
  assert.deepEqual(calls, ['2026-01', '2026-02']); assert.equal(result.created, 5);
  assert.equal(result.succeeded, 1); assert.equal(result.failed, 1); assert.equal(result.unprocessed, 1);
  assert.equal(result.ok, false); assert.equal(result.results[1].error, 'Resultado no confirmado');
});

test('otra sincronización en curso no se cuenta como un mes sincronizado', async () => {
  let calls = 0;
  const result = await runNuboxHistory({ startPeriod: '2026-01', endPeriod: '2026-03', syncPeriod: async () => {
    calls++; return { pending: true, ok: false, message: 'Ya hay una operación en curso' };
  } });
  assert.equal(calls, 1); assert.equal(result.succeeded, 0); assert.equal(result.unprocessed, 2);
  assert.equal(result.results[0].pending, true); assert.equal(result.ok, false);
});

test('error inicial no dispara solicitudes del resto del historial', async () => {
  let calls = 0;
  const result = await runNuboxHistory({ startPeriod: '2026-01', endPeriod: '2026-02', syncPeriod: async () => { calls++; throw new Error('No autorizado'); } });
  assert.equal(calls, 1); assert.equal(result.unprocessed, 1); assert.equal(result.failed, 1);
});
