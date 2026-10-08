import test from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../src/lib/db.js';
import { getEligibleTenantModules } from '../src/services/tenant-modules.service.js';
import { MODULES } from '../src/lib/modules.js';

test('permisos agregados: una consulta por petición, tenant obligatorio y revocación inmediata', async t => {
  const original=prisma.tenantModule.findMany;
  t.after(()=>{prisma.tenantModule.findMany=original;});
  const requested=[MODULES.FINANCE_INVOICES, MODULES.FINANCE_PAYABLES];
  let calls=0, revoked=false;
  prisma.tenantModule.findMany=async ({where})=>{
    calls++; assert.equal(where.tenantId,'empresa-a');
    assert.ok(requested.every(m=>where.module.in.includes(m)));
    return requested.map(module=>({module,enabled:!revoked,source:'MANUAL'}));
  };
  assert.deepEqual(await getEligibleTenantModules({modules:requested}),[]);
  assert.equal(calls,0);
  assert.deepEqual(await getEligibleTenantModules({tenantId:'empresa-a',modules:requested}),requested);
  assert.equal(calls,1);
  revoked=true;
  assert.deepEqual(await getEligibleTenantModules({tenantId:'empresa-a',modules:requested}),[]);
  assert.equal(calls,2);
});
