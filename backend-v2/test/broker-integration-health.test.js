/** Verifica evidencia de integraciones, privacidad y aislamiento con datos sintéticos. */
import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import express from "express";
import {brokerQaEnvironment} from "../scripts/lib/broker-qa-environment.mjs";
import {brokerHealthItem,brokerTestEvidence,brokerSourceByKey,brokerAccountDiscovered} from "../src/services/broker-integration-health.service.js";

const now=new Date("2026-11-20T12:00:00Z"),at="2026-11-20T11:00:00.000Z",older="2026-11-17T12:00:00.000Z";
const gmail=brokerSourceByKey.get("gmail"),ok={lastTestedAt:at,lastTestStatus:"OK",lastTestKind:"REMOTE"};
const row=(metadata,over={})=>({isActive:true,token:true,external:true,metadata,...over});
const read=(metadata,over={},audit={})=>brokerHealthItem(gmail,row(metadata,over),audit,now);
test("Editar, revisar campos locales o detectar otro activo no demuestra la conexión de la cuenta",()=>{
  assert.equal(brokerHealthItem(gmail,null,{},now).state,"NOT_CONFIGURED");
  assert.equal(read({}, {updatedAt:now}).lastCheckedAt,null);
  for(const kind of ["ASSET_DISCOVERY","LOCAL"])assert.equal(read({...ok,lastTestKind:kind}).state,"UNVERIFIED");
  assert.equal(read({...ok,lastTestedAt:"2027-01-01"}).state,"UNVERIFIED");
  assert.equal(read({...ok,connectionConfigChangedAt:now}).state,"UNVERIFIED");
  assert.equal(read(ok).state,"VERIFIED");assert.equal(read({...ok,lastTestedAt:older}).state,"STALE");
  const legacy={...ok,lastTestKind:undefined,lastTestMessage:"Token y cuenta OAuth validados"};
  assert.equal(read(legacy).state,"UNVERIFIED");assert.equal(read(legacy,{legacyAccount:true}).state,"VERIFIED");
  assert.equal(read(ok,{token:false}).state,"INCOMPLETE");
  assert.equal(read({...ok,oauthExpiresAt:at}).state,"EXPIRED");
  assert.equal(read({...ok,oauthExpiresAt:at},{isActive:false}).state,"DISCONNECTED");
  assert.equal(brokerAccountDiscovered("meta_instagram",{externalAccountId:"meta-page:1",discovery:{account:{pageId:"1"}}}),false);
  assert.equal(brokerAccountDiscovered("gmail",{}),false);
});
test("El último fallo preserva el éxito previo y nunca expone el mensaje ni tokens del proveedor",()=>{
  const evidence=brokerTestEvidence(gmail,{at,ok:false,remote:true,error:"401 private-sentinel"});
  const result=read({...evidence,lastTestRemoteSuccessAt:older,lastTestedAt:at,lastTestStatus:"ERROR",lastTestMessage:"401 private-sentinel"});
  assert.equal(result.state,"ERROR");assert.equal(result.lastSuccessAt,older);assert.equal(result.lastErrorAt,at);
  assert.match(result.lastError,/autorización/);assert.doesNotMatch(JSON.stringify(result),/sentinel/);
  assert.equal(read({...ok,lastTestedAt:older},{},{error:at}).state,"ERROR");
  const local=brokerSourceByKey.get("webpay");
  assert.equal(brokerHealthItem(local,row(ok,{commerce:true}),{success:at},now).lastSuccessAt,null);
  assert.equal(brokerHealthItem(local,row(ok,{commerce:true}),{},now).state,"LOCAL_ONLY");
  assert.deepEqual(brokerTestEvidence({key:"finance_nubox"},{at,ok:true,remote:true}),{});
});
test("API con PostgreSQL: dos inmobiliarias, corredor sin permiso, portal comercial y Centro de conexiones", {skip:!process.env.QA_BROKER_DATABASE_URL},async()=>{
  process.env.DATABASE_URL=brokerQaEnvironment(process.env).DATABASE_URL;
  const {prisma}=await import("../src/lib/db.js"),{brokerRouter}=await import("../src/routes/broker.routes.js"),{connectionsRouter}=await import("../src/routes/connections.routes.js");
  const companies=[],users=[];let server;
  try{
    const recent=new Date(Date.now()-60_000).toISOString();
    for(const [i,name] of ["Norte","Sur"].entries()){
      const t=await prisma.tenant.create({data:{slug:randomUUID(),name,industry:"REAL_ESTATE"}});companies.push(t);
      users.push(await prisma.workspaceUser.create({data:{tenantId:t.id,name:"Dirección "+name,role:"OWNER",email:randomUUID()+"@example.invalid",passwordHash:"no-login"}}));
      await prisma.tenantChannelConfig.create({data:{tenantId:t.id,channel:"gmail",accessToken:"private-sentinel",externalAccountId:randomUUID(),metadata:{...ok,lastTestedAt:recent,...(i?{oauthExpiresAt:older}:{})}}});
    }
    const t=companies[0];
    users.push(await prisma.workspaceUser.create({data:{tenantId:t.id,name:"Corredor QA",role:"SELLER",email:randomUUID()+"@example.invalid",passwordHash:"no-login"}}));
    await prisma.tenantChannelConfig.createMany({data:[{tenantId:t.id,channel:"finance_nubox"},{tenantId:t.id,channel:"facebook",accessToken:"private-sentinel",externalAccountId:randomUUID(),metadata:{}},{tenantId:t.id,channel:"webpay",accessToken:"private-sentinel",metadata:{commerceCode:"private-sentinel",lastTestStatus:"OK",lastTestedAt:recent}}]});
    await prisma.industryRecord.create({data:{tenantId:t.id,recordType:"broker_publication_provider",status:"ACTIVE",title:"TocToc QA",data:{channel:"TOCTOC",providerStatus:"ACTIVE",notes:"private-sentinel"}}});
    const app=express();app.use((req,res,next)=>{req.user=users[Number(req.headers["x-qa"]||0)];req.tenant=companies.find(c=>c.id===req.user.tenantId);req.tenantId=req.tenant.id;next();});
    app.use(brokerRouter);app.use(connectionsRouter);
    server=await new Promise(resolve=>{const s=app.listen(0,"127.0.0.1",()=>resolve(s));});
    const origin="http://127.0.0.1:"+server.address().port;
    const get=(p,i=0)=>fetch(origin+p,{headers:{"x-qa":String(i)}});
    const r=await get("/broker/integrations/health?tenantId="+companies[1].id);assert.equal(r.status,200);assert.match(r.headers.get("cache-control"),/no-store/);
    const health=await r.json(),by=(h,k)=>h.items.find(i=>i.key===k);
    assert.equal(by(health,"gmail").state,"VERIFIED");assert.equal(by(health,"facebook_business").state,"UNVERIFIED");assert.equal(by(health,"meta_business").state,"NOT_CONFIGURED");assert.equal(by(health,"webpay").state,"LOCAL_ONLY");
    assert.equal(health.items.filter(i=>i.registered).length,3);assert.doesNotMatch(JSON.stringify(health),/private-sentinel|finance_nubox/);
    assert.equal(health.portals.find(p=>p.key==="TOCTOC").providerStatus,"ACTIVE");assert.ok(health.portals.every(p=>!p.externalPublishingEnabled));assert.equal(health.externalActionsEnabled,false);
    const other=await (await get("/broker/integrations/health",1)).json();assert.equal(by(other,"gmail").state,"EXPIRED");assert.equal(other.items.filter(i=>i.registered).length,1);
    assert.equal((await get("/broker/integrations/health",2)).status,403);
    const center=await get("/connections");assert.equal(center.status,200);const cards=(await center.json()).groups.flatMap(g=>g.providers);
    for(const key of ["gmail","meta_business","facebook_business","webpay"])assert.deepEqual(cards.find(p=>p.key===key).brokerHealth,by(health,key));
    const property=await prisma.industryRecord.create({data:{tenantId:t.id,recordType:"property",status:"ACTIVE",title:"Propiedad QA",data:{}}});
    const publication=await prisma.industryRecord.create({data:{tenantId:t.id,recordType:"marketing_publication",status:"DRAFT",title:"Borrador QA",data:{channel:"MERCADOLIBRE_INMUEBLES",propertyId:property.id}}});
    const cfg=await prisma.tenantChannelConfig.create({data:{tenantId:t.id,channel:"broker_mercadolibre_real_estate",accessToken:"private-sentinel",externalAccountId:randomUUID(),metadata:{lastTestStatus:"OK"}}});
    const check=async()=>{const resp=await get("/broker/publications/"+publication.id+"/preflight");assert.equal(resp.status,200);return (await resp.json()).connection;};
    assert.equal((await check()).state,"UNVERIFIED");assert.equal((await check()).lastTestedAt,null);
    await prisma.tenantChannelConfig.update({where:{id:cfg.id},data:{metadata:{...ok,lastTestedAt:recent}}});
    assert.equal((await check()).state,"CONNECTED");
    const fail=new Date().toISOString();await prisma.tenantAuditLog.create({data:{tenantId:t.id,entity:"tenant_channel_config",entityId:cfg.id,action:"CONNECTION_TESTED",metadata:{ok:false,checkedAt:fail}}});
    const after=by(await (await get("/broker/integrations/health")).json(),"broker_mercadolibre_real_estate");
    assert.equal(after.state,"ERROR");assert.equal(after.lastErrorAt,fail);assert.equal(after.lastSuccessAt,recent);
    // Solo el transporte a Gmail se simula; la ruta, las escrituras y la consulta posterior son reales.
    const nativeFetch=globalThis.fetch;let calls=0,allowed=true;
    try{
      globalThis.fetch=async(url,options)=>{
        if(String(url).startsWith(origin+"/"))return nativeFetch(url,options);
        assert.equal(String(url),"https://gmail.googleapis.com/gmail/v1/users/me/profile");calls++;
        return Response.json(allowed?{emailAddress:"qa@example.invalid"}:{error:{message:"private-sentinel"}},{status:allowed?200:403});
      };
      const attempt=()=>fetch(origin+"/connections/gmail/test",{method:"POST"});
      assert.equal((await attempt()).status,200);
      const verified=by(await (await get("/broker/integrations/health")).json(),"gmail");assert.equal(verified.state,"VERIFIED");
      allowed=false;assert.equal((await attempt()).status,400);
      const rejected=by(await (await get("/broker/integrations/health")).json(),"gmail");
      assert.equal(rejected.state,"ERROR");assert.equal(rejected.lastSuccessAt,verified.lastSuccessAt);assert.match(rejected.lastError,/Permiso/);assert.doesNotMatch(JSON.stringify(rejected),/sentinel/);
      allowed=true;assert.equal((await attempt()).status,200);
      const recovered=by(await (await get("/broker/integrations/health")).json(),"gmail");assert.equal(recovered.state,"VERIFIED");assert.equal(recovered.lastErrorAt,rejected.lastErrorAt);
      assert.equal(calls,3);
    }finally{globalThis.fetch=nativeFetch;}
    if(process.env.BROKER_HEALTH_WEB_URL){const {default:verify}=await import("../../frontend/test/broker-integration-health.browser.cjs");await verify({webUrl:process.env.BROKER_HEALTH_WEB_URL,apiOrigin:origin,user:users[0],tenant:t});}
  }finally{if(server)await new Promise(resolve=>server.close(resolve));for(const t of companies)await prisma.tenant.delete({where:{id:t.id}});await prisma.$disconnect();}
});
