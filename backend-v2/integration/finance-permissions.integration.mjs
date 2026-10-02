import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { qaEnvironment } from '../scripts/lib/qa-environment.mjs';
import { blockDotEnvReads } from '../scripts/lib/qa-runtime.mjs';
const isolated = qaEnvironment(process.env, { requireRedis: false });
for (const key of Object.keys(process.env)) delete process.env[key];
Object.assign(process.env, isolated);
blockDotEnvReads();
const { prisma } = await import('../src/lib/db.js');
const { authMiddleware, signAuthToken } = await import('../src/lib/auth.js');
const { financeRouter } = await import('../src/routes/finance.routes.js');
const { industryRecordsRouter } = await import('../src/routes/industry-records.routes.js');
const { MODULES } = await import('../src/lib/modules.js');
const { FINANCE_RECORD_MODULES } = await import('../src/services/finance-record-access.service.js');
const { createBankImportJob } = await import('../src/services/finance-import-jobs.service.js');
const { default: express } = await import('express');
const { default: jwt } = await import('jsonwebtoken');

test('P0 etapa 3: permisos y aislamiento con HTTP y PostgreSQL reales', { timeout: 90000 }, async t => {
  const tenants = [], run = `permissions-${randomUUID()}`;
  let server;
  t.after(async () => {
    if (server) await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
    try { await prisma.tenant.deleteMany({ where: { id: { in: tenants.map(r => r.id) } } }); }
    finally { await prisma.$disconnect(); }
  });
  for (const suffix of ['a', 'b']) {
    const tenant = await prisma.tenant.create({ data: { name: `Prueba permisos ${suffix}`, slug: `${run}-${suffix}`, industry: 'FINANCE', plan: 'ENTERPRISE' } });
    tenants.push(tenant);
    await prisma.tenantModule.createMany({ data: Object.values(MODULES).map(module => ({ tenantId: tenant.id, module, enabled: true, source: 'MANUAL' })) });
  }
  const [a, b] = tenants, users = {};
  for (const role of ['SUPER_ADMIN', 'OWNER', 'ADMIN', 'AGENT', 'SELLER', 'VIEWER']) {
    users[role] = await prisma.workspaceUser.create({ data: { tenantId: a.id, role, name: `Prueba ${role}`, email: `${run}-${role}@example.invalid` } });
  }
  const invoice = tenantId => ({ tenantId, recordType: 'finance_invoice', title: `Factura privada ${tenantId}`, data: {
    invoiceNumber: 'QA-001', clientName: 'Cliente ficticio', clientRut: '11111111-1', amount: 10000, balance: 10000, paidAmount: 0, currency: 'CLP', issueDate: '2026-01-02', dueDate: '2026-01-30', documentSide: 'CUSTOMER'
  } });
  const own = await prisma.industryRecord.create({ data: invoice(a.id) });
  const foreign = await prisma.industryRecord.create({ data: invoice(b.id) });
  const foreignJob = await createBankImportJob(prisma, { tenantId: b.id, file: { originalname: 'Privada.csv', buffer: Buffer.from('fecha;monto\n02/01/2026;10000') } });
  const app = express(); app.use(express.json()); app.use('/api', authMiddleware, financeRouter, industryRecordsRouter);
  server = createServer(app); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const request = async (role, route, method = 'GET', body, token) => {
    const response = await fetch(base + route, { method, headers: { 'Content-Type': 'application/json', ...(role ? { Authorization: `Bearer ${token || signAuthToken(users[role])}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(10000) });
    return { status: response.status, body: await response.json(), cache: response.headers.get('cache-control') };
  };
  const writes = [
    ['/finance/bank-statements/import', 'POST'], ['/finance/bank-import-jobs/upload', 'POST'],
    ['/finance/monthly-close', 'POST'], ['/finance/monthly-close/2026-01/reopen', 'POST'],
    ['/finance/agents/policy', 'PATCH'], ['/finance/bank-accounts', 'POST'],
    ['/finance/migrations/import', 'POST'], ['/finance/sii/dte/import', 'POST'],
    ['/finance/nubox/sales/issuance', 'POST'], ['/finance/sync/nubox', 'POST'],
    ['/finance/budgets', 'POST'], ['/finance/budgets/unknown', 'DELETE'],
    [`/finance/invoices/${own.id}/receipts`, 'POST'], ['/finance/payables/unknown/payments', 'POST'],
    ['/finance/reconciliations/unknown/approve', 'POST'], ['/finance/reconciliations/unknown/reverse', 'POST'],
    ['/finance/collection-deliveries/unknown/send', 'POST']
  ];
  for (const role of ['VIEWER', 'AGENT', 'SELLER']) {
    for (const [route, method] of writes) await t.test(`${role}: rechaza ${method} ${route}`, async () => {
      assert.equal((await request(role, route, method, {})).status, 403);
    });
  }
  for (const role of Object.keys(users)) await t.test(`${role}: consulta facturas propias sin exponer otra empresa`, async () => {
    const result = await request(role, '/finance/documents?type=customers&tenantId=' + b.id);
    assert.equal(result.status, 200);
    assert.ok(JSON.stringify(result.body).includes(own.id));
    assert.ok(!JSON.stringify(result.body).includes(foreign.id));
    assert.equal(result.cache, 'no-store');
  });
  await t.test('sin sesión no se puede consultar ni escribir', async () => {
    assert.equal((await request(null, '/finance/documents')).status, 401);
    assert.equal((await request(null, '/finance/bank-statements/import', 'POST', {})).status, 401);
  });
  await t.test('claims incompletos, empresa falsificada, expiración y firma inválida se rechazan', async () => {
    const secret = isolated.JWT_SECRET;
    const baseClaims = { userId: users.ADMIN.id, tenantId: a.id, role: 'ADMIN' };
    const invalidTokens = [
      signAuthToken({ tenantId: a.id, role: 'SUPER_ADMIN' }),
      signAuthToken({ ...users.ADMIN, tenantId: b.id }),
      jwt.sign({ ...baseClaims, userId: { not: 'anything' } }, secret),
      jwt.sign(baseClaims, secret, { expiresIn: -1 }),
      jwt.sign(baseClaims, 'untrusted_test_signing_key'),
      jwt.sign(baseClaims, secret, { algorithm: 'HS384' })
    ];
    for (const token of invalidTokens) assert.equal((await request('ADMIN', '/finance/documents', 'GET', undefined, token)).status, 401);
  });
  for (const role of ['ADMIN', 'SUPER_ADMIN']) await t.test(`${role}: IDs ajenos no dan acceso a originales ni modificaciones`, async () => {
    for (const route of [`/finance/bank-import-jobs/${foreignJob.id}`, `/finance/bank-import-jobs/${foreignJob.id}/original`]) {
      assert.equal((await request(role, route)).status, 404);
    }
    for (const [route, method, body] of [
      [`/finance/bank-import-jobs/${foreignJob.id}/cancel`, 'POST', {}],
      [`/industry-records/${foreign.id}`, 'PATCH', { title: 'No permitido', tenantId: b.id }],
      [`/industry-records/${foreign.id}/metadata`, 'PATCH', { metadata: { amount: 1 } }],
      [`/industry-records/${foreign.id}`, 'DELETE', {}]
    ]) assert.equal((await request(role, route, method, body)).status, 404);
    assert.equal((await prisma.industryRecord.findUniqueOrThrow({ where: { id: foreign.id } })).data.amount, 10000);
  });
  await t.test('un token anterior no conserva permisos revocados ni puede falsear el rol', async () => {
    const token = signAuthToken(users.ADMIN);
    await prisma.workspaceUser.update({ where: { id: users.ADMIN.id }, data: { role: 'VIEWER' } });
    try {
      assert.equal((await request('ADMIN', '/finance/monthly-close', 'POST', {}, token)).status, 403);
      const forgedRole = signAuthToken({ ...users.ADMIN, role: 'SUPER_ADMIN' });
      assert.equal((await request('ADMIN', '/finance/monthly-close', 'POST', {}, forgedRole)).status, 403);
    } finally { await prisma.workspaceUser.update({ where: { id: users.ADMIN.id }, data: { role: 'ADMIN' } }); }
  });
  await t.test('desactivar usuario o cambiar su empresa invalida su sesión anterior', async () => {
    const token = signAuthToken(users.ADMIN);
    try {
      await prisma.workspaceUser.update({ where: { id: users.ADMIN.id }, data: { isActive: false } });
      assert.equal((await request('ADMIN', '/finance/documents', 'GET', undefined, token)).status, 401);
      await prisma.workspaceUser.update({ where: { id: users.ADMIN.id }, data: { isActive: true, tenantId: b.id } });
      assert.equal((await request('ADMIN', '/finance/documents', 'GET', undefined, token)).status, 401);
    } finally { await prisma.workspaceUser.update({ where: { id: users.ADMIN.id }, data: { isActive: true, tenantId: a.id } }); }
  });
  await t.test('la consulta genérica no permite eludir un módulo bloqueado', async () => {
    await prisma.tenantModule.update({ where: { tenantId_module: { tenantId: a.id, module: MODULES.FINANCE_INVOICES } }, data: { enabled: false } });
    try {
      assert.equal((await request('ADMIN', '/finance/documents')).status, 403);
      assert.equal((await request('ADMIN', '/industry-records?type=finance_invoice')).status, 403);
      const all = await request('ADMIN', '/industry-records');
      assert.equal(all.status, 200); assert.ok(!JSON.stringify(all.body).includes(own.id));
      const overview = await request('ADMIN', '/finance/overview?period=2026-01');
      assert.equal(overview.status, 200); assert.equal(overview.body.restricted, true);
      assert.ok(!JSON.stringify(overview.body).includes(own.id));
      assert.equal((await request('ADMIN', '/finance/overview?period=2026-01&export=csv')).status, 403);
      assert.equal((await request('ADMIN', '/finance/reconciliation-workspace?kind=invoices')).status, 403);
      assert.equal((await request('ADMIN', '/finance/collections/portfolio')).status, 403);
      assert.equal((await request('ADMIN', '/finance/workspace-records?type=finance_collection_case')).status, 403);
      assert.equal((await request('ADMIN', '/finance/monthly-close/preview?period=2026-01')).status, 403);
      assert.equal((await request('ADMIN', '/finance/planning?period=2026-01')).status, 403);
      assert.equal((await request('ADMIN', '/finance/budgets', 'POST', { period: '2026-01', category: 'Prohibido' })).status, 403);
      for (const type of ['finance_reconciliation', 'finance_collection_case', 'finance_monthly_close']) {
        assert.equal((await request('ADMIN', `/industry-records?type=${type}`)).status, 403, type);
      }
      assert.equal((await request('SUPER_ADMIN', '/finance/documents')).status, 200);
    } finally { await prisma.tenantModule.update({ where: { tenantId_module: { tenantId: a.id, module: MODULES.FINANCE_INVOICES } }, data: { enabled: true } }); }
  });
  await t.test('proveedores históricos y tipos no clasificados no evaden permisos', async () => {
    const supplier = await prisma.industryRecord.create({ data: { ...invoice(a.id), title: 'Proveedor histórico', data: { ...invoice(a.id).data, documentSide: 'SUPPLIER' } } });
    const unknown = await prisma.industryRecord.create({ data: { tenantId: a.id, recordType: 'finance_unclassified', title: 'No publicar' } });
    await prisma.tenantModule.update({ where: { tenantId_module: { tenantId: a.id, module: MODULES.FINANCE_PAYABLES } }, data: { enabled: false } });
    try {
      for (const route of ['/industry-records', '/industry-records?type=finance_invoice']) {
        const result = await request('ADMIN', route); assert.equal(result.status, 200);
        assert.ok(!JSON.stringify(result.body).includes(supplier.id)); assert.ok(!JSON.stringify(result.body).includes(unknown.id));
      }
      assert.equal((await request('ADMIN', '/industry-records?type=finance_unclassified')).status, 403);
      assert.equal((await request('ADMIN', `/industry-records/${supplier.id}`, 'PATCH', { title: 'Eludir' })).status, 403);
      assert.equal((await request('ADMIN', `/industry-records/${own.id}/metadata`, 'PATCH', { data: { documentSide: 'SUPPLIER' } })).status, 403);
      assert.equal((await request('ADMIN', `/finance/documents/${supplier.id}/nubox/pdf`)).status, 403);
    } finally { await prisma.tenantModule.update({ where: { tenantId_module: { tenantId: a.id, module: MODULES.FINANCE_PAYABLES } }, data: { enabled: true } }); }
  });
  await t.test('registros de control requieren sus flujos auditados, incluso para administradores', async () => {
    for (const recordType of ['finance_open_banking_consent', 'finance_budget', 'finance_document_adjustment', 'finance_monthly_close']) {
      assert.equal((await request('ADMIN', '/industry-records', 'POST', { recordType, title: 'Bypass' })).status, 409);
    }
    assert.equal((await request('ADMIN', '/industry-records/assignments/balance', 'POST', { recordType: 'finance_invoice' })).status, 409);
  });
  for (const module of new Set(Object.values(FINANCE_RECORD_MODULES))) await t.test(`todos los tipos de ${module} respetan la desactivación`, async () => {
    await prisma.tenantModule.update({ where: { tenantId_module: { tenantId: a.id, module } }, data: { enabled: false } });
    try {
      for (const [type, ownerModule] of Object.entries(FINANCE_RECORD_MODULES)) if (ownerModule === module) {
        assert.equal((await request('ADMIN', `/industry-records?type=${type}`)).status, 403, type);
      }
    } finally { await prisma.tenantModule.update({ where: { tenantId_module: { tenantId: a.id, module } }, data: { enabled: true } }); }
  });
  for (const role of ['OWNER', 'ADMIN', 'SUPER_ADMIN']) await t.test(`${role}: operación válida conserva la empresa de la sesión`, async () => {
    const result = await request(role, '/finance/budgets', 'POST', { period: '2026-01', category: `Prueba ${role}`, plannedIncome: 10000, plannedExpense: 1000, tenantId: b.id });
    assert.ok([200, 201].includes(result.status));
    const record = await prisma.industryRecord.findFirstOrThrow({ where: { tenantId: a.id, recordType: 'finance_budget', data: { path: ['category'], equals: `Prueba ${role}` } } });
    assert.equal(record.data.plannedIncome, 10000);
    assert.equal(await prisma.industryRecord.count({ where: { tenantId: b.id, recordType: 'finance_budget' } }), 0);
  });
});
