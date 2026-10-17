/** Archivo: Implementa reglas de negocio y procesos del dominio broker conversion plan. */
import { mandateTerms, prospectInput } from './broker-prospect.service.js';
import { stagesForBrokerOperation } from './broker-workflows.service.js';

export const CONVERSION_VERSION = 'BROKER_CONVERSION_V1';
// Compartido por la vista previa de solo lectura y la conversión transaccional final.
// Nunca infiere una firma, publicación o pago desde la posición de un flujo.
export function brokerConversionPlan(prospect, input, now = new Date()) {
  const data = prospect.data || {};
  const fail = message => { throw Object.assign(new Error(message), { status: 422 }); };
  prospectInput(data);
  if (!prospect.assignedToId) fail('Asigna un responsable antes de convertir la captación.');
  if (data.isReferral && !data.referralConvertedAt) fail('Incorpora primero el referido al embudo.');
  if (!(Number(data.valuation?.amount) > 0) || !Number.isFinite(Number(data.valuation?.amount))) fail('Registra la valorización preliminar antes de convertir.');
  const terms = mandateTerms(data, input);
  const expiresAt = new Date(terms.signedAt);
  expiresAt.setUTCDate(expiresAt.getUTCDate() + terms.exclusivityDays);
  const operationType = { VENTA: 'SALE', ARRIENDO: 'RENTAL', ADMINISTRACION: 'ADMINISTRATION' }[data.intendedService];
  const warnings = [];
  if (!data.ownerRut) warnings.push('Sin RUT no se fusionarán propietarios por nombre. Se creará una identidad independiente.');
  if (expiresAt < now) warnings.push('El plazo de exclusividad informado ya venció. Se conservará como antecedente histórico; no acredita un mandato vigente.');
  if (!data.photoUrl) warnings.push('Falta la foto principal. La conversión no publica automáticamente el inmueble.');
  if (!data.region) warnings.push('Región no informada: deberá completarse en la ficha del inmueble.');
  return {
    version: CONVERSION_VERSION, prospectId: prospect.id, prospectVersion: data.version,
    operationType, initialStage: stagesForBrokerOperation(operationType)[0],
    property: { title: data.title, address: data.address, comuna: data.comuna, region: data.region || 'Sin informar', propertyType: data.propertyType },
    owner: { name: data.ownerName, rut: data.ownerRut || '', phone: data.ownerPhone || '', email: data.ownerEmail || '' },
    assignedToId: prospect.assignedToId, origin: data.captureOrigin, intendedService: data.intendedService,
    terms: { ...terms, expiresAt: expiresAt.toISOString() }, warnings,
    creates: ['Ficha del inmueble', 'Propietario nuevo o vinculado por RUT', 'Mandato con evidencia registrada', operationType === 'ADMINISTRATION' ? 'Operación de administración' : 'Negocio y expediente de ' + (operationType === 'SALE' ? 'venta' : 'arriendo')],
    externalActions: false,
  };
}
