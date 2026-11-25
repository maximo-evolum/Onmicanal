/** Reporte de negocios Broker: período civil chileno, alcance de lectura y una proyección común a los tres formatos. */
import {createHash} from "node:crypto";
import {brokerRecordWhere} from "./broker-access.service.js";
import {brokerOperationPayload} from "./broker-operation-contract.service.js";
import {buildBrokerOperationInsights} from "./broker-operational-read-model.service.js";

export const types={SALE:"Venta",RENTAL:"Arriendo",ADMINISTRATION:"Administración",UNKNOWN:"Sin clasificar"};
export const states={OPEN:"En curso",CLOSED:"Finalizada",LOST:"Perdida o cancelada",REVIEW:"Por revisar"};
const dateFormat=new Intl.DateTimeFormat("sv-SE",{timeZone:"America/Santiago",year:"numeric",month:"2-digit",day:"2-digit"});
const day=86400000,none="__none__";
const fail=(message)=>Object.assign(new Error(message),{status:422});
const clean=v=>String(v??"").trim();
export function reportFilters(q,now=new Date()){
  const defaults={from:dateFormat.format(+now-89*day),to:dateFormat.format(now),broker:"",office:"",type:"",state:""};
  for(const key of Object.keys(q)) if(![...Object.keys(defaults),"format","snapshot"].includes(key)||typeof q[key]!=="string"||q[key].length>160)throw fail("Filtro no válido.");
  for(const key of Object.keys(defaults))if(q[key])defaults[key]=q[key].trim();
  const {from,to,type,state}=defaults;
  for(const d of [from,to])if(!/^\d{4}-\d{2}-\d{2}$/.test(d)||!Number.isFinite(Date.parse(d))||new Date(d).toISOString().slice(0,10)!==d)throw fail("Selecciona fechas válidas.");
  if(to<from||Date.parse(to)-Date.parse(from)>365*day)throw fail("Selecciona un período de entre 1 y 366 días.");
  if((type&&!Object.hasOwn(types,type))||(state&&!Object.hasOwn(states,state)))throw fail("Tipo de operación o estado desconocido.");
  return defaults;
}
// Primer milisegundo del día local, incluso cuando Chile cambia de hora a medianoche.
export function startDay(d){
  const t=Date.parse(d);let lo=t-day,hi=t+day;
  while(hi-lo>1){const mid=Math.floor((lo+hi)/2);if(dateFormat.format(mid)<d)lo=mid;else hi=mid;}
  return new Date(hi);
}
function rowOf(record,office){
  const op=brokerOperationPayload(record),d=op.data,insight=buildBrokerOperationInsights({operations:[op]})[0];
  const type=Object.hasOwn(types,d.operationType)?d.operationType:"UNKNOWN";
  const state=op.journey.needsReview?"REVIEW":["PERDIDA","CANCELADA"].includes(d.stage)?"LOST":insight.terminal?"CLOSED":"OPEN";
  const warnings=[];
  if(op.journey.needsReview)warnings.push("Tipo o etapa sin equivalencia");
  if(!record.assignedToId)warnings.push("Sin corredor asignado");
  if(!office)warnings.push("Oficina no registrada");
  const field=["agreedAmount","offerAmount","estimatedValue","publicationPrice","amount",...(type==="RENTAL"?["monthlyRent"]:[])].find(k=>["number","string"].includes(typeof d[k])&&Number.isFinite(Number(d[k]))&&Number(d[k])>0);
  const amount=field?Number(d[field]):null;
  const currency=clean(d.currency||d.moneda).toUpperCase()||null;
  if(amount===null)warnings.push("Sin monto declarado");
  else if(!currency)warnings.push("Sin moneda; excluido de totales monetarios");
  return {id:record.id,title:record.title,company:record.tenant.name,brokerId:record.assignedToId,broker:record.assignedTo?.name||"Sin corredor",office:office||"",type,state,
    stage:d.stage||"",opened:dateFormat.format(record.createdAt),updated:record.updatedAt.toISOString(),amount,currency,
    amountSource:({agreedAmount:"Monto acordado",offerAmount:"Oferta",estimatedValue:"Tasación",publicationPrice:"Precio de publicación",amount:"Monto del negocio",monthlyRent:"Renta mensual"})[field]||"",
    warnings};
}
export const reportNotice="Negocios creados en el período (hora de Santiago), con su estado actual. La oficina es la actual del corredor. Los montos corresponden al negocio, no a ingresos cobrados; no se convierten monedas.";
export async function readBrokerReport(db,req,filters){
  const after=new Date(Date.parse(filters.to)+day).toISOString().slice(0,10);
  const where=brokerRecordWhere(req,{recordType:"broker_operation",createdAt:{gte:startDay(filters.from),lt:startDay(after)}});
  const rows=[],brokers=new Map(),offices=new Set();
  await db.$transaction(async tx=>{
    let cursor,scanned=0;
    for(;;){
      const batch=await tx.industryRecord.findMany({where,orderBy:{id:"asc"},take:350,...(cursor?{cursor:{id:cursor},skip:1}:{}),
        select:{id:true,title:true,data:true,tenantId:true,createdAt:true,updatedAt:true,assignedToId:true,assignedTo:{select:{name:true,tenantId:true}},tenant:{select:{name:true}}}});
      if(!batch.length)break;
      scanned+=batch.length;if(scanned>20000)throw fail("El período supera 20.000 negocios visibles. Acota las fechas; no se han calculado totales parciales.");
      const ids=[...new Set(batch.map(r=>r.assignedToId).filter(Boolean))];
      const profiles=ids.length?await tx.industryRecord.findMany({where:{tenantId:{in:[...new Set(batch.map(r=>r.tenantId))]},assignedToId:{in:ids},recordType:"broker_access_profile",status:"ACTIVE"},
        select:{tenantId:true,assignedToId:true,data:true},orderBy:[{updatedAt:"desc"},{id:"desc"}]}):[];
      const branches=new Map();
      for(const p of profiles){const k=p.tenantId+":"+p.assignedToId;if(!branches.has(k))branches.set(k,clean(p.data?.branchKey));}
      for(const r of batch){
        if(r.assignedTo && r.assignedTo.tenantId!==r.tenantId){r.assignedTo=null;r.assignedToId=null;}
        const row=rowOf(r,branches.get(r.tenantId+":"+r.assignedToId));
        if(row.brokerId)brokers.set(row.brokerId,row.broker);
        if(row.office)offices.add(row.office);
        if((filters.broker&&filters.broker!==(row.brokerId||none))||(filters.office&&filters.office!==(row.office||none))||
          (filters.type&&filters.type!==row.type)||(filters.state&&filters.state!==row.state))continue;
        rows.push(row);if(rows.length>1000)throw fail("Hay más de 1.000 negocios en el resultado. Acota los filtros; no se generó un reporte parcial.");
      }
      if(batch.length<350)break;cursor=batch.at(-1).id;
    }
  },{isolationLevel:"RepeatableRead",timeout:20000});
  rows.sort((a,b)=>b.opened.localeCompare(a.opened)||a.id.localeCompare(b.id));
  const counts={OPEN:0,CLOSED:0,LOST:0,REVIEW:0},totals=new Map();
  for(const r of rows){counts[r.state]++;if(r.state!=="OPEN"||r.amount===null||!r.currency)continue;
    const basis=r.amountSource==="Renta mensual"?"Arriendo mensual":types[r.type];
    const key=JSON.stringify([r.currency,basis]),group=totals.get(key)||{currency:r.currency,basis,amount:0};
    group.amount+=r.amount;totals.set(key,group);}
  const summary={total:rows.length,counts,incomplete:rows.filter(r=>r.warnings.length).length,openAmounts:[...totals.values()].sort((a,b)=>a.currency.localeCompare(b.currency)||a.basis.localeCompare(b.basis))};
  const scope=req.brokerAccess.scopeDescription || ({COMPANY:"Empresa",HOLDING:"Holding autorizado",TEAM:"Equipo",BRANCH:"Sucursal",ASSIGNED:"Cartera asignada"})[req.brokerAccess.accessScope] || "Cartera autorizada";
  const fingerprint=createHash("sha256").update(JSON.stringify([req.tenantId,req.user.id,scope,filters,rows])).digest("hex");
  return {generatedAt:new Date().toISOString(),filters,scope,notice:reportNotice,summary,rows,fingerprint,
    options:{brokers:[...brokers].map(([id,name])=>({id,name})).sort((a,b)=>a.name.localeCompare(b.name,"es")),offices:[...offices].sort()}};
}
export function selection(r){
  const f=r.filters;
  return [f.from+" al "+f.to,"Corredor: "+(f.broker===none?"Sin corredor":r.options.brokers.find(b=>b.id===f.broker)?.name||(f.broker?"Sin coincidencias":"Todos")),
    "Oficina: "+(f.office===none?"Sin oficina":f.office||"Todas"),"Tipo: "+(types[f.type]||"Todos"),"Estado: "+(states[f.state]||"Todos")];
}
export function reportCsv(report){
  const cell=v=>{let s=String(v??"").replace(/[\r\n\t]+/g," ");if(/^[\s\uFEFF]*[=+@-]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';};
  const lines=[["Broker OS","Reporte ejecutivo de negocios"],["Generado",report.generatedAt],["Alcance",report.scope],["Filtros",...selection(report)],["Criterio",report.notice],
    ["Total",report.summary.total],...Object.entries(report.summary.counts).map(([k,v])=>[states[k],v]),["Con datos incompletos",report.summary.incomplete],
    ...report.summary.openAmounts.map(v=>["Cartera en curso",v.basis,v.currency,v.amount]),[],
    ["ID fuente","Empresa","Negocio","Creación","Corredor","Oficina","Tipo","Estado","Etapa","Monto","Moneda","Origen del monto","Última actualización","Advertencias"],
    ...report.rows.map(r=>[r.id,r.company,r.title,r.opened,r.broker,r.office,types[r.type],states[r.state],r.stage,r.amount,r.currency,r.amountSource,r.updated,r.warnings.join(" · ")])];
  return "\uFEFF"+lines.map(a=>a.map(cell).join(";")).join("\r\n")+"\r\n";
}
