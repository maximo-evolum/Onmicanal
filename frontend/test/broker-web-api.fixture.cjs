/** Archivo: Comprueba el comportamiento de interfaz o integración de broker web api.fixture. */
// Fixture HTTP solo local: router real de prospectos y servicio real de conversión,
// con adaptador de transacciones en memoria. Sin cliente Prisma, .env ni acceso a producción.
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const express = require('../../backend-v2/node_modules/express');
module.exports = async function startFixture() {
  const imp = name=>import(pathToFileURL(path.resolve(__dirname, '../../backend-v2/src',name)).href);
  const [{createBrokerProspectsRouter},{convertBrokerProspect},{normalizeBrokerAccessProfile},{normalizeBrokerCapture}] = await Promise.all([imp('routes/broker-prospects.routes.js'),imp('services/broker-prospect-conversion.service.js'),imp('services/broker-access.service.js'),imp('services/broker-capture.service.js')]);
  let rows=[],logs=[],serial=0; let queue=Promise.resolve();
  const matches=(r,w)=>Object.entries(w).every(([k,v])=>k==='AND'?(Array.isArray(v)?v:[v]).every(x=>matches(r,x)):k==='OR'?v.some(x=>matches(r,x)):k==='data'?r.data?.[v.path[0]]===v.equals:v&&typeof v==='object'?v.in?.includes(r[k])||r[k]===v.equals:r[k]===v);
  const db={industryRecord:{
    findFirst:async({where})=>structuredClone(rows.find(r=>matches(r,where))||null),
    findMany:async({where,skip=0,take=100})=>structuredClone(rows.filter(r=>matches(r,where)).slice(skip,skip+take)),
    count:async({where})=>rows.filter(r=>matches(r,where)).length,
    create:async({data})=>{if(data.id&&rows.some(r=>r.id===data.id))throw Object.assign(new Error('Duplicado'),{code:'P2002'});const row={...structuredClone(data),id:data.id||`qa-${++serial}`,createdAt:new Date().toISOString()};rows.unshift(row);return structuredClone(row);},
    update:async({where,data})=>{const row=rows.find(r=>r.id===where.id);Object.assign(row,structuredClone(data));return structuredClone(row);},
    updateMany:async({where,data})=>{const found=rows.filter(r=>matches(r,where));found.forEach(r=>Object.assign(r,structuredClone(data)));return {count:found.length};}
  },tenantAuditLog:{create:async({data})=>logs.push(structuredClone(data))},brokerPropertyCapture:{create:async({data})=>data}};
  const prisma={...db,$transaction:fn=>{const result=queue.then(async()=>{const snapshot=structuredClone(rows),audit=structuredClone(logs);try{return await fn(db);}catch(e){rows=snapshot;logs=audit;throw e;}});queue=result.catch(()=>{});return result;}};
  const app=express(); app.use(express.json());
  app.use((req,res,next)=>{req.tenantId=req.headers['x-qa-tenant']||'qa-t1';req.user={id:req.headers['x-qa-user']||'qa-u1',role:'SELLER'};req.brokerAccess={...normalizeBrokerAccessProfile({businessRole:req.headers['x-qa-role']||'CORREDOR'}),technicalRole:'SELLER',scopeUserIds:[req.user.id],scopeTenantIds:[req.tenantId]};next();});
  app.use('/broker/prospects',createBrokerProspectsRouter({prisma,assertAssignedUser:async(req,id)=>{if(id!==req.user.id)throw Object.assign(new Error('Responsable fuera del alcance de prueba'),{status:403});},convert:(db,req,row,terms)=>convertBrokerProspect(db,req,row,terms,{
    propertyDataFromCapture:(raw,capture)=>({...raw,captureStatus:capture.status}),
    ensureBrokerCaptureProperty:async(_db,{property})=>({id:`strict-${property.id}`,ownerId:`strict-owner-${row.id}`}),
    ensureBrokerSaleCase:async()=>({}),ensureBrokerRentalCase:async()=>({})
  })}));
  const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
  return{url:`http://127.0.0.1:${server.address().port}`,rows:()=>rows,logs:()=>logs,close:()=>new Promise(r=>server.close(r)),normalizeBrokerAccessProfile,normalizeBrokerCapture};
};
