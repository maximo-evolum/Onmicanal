/** Archivo: Verifica mediante pruebas automatizadas el comportamiento de broker conversion.test. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { brokerConversionPlan } from '../src/services/broker-conversion-plan.service.js';
import { convertBrokerProspect } from '../src/services/broker-prospect-conversion.service.js';
import { brokerOperationPayload } from '../src/services/broker-operation-contract.service.js';
import { brokerSaleReadiness } from '../src/services/broker-sale.service.js';

const source = {id:'prospect-1',tenantId:'tenant-1',assignedToId:'broker-1',data:{version:3,stage:'NEGOCIACION',ownerName:'Carolina Pérez',ownerPhone:'56911111111',ownerRut:'12345678-5',title:'Casa de Carolina',propertyType:'casa',address:'Calle Uno 123',comuna:'Temuco',captureOrigin:'Formulario web',intendedService:'VENTA',currency:'UF',valuation:{amount:5000,rationale:'Comparables revisados'},timeline:[{at:'2026-01-01',action:'NOTA_REGISTRADA',note:'Documentos recibidos',userId:'broker-1'}]}};
const terms = {signedAt:'2026-01-01',publicationPrice:5200,commissionPct:2.5,exclusivityDays:90,evidenceReference:'Expediente de prueba M-100',confirmSigned:true};

test('Revisión de conversión no muta datos ni mezcla monedas y avisa plazo vencido',()=>{
  const before=structuredClone(source);
  const preview=brokerConversionPlan(source,terms,new Date('2026-10-12'));
  assert.deepEqual(source,before);
  assert.equal(preview.externalActions,false);
  assert.equal(preview.initialStage,'RECEPCION_MANDATO');
  assert.equal(preview.terms.currency,'UF');
  assert.equal(preview.terms.expiresAt,'2026-04-01T00:00:00.000Z');
  assert.ok(preview.warnings.some(w=>w.includes('venció')));
  assert.equal(preview.property.region,'Sin informar');
});
test('Revisión exige identidad, contacto, tasación, responsable, referido y fecha real',()=>{
  for(const patch of [{valuation:null},{ownerName:''},{ownerPhone:''},{captureOrigin:''},{intendedService:'INVENTADA'},{isReferral:true}])assert.throws(()=>brokerConversionPlan({...source,data:{...source.data,...patch}},terms));
  assert.throws(()=>brokerConversionPlan({...source,assignedToId:null},terms),/responsable/);
  for(const signedAt of [null,'','2026-02-30','nada'])assert.throws(()=>brokerConversionPlan(source,{...terms,signedAt}));
  const preview=brokerConversionPlan({...source,data:{...source.data,ownerRut:''}},terms);
  assert.ok(preview.warnings.some(w=>w.includes('no se fusionarán')));
});

function adapter(failAt=Infinity) {
  let state=[],writes=0;
  const write=async data=>{state.push(structuredClone(data));if(++writes===failAt)throw new Error('Fallo controlado');return {...data,id:data.id||`record-${writes}`};};
  const db={industryRecord:{create:async({data})=>write(data),findFirst:async()=>null},brokerPropertyCapture:{create:async({data})=>write({...data,kind:'capture'})}};
  const deps={propertyDataFromCapture:(raw,capture)=>({...raw,captureStatus:capture.status}),ensureBrokerCaptureProperty:async()=>{await write({kind:'strict-property'});return{id:'strict-p',ownerId:'strict-o'};},ensureBrokerSaleCase:async(_db,input)=>write({kind:'sale',propertyId:input.property.id,operationId:input.operation.id}),ensureBrokerRentalCase:async(_db,input)=>write({kind:'rental',propertyId:input.property.id,operationId:input.operation.id})};
  return{db,deps,state:()=>state,transaction:async fn=>{const before=structuredClone(state);try{return await fn(db);}catch(e){state=before;throw e;}}};
}
for(const intendedService of ['VENTA','ARRIENDO','ADMINISTRACION'])test(`Conversión ${intendedService}: vínculos bidireccionales e historia preservada`,async()=>{
  const a=adapter(),prospect={...source,data:{...source.data,intendedService}};
  const plan=brokerConversionPlan(prospect,terms);
  const links=await a.transaction(db=>convertBrokerProspect(db,{tenantId:source.tenantId,user:{id:'actor-1'}},prospect,plan.terms,a.deps));
  const operation=a.state().find(r=>r.recordType==='broker_operation'),mandate=a.state().find(r=>r.recordType==='property_mandate'),property=a.state().find(r=>r.recordType==='property');
  assert.equal(operation.id,links.operationId);assert.equal(operation.data.mandateId,mandate.id);assert.equal(mandate.data.operationId,operation.id);
  assert.equal(mandate.data.ownerRecordId,links.ownerId);assert.equal(property.data.currency,'UF');
  assert.deepEqual(operation.data.conversion.captureHistory,source.data.timeline);
  assert.equal(operation.data.conversion.terms.commissionPct,2.5);
  assert.equal(operation.data.stage,plan.initialStage);
  assert.equal(operation.data.conversion.convertedBy,'actor-1');
  assert.equal(operation.data.ownerName,'Carolina Pérez');
  if(intendedService==='VENTA')assert.equal(brokerOperationPayload(operation).journey.commercial.key,'CAPTACION');
  assert.ok(!a.state().find(r=>r.kind==='capture').ownerAcceptedEvaluationAt,'La firma del mandato no inventa la aceptación de la tasación');
  assert.equal(property.data.stage,undefined);
});
for(let failAt=1;failAt<=7;failAt++)test(`Fallo en escritura ${failAt}: no deja conversión parcial (adaptador transaccional)`,async()=>{
  const a=adapter(failAt);
  await assert.rejects(()=>a.transaction(db=>convertBrokerProspect(db,{tenantId:source.tenantId,user:{id:'actor-1'}},source,brokerConversionPlan(source,terms).terms,a.deps)),/Fallo controlado/);
  assert.equal(a.state().length,0);
});
test('Nuevas ventas requieren revisar título inicial para avanzar; no salta por firmar mandato',()=>{
  for(const status of ['PENDIENTE','EN_REVISION','REVISADO_CON_OBSERVACIONES'])assert.equal(brokerSaleReadiness({targetStage:'EVALUACION_COMERCIAL',capture:{status:'MANDATO_FIRMADO',preliminaryTitleStatus:status}}).ready,false);
  assert.equal(brokerSaleReadiness({targetStage:'EVALUACION_COMERCIAL',capture:{preliminaryTitleStatus:'REVISADO_SIN_OBSERVACIONES'}}).ready,true);
});
