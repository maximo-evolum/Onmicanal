/** Prueba rutas Broker con PostgreSQL local exclusivo de QA y sesiones sintéticas. */
import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import {randomUUID} from "node:crypto";
import {brokerQaEnvironment} from "../scripts/lib/broker-qa-environment.mjs";

test("HTTP y PostgreSQL: políticas efectivas, agentes por empresa, conflictos, reversión y auditoría", {skip:!process.env.QA_BROKER_DATABASE_URL}, async()=>{
  process.env.DATABASE_URL=brokerQaEnvironment(process.env).DATABASE_URL;
  const {prisma}=await import("../src/lib/db.js");
  const {brokerRouter}=await import("../src/routes/broker.routes.js");
  const {notificationsRouter}=await import("../src/routes/notifications.routes.js");
  const {industryRecordsRouter}=await import("../src/routes/industry-records.routes.js");
  const run=randomUUID(), users=[],tenants=[];
  let server;
  try {
    for (let i=0;i<2;i++) tenants.push(await prisma.tenant.create({data:{name:"Broker QA",slug:run+i,industry:"REAL_ESTATE"}}));
    for(const [idx,role] of [[0,"OWNER"],[1,"OWNER"],[0,"SELLER"]]) users.push(await prisma.workspaceUser.create({data:{name:"Prueba",email:randomUUID()+"@example.invalid",passwordHash:"no-login",tenantId:tenants[idx].id,role}}));
    const app=express();app.use(express.json());app.use((req,res,next)=>{req.user=users[Number(req.headers["x-qa"]||0)];req.tenantId=req.user.tenantId;req.tenant=tenants.find(t=>t.id===req.tenantId);next();});
    app.use(brokerRouter,notificationsRouter,industryRecordsRouter);
    server=await new Promise(resolve=>{const s=app.listen(0,"127.0.0.1",()=>resolve(s));});
    async function api(path,index=0,method="GET",body){
      const resp=await fetch("http://127.0.0.1:"+server.address().port+path,{method,headers:{"content-type":"application/json","x-qa":String(index)},body:body?JSON.stringify(body):undefined});
      return {s:resp.status,b:await resp.json()};
    }
    const ps="/broker/configuration/controls",agent="/broker/ai-governance/agents/analytics";
    const value=(await api(ps)).b.value;
    const settings={revision:0,reason:"Validación operativa",value:{...value,priceGapPct:23,reminderLimit:1}};
    assert.equal((await api(ps,2,"PUT",settings)).s,403);
    const writes=await Promise.all([api(ps,0,"PUT",settings),api(ps,0,"PUT",settings)]);
    assert.deepEqual(writes.map(x=>x.s).sort(),[200,409]);
    assert.equal((await api(ps,1)).b.value.priceGapPct,10);
    assert.equal((await api(ps)).b.value.priceGapPct,23);
    const generic="/industry-records";
    assert.equal((await api(generic+"?type=broker_tenant_control")).s,403);
    assert.equal((await api(generic,0,"POST",{recordType:"broker_tenant_control",title:"Prueba interna",data:{}})).s,403);
    const create=(recordType,title,data={},status="ACTIVE")=>prisma.industryRecord.create({data:{recordType,title,data,status,tenantId:tenants[0].id}});
    const capture=await create("broker_capture_prospect","Captación",{ownerExpectedPrice:120,valuation:{amount:100}});
    const prospect="/broker/prospects/"+capture.id;
    assert.equal((await api(prospect)).b.priceGapWarning,false);
    const revert={revision:1,reason:"Recuperar valores anteriores",revert:true};
    const visit=await create("visit","Visita",{},"SCHEDULED");
    const remind=()=>api("/broker/agenda/"+visit.id+"/actions",0,"POST",{action:"PREPARE_REMINDER"});
    assert.equal((await remind()).b.record.data.brokerAgenda.reminder.attempts,1);
    assert.equal((await remind()).b.record.status,"PENDING_REVIEW");
    assert.equal((await remind()).s,409);
    assert.equal((await api(ps,0,"PUT",revert)).s,200);
    assert.equal((await api(prospect)).b.priceGapWarning,true);
    const pause={revision:0,reason:"Pausa de revisión",value:{enabled:false,actions:["SCAN"],areas:["commercial"]}};
    assert.equal((await api(agent,2,"PUT",pause)).s,403);
    assert.equal((await api(agent.replace("analytics","legal"),0,"PUT",pause)).s,422);
    assert.equal((await api(agent,0,"PUT",pause)).s,200);
    assert.equal((await api("/broker/automation-scan",0,"POST",{})).s,403);
    const evaluate=i=>api("/broker/ai-evaluations",i,"POST",{scenarioKey:"documento-por-vencer"});
    assert.equal((await evaluate(0)).s,403);
    assert.equal((await evaluate(1)).s,201);
    const liveCatalog=await api("/broker/catalog");
    assert.equal(liveCatalog.b.aiScenarios.some(s=>s.agentKey==="analytics"),false);
    assert.equal((await api(agent,0,"PUT",{revision:1,reason:"Acotar la cobertura",value:{enabled:true,actions:["EVALUATE"],areas:["commercial"]}})).s,200);
    assert.equal((await evaluate(0)).s,403);
    assert.equal((await api("/broker/ai-evaluations",0,"POST",{scenarioKey:"cartera-sin-responsable"})).s,201);
    assert.equal((await api("/broker/automation-scan",0,"POST",{})).s,403);
    assert.equal((await api(agent,0,"PUT",{...revert,revision:2})).b.value.enabled,false);
    assert.equal(await prisma.tenantAuditLog.count({where:{tenantId:tenants[0].id,action:"BROKER_TENANT_CONTROL_CHANGED"}}),5);
    const prop=await create("property","Casa QA");
    const draft=body=>api("/broker/marketing/predictions",0,"POST",{...body,propertyId:prop.id});
    for(const body of [{action:"CREATE_CAMPAIGN_DRAFT",name:"Invierno"},{action:"CREATE_PROSPECT_DRAFT",name:"Contacto",phone:"+56 91234 5454",email:"TEST@example.invalid"}]){
      const first=await draft(body);assert.equal(first.s,201,JSON.stringify(first.b));
      assert.equal((await draft({...body,phone:"56912345454"})).s,409);
    }
    const crm=agent.replace("analytics","crm");
    const {canUseAgent,readBrokerControl}=await import("../src/services/broker-tenant-controls.service.js");
    const original=await readBrokerControl(prisma,tenants[0].id,"agent:crm");
    const restricted=await api(crm,0,"PUT",{revision:0,reason:"Solo responsables de aprobar",value:{...original.value,approverOnly:true}});
    assert.equal(restricted.s,200);
    assert.equal(canUseAgent(restricted.b,"crm","DRAFT",null,"commercial"),false);
    assert.equal(canUseAgent(restricted.b,"crm","DRAFT",(await api("/broker/access/me",2)).b,"commercial"),false);
    assert.equal(canUseAgent(restricted.b,"crm","DRAFT",(await api("/broker/access/me")).b,"commercial"),true);
    assert.equal((await api(crm,0,"PUT",{revision:1,reason:"Revisión con un cliente anterior",value:{enabled:true,actions:["DRAFT"],areas:["commercial"]}})).s,422);
    await create("notification","Aviso Broker",{targetUrl:"/realty",severity:"info"},"UNREAD");
    await create("notification","Urgente Broker",{targetUrl:"/realty",severity:"critical"},"UNREAD");
    assert.equal((await api("/broker/preferences/notices",2,"PUT",{revision:0,reason:"Mi preferencia",value:{showInfoNotices:false}})).s,200);
    assert.deepEqual((await api("/notifications",2)).b.notifications.map(n=>n.title),["Urgente Broker"]);
    assert.equal((await api("/notifications")).b.notifications.length,2);
    if(process.env.BROKER_CONTROLS_WEB_URL) {
      const {default:verify}=await import("../../frontend/test/broker-tenant-controls.browser.cjs");
      await verify({webUrl:process.env.BROKER_CONTROLS_WEB_URL,apiOrigin:"http://127.0.0.1:"+server.address().port,user:users[1],tenant:tenants[1],actor:1});
      assert.equal((await api(ps,1)).b.revision,2);
      const saved=(await api("/broker/ai-governance",1)).b.agents.find(a=>a.key==="analytics").control;
      assert.equal(saved.revision,2);assert.equal(saved.value.enabled,true);
    }
  }finally{
    if(server)await new Promise(resolve=>server.close(resolve));
    for(const tenant of tenants) await prisma.tenant.delete({where:{id:tenant.id}});
    await prisma.$disconnect();
  }
});
