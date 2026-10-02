import test from 'node:test';
import assert from 'node:assert/strict';
import { MODULES } from '../src/lib/modules.js';
import { FINANCE_RECORD_MODULES, financeRecordModule, financeRecordRequiredModules, GENERIC_FINANCE_WRITABLE_TYPES } from '../src/services/finance-record-access.service.js';

test('todos los registros financieros clasificados tienen un módulo conocido y dependencias explícitas', () => {
  const known = new Set(Object.values(MODULES));
  for (const [type, owner] of Object.entries(FINANCE_RECORD_MODULES)) {
    assert.ok(known.has(owner), type);
    const required = financeRecordRequiredModules(type);
    assert.ok(required.includes(owner), type);
    assert.ok(required.every(module => known.has(module)), type);
  }
  assert.equal(financeRecordModule('finance_future_private_record'), null);
  assert.deepEqual(financeRecordRequiredModules('finance_future_private_record'), []);
});

test('documento histórico de proveedor conserva permiso de cuentas por pagar', () => {
  assert.equal(financeRecordModule('finance_invoice', { documentSide: 'SUPPLIER' }), MODULES.FINANCE_PAYABLES);
  assert.equal(financeRecordModule('finance_invoice', { documentSide: 'CUSTOMER' }), MODULES.FINANCE_INVOICES);
});

test('resúmenes de conciliación, cobranza y cierre no eluden permisos de sus fuentes', () => {
  for (const type of ['finance_reconciliation', 'finance_collection_case', 'finance_monthly_close']) {
    assert.ok(financeRecordRequiredModules(type).includes(MODULES.FINANCE_INVOICES), type);
  }
  assert.ok(financeRecordRequiredModules('finance_monthly_close').includes(MODULES.FINANCE_PAYABLES));
  assert.deepEqual([...GENERIC_FINANCE_WRITABLE_TYPES].sort(), ['bank_movement', 'finance_invoice', 'finance_payable']);
});
