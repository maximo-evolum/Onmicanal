/** Comprueba permisos, consistencia de exportación y evidencia del reporte ejecutivo Broker. */
import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import {randomUUID} from "node:crypto";
import {brokerQaEnvironment} from "../scripts/lib/broker-qa-environment.mjs";
import {reportFilters,startDay,reportCsv} from "../src/services/broker-executive-report.service.js";
import {brokerReportPdf} from "../src/lib/broker-executive-report-pdf.js";
import pdfParse from "pdf-parse";

test("El período civil chileno incluye el cambio de hora y rechaza filtros ambiguos",()=>{
  assert.equal(startDay("2026-01-01").toISOString(),"2026-01-01T03:00:00.000Z");
  assert.equal(startDay("2026-07-01").toISOString(),"2026-07-01T04:00:00.000Z");
  assert.throws(()=>reportFilters({from:"2026-02-30"}));
  assert.throws(()=>reportFilters({type:["SALE"]}));
  assert.throws(()=>reportFilters({from:"2024-01-01",to:"2026-09-01"}));
  assert.throws(()=>reportFilters({state:"__proto__"}));
});

test("El PDF paginado conserva la última operación y las advertencias, también con acentos",async()=>{
  const rows=Array.from({length:32},(_,index)=>({id:"QA-EVIDENCIA-"+index,title:"Captación en Ñuñoa",company:"Inmobiliaria de prueba",type:"SALE",state:"OPEN",stage:"RECEPCION_MANDATO",broker:"Dirección",office:"Centro",opened:"2026-01-02",updated:"2026-01-02T12:00:00.000Z",amount:null,currency:null,amountSource:"",warnings:["Sin monto declarado"]}));
  const bytes=await brokerReportPdf({filters:reportFilters({from:"2026-01-01",to:"2026-01-31"}),generatedAt:"2026-02-10T10:00:00Z",scope:"Empresa",notice:"Datos de prueba",options:{brokers:[]},summary:{total:32,counts:{OPEN:32,CLOSED:0,REVIEW:0,LOST:0},incomplete:32,openAmounts:[]},rows});
  const parsed=await pdfParse(bytes);assert.ok(parsed.numpages>1);assert.match(parsed.text,/QA-EVIDENCIA-31/);assert.match(parsed.text,/Ñuñoa/);assert.match(parsed.text,/Sin monto declarado/);
});

test("Reporte propio por HTTP y PostgreSQL: filtros, alcance, frescura, PDF/CSV y auditoría", {skip:!process.env.QA_BROKER_DATABASE_URL},async()=>{
  process.env.DATABASE_URL=brokerQaEnvironment(process.env).DATABASE_URL;
  const {prisma}=await import("../src/lib/db.js"),{brokerRouter}=await import("../src/routes/broker.routes.js");
  const tenants=[],users=[];let server;
  try{
    for(const name of ["Corretaje de muestra","Empresa independiente"])tenants.push(await prisma.tenant.create({data:{slug:randomUUID(),name,industry:"REAL_ESTATE"}}));
    for(const [role,name] of [["OWNER","Dirección QA"],["SELLER","Coordinación QA"],["SELLER","Corredora QA"]]){
      users.push(await prisma.workspaceUser.create({data:{tenantId:tenants[0].id,name,email:randomUUID()+"@example.invalid",role,passwordHash:"no-login"}}));
    }
    for(const [i,businessRole,accessScope,branchKey] of [[0,"CEO","COMPANY","Centro"],[1,"COORDINADOR_COMERCIAL","TEAM","Sur"],[2,"CORREDOR","ASSIGNED","Centro"]]){
      await prisma.industryRecord.create({data:{tenantId:tenants[0].id,assignedToId:users[i].id,recordType:"broker_access_profile",status:"ACTIVE",title:businessRole,data:{userId:users[i].id,businessRole,accessScope,branchKey,teamKey:"ventas"}}});
    }
    const add=(i,title,data,date="2026-01-12T15:00:00Z",tenant=0)=>prisma.industryRecord.create({data:{tenantId:tenants[tenant].id,recordType:"broker_operation",title,status:"ACTIVE",assignedToId:users[i]?.id||null,createdAt:new Date(date),data}});
    const venta={operationType:"SALE",stage:"RECEPCION_MANDATO",agreedAmount:7800,currency:"UF"};
    const source=await add(0,"Venta en Ñuñoa",venta);
    await add(1,"Arriendo de oficinas",{operationType:"RENTAL",stage:"CAPTACION",amount:720000,currency:"CLP"});
    await add(2,"=Ficha heredada sin etapa",{amount:100});
    await add(0,"Fuera del período",venta,"2026-02-01T03:00:00Z");
    await add(-1,"Cartera de otra empresa",venta,"2026-01-02T03:00:00Z",1);
    const app=express();app.use((req,res,next)=>{req.user=users[Number(req.headers["x-qa"]||0)];req.tenantId=tenants[0].id;req.tenant=tenants[0];next();});
    app.use(brokerRouter);
    server=await new Promise(resolve=>{const s=app.listen(0,"127.0.0.1",()=>resolve(s))});
    const apiOrigin="http://127.0.0.1:"+server.address().port;
    const api=(extra={},actor=0)=>fetch(apiOrigin+"/broker/executive-report?"+new URLSearchParams({from:"2026-01-01",to:"2026-01-31",...extra}),{headers:{"x-qa":String(actor)}});
    const preview=await (await api()).json();assert.equal(preview.summary.total,3);assert.equal(preview.canExport,true);
    assert.equal(preview.summary.counts.REVIEW,1);assert.equal(preview.summary.incomplete,1);
    assert.deepEqual(preview.summary.openAmounts,[{currency:"CLP",basis:"Arriendo",amount:720000},{currency:"UF",basis:"Venta",amount:7800}]);
    assert.equal(preview.rows.some(r=>r.title.includes("otra empresa")),false);
    assert.equal((await (await api({type:"SALE",state:"OPEN",broker:users[0].id,office:"Centro"})).json()).rows[0].id,source.id);
    assert.equal((await (await api({office:"Otra oficina"})).json()).summary.total,0);
    const partial=await (await api({},1)).json();assert.equal(partial.summary.total,1);assert.equal(partial.canExport,false);
    assert.deepEqual(partial.options.offices,["Sur"]);
    for(const format of ["csv","pdf"])assert.equal((await api({format},1)).status,403);
    assert.equal((await api({},2)).status,403);
    const csvResponse=await api({format:"csv",snapshot:preview.fingerprint});
    assert.equal(csvResponse.status,200);const csv=await csvResponse.text();assert.equal(csv,reportCsv(preview).slice(1).replace(preview.generatedAt,csv.match(/"Generado";"([^"]+)"/)[1]));
    assert.ok(csv.includes(source.id));assert.ok(csv.includes("'=Ficha"));assert.ok(!csv.includes("Cartera de otra empresa"));
    const pdfResponse=await api({format:"pdf",snapshot:preview.fingerprint});
    assert.equal(pdfResponse.status,200);const pdf=Buffer.from(await pdfResponse.arrayBuffer());assert.equal(pdf.subarray(0,5).toString(),"%PDF-");
    assert.equal(await prisma.tenantAuditLog.count({where:{tenantId:tenants[0].id,action:"BROKER_EXECUTIVE_REPORT_EXPORTED"}}),2);
    if(process.env.BROKER_REPORT_WEB_URL){
      const {default:verify}=await import("../../frontend/test/broker-executive-report.browser.cjs");
      await verify({webUrl:process.env.BROKER_REPORT_WEB_URL,apiOrigin,user:users[0],tenant:tenants[0],sourceId:source.id});
    }
    await prisma.industryRecord.update({where:{id:source.id},data:{title:"Título actualizado"}});
    assert.equal((await api({format:"csv",snapshot:preview.fingerprint})).status,409);
  }finally{
    if(server)await new Promise(resolve=>server.close(resolve));for(const t of tenants)await prisma.tenant.delete({where:{id:t.id}});
    await prisma.$disconnect();
  }
});
