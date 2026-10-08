import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { qaEnvironment } from '../scripts/lib/qa-environment.mjs';
import { blockDotEnvReads } from '../scripts/lib/qa-runtime.mjs';

const env = qaEnvironment(process.env, { requireRedis: false });
for (const key of Object.keys(process.env)) delete process.env[key];
Object.assign(process.env, env);
blockDotEnvReads();
const { prisma } = await import('../src/lib/db.js');
const { registerManualSettlement } = await import('../src/services/finance-manual-writes.service.js');
const { applyFinanceAllocation, reverseFinanceAllocation } = await import('../src/services/finance-allocation.service.js');

test('Integridad financiera: concurrencia, evidencia y rollback en PostgreSQL aislado', { timeout: 90000 }, async t => {
  const tenantIds = [];
  t.after(async () => {
    try { if (tenantIds.length) await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } }); }
    finally { await prisma.$disconnect(); }
  });
  const [identity] = await prisma.$queryRaw`SELECT current_database() AS db, current_user AS username`;
  assert.equal(identity.db, 'evolum_finance_test'); assert.equal(identity.username, 'evolum_test');
  const tenant = await prisma.tenant.create({ data: { name: 'Integridad de prueba', slug: `integrity-${randomUUID()}`, industry: 'FINANCE' } });
  tenantIds.push(tenant.id);
  const tenantId = tenant.id;
  const user = await prisma.workspaceUser.create({ data: { tenantId, name: 'Contador de prueba', email: `${randomUUID()}@example.invalid`, role: 'ADMIN' } });
  const userId = user.id;
  const create = (recordType, data, status = 'OPEN') => prisma.industryRecord.create({ data: { tenantId, recordType, title: 'Registro de prueba aislado', status, data } });
  const invoice = (amount = 100, recordType = 'finance_invoice') => create(recordType, { amount, balance: amount, paidAmount: 0, currency: 'CLP', clientRut: '11111111-1', issueDate: '2026-01-02' });
  const movement = () => create('bank_movement', { amount: 100, direction: 'CREDIT', currency: 'CLP', transactionDate: '2026-01-20', rut: '11111111-1' }, 'PENDING');
  const read = id => prisma.industryRecord.findUniqueOrThrow({ where: { id } });
  const pay = (doc, extra = {}) => registerManualSettlement(prisma, { tenantId, userId, documentId: doc.id, kind: 'RECEIPT', amount: 70, paymentDate: '2026-01-20', idempotencyKey: randomUUID(), ...extra });
  const reconcile = (bank, doc, db = prisma) => applyFinanceAllocation(db, { tenantId, userId, movementId: bank.id, allocations: [{ invoiceId: doc.id, amount: 100 }] });
  const reverse = id => reverseFinanceAllocation(prisma, { tenantId, userId, reconciliationId: id, reason: 'Reversa controlada de prueba' });

  await t.test('dos cobros o pagos simultáneos no pueden exceder el saldo', async () => {
    for (const kind of ['RECEIPT', 'PAYMENT']) {
      const doc = await invoice(100, kind === 'RECEIPT' ? 'finance_invoice' : 'finance_payable');
      const results = await Promise.allSettled([pay(doc, { kind }), pay(doc, { kind })]);
      assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
      assert.equal(results.find(r => r.status === 'rejected').reason.status, 409);
      const row = await read(doc.id); assert.equal(row.data.balance, 30); assert.equal(row.data.paidAmount, 70);
    }
  });
  await t.test('reintentos simultáneos del mismo cobro dejan un solo comprobante y auditoría', async () => {
    const doc = await invoice(), key = randomUUID();
    const results = await Promise.all([pay(doc, { idempotencyKey: key }), pay(doc, { idempotencyKey: key })]);
    assert.equal(results[0].receipt.id, results[1].receipt.id);
    assert.equal((await read(doc.id)).data.balance, 30);
    assert.equal(await prisma.tenantAuditLog.count({ where: { tenantId, entityId: doc.id, action: 'FINANCE_INVOICE_RECEIPT_REGISTERED' } }), 1);
    await assert.rejects(pay(doc, { idempotencyKey: key, amount: 20 }), e => e.status === 409);
  });
  await t.test('dos abonos compitiendo por la misma factura no la cobran dos veces', async () => {
    const doc = await invoice(), a = await movement(), b = await movement();
    const results = await Promise.allSettled([reconcile(a, doc), reconcile(b, doc)]);
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    assert.equal((await read(doc.id)).data.paidAmount, 100);
    const rows = await Promise.all([read(a.id), read(b.id)]);
    assert.equal(rows.filter(r => r.status === 'MATCHED').length, 1);
    assert.equal(rows.filter(r => r.status === 'PENDING').length, 1);
  });
  await t.test('reversas simultáneas restituyen el saldo una sola vez y conservan historial', async () => {
    const doc = await invoice(), bank = await movement(), applied = await reconcile(bank, doc);
    const results = await Promise.all([reverse(applied.reconciliation.id), reverse(applied.reconciliation.id)]);
    assert.equal(results.filter(r => r.alreadyReversed).length, 1);
    const row = await read(doc.id); assert.equal(row.data.balance, 100); assert.equal(row.data.paidAmount, 0);
    assert.equal((await read(bank.id)).status, 'PENDING');
    assert.equal(await prisma.tenantAuditLog.count({ where: { tenantId, entityId: applied.reconciliation.id, action: 'FINANCE_RECONCILIATION_REVERSED' } }), 1);
  });
  await t.test('fallo de auditoría revierte factura, abono, comprobante y conciliación', async () => {
    const doc = await invoice(), bank = await movement();
    const brokenAudit = { $transaction: (fn, options) => prisma.$transaction(tx => fn(new Proxy(tx, {
      get: (target, key) => key === 'tenantAuditLog' ? { create: async () => { throw new Error('Fallo de auditoría simulado'); } } : target[key]
    })), options) };
    await assert.rejects(reconcile(bank, doc, brokenAudit), /Fallo de auditoría/);
    assert.equal((await read(doc.id)).data.balance, 100); assert.equal((await read(bank.id)).status, 'PENDING');
    assert.equal(await prisma.industryRecord.count({ where: { tenantId, data: { path: ['movementId'], equals: bank.id } } }), 0);
  });
  await t.test('una asignación alterada no permite revertir ni modificar el saldo', async () => {
    const doc = await invoice(), bank = await movement(), applied = await reconcile(bank, doc);
    await prisma.industryRecord.update({ where: { id: applied.reconciliation.id }, data: { data: { ...applied.reconciliation.data, allocations: [{ invoiceId: doc.id, amount: 99 }] } } });
    await assert.rejects(reverse(applied.reconciliation.id), e => e.status === 409);
    assert.equal((await read(doc.id)).data.balance, 0); assert.equal((await read(bank.id)).status, 'MATCHED');
  });
  await t.test('el período cerrado bloquea cobros y reversas sin cambios parciales', async () => {
    const doc = await invoice(), bank = await movement(), applied = await reconcile(bank, doc), pending = await invoice();
    const snapshot = await create('finance_monthly_close', { period: '2026-01' }, 'CLOSED');
    await prisma.financePeriodControl.update({ where: { tenantId_period: { tenantId, period: '2026-01' } }, data: { status: 'CLOSED', latestCloseId: snapshot.id, version: { increment: 1 } } });
    await assert.rejects(pay(pending), /cerrado/); await assert.rejects(reverse(applied.reconciliation.id), /cerrado/);
    assert.equal((await read(doc.id)).data.balance, 0); assert.equal((await read(pending.id)).data.balance, 100);
  });
});
