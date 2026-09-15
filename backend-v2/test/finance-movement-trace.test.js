import test from 'node:test';
import assert from 'node:assert/strict';
import { readMovementTrace } from '../src/services/finance-movement-trace.service.js';

const full = { invoices: true, reconciliation: true, exceptions: true };
const row = (id, recordType, data = {}, tenantId = 'a') => ({ id, tenantId, recordType, data, title: id, status: 'OPEN', createdAt: '2026-01-01T12:00:00Z' });
function database(records, audits = []) {
  const matches = (r, w) => Object.entries(w).every(([k, v]) => k === 'data' ? r.data?.[v.path[0]] === v.equals : v?.in ? v.in.includes(r[k]) : r[k] === v);
  const model = (rows) => ({
    findFirst: async ({ where }) => rows.find((r) => matches(r, where)) || null,
    findMany: async ({ where, cursor, skip = 0, take }) => {
      const found = rows.filter((r) => matches(r, where));
      const start = cursor ? found.findIndex((r) => r.id === cursor.id) + skip : 0;
      return found.slice(start, start + take);
    }
  });
  return { industryRecord: model(records), tenantAuditLog: model(audits) };
}
const read = (db, extra = {}) => readMovementTrace(db, { tenantId: 'a', movementId: 'm', access: full, ...extra });

test('rechaza un movimiento de otra empresa', async () => {
  await assert.rejects(read(database([row('m', 'bank_movement', {}, 'b')])), { status: 404 });
});
test('solo incluye documentos enlazados y de la misma empresa', async () => {
  const result = await read(database([row('m', 'bank_movement'), row('r', 'finance_reconciliation', { movementId: 'm', invoiceIds: ['i', 'foreign'] }), row('i', 'finance_invoice'), row('foreign', 'finance_invoice', {}, 'b'), row('similar', 'finance_invoice', { amount: 100 }), row('other', 'finance_exception', { movementId: 'different' })]));
  assert.deepEqual(result.records.map((r) => r.id), ['r', 'i']);
});
test('no expone secciones sin acceso ni metadatos secretos', async () => {
  const result = await read(database([row('m', 'bank_movement'), row('r', 'finance_reconciliation', { movementId: 'm', token: 'secret' })]), { access: { invoices: false, reconciliation: false, exceptions: false } });
  assert.deepEqual(result.records, []);
  assert.ok(!JSON.stringify(result).includes('secret'));
});
test('paginación de 25 eventos sin perder ni repetir eventos', async () => {
  const audits = Array.from({ length: 31 }, (_, i) => ({ id: `event-${i}`, tenantId: 'a', entityId: 'm', createdAt: '2026-01-01', action: 'TEST', metadata: { secret: 'hidden' } }));
  const db = database([row('m', 'bank_movement')], audits);
  const first = await read(db);
  const second = await read(db, { cursor: first.nextCursor });
  assert.equal(first.events.length, 25);
  assert.equal(second.events.length, 6);
  assert.equal(second.nextCursor, null);
  assert.equal(new Set([...first.events, ...second.events].map((e) => e.id)).size, 31);
  assert.ok(!JSON.stringify(first).includes('hidden'));
});
test('rechaza cursor de otra empresa o de otro movimiento', async () => {
  const db = database([row('m', 'bank_movement')], [{ id: 'foreign', tenantId: 'b', entityId: 'm' }, { id: 'other', tenantId: 'a', entityId: 'different' }]);
  for (const cursor of ['foreign', 'other']) await assert.rejects(read(db, { cursor }), { status: 400 });
});
test('tolera relaciones antiguas mal formadas y fechas inválidas', async () => {
  const result = await read(database([row('m', 'bank_movement'), { ...row('r', 'finance_reconciliation', { movementId: 'm', invoiceIds: {}, allocations: [null, { invoiceId: 'i' }] }), createdAt: 'invalid' }, row('i', 'finance_invoice')]));
  assert.equal(result.records[0].date, '');
  assert.deepEqual(result.records[0].allocations, []);
});
test('incluye reversa, recibo y asignación sin modificar registros', async () => {
  const records = [row('m', 'bank_movement'), { ...row('r', 'finance_reconciliation', { movementId: 'm', allocations: [{ invoiceId: 'i', amount: 100 }], reversedAt: '2026-01-02', reversalReason: 'Corrección' }), status: 'REVERSED' }, row('receipt', 'finance_invoice_receipt', { movementId: 'm', invoiceId: 'i' }), row('i', 'finance_invoice', { amount: 100, balance: 100 })];
  const before = JSON.stringify(records);
  const result = await read(database(records));
  assert.equal(result.records[0].status, 'REVERSED');
  assert.equal(result.records[0].allocations[0].amount, 100);
  assert.equal(JSON.stringify(records), before);
});
