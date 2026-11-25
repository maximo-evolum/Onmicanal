/** Recorre los controles con la web local y las rutas reales del servidor de pruebas Broker. */
const {chromium} = require("playwright");
const assert = require("node:assert/strict");
const path = require("node:path");
const {mkdir} = require("node:fs/promises");

module.exports = async function verifyTenantControls({webUrl,apiOrigin,user,tenant,actor}) {
  for (const address of [webUrl,apiOrigin]) {
    const url=new URL(address);
    assert.equal(url.protocol,"http:"); assert.ok(["127.0.0.1","localhost"].includes(url.hostname));
  }
  const evidence=path.resolve("E:/Entregables_EVOLUM_OS/QA_Broker_OS/politicas_y_agentes");
  await mkdir(evidence,{recursive:true});
  const browser=await chromium.launch(process.platform==="win32"?{channel:"msedge",headless:true}:{headless:true});
  try {
    const context=await browser.newContext({viewport:{width:1440,height:1000},serviceWorkers:"block"});
    const session={id:user.id,name:user.name,email:user.email,role:user.role,tenantId:tenant.id};
    await context.addInitScript(session=>{
      localStorage.setItem("inbox_session",JSON.stringify(session));
      document.cookie="inbox_session="+encodeURIComponent(JSON.stringify(session))+";path=/";
    },session);
    const modules=["properties","realty_loads","realty_clients","realty_activity","brokers","broker_portal"];
    await context.route("**/*",async route=>{
      const req=route.request(), url=new URL(req.url()),endpoint=url.pathname.replace(/^\/api\//,"/");
      if(url.origin===webUrl && !url.pathname.startsWith("/api/"))return route.continue();
      const headers={"access-control-allow-origin":webUrl,"access-control-allow-credentials":"true","access-control-allow-methods":"GET,POST,PUT,PATCH,OPTIONS","access-control-allow-headers":"Content-Type"};
      const reply=(obj,status=200)=>route.fulfill({status,headers,contentType:"application/json",body:JSON.stringify(obj)});
      if(req.method()==="OPTIONS")return route.fulfill({status:204,headers});
      if(endpoint==="/auth/me")return reply({user:session,tenant,modules});
      if(endpoint==="/modules/me")return reply({modules,industry:tenant.industry,role:user.role});
      if(endpoint.startsWith("/broker/")||endpoint==="/notifications"){
        const response=await context.request.fetch(apiOrigin+endpoint+url.search,{method:req.method(),headers:{"content-type":"application/json","x-qa":String(actor)},data:req.postData()||undefined,maxRedirects:0});
        return route.fulfill({status:response.status(),headers,contentType:"application/json",body:await response.body()});
      }
      return reply([]);
    });
    const page=await context.newPage(), errors=[];
    page.on("pageerror",e=>errors.push(e.message));page.setDefaultTimeout(15000);
    await page.goto(webUrl+"/realty?view=broker_os&tab=configuration");
    const gap=page.getByLabel(/Brecha de tasación/);
    assert.equal(await gap.inputValue(),"10");
    const policy=page.locator("form").filter({has:gap});
    await gap.fill("17");await policy.getByLabel("Motivo del cambio").fill("Ajuste de prueba de tasación");
    await policy.getByRole("button",{name:"Guardar política"}).click();
    await page.getByText("Política operativa guardada.",{exact:true}).waitFor();
    await page.reload();assert.equal(await gap.inputValue(),"17");
    await policy.getByLabel("Motivo del cambio").fill("Volver a la política original");
    await policy.getByRole("button",{name:"Restaurar versión anterior"}).click();
    await page.getByText("Política anterior restaurada.",{exact:true}).waitFor();
    assert.equal(await gap.inputValue(),"10");
    await policy.screenshot({path:path.join(evidence,"politica-operativa.png")});
    await page.goto(webUrl+"/realty?view=broker_os&tab=ai_governance");
    const card=page.locator("article.broker-ai-agent").filter({has:page.getByRole("heading",{name:"Agente de Analítica",exact:true})});
    async function openControls(){await card.locator("summary").waitFor();if(!await card.locator("details").evaluate(e=>e.open))await card.locator("summary").click();}
    await openControls();await card.getByLabel("Agente habilitado").uncheck();
    await card.getByLabel("Solo perfiles con permiso de aprobación IA").check();
    await card.getByLabel("Motivo",{exact:true}).fill("Pausa temporal del agente");
    await card.getByRole("button",{name:"Guardar agente"}).click();
    await card.getByText("Pausado en la empresa").waitFor();
    await page.reload();await card.getByText("Pausado en la empresa").waitFor();await openControls();
    assert.equal(await card.getByLabel("Solo perfiles con permiso de aprobación IA").isChecked(),true);
    await page.setViewportSize({width:1440,height:1800});
    await card.evaluate(e=>e.scrollIntoView({block:"center"}));
    await card.screenshot({path:path.join(evidence,"agente-pausado.png")});
    await card.getByLabel("Motivo",{exact:true}).fill("Reactivar tras la revisión");
    await card.getByRole("button",{name:"Revertir cambio"}).click();
    await card.getByText("Habilitado en la empresa").waitFor();
    await page.setViewportSize({width:390,height:844});await openControls();
    assert.equal(await card.getByLabel("Solo perfiles con permiso de aprobación IA").isChecked(),false);
    assert.ok(await card.evaluate(e=>e.scrollWidth<=e.clientWidth+2),"El editor de agentes debe caber en móvil.");
    assert.deepEqual(errors,[]);
  } finally {await browser.close();}
};
