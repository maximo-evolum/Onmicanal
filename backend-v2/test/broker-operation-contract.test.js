/** Archivo: Verifica mediante pruebas automatizadas el comportamiento de broker operation contract.test. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { BROKER_JOURNEY_CATALOG as catalog, brokerOperationPayload, captureJourney, projectBrokerOperations, validateBrokerOperationReferences, persistBrokerOperationStage, allowGenericBrokerMutation, updateBrokerOperationSnapshot } from '../src/services/broker-operation-contract.service.js';
import { SALE_STAGES, RENTAL_STAGES, stagesForBrokerOperation, validateBrokerStageTransition } from '../src/services/broker-workflows.service.js';

const operation = (stage = 'PROMESA', type = 'SALE', extras = {}) => ({ id: 'op-1', tenantId: 'empresa-1', updatedAt: new Date('2026-10-09T10:00:00Z'), data: { operationType: type, stage, propertyId: 'ficha-1', timeline: [{ note: 'Histórico original' }] }, ...extras });

test('catálogo distingue cuatro captaciones, seis negocios, ocho columnas y nueve hitos', () => {
  for (const [area, size] of Object.entries({ capture: 4, commercial: 6, pipeline: 8, tracker: 9 })) {
    assert.equal(catalog[area].length, size);
    assert.equal(new Set(catalog[area].map(x => x.key)).size, size);
    assert.ok(catalog[area].every(x => x.label));
  }
});

for (const [type, stages] of [['SALE', SALE_STAGES], ['RENTAL', RENTAL_STAGES], ['ADMINISTRATION', stagesForBrokerOperation('ADMINISTRATION')]]) {
  test(`todas las etapas de ${type} tienen una proyección sin mutar el histórico`, () => {
    for (const stage of stages) {
      const source = operation(stage, type);
      const before = structuredClone(source);
      const result = brokerOperationPayload(source);
      assert.deepEqual(source, before);
      assert.equal(result.id, source.id);
      assert.equal(result.journey.needsReview, false, stage);
      assert.equal(result.journey.internalStage, stage);
      assert.equal(result.journey.sourceStage, stage);
      assert.equal(result.journey.evidencePolicy, 'POSITION_IS_NOT_COMPLETION');
      assert.equal(result.journey.trackerApplicable, type === 'SALE');
      if (type !== 'ADMINISTRATION') { assert.ok(result.journey.commercial); assert.ok(result.journey.pipeline); }
      if (type === 'SALE') assert.ok(result.journey.tracker);
      else assert.equal(result.journey.tracker, null);
    }
  });
}

test('Negocios, Pipeline y Tracker representan la misma promesa', () => {
  const { journey } = brokerOperationPayload(operation());
  assert.equal(journey.commercial.key, 'CIERRE_LEGAL');
  assert.equal(journey.pipeline.key, 'NEGOTIATION');
  assert.equal(journey.tracker.key, 'PROMESA');
  assert.equal(journey.operationId, 'op-1');
  assert.match(journey.warning, /no acredita/);
});

test('alias antiguos conservan su valor original; desconocidos no vuelven a etapa uno', () => {
  const alias = brokerOperationPayload(operation('PUBLICACION'));
  assert.equal(alias.journey.sourceStage, 'PUBLICACION');
  assert.equal(alias.data.stage, 'MANDATO_Y_PUBLICACION');
  for (const stage of ['ETAPA_DESCONOCIDA', '']) {
    const result = brokerOperationPayload(operation(stage));
    assert.equal(result.journey.needsReview, true);
    assert.equal(result.journey.pipeline, null);
  }
  assert.equal(brokerOperationPayload({ ...operation(), data: {} }).journey.needsReview, true);
  assert.equal(brokerOperationPayload(operation('PROMESA', 'DESCONOCIDO')).journey.needsReview, true);
});

test('la ruta genérica no permite alterar ni borrar operaciones saltándose sus controles', () => {
  const res = { code: null, payload: null, status(code) { this.code = code; return this; }, json(body) { this.payload = body; return this; } };
  assert.equal(allowGenericBrokerMutation(res, 'broker_operation'), false);
  assert.equal(res.code, 409);
  assert.match(res.payload.error, /Negocios de Broker OS/);
  for (const type of ['property', 'customer', 'invoice']) assert.equal(allowGenericBrokerMutation(res, type), true);
});

test('una operación cerrada o cancelada no aparece como recién iniciada', () => {
  for (const stage of ['CANCELADA', 'PERDIDA', 'CERRADA']) {
    const result = brokerOperationPayload(operation(stage));
    assert.equal(result.journey.outcome, stage);
    assert.equal(result.journey.pipeline, null);
    assert.equal(validateBrokerStageTransition({ operationType: 'SALE', currentStage: stage, nextStage: SALE_STAGES[0] }).ok, false);
  }
  for (const currentStage of ['', 'DESCONOCIDO']) assert.equal(validateBrokerStageTransition({ operationType: 'SALE', currentStage, nextStage: 'CANCELADA' }).ok, false);
});

test('captación agrupa estados sin afirmar mandato firmado ni perder descartes', () => {
  assert.equal(captureJourney('LISTA_PARA_MANDATO').stage.key, 'MANDATO');
  assert.equal(captureJourney('LISTA_PARA_MANDATO').outcome, null);
  assert.equal(captureJourney('MANDATO_FIRMADO').outcome, 'CONVERTED');
  assert.equal(captureJourney('DESCARTADA').outcome, 'DISCARDED');
  assert.equal(captureJourney('desconocido').stage, null);
});

test('identidad se une por empresa e ID, nunca por nombres, y solo consulta', async () => {
  const queries = [];
  const model = rows => ({ findMany: async query => { queries.push(query); return rows; } });
  const db = {
    brokerProperty: model([{ id: 'estricta-otra', tenantId: 'empresa-2', legacyRecordId: 'ficha-1', ownerId: 'otra' }, { id: 'estricta-1', tenantId: 'empresa-1', legacyRecordId: 'ficha-1', ownerId: 'dueno-1', capture: { id: 'captacion-1' } }]),
    brokerSaleCase: model([{ tenantId: 'empresa-1', operationId: 'op-1', buyerId: 'comprador-1' }]),
    brokerRentalCase: model([]),
  };
  const [linked, legacy] = await projectBrokerOperations(db, [operation(), operation('PROMESA', 'SALE', { id: 'op-2', data: { operationType: 'SALE', stage: 'PROMESA', propertyId: 'no-normalizada' } })]);
  assert.equal(linked.identity.propertyId, 'estricta-1');
  assert.equal(linked.identity.ownerId, 'dueno-1');
  assert.equal(linked.identity.buyerId, 'comprador-1');
  assert.equal(linked.identity.captureId, 'captacion-1');
  assert.equal(legacy.relationStatus, 'LEGACY_PENDING');
  assert.equal(legacy.identity.propertyId, null);
  assert.ok(queries.every(q => q.where.tenantId.in.includes('empresa-1')));
  assert.deepEqual(await projectBrokerOperations({}, []), []);
});

test('referencias de personas y mandato deben ser de la misma empresa y propiedad', async () => {
  const db = {
    brokerBuyer: { findFirst: async ({ where }) => where.tenantId === 'empresa-1' && where.id === 'comprador-1' ? { id: where.id } : null },
    brokerLeaseTenant: { findFirst: async () => null },
    industryRecord: { findFirst: async ({ where }) => where.tenantId === 'empresa-1' && where.id === 'mandato-1' ? { data: { propertyId: 'ficha-1' } } : null },
  };
  const valid = { tenantId: 'empresa-1', propertyId: 'ficha-1', buyerId: 'comprador-1', mandateId: 'mandato-1' };
  await validateBrokerOperationReferences(db, valid);
  for (const patch of [{ buyerId: 'ajeno' }, { tenantId: 'empresa-2' }, { propertyId: 'otra' }, { leaseTenantId: 'ajeno' }]) await assert.rejects(validateBrokerOperationReferences(db, { ...valid, ...patch }), { status: 422 });
});

// El simulador transaccional comprueba el límite de transacción y el rollback del servicio;
// no afirma verificar una instancia PostgreSQL de producción.
function database({ failCase = false } = {}) {
  let state = { record: operation(), case: { currentStage: 'PROMESA' } };
  return {
    state: () => structuredClone(state),
    $transaction: async fn => {
      const draft = structuredClone(state);
      const tx = {
        industryRecord: {
          updateMany: async ({ where, data }) => {
            assert.equal(where.tenantId, draft.record.tenantId);
            if (+where.updatedAt !== +draft.record.updatedAt) return { count: 0 };
            Object.assign(draft.record, data, { updatedAt: new Date(+draft.record.updatedAt + 1) });
            return { count: 1 };
          },
          findFirst: async () => draft.record,
        },
        brokerSaleCase: { updateMany: async ({ where, data }) => { assert.equal(where.tenantId, 'empresa-1'); if (failCase) throw new Error('fallo simulado'); Object.assign(draft.case, data); return { count: 1 }; } },
      };
      const result = await fn(tx);
      state = draft;
      return result;
    },
  };
}

test('avance guarda etapa e historial junto con el expediente; conflicto devuelve 409', async () => {
  const db = database();
  const input = { existing: operation(), type: 'SALE', stage: 'ESTUDIO_DE_TITULO', terminal: false, data: { ...operation().data, stage: 'ESTUDIO_DE_TITULO', timeline: [...operation().data.timeline, { type: 'STAGE_CHANGED' }] } };
  await persistBrokerOperationStage(db, input);
  assert.equal(db.state().record.data.stage, db.state().case.currentStage);
  assert.equal(db.state().record.data.timeline.length, 2);
  await assert.rejects(persistBrokerOperationStage(db, input), { status: 409 });
  assert.equal(db.state().record.data.timeline.length, 2);
});

test('si falla el expediente se revierte también la operación', async () => {
  const db = database({ failCase: true });
  const before = db.state();
  await assert.rejects(persistBrokerOperationStage(db, { existing: operation(), type: 'SALE', stage: 'ESTUDIO_DE_TITULO', terminal: false, data: { ...operation().data, stage: 'ESTUDIO_DE_TITULO' } }), /fallo simulado/);
  assert.deepEqual(db.state(), before);
});

test('una edición del expediente o nota obsoleta no revierte un avance de etapa', async () => {
  const db = database();
  const original = operation();
  await persistBrokerOperationStage(db, { existing: original, type: 'SALE', stage: 'ESTUDIO_DE_TITULO', terminal: false, data: { ...original.data, stage: 'ESTUDIO_DE_TITULO' } });
  await assert.rejects(db.$transaction(tx => updateBrokerOperationSnapshot(tx, original, { ...original.data, clientName: 'Persona de prueba' })), { status: 409 });
  assert.equal(db.state().record.data.stage, 'ESTUDIO_DE_TITULO');
});
