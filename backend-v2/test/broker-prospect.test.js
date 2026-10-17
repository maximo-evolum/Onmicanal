/** Archivo: Verifica mediante pruebas automatizadas el comportamiento de broker prospect.test. */
import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { once } from "node:events";
import { prospectInput, prospectTransition, mandateTerms, prospectPresentation, comparableValuation, claimProspect } from "../src/services/broker-prospect.service.js";
import { createBrokerProspectsRouter } from "../src/routes/broker-prospects.routes.js";
import { normalizeBrokerAccessProfile } from "../src/services/broker-access.service.js";
import { brokerGenericRecordAllowed } from "../src/services/broker-record-access.service.js";
import { convertBrokerProspect } from "../src/services/broker-prospect-conversion.service.js";

const valid = { ownerName: "Ana Pérez", ownerPhone: "56912345678", title: "Casa de Ana", captureOrigin: "Formulario web", intendedService: "VENTA", currency: "CLP", address: "Los Alerces 120", comuna: "Providencia", propertyType: "casa", ownerExpectedPrice: 120000000 };
const terms = { publicationPrice: 100000000, commissionPct: 2.5, exclusivityDays: 90, signedAt: "2026-01-01", evidenceReference: "Expediente M-001", confirmSigned: true };
test("Origen y contacto obligatorios; el cliente no puede inyectar etapa, versión ni conversión", () => {
  for (const patch of [{ captureOrigin: "" }, { ownerPhone: "", ownerEmail: "" }, { intendedService: "INVENTADO" }, { currency: "ZZZ" }, { usableSquareMeters: -2 }, { usableSquareMeters: 100, totalSquareMeters: 20 }]) assert.throws(()=>prospectInput({...valid,...patch}));
  const parsed = prospectInput({...valid, version:99, stage:"NEGOCIACION",outcome:"CONVERTED"});
  assert.equal(parsed.version,undefined);assert.equal(parsed.stage,undefined);assert.equal(parsed.outcome,undefined);
});
test("Tracker secuencial y condiciones para tasación y negociación",()=>{
  assert.throws(()=>prospectTransition({...valid,stage:"PROSPECCION"},"TASACION"),/siguiente/);
  assert.equal(prospectTransition({...valid,stage:"PROSPECCION"},"CONTACTO").stage,"CONTACTO");
  assert.throws(()=>prospectTransition({...valid,stage:"CONTACTO",address:""},"TASACION"),/dirección/);
  assert.throws(()=>prospectTransition({...valid,stage:"TASACION"},"NEGOCIACION"),/valorización/);
  assert.throws(()=>prospectTransition({...valid,stage:"PROSPECCION",isReferral:true},"CONTACTO"),/referido/);
});
test("Mandato exige condiciones positivas, evidencia, confirmación y fecha real",()=>{
  const data={...valid,stage:"NEGOCIACION"};
  assert.equal(mandateTerms(data,terms).commissionPct,2.5);
  for(const patch of [{confirmSigned:false},{evidenceReference:""},{publicationPrice:0},{commissionPct:101},{exclusivityDays:45},{signedAt:"2099-01-01"}]) assert.throws(()=>mandateTerms(data,{...terms,...patch}));
  assert.throws(()=>mandateTerms({...data,stage:"CONTACTO"},terms));
});
test("Brecha mayor al 10%, prioridad y próxima acción explicable",()=>{
  const row=prospectPresentation({createdAt:"2026-01-01",data:{...valid,stage:"TASACION",valuation:{amount:100000000}}},new Date("2026-01-10"));
  assert.equal(row.priceGapPct,20);assert.equal(row.priceGapWarning,true);assert.equal(row.priority,"ALTA");assert.match(row.nextAction,/comparables/);
});
test("Comparables no mezclan moneda, comuna, tipo ni operación",()=>{
  const rows=[90,100,110].map((price,i)=>({id:String(i),title:`Casa ${i}`,data:{...valid,price,operation:"venta"}}));
  const result=comparableValuation(valid,rows);
  assert.equal(result.amount,100);assert.equal(result.comparables.length,3);
  assert.throws(()=>comparableValuation(valid,[...rows.slice(0,2),{...rows[2],data:{...rows[2].data,currency:"UF"}}]),/tres comparables/);
});
test("CAS no acepta versiones obsoletas ni carreras de guardado",async()=>{
  await assert.rejects(()=>claimProspect({}, {data:{version:2}},1),/cambió/);
  await assert.rejects(()=>claimProspect({industryRecord:{updateMany:async()=>({count:0})}},{id:"x",tenantId:"t",data:{version:2}},2),/Otra acción/);
});
test("API genérica no permite alterar prospectos internos",()=>{
  for(const action of ["VIEW","CREATE","EDIT","DELETE"]) assert.equal(brokerGenericRecordAllowed({},"broker_capture_prospect",action),false);
});
test("RUT normalizado y verificado; no se confunden propietarios por nombre",()=>{
  assert.equal(prospectInput({...valid,ownerRut:"12.345.678-5"}).ownerRut,"12345678-5");
  assert.throws(()=>prospectInput({...valid,ownerRut:"12.345.678-9"}),/verificador/);
});
for (const intendedService of ["VENTA","ARRIENDO","ADMINISTRACION"]) test(`Conversión ${intendedService}: conserva condiciones y crea vínculos correctos`,async()=>{
  const created=[], strict=[], calls=[];
  const db={industryRecord:{create:async({data})=>{const r={...data,id:`i${created.length+1}`};created.push(r);return r;},findFirst:async()=>null},brokerPropertyCapture:{create:async({data})=>strict.push(data)}};
  const dependencies={ensureBrokerCaptureProperty:async()=>({id:"strict-property",ownerId:"strict-owner"}),propertyDataFromCapture:(raw,capture)=>({...raw,captureStatus:capture.status}),ensureBrokerSaleCase:async()=>calls.push("SALE"),ensureBrokerRentalCase:async()=>calls.push("RENTAL")};
  const links=await convertBrokerProspect(db,{tenantId:"t1",user:{id:"u1"}},{id:"prospect1",assignedToId:"u1",data:{...valid,intendedService,valuation:{amount:100000000,rationale:"Comparable documentado"}}},mandateTerms({...valid,stage:"NEGOCIACION"},terms),dependencies);
  assert.deepEqual(created.map(r=>r.recordType),["property","owner","property_mandate","broker_operation"]);
  assert.ok(created.every(r=>r.tenantId==="t1"&&r.assignedToId==="u1"));
  assert.equal(created[3].data.propertyId,links.propertyId);assert.equal(created[3].data.mandateId,links.mandateId);
  assert.equal(created[3].data.commissionRatePct,2.5);assert.equal(created[3].data.timeline[0].evidenceReference,"Expediente M-001");
  assert.equal(strict[0].propertyId,"strict-property");assert.equal(strict[0].status,"MANDATO_FIRMADO");
  assert.deepEqual(calls,intendedService==="VENTA"?["SALE"]:intendedService==="ARRIENDO"?["RENTAL"]:[]);
});
test("Conversión reutiliza propietario por identidad estricta sin duplicar ficha",async()=>{
  const created=[],updates=[];
  const owner={id:"o1",title:"Ana Pérez",data:{brokerOwnerId:"strict-owner",propertyId:"previous-property"}};
  const db={industryRecord:{create:async({data})=>{const r={...data,id:`i${created.length+1}`};created.push(r);return r;},findFirst:async()=>owner,update:async args=>updates.push(args)},brokerPropertyCapture:{create:async()=>({})}};
  const dependencies={ensureBrokerCaptureProperty:async()=>({id:"strict-property",ownerId:"strict-owner"}),propertyDataFromCapture:(raw)=>raw,ensureBrokerSaleCase:async()=>({}),ensureBrokerRentalCase:async()=>({})};
  const links=await convertBrokerProspect(db,{tenantId:"t1",user:{id:"u1"}},{id:"p1",assignedToId:"u1",data:valid},terms,dependencies);
  assert.equal(links.ownerId,"o1");assert.equal(created.filter(r=>r.recordType==="owner").length,0);assert.deepEqual(updates[0].data.data.propertyIds,["previous-property",links.propertyId]);
});

// Adaptador de memoria transaccional para probar HTTP y rollback. No simula
// bloqueos de PostgreSQL: el control condicional también se prueba arriba.
function matches(row,w) {
  return Object.entries(w).every(([k,v])=> k==="AND"?(Array.isArray(v)?v:[v]).every(x=>matches(row,x)):k==="OR"?v.some(x=>matches(row,x)):k==="data"?row.data[v.path[0]]===v.equals:v&&typeof v==="object"?(v.in?v.in.includes(row[k]):row[k]===v.equals):row[k]===v);
}
async function fixture(t) {
  let rows=[], logs=[], conversionCount=0, failConversion=false;
  const records={
    findFirst:async({where})=>structuredClone(rows.find(r=>matches(r,where))||null),
    findMany:async({where,skip=0,take=100})=>structuredClone(rows.filter(r=>matches(r,where)).slice(skip,skip+take)),
    count:async({where})=>rows.filter(r=>matches(r,where)).length,
    create:async({data})=>{const row={...structuredClone(data),id:data.id||`r${rows.length}`,createdAt:new Date().toISOString()};rows.push(row);return structuredClone(row);},
    update:async({where,data})=>{const row=rows.find(r=>r.id===where.id);Object.assign(row,structuredClone(data));return structuredClone(row);},
    updateMany:async({where,data})=>{const found=rows.filter(r=>matches(r,where));found.forEach(r=>Object.assign(r,structuredClone(data)));return{count:found.length};}
  };
  const db={industryRecord:records,tenantAuditLog:{create:async({data})=>{logs.push(data);return data;}}};
  const prisma={...db,$transaction:async fn=>{const backup=structuredClone(rows),before=structuredClone(logs);try{return await fn(db);}catch(e){rows=backup;logs=before;throw e;}}};
  const app=express();app.use(express.json());
  app.use((req,_res,next)=>{req.tenantId=req.headers["x-tenant"]||"t1";req.user={id:req.headers["x-user"]||"u1",role:"SELLER"};req.brokerAccess={...normalizeBrokerAccessProfile({businessRole:req.headers["x-role"]||"CORREDOR"}),technicalRole:"SELLER",scopeUserIds:req.headers["x-holding"]?null:[req.user.id],scopeTenantIds:req.headers["x-holding"]?["t1","t2"]:[req.tenantId]};next();});
  app.use("/broker/prospects",createBrokerProspectsRouter({prisma,assertAssignedUser:async(_req,id)=>{if(id!=="u1")throw Object.assign(new Error("Fuera de alcance"),{status:403});},convert:async(tx,req)=>{
    conversionCount++;
    await tx.industryRecord.create({data:{tenantId:req.tenantId,recordType:"property",data:{}}});
    if(failConversion)throw new Error("Fallo simulado durante conversión");
    return{propertyId:"p1",ownerId:"o1",operationId:"op1",mandateId:"m1"};
  }}));
  const server=app.listen(0,"127.0.0.1");await once(server,"listening");t.after(()=>new Promise(resolve=>server.close(resolve)));
  const call=async(path="",body,headers={})=>{const result=await fetch(`http://127.0.0.1:${server.address().port}/broker/prospects${path}`,{method:body?"POST":"GET",headers:{"Content-Type":"application/json",...headers},...(body?{body:JSON.stringify(body)}:{})});return{status:result.status,data:await result.json()};};
  return{call,rows:()=>rows,logs:()=>logs,conversions:()=>conversionCount,setFail:()=>{failConversion=true;}};
}
test("HTTP alta sin propiedad prematura, idempotencia y aislamiento",async t=>{
  const f=await fixture(t),input={...valid,requestKey:"test-request-00000001"};
  const first=await f.call("",input);assert.equal(first.status,201);assert.equal(f.rows().length,1);assert.equal(first.data.data.stage,"PROSPECCION");
  const repeated=await f.call("",input);assert.equal(repeated.data.id,first.data.id);assert.equal(f.rows().length,1);
  assert.equal((await f.call("",undefined,{"x-user":"u2"})).data.total,0);
  assert.equal((await f.call("",undefined,{"x-tenant":"t2"})).data.total,0);
  assert.equal((await f.call(`/${first.data.id}/actions`,{action:"NOTE",version:1,note:"Intrusión"},{"x-user":"u2"})).status,404);
  assert.equal((await f.call("",{...input,requestKey:"test-request-00000002"},{"x-role":"LECTURA"})).status,403);
});
test("HTTP ciclo completo, notas, auditoría y firma repetida sin duplicar",async t=>{
  const f=await fixture(t);let row=(await f.call("",{...valid,requestKey:"full-request-00000001"})).data;
  const act=async(action,other={})=>{const r=await f.call(`/${row.id}/actions`,{action,version:row.data.version,...other});assert.equal(r.status,200,JSON.stringify(r.data));row=r.data;};
  await act("NOTE",{note:"Visita coordinada"});await act("ADVANCE",{stage:"CONTACTO"});await act("ADVANCE",{stage:"TASACION"});await act("VALUE",{amount:100000000,rationale:"Comparación con tres inmuebles del sector."});await act("ADVANCE",{stage:"NEGOCIACION"});await act("SIGN",terms);
  assert.equal(row.data.outcome,"CONVERTED");assert.equal(row.data.mandate.commissionPct,2.5);assert.ok(row.data.timeline.some(e=>e.note==="Visita coordinada"));
  await act("SIGN",terms);assert.equal(f.conversions(),1);assert.equal(f.logs().filter(e=>e.action==="MANDATO_FIRMADO").length,1);
});
test("HTTP error a mitad de conversión revierte propiedad y versión",async t=>{
  const f=await fixture(t);let row=(await f.call("",{...valid,requestKey:"fail-request-00000001"})).data;
  const stored=f.rows()[0];stored.data.stage="NEGOCIACION";stored.data.valuation={amount:100000000};f.setFail();
  const result=await f.call(`/${row.id}/actions`,{action:"SIGN",version:1,...terms});assert.equal(result.status,500);assert.equal(f.rows().length,1);assert.equal(f.rows()[0].data.version,1);assert.equal(f.rows()[0].data.outcome,undefined);
});
test("HTTP una edición obsoleta no pierde notas",async t=>{
  const f=await fixture(t),row=(await f.call("",{...valid,requestKey:"notes-request-0000001"})).data;
  assert.equal((await f.call(`/${row.id}/actions`,{action:"NOTE",version:1,note:"Primera nota"})).status,200);
  assert.equal((await f.call(`/${row.id}/actions`,{action:"NOTE",version:1,note:"Segunda nota obsoleta"})).status,409);
  assert.equal(f.rows()[0].data.timeline.length,2);
});
test("HTTP vincula adjuntos privados por tenant y conserva su tipo de expediente",async t=>{
  const f=await fixture(t),row=(await f.call("",{...valid,requestKey:"document-request-001"})).data;
  f.rows().push({id:"documento-a1",tenantId:"t1",recordType:"document",title:"Plano de arquitectura",status:"ACTIVE",data:{originalName:"plano-casa.pdf",mimeType:"application/pdf"}});
  f.rows().push({id:"documento-b2",tenantId:"t1",recordType:"document",title:"Mandato firmado",status:"ACTIVE",data:{originalName:"mandato.pdf",mimeType:"application/pdf"}});
  const linked=await f.call(`/${row.id}/actions`,{action:"LINK_DOCUMENTS",version:1,documents:[{id:"documento-a1",role:"PLANO"},{id:"documento-b2",role:"MANDATO"}]});
  assert.equal(linked.status,200,JSON.stringify(linked.data));
  assert.deepEqual(linked.data.data.captureDocuments.map(d=>[d.id,d.role]),[["documento-a1","PLANO"],["documento-b2","MANDATO"]]);
  assert.equal(f.logs().at(-1).action,"DOCUMENTOS_VINCULADOS");
  const duplicated=await f.call(`/${row.id}/actions`,{action:"LINK_DOCUMENTS",version:2,documents:[{id:"documento-a1",role:"PLANO"},{id:"documento-a1",role:"OTRO"}]});
  assert.equal(duplicated.status,422);
  f.rows().push({id:"documento-ajeno",tenantId:"t2",recordType:"document",title:"Ajeno",status:"ACTIVE",data:{}});
  const foreign=await f.call(`/${row.id}/actions`,{action:"LINK_DOCUMENTS",version:2,documents:[{id:"documento-ajeno",role:"OTRO"}]});
  assert.equal(foreign.status,404);
});
test("Conversión conserva adjuntos en propiedad, captación, mandato y negocio",async()=>{
  const created=[], strict=[];
  const db={industryRecord:{create:async({data})=>{const row={...data,id:`c${created.length+1}`};created.push(row);return row;},findFirst:async()=>null},brokerPropertyCapture:{create:async({data})=>{strict.push(data);return data;}}};
  const dependencies={ensureBrokerCaptureProperty:async()=>({id:"strict-property",ownerId:"strict-owner"}),propertyDataFromCapture:(raw)=>raw,ensureBrokerSaleCase:async()=>({}),ensureBrokerRentalCase:async()=>({})};
  await convertBrokerProspect(db,{tenantId:"t1",user:{id:"u1"}},{id:"prospect-docs",assignedToId:"u1",data:{...valid,intendedService:"VENTA",captureDocuments:[{id:"documento-a1",role:"PLANO",originalName:"plano.pdf"},{id:"documento-b2",role:"MANDATO",originalName:"mandato.pdf"}]}},terms,dependencies);
  assert.deepEqual(strict[0].documentChecklist.map(d=>d.id),["documento-a1","documento-b2"]);
  assert.deepEqual(created.find(row=>row.recordType==="property_mandate").data.evidenceDocumentIds,["documento-b2"]);
  assert.equal(created.find(row=>row.recordType==="broker_operation").data.conversion.captureDocuments.length,2);
});
test("HTTP referido, descarte y reapertura conservan el historial",async t=>{
  const f=await fixture(t);let row=(await f.call("",{...valid,captureOrigin:"Referido",referredBy:"Carolina Rojas",isReferral:true,requestKey:"referral-request-001"})).data;
  const act=async(action,fields={})=>f.call(`/${row.id}/actions`,{action,version:row.data.version,...fields});
  assert.equal((await act("ADVANCE",{stage:"CONTACTO"})).status,422);
  row=(await act("CONVERT_REFERRAL")).data;
  row=(await act("ADVANCE",{stage:"CONTACTO"})).data;
  row=(await act("DISCARD",{reason:"Propietario posterga la venta"})).data;assert.equal(row.data.outcome,"DISCARDED");
  row=(await act("REOPEN")).data;assert.equal(row.data.outcome,null);assert.equal(row.data.stage,"CONTACTO");assert.equal(row.data.timeline.length,5);
});
test("HTTP tasador puede evaluar pero no convertir un mandato en negocio",async t=>{
  const f=await fixture(t),row=(await f.call("",{...valid,requestKey:"role-request-000001"})).data;
  const result=await f.call(`/${row.id}/actions`,{action:"SIGN",version:1,...terms},{"x-role":"TASADOR"});
  assert.equal(result.status,403);assert.equal(f.conversions(),0);
});
test("HTTP previsualización sin escrituras, control de versión y aislamiento",async t=>{
  const f=await fixture(t),row=(await f.call("",{...valid,requestKey:"preview-request-0001"})).data;
  Object.assign(f.rows()[0].data,{stage:"NEGOCIACION",valuation:{amount:100000000}});
  const before=structuredClone(f.rows()),logs=f.logs().length;
  const preview=await f.call(`/${row.id}/conversion-preview`,{...terms,version:1});
  assert.equal(preview.status,200);assert.equal(preview.data.operationType,"SALE");assert.equal(preview.data.initialStage,"RECEPCION_MANDATO");
  assert.deepEqual(f.rows(),before);assert.equal(f.logs().length,logs);assert.equal(f.conversions(),0);
  assert.equal((await f.call(`/${row.id}/conversion-preview`,{...terms,version:0})).status,409);
  assert.equal((await f.call(`/${row.id}/conversion-preview`,{...terms,version:1},{"x-user":"u2"})).status,404);
  assert.equal((await f.call(`/${row.id}/conversion-preview`,{...terms,version:1},{"x-role":"TASADOR"})).status,403);
  assert.equal((await f.call(`/${row.id}`)).status,200);
  assert.equal((await f.call(`/${row.id}`,undefined,{"x-tenant":"t2"})).status,404);
});
test("HTTP lectura holding no autoriza convertir desde otra empresa activa",async t=>{
  const f=await fixture(t),row=(await f.call("",{...valid,requestKey:"holding-request-0001"})).data;
  Object.assign(f.rows()[0].data,{stage:"NEGOCIACION",valuation:{amount:100000000}});
  const result=await f.call(`/${row.id}/actions`,{...terms,version:1,action:"SIGN"},{"x-tenant":"t2","x-holding":"yes"});
  assert.equal((await f.call(`/${row.id}`,undefined,{"x-tenant":"t2","x-holding":"yes"})).status,200);
  assert.equal(result.status,404,JSON.stringify(result.data));
  assert.equal(f.conversions(),0);
  assert.ok(f.rows().every(r=>r.tenantId==="t1"));
  assert.ok(f.logs().every(r=>r.tenantId==="t1"));
});
