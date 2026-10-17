/** Archivo: Comprueba el comportamiento de interfaz o integración de broker web journey.browser. */
// Prueba de aceptación en navegador de las etapas 1 a 4, usando el router HTTP real de prospectos.
// Los modelos estrictos de operaciones y la autenticación son fixtures; NO es una prueba de PostgreSQL ni de inicio de sesión.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert=require('node:assert/strict');
const path=require('node:path');
const fs=require('node:fs');
const {pathToFileURL}=require('node:url');
const startFixture=require('./broker-web-api.fixture.cjs');
const frontendUrl=(process.env.BROKER_WEB_URL||'http://localhost:3001').replace(/\/$/,'');
(async()=>{
  const output=path.resolve(process.env.QA_OUTPUT||'');
  assert.ok(output.startsWith(path.resolve('E:/Entregables_EVOLUM_OS')+path.sep),'QA_OUTPUT debe estar fuera del proyecto, en Entregables_EVOLUM_OS');
  fs.mkdirSync(output,{recursive:true});
  const imp=name=>import(pathToFileURL(path.resolve(__dirname,'../../backend-v2/src/services',name)).href);
  const [flow,contract,sale,rental]=await Promise.all(['broker-workflows.service.js','broker-operation-contract.service.js','broker-sale.service.js','broker-rental.service.js'].map(imp));
  // En Windows aprovecha Edge instalado; en CI/Linux usa Chromium descargado por Playwright.
  // PLAYWRIGHT_CHANNEL permite forzar un navegador concreto sin modificar la prueba.
  const launchOptions={headless:true};
  if(process.env.PLAYWRIGHT_CHANNEL)launchOptions.channel=process.env.PLAYWRIGHT_CHANNEL;
  else if(process.platform==='win32')launchOptions.channel='msedge';
  const browser=await chromium.launch(launchOptions);
  const results=[];
  try {
    for(const [destination,currency] of [['VENTA','UF'],['ARRIENDO','CLP'],['ADMINISTRACION','USD']]) {
      const api=await startFixture();
      const context=await browser.newContext({viewport:{width:1440,height:1050}});
      let role='CORREDOR',failList=true,loseSign=true,postCount=0;
      const errors=[];
      const user={id:'qa-u1',tenantId:'qa-t1',name:'Corredora QA',email:'qa@example.invalid',role:'SELLER'};
      const modules=['properties','realty_loads','brokers','realty_activity','broker_portal','realty_clients'];
      const prospect=()=>api.rows().find(r=>r.recordType==='broker_capture_prospect'&&!r.id.startsWith('padding'));
      const operations=()=>api.rows().filter(r=>r.recordType==='broker_operation').map(contract.brokerOperationPayload);
      try {
        await context.addInitScript(({user})=>{localStorage.setItem('inbox_session',JSON.stringify(user));document.cookie=`inbox_session=${encodeURIComponent(JSON.stringify(user))};path=/`;},{user});
        await context.route('**/*',async route=>{
          const url=new URL(route.request().url()),p=url.pathname.replace(/^\/api/,''),method=route.request().method();
          if(url.origin===frontendUrl&&!url.pathname.startsWith('/api/'))return route.continue();
          const headers={'access-control-allow-origin':frontendUrl,'access-control-allow-credentials':'true','access-control-allow-headers':'Content-Type','access-control-allow-methods':'GET,POST,PUT,OPTIONS'};
          const send=(body,status=200)=>route.fulfill({status,headers,contentType:'application/json',body:JSON.stringify(body)});
          if(method==='OPTIONS')return route.fulfill({status:204,headers});
          if(p.startsWith('/broker/prospects')) {
            if(method==='GET'&&p==='/broker/prospects'&&failList){failList=false;return send({error:'Fallo temporal de prueba'},503);}
            if(method==='POST'&&p==='/broker/prospects'){postCount++;await new Promise(r=>setTimeout(r,250));}
            const response=await fetch(api.url+p+url.search,{method,headers:{'content-type':'application/json','x-qa-role':role},...(method==='POST'?{body:route.request().postData()}: {})});
            const body=await response.json();
            if(method==='POST'&&p.endsWith('/actions')&&route.request().postDataJSON().action==='SIGN'&&response.ok&&loseSign){loseSign=false;return send({error:'Respuesta perdida después de guardar: prueba de recuperación'},503);}
            return send(body,response.status);
          }
          if(p==='/auth/me')return send({user,tenant:{id:user.tenantId,industry:'REAL_ESTATE',name:'Broker QA'},modules});
          if(p==='/modules/me')return send({modules,industry:'REAL_ESTATE',role:'SELLER'});
          if(p==='/broker/access/me')return send({...api.normalizeBrokerAccessProfile({businessRole:role}),technicalRole:'SELLER',scopeUserIds:[user.id]});
          if(p==='/industry-records/users')return send([user]);
          if(p==='/broker/catalog')return send({operationStages:{SALE:flow.SALE_STAGES,RENTAL:flow.RENTAL_STAGES,ADMINISTRATION:flow.ADMINISTRATION_STAGES},journey:contract.BROKER_JOURNEY_CATALOG,recordDefinitions:{},areas:{}});
          if(p==='/broker/overview')return send({properties:api.rows().filter(r=>r.recordType==='property'),recommendations:[]});
          if(p==='/broker/operations')return send(operations());
          if(/^\/broker\/(sales|rentals)\//.test(p)) {
            assert.equal(method,'GET','Los controles de consulta no deben escribir expedientes');
            const operation=operations()[0],property=api.rows().find(r=>r.recordType==='property');
            const common={operation,property,capture:null,nextStage:'EVALUACION_COMERCIAL',readiness:{ready:false,missing:['Revisión humana pendiente'],requirements:[]}};
            return send(p.includes('/sales/')?{...common,saleCase:{...sale.normalizeBrokerSaleCase(),id:'qa-sale',currentStage:operation.data.stage},options:sale.BROKER_SALE_OPTIONS}:{...common,rentalCase:{...rental.normalizeBrokerRentalCase(),id:'qa-rental',currentStage:operation.data.stage},options:rental.BROKER_RENTAL_OPTIONS});
          }
          if(/notification|alerts|alertas/.test(p))return send({items:[],notifications:[],unreadCount:0});
          return send([]); // los servicios de páginas no relacionados permanecen sintéticos, sin red externa
        });
        const page=await context.newPage();
        page.setDefaultTimeout(Number(process.env.PLAYWRIGHT_TIMEOUT_MS||10000));
        page.on('pageerror',e=>errors.push(e.message));
        await page.goto(`${frontendUrl}/realty?view=operations`);
        const root=page.getByRole('region',{name:'Captación de propietarios'});
        await root.getByRole('alert').filter({hasText:'No se pudo actualizar la cartera'}).waitFor();
        assert.equal(await root.getByText('No hay prospectos en esta vista.').count(),0,'Un fallo no es una cartera vacía');
        await root.getByRole('button',{name:'Actualizar fichas'}).click();
        await root.getByText('No hay prospectos en esta vista.').waitFor();
        await root.getByRole('button',{name:'Nuevo prospecto',exact:true}).click();
        for(const [name,value] of [['Nombre del propietario','Ana Pérez'],['Teléfono','56912345678'],['Nombre del inmueble',`Casa QA ${destination}`],['Dirección','Los Robles 123'],['Comuna','Temuco'],['Región','La Araucanía']])await root.getByLabel(name,{exact:true}).fill(value);
        await root.getByLabel(/^Origen \(obligatorio\)/).selectOption('Formulario web');
        await root.getByLabel(/^Destino/).selectOption(destination);
        await root.getByLabel(/^Moneda/).selectOption(currency);
        // Los eventos de envío simultáneos ejercitan el bloqueo síncrono, no solo el CSS.
        await root.locator('form').first().evaluate(form=>{form.requestSubmit();form.requestSubmit();});
        await root.getByRole('button',{name:'Avanzar a Contacto',exact:true}).waitFor();
        assert.equal(postCount,1,'Doble envío no debe producir dos solicitudes');
        await root.getByRole('button',{name:'Avanzar a Contacto',exact:true}).click();
        await root.getByRole('button',{name:'Avanzar a Tasación preliminar',exact:true}).click();
        await root.getByRole('button',{name:'Avanzar a Negociación de mandato',exact:true}).click();
        await root.getByText(/Registra una valorización preliminar/).waitFor();
        await root.getByLabel('Valor preliminar',{exact:true}).fill('5000');
        await root.getByLabel('Fundamento y fuentes',{exact:true}).fill('Evaluación profesional registrada para este recorrido de prueba.');
        await root.getByRole('button',{name:'Guardar evaluación',exact:true}).click();
        await root.getByRole('button',{name:'Avanzar a Negociación de mandato',exact:true}).click();
        await root.getByRole('button',{name:'Registrar mandato firmado',exact:true}).waitFor();
        // Oculta el prospecto seleccionado después de la página 1 para probar recuperación mediante enlace directo.
        for(let i=0;i<101;i++)api.rows().unshift({...structuredClone(prospect()),id:`padding-${i}`,title:`Otro prospecto ${i}`});
        await page.goto(`${frontendUrl}/realty?view=operations&prospectId=${prospect().id}`);
        await root.getByRole('button',{name:'Registrar mandato firmado',exact:true}).waitFor();
        prospect().data.version++;
        await root.getByLabel(/^Nota interna/).fill('Nota conservada después de un conflicto');
        await root.getByRole('button',{name:'Registrar nota',exact:true}).click();
        await root.getByText(/La ficha cambió/).waitFor();
        assert.equal(await root.getByLabel(/^Nota interna/).inputValue(),'Nota conservada después de un conflicto');
        await root.getByRole('button',{name:'Actualizar fichas'}).click();
        await root.getByRole('button',{name:'Registrar nota',exact:true}).click();
        await root.getByText('Nota conservada después de un conflicto',{exact:true}).waitFor();
        await root.getByRole('button',{name:'Registrar mandato firmado',exact:true}).click();
        await root.getByLabel('Fecha de firma',{exact:true}).fill('2026-01-01');
        await root.getByLabel('Referencia del documento firmado',{exact:true}).fill(`MANDATO-QA-${destination}`);
        await root.getByLabel('Confirmo que cuento con la evidencia de firma.').check();
        await root.getByRole('button',{name:'Revisar conversión',exact:true}).click();
        await root.getByRole('region',{name:'Revisión de conversión'}).waitFor();
        await root.getByRole('button',{name:'Confirmar y crear negocio',exact:true}).click();
        await root.getByText(/Respuesta perdida después de guardar/).waitFor();
        await root.getByRole('button',{name:'Confirmar y crear negocio',exact:true}).click();
        await root.getByText('Mandato registrado. Negocio y propietario vinculados.',{exact:true}).waitFor();
        assert.equal(operations().length,1);assert.equal(api.logs().filter(l=>l.action==='MANDATO_FIRMADO').length,1);
        assert.equal(operations()[0].data.currency,currency);
        const operationId=operations()[0].id;
        await root.getByRole('link',{name:'Ver en Negocios',exact:true}).click();
        const receipt=page.getByRole('region',{name:'Condiciones de origen del negocio'}).first();
        await receipt.waitFor();assert.match(await receipt.innerText(),new RegExp(currency));
        await page.reload();await receipt.waitFor();
        await receipt.locator('summary').click();assert.match(await receipt.innerText(),/Nota conservada/);
        await receipt.scrollIntoViewIfNeeded();await page.screenshot({path:path.join(output,`${destination}-negocio.png`)});
        // El router HTTP real bloquea a otro tenant o usuario, incluso con un ID válido.
        for(const headers of [{'x-qa-tenant':'otra-empresa'},{'x-qa-user':'otro-corredor'}]) {
          const res=await fetch(`${api.url}/broker/prospects/${prospect().id}`,{headers});assert.equal(res.status,404);
        }
        role='LECTURA';
        await page.goto(`${frontendUrl}/realty?view=broker_os&tab=operations`);
        await receipt.waitFor();
        const advance=page.getByRole('button',{name:/^Avanzar a /}).first();assert.equal(await advance.isDisabled(),true);
        if(destination!=='ADMINISTRACION') {
          const open=page.locator('.broker-operation-card').getByRole('button',{name:'Abrir expediente',exact:true}).first();assert.equal(await open.isEnabled(),true);await open.click();
          await page.getByRole('region',{name:destination==='VENTA'?'Expediente completo de venta':'Expediente completo de arriendo'}).waitFor();
          assert.equal(await page.getByRole('button',{name:destination==='VENTA'?'Guardar controles de venta':'Guardar controles de arriendo',exact:true}).isDisabled(),true);
        }
        await page.goto(`${frontendUrl}/realty?view=operations&prospectId=${prospect().id}`);
        await root.getByRole('link',{name:'Abrir negocio',exact:true}).waitFor();assert.equal(await root.getByRole('button',{name:'Nuevo prospecto',exact:true}).isDisabled(),true);
        const denied=await fetch(`${api.url}/broker/prospects/${prospect().id}/actions`,{method:'POST',headers:{'content-type':'application/json','x-qa-role':'LECTURA'},body:JSON.stringify({action:'NOTE',version:prospect().data.version,note:'No permitido'})});assert.equal(denied.status,403);
        await page.setViewportSize({width:390,height:844});
        const closeMenu=page.locator('button').filter({hasText:'×'}).first();if(await closeMenu.isVisible())await closeMenu.click();
        await root.scrollIntoViewIfNeeded();
        assert.equal(await root.evaluate(el=>el.scrollWidth<=el.clientWidth+2&&el.getBoundingClientRect().right<=innerWidth+1),true);
        await page.screenshot({path:path.join(output,`${destination}-movil.png`)});
        await page.evaluate(()=>{document.documentElement.dataset.theme='purple';document.documentElement.dataset.designSystem='dark';});
        await page.screenshot({path:path.join(output,`${destination}-oscuro.png`)});
        assert.ok(await root.locator('aside').evaluate(el=>el.getBoundingClientRect().height<=321),'El listado móvil no debe desplazar indefinidamente la ficha');
        const detail=root.locator('article').first(); await detail.scrollIntoViewIfNeeded();
        await page.screenshot({path:path.join(output,`${destination}-detalle-movil.png`)});
        assert.deepEqual(errors,[]);
        results.push({destination,currency,operationId,result:'PASS',coverage:['retry-list','double-submit','valuation-gate','conflict-deep-link','lost-sign-response','reload','read-only','tenant-scope','mobile'],storage:'in-memory',auth:'synthetic'});
        console.log(`${destination}: recorrido, errores, permisos y navegación OK`);
      } catch(error) {
        const page=context.pages()[0];
        if(page){await page.screenshot({path:path.join(output,`${destination}-fallo.png`)}); console.error((await page.locator('body').innerText()).slice(-4500));}
        throw error;
      } finally {await context.close();await api.close();}
    }
  } finally {await browser.close();fs.writeFileSync(path.join(output,'resultados.json'),JSON.stringify(results,null,2));}
})().catch(e=>{console.error(e);process.exitCode=1;});
