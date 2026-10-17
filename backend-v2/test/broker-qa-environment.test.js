/** Archivo: Verifica que la QA de Broker OS jamás acepte una base remota o productiva. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { brokerQaEnvironment } from '../scripts/lib/broker-qa-environment.mjs';

const valid = {
  NODE_ENV: 'test',
  CONFIRM_BROKER_QA: 'YES',
  QA_BROKER_DATABASE_URL: 'postgresql://evolum_test:evolum_local_test_only@127.0.0.1:55434/evolum_broker_test'
};

test('Broker QA acepta solamente la base local dedicada y elimina secretos heredados', () => {
  const env = brokerQaEnvironment({ ...valid, NUBOX_API_KEY: 'no-debe-filtrarse', DATABASE_URL: 'postgresql://prod' });
  assert.equal(env.DATABASE_URL, valid.QA_BROKER_DATABASE_URL);
  assert.equal(env.NUBOX_API_KEY, undefined);
  assert.equal(env.ENABLE_AUTOMATION, 'false');
});

test('Broker QA rechaza producción, hosts remotos y otra base', () => {
  assert.throws(() => brokerQaEnvironment({ ...valid, NODE_ENV: 'production' }), /producción/);
  assert.throws(() => brokerQaEnvironment({ ...valid, QA_BROKER_DATABASE_URL: 'postgresql://evolum_test:x@railway.app:55434/evolum_broker_test' }), /Solo se permite/);
  assert.throws(() => brokerQaEnvironment({ ...valid, QA_BROKER_DATABASE_URL: 'postgresql://evolum_test:x@127.0.0.1:55434/railway' }), /Solo se permite/);
});
