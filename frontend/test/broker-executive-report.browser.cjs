/** Comprueba las descargas del reporte desde Edge/Chromium contra la API y la base locales de QA. */
const {chromium}=require("playwright");
const {mkdir,readFile}=require("node:fs/promises");
const path=require("node:path");
const assert=require("node:assert/strict");

module.exports=async function verify({webUrl,apiOrigin,user,tenant,sourceId}){
  for(const s of [webUrl,apiOrigin])assert.ok(/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(s));
  const out=process.platform==="win32"?path.resolve("E:/Entregables_EVOLUM_OS/QA_Broker_OS/reporte_ejecutivo"):await require("node:fs/promises").mkdtemp(path.join(require("node:os").tmpdir(),"broker-report-"));
  await mkdir(out,{recursive:true});
  const browser=await chromium.launch(process.platform==="win32"?{headless:true,channel:"msedge"}:{headless:true});
  try{
    const context=await browser.newContext({viewport:{width:1390,height:940},acceptDownloads:true,serviceWorkers:"block"});
    const session={id:user.id,role:user.role,name:user.name,email:user.email,tenantId:tenant.id};
    await context.addInitScript(s=>{localStorage.setItem("inbox_session",JSON.stringify(s));document.cookie="inbox_session="+encodeURIComponent(JSON.stringify(s))+";path=/";},session);
    const modules=["properties","brokers","broker_portal","realty_loads","realty_activity","realty_clients"];
    await context.route("**/*",async route=>{
      const req=route.request(),url=new URL(req.url()),endpoint=url.pathname.replace(/^\/api\//,"/");
      if(url.origin===webUrl&&!url.pathname.startsWith("/api/"))return route.continue();
      const cors={"access-control-allow-origin":webUrl,"access-control-allow-credentials":"true","access-control-allow-methods":"GET,OPTIONS","access-control-allow-headers":"content-type"};
      const json=body=>route.fulfill({status:200,headers:cors,contentType:"application/json",body:JSON.stringify(body)});
      if(req.method()==="OPTIONS")return route.fulfill({status:204,headers:cors});
      if(endpoint==="/auth/me")return json({user:session,tenant,modules});
      if(endpoint==="/modules/me")return json({role:user.role,industry:tenant.industry,modules});
      if(endpoint.startsWith("/broker/")){
        const r=await context.request.get(apiOrigin+endpoint+url.search,{maxRedirects:0});
        return route.fulfill({status:r.status(),headers:{...cors,"content-type":r.headers()["content-type"]||"application/json"},body:await r.body()});
      }
      return json([]);
    });
    const page=await context.newPage(),errors=[];page.on("pageerror",e=>errors.push(e.message));
    await page.goto(webUrl+"/realty?view=broker_os&tab=executive_dashboard");
    const panel=page.getByRole("region",{name:"Reporte ejecutivo de negocios",exact:true});
    await panel.getByLabel("Desde",{exact:true}).fill("2026-01-01");await panel.getByLabel("Hasta",{exact:true}).fill("2026-01-31");
    await panel.getByRole("button",{name:"Consultar reporte"}).click();
    await panel.getByText("Venta en Ñuñoa",{exact:true}).waitFor();assert.equal(await panel.locator("ol li").count(),3);
    for(const fmt of ["PDF","CSV"]){
      const [d]=await Promise.all([page.waitForEvent("download"),panel.getByRole("button",{name:"Descargar "+fmt}).click()]);
      const target=path.join(out,"Broker_OS_reporte_ejecutivo_QA."+fmt.toLowerCase());await d.saveAs(target);const bytes=await readFile(target);
      if(fmt==="PDF")assert.equal(bytes.subarray(0,5).toString(),"%PDF-");
      else {assert.ok(bytes.toString().includes(sourceId));assert.ok(!bytes.toString().includes("Cartera de otra empresa"));}
    }
    await panel.getByLabel("Oficina",{exact:true}).selectOption("Sur");assert.equal(await panel.getByRole("button",{name:"Descargar PDF"}).count(),0);
    await panel.getByRole("button",{name:"Consultar reporte"}).click();await panel.getByText("Arriendo de oficinas",{exact:true}).waitFor();assert.equal(await panel.locator("ol li").count(),1);
    await page.setViewportSize({width:390,height:844});
    assert.ok(await panel.evaluate(el=>el.scrollWidth<=el.clientWidth+2));assert.deepEqual(errors,[]);
  }finally{await browser.close();}
};
