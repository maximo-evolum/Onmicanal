/** Recorre la cuenta Broker en navegador contra la API/BD aisladas, sin conectarse a proveedores. */
const {chromium}=require("playwright");
const assert=require("node:assert/strict");
const {mkdir}=require("node:fs/promises");
const path=require("node:path");
module.exports=async function verify({webUrl,apiOrigin,user,tenant}){
  for(const s of [webUrl,apiOrigin])assert.match(s,/^http:\/\/127\.0\.0\.1:\d+$/);
  const browser=await chromium.launch(process.platform==="win32"?{headless:true,channel:"msedge"}:{headless:true});
  try{
    const ctx=await browser.newContext({viewport:{width:1366,height:850},serviceWorkers:"block"});
    const session={id:user.id,role:user.role,name:user.name,email:user.email,tenantId:tenant.id},modules=["properties","broker_portal","brokers","realty_loads","realty_activity","realty_clients"];
    await ctx.addInitScript(s=>{localStorage.setItem("inbox_session",JSON.stringify(s));document.cookie="inbox_session="+encodeURIComponent(JSON.stringify(s))+";path=/";},session);
    let reads=0;
    await ctx.route("**/*",async route=>{
      const r=route.request(),url=new URL(r.url()),p=url.pathname.replace(/^\/api\//,"/");
      if(url.origin===webUrl&&!url.pathname.startsWith("/api/"))return route.continue();
      const headers={"access-control-allow-origin":webUrl,"access-control-allow-credentials":"true","access-control-allow-methods":"GET, OPTIONS","access-control-allow-headers":"content-type"};
      if(r.method()==="OPTIONS")return route.fulfill({status:204,headers});
      if(r.method()!=="GET")return route.abort();
      if(p.startsWith("/broker/")){
        if(p==="/broker/integrations/health")reads++;
        const response=await ctx.request.get(apiOrigin+p+url.search,{maxRedirects:0});
        return route.fulfill({status:response.status(),headers,contentType:"application/json",body:await response.body()});
      }
      const data=p==="/auth/me"?{user:session,tenant,modules}:p==="/modules/me"?{role:user.role,industry:tenant.industry,modules}:[];
      return route.fulfill({headers,contentType:"application/json",body:JSON.stringify(data)});
    });
    const page=await ctx.newPage(),errors=[];page.on("pageerror",e=>errors.push(e.message));
    await page.goto(webUrl+"/realty?view=broker_os&tab=account");
    const panel=page.getByRole("region",{name:"Estado real de integraciones",exact:true});
    await panel.getByText("Verificación reciente",{exact:true}).waitFor();
    await panel.getByText("Solo configuración local",{exact:true}).waitFor();
    await panel.getByText("Estado de los portales de publicación",{exact:true}).click();
    await panel.getByText(/Activo en registro comercial/).waitFor();
    const previous=reads;
    await Promise.all([page.waitForResponse(r=>r.url().includes("/broker/integrations/health")&&r.request().method()==="GET"),panel.getByRole("button",{name:"Actualizar estado"}).click()]);
    assert.equal(reads,previous+1);
    for(const width of [1366,390]){
      await page.setViewportSize({width,height:850});await panel.getByText("Verificación reciente",{exact:true}).waitFor();
      assert.ok(await panel.evaluate(el=>el.scrollWidth<=el.clientWidth+2));
      await panel.evaluate(el=>{el.style.scrollMarginTop="90px";el.scrollIntoView({block:"start",inline:"nearest",behavior:"instant"});});
      const bounds=await panel.boundingBox();assert.ok(bounds.x>=-2 && bounds.x+bounds.width<=width+2,"El panel debe caber en la ventana");
      if(process.platform==="win32"){const out="E:/Entregables_EVOLUM_OS/QA_Broker_OS/estado_integraciones";await mkdir(out,{recursive:true});await page.screenshot({path:path.join(out,"Broker_integraciones_"+width+".png"),animations:"disabled"});}
    }
    assert.deepEqual(errors,[]);
  }finally{await browser.close();}
};
