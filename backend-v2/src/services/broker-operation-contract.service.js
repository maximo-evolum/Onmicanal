/** Archivo: Implementa reglas de negocio y procesos del dominio broker operation contract. */
import { normalizeBrokerOperationType, normalizeBrokerStage, stagesForBrokerOperation, brokerStageChecklist } from './broker-workflows.service.js';

// Contrato de proyección, no reemplaza los estados persistidos del flujo. Incrementa
// la versión cuando cambie un mapeo; nunca reescribe una etapa histórica en GET.
export const BROKER_JOURNEY_VERSION = 'BROKER_JOURNEY_V2';
export function allowGenericBrokerMutation(res, recordType) {
  if (recordType !== 'broker_operation') return true;
  res.status(409).json({ error: 'Utiliza Negocios de Broker OS. Las operaciones y sus etapas tienen controles de acceso, evidencia e historial que no admiten edición ni eliminación genérica.' });
  return false;
}
const entries = (pairs) => pairs.map(([key, label]) => ({ key, label }));
export const BROKER_JOURNEY_CATALOG = {
  version: BROKER_JOURNEY_VERSION,
  capture: entries([['PROSPECCION', 'Prospección'], ['CONTACTO', 'Contacto'], ['TASACION', 'Tasación preliminar'], ['MANDATO', 'Negociación de mandato']]),
  commercial: entries([['CAPTACION', 'Captación'], ['TASACION', 'Tasación'], ['PUBLICACION', 'Publicación'], ['INTERESADOS', 'Interesados'], ['NEGOCIACION', 'Negociación'], ['CIERRE_LEGAL', 'Cierre legal']]),
  pipeline: entries([['LEAD', 'Lead'], ['CONTACT', 'Contacto'], ['QUALIFIED', 'Calificado'], ['VISIT_SCHEDULED', 'Visita agendada'], ['OFFER', 'Oferta'], ['NEGOTIATION', 'Negociación'], ['CLOSING', 'Cierre'], ['POSTSALE', 'Postventa']]),
  tracker: entries([['TITULO_INICIAL', 'Estudio de título inicial'], ['TASACION', 'Evaluación comercial y tasación'], ['PUBLICACION', 'Publicación y seguimiento'], ['COMPRADORES', 'Filtro de compradores'], ['OFERTA', 'Oferta de compra'], ['PROMESA', 'Promesa de compraventa'], ['TITULO_DEFINITIVO', 'Estudio de título definitivo'], ['ESCRITURA', 'Firma de escrituras'], ['INSCRIPCION', 'Inscripción en el Conservador']]),
};
const SALE = {
  RECEPCION_MANDATO: ['CAPTACION', 'CONTACT', 'TITULO_INICIAL'],
  EVALUACION_COMERCIAL: ['TASACION', 'QUALIFIED', 'TASACION'],
  MANDATO_Y_PUBLICACION: ['PUBLICACION', 'QUALIFIED', 'PUBLICACION'],
  CALIFICACION_Y_VISITAS: ['INTERESADOS', 'QUALIFIED', 'COMPRADORES'],
  OFERTA_Y_NEGOCIACION: ['NEGOCIACION', 'OFFER', 'OFERTA'],
  PROMESA: ['CIERRE_LEGAL', 'NEGOTIATION', 'PROMESA'],
  ESTUDIO_DE_TITULO: ['CIERRE_LEGAL', 'CLOSING', 'TITULO_DEFINITIVO'],
  ESCRITURA: ['CIERRE_LEGAL', 'CLOSING', 'ESCRITURA'],
  INSCRIPCION_CBR: ['CIERRE_LEGAL', 'CLOSING', 'INSCRIPCION'],
  ENTREGA_Y_POSTVENTA: ['CIERRE_LEGAL', 'POSTSALE', 'INSCRIPCION'],
};
const RENTAL = {
  CAPTACION: ['CAPTACION', 'CONTACT'], EVALUACION_COMERCIAL: ['TASACION', 'QUALIFIED'],
  DEFINICION_DE_PRECIO: ['TASACION', 'QUALIFIED'], EXCLUSIVIDAD: ['CAPTACION', 'CONTACT'],
  PREPARACION_INMUEBLE: ['PUBLICACION', 'QUALIFIED'], PUBLICACION: ['PUBLICACION', 'QUALIFIED'],
  GENERACION_DE_LEADS: ['INTERESADOS', 'LEAD'], EVALUACION_ARRENDATARIO: ['INTERESADOS', 'QUALIFIED'],
  VISITAS: ['INTERESADOS', 'VISIT_SCHEDULED'], RESERVA: ['NEGOCIACION', 'NEGOTIATION'],
  CONTRATO: ['CIERRE_LEGAL', 'CLOSING'], PAGO_INICIAL: ['CIERRE_LEGAL', 'CLOSING'],
  ENTREGA_LLAVES: ['CIERRE_LEGAL', 'POSTSALE'],
};
const CAPTURE = { PROSPECTO: 'PROSPECCION', VISITA_AGENDADA: 'CONTACTO', EVALUACION_COMERCIAL: 'TASACION', PENDIENTE_DECISION_PROPIETARIO: 'MANDATO', LISTA_PARA_MANDATO: 'MANDATO' };
const text = (v) => String(v ?? '').trim();
const object = (v) => v && typeof v === 'object' && !Array.isArray(v) ? v : {};
const selection = (area, key) => BROKER_JOURNEY_CATALOG[area].find((item) => item.key === key) || null;

export function captureJourney(status) {
  const raw = text(status).toUpperCase();
  return { version: BROKER_JOURNEY_VERSION, sourceStatus: raw, stage: selection('capture', CAPTURE[raw]), outcome: raw === 'MANDATO_FIRMADO' ? 'CONVERTED' : raw === 'DESCARTADA' ? 'DISCARDED' : null };
}

export function brokerOperationPayload(record) {
  const data = object(record.data);
  const type = text(data.operationType) ? normalizeBrokerOperationType(data.operationType) : null;
  const sourceStage = text(data.stage);
  const stage = type ? normalizeBrokerStage(type, sourceStage) : sourceStage;
  const known = !!type && !!sourceStage && (stagesForBrokerOperation(type).includes(stage) || ['CANCELADA', 'PERDIDA', 'CERRADA'].includes(stage));
  const map = known ? (type === 'SALE' ? SALE[stage] : type === 'RENTAL' ? RENTAL[stage] : null) : null;
  const outcome = ['CANCELADA', 'PERDIDA', 'CERRADA'].includes(stage) ? stage : null;
  return {
    ...record,
    data: { ...data, operationType: type || data.operationType, stage, checklist: known ? brokerStageChecklist(type, stage) : [], timeline: Array.isArray(data.timeline) ? data.timeline : [] },
    journey: {
      version: BROKER_JOURNEY_VERSION, operationId: record.id, sourceStage, internalStage: stage,
      commercial: selection('commercial', map?.[0]), pipeline: selection('pipeline', map?.[1]),
      tracker: type === 'SALE' ? selection('tracker', map?.[2]) : null,
      trackerApplicable: type === 'SALE', outcome, needsReview: !known,
      // La posición por sí sola nunca debe mostrarse como prueba de pasos legales completados.
      evidencePolicy: 'POSITION_IS_NOT_COMPLETION',
      warning: !known ? 'Etapa histórica sin equivalencia. Requiere revisión; no se ha modificado.' : type === 'SALE' ? 'La posición no acredita hitos anteriores ni firmas. Consulta la evidencia del expediente.' : null,
    },
    identity: { operationId: record.id, propertyRecordId: text(data.propertyId) || null, propertyId: null, ownerId: null, captureId: null, mandateId: text(data.mandateId) || null, buyerId: text(data.buyerId) || null, leaseTenantId: text(data.leaseTenantId) || null },
  };
}

// Solo lecturas por lote: mostrar una operación no debe crear personas ni propiedades.
export async function projectBrokerOperations(db, records) {
  const rows = records.map(brokerOperationPayload);
  if (!rows.length) return rows;
  const tenantIds = [...new Set(records.map(r => r.tenantId))];
  const ids = [...new Set(rows.map(r => r.identity.propertyRecordId).filter(Boolean))];
  const properties = ids.length ? await db.brokerProperty.findMany({ where: { tenantId: { in: tenantIds }, legacyRecordId: { in: ids } }, select: { id: true, tenantId: true, legacyRecordId: true, ownerId: true, capture: { select: { id: true } } } }) : [];
  const lookup = new Map(properties.map(p => [`${p.tenantId}:${p.legacyRecordId}`, p]));
  const operationIds = records.map(r => r.id);
  const [sales, rentals] = await Promise.all([
    db.brokerSaleCase.findMany({ where: { tenantId: { in: tenantIds }, operationId: { in: operationIds } }, select: { tenantId: true, operationId: true, buyerId: true } }),
    db.brokerRentalCase.findMany({ where: { tenantId: { in: tenantIds }, operationId: { in: operationIds } }, select: { tenantId: true, operationId: true, leaseTenantId: true } }),
  ]);
  const saleLookup = new Map(sales.map(c => [`${c.tenantId}:${c.operationId}`, c]));
  const rentalLookup = new Map(rentals.map(c => [`${c.tenantId}:${c.operationId}`, c]));
  return rows.map(row => {
    const property = lookup.get(`${row.tenantId}:${row.identity.propertyRecordId}`);
    const sale = saleLookup.get(`${row.tenantId}:${row.id}`);
    const rental = rentalLookup.get(`${row.tenantId}:${row.id}`);
    return { ...row, identity: { ...row.identity, propertyId: property?.id || null, ownerId: property?.ownerId || null, captureId: property?.capture?.id || null, buyerId: sale ? sale.buyerId : row.identity.buyerId, leaseTenantId: rental ? rental.leaseTenantId : row.identity.leaseTenantId }, relationStatus: property ? 'LINKED' : 'LEGACY_PENDING' };
  });
}

export async function validateBrokerOperationReferences(db, { tenantId, propertyId, buyerId, leaseTenantId, mandateId }) {
  const fail = () => { const error = new Error('Una referencia inmobiliaria no existe en esta empresa o no corresponde a la propiedad.'); error.status = 422; throw error; };
  for (const [model, id] of [['brokerBuyer', buyerId], ['brokerLeaseTenant', leaseTenantId]]) {
    if (id && !await db[model].findFirst({ where: { id, tenantId }, select: { id: true } })) fail();
  }
  if (mandateId) {
    const mandate = await db.industryRecord.findFirst({ where: { id: mandateId, tenantId, recordType: 'property_mandate' }, select: { data: true } });
    if (!mandate || object(mandate.data).propertyId !== propertyId) fail();
  }
}

// Actualización atómica de proyección con concurrencia optimista: no deja el caso de venta
// en otra etapa ni sobrescribe una línea de tiempo más reciente después de una escritura paralela.
export async function updateBrokerOperationSnapshot(tx, existing, data, status, changes = {}) {
  const changed = await tx.industryRecord.updateMany({
    where: { id: existing.id, tenantId: existing.tenantId, updatedAt: existing.updatedAt },
    data: { ...(status ? { status } : {}), ...changes, data }
  });
  if (changed.count !== 1) { const error = new Error('La operación cambió mientras la revisabas. Actualiza la vista e inténtalo de nuevo.'); error.status = 409; throw error; }
}

export async function persistBrokerOperationStage(db, { existing, type, stage, terminal, data }) {
  return db.$transaction(async tx => {
    await updateBrokerOperationSnapshot(tx, existing, data, terminal ? 'COMPLETED' : 'ACTIVE');
    const model = type === 'SALE' ? 'brokerSaleCase' : type === 'RENTAL' ? 'brokerRentalCase' : null;
    if (model) await tx[model].updateMany({ where: { operationId: existing.id, tenantId: existing.tenantId }, data: { currentStage: stage, status: terminal ? (['ENTREGA_Y_POSTVENTA', 'ENTREGA_LLAVES'].includes(stage) ? 'CERRADA' : 'CANCELADA') : 'ACTIVA' } });
    return tx.industryRecord.findFirst({ where: { id: existing.id, tenantId: existing.tenantId } });
  });
}
