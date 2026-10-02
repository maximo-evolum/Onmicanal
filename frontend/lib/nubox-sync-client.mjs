export const NUBOX_SYNC_TIMEOUT_MS = 120_000;
export const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;

export function isNuboxSyncRequest(path) {
  return /^\/finance\/sync\/nubox(?:\/history)?(?:\?|$)/.test(path);
}

export function requestTimeoutMs(path) {
  return isNuboxSyncRequest(path) ? NUBOX_SYNC_TIMEOUT_MS : DEFAULT_REQUEST_TIMEOUT_MS;
}

export function nuboxPeriodsBetween(start, end) {
  const valid = value => /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
  if (!valid(start) || !valid(end)) throw new Error('Selecciona períodos válidos (AAAA-MM).');
  const index = value => Number(value.slice(0, 4)) * 12 + Number(value.slice(5)) - 1;
  const first = index(start), last = index(end);
  if (last < first) throw new Error('El período final no puede ser anterior al inicial.');
  if (last - first >= 24) throw new Error('Puedes sincronizar hasta 24 meses por vez.');
  return Array.from({ length: last - first + 1 }, (_, offset) => {
    const n = first + offset;
    return `${String(Math.floor(n / 12)).padStart(4, '0')}-${String(n % 12 + 1).padStart(2, '0')}`;
  });
}

/**
 * One request per month. A timeout cannot confirm whether the server committed,
 * so stop rather than retry or overlap the following months.
 * @param {{startPeriod: string, endPeriod: string, syncPeriod: (period: string) => Promise<any>, onProgress?: (progress: {completed: number, total: number, period: string}) => void}} options
 */
export async function runNuboxHistory({ startPeriod, endPeriod, syncPeriod, onProgress }) {
  const periods = nuboxPeriodsBetween(startPeriod, endPeriod);
  const results = [];
  let completed = 0;
  for (const period of periods) {
    onProgress?.({ completed, total: periods.length, period });
    try {
      const result = await syncPeriod(period);
      results.push({ ...result, period });
      if (!result.ok || result.pending) break;
      completed++;
      onProgress?.({ completed, total: periods.length, period });
    } catch (error) {
      results.push({ ok: false, period, error: error instanceof Error ? error.message : 'No se pudo confirmar la sincronización de este mes.' });
      break;
    }
  }
  return {
    ok: completed === periods.length, periods: periods.length, succeeded: completed,
    failed: results.filter(r => !r.ok || r.pending).length, unprocessed: periods.length - results.length,
    created: results.reduce((sum, r) => sum + (Number(r.created) || 0), 0),
    updated: results.reduce((sum, r) => sum + (Number(r.updated) || 0), 0), results
  };
}
