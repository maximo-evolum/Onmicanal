/** Archivo: Comprueba el comportamiento de interfaz o integración de broker prospects.browser. */
// QA local con API simulada. No usa credenciales ni escribe en producción.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const frontendUrl = (process.env.BROKER_WEB_URL || 'http://localhost:3001').replace(/\/$/, '');
(async () => {
  const core = await import(pathToFileURL(path.resolve(__dirname,'../../backend-v2/src/services/broker-prospect.service.js')).href);
  const {brokerConversionPlan} = await import(pathToFileURL(path.resolve(__dirname,'../../backend-v2/src/services/broker-conversion-plan.service.js')).href);
  const {brokerOperationPayload,BROKER_JOURNEY_CATALOG} = await import(pathToFileURL(path.resolve(__dirname,'../../backend-v2/src/services/broker-operation-contract.service.js')).href);
  const workflow = await import(pathToFileURL(path.resolve(__dirname,'../../backend-v2/src/services/broker-workflows.service.js')).href);
  const sale = await import(pathToFileURL(path.resolve(__dirname,'../../backend-v2/src/services/broker-sale.service.js')).href);
  const out = process.env.QA_OUTPUT;
  if (!out) throw new Error('Define QA_OUTPUT fuera del repositorio.');
  fs.mkdirSync(out,{recursive:true});
  // En Windows aprovecha Edge instalado; en CI/Linux usa Chromium descargado por Playwright.
  // PLAYWRIGHT_CHANNEL permite forzar un navegador concreto sin modificar la prueba.
  const launchOptions={headless:true};
  if(process.env.PLAYWRIGHT_CHANNEL)launchOptions.channel=process.env.PLAYWRIGHT_CHANNEL;
  else if(process.platform==='win32')launchOptions.channel='msedge';
  const browser = await chromium.launch(launchOptions);
  try {
    const context = await browser.newContext({viewport:{width:1440,height:1050}});
    const user={id:'qa-u1',tenantId:'qa-t1',name:'Corredora de prueba',email:'qa@example.invalid',role:'SELLER'};
    const modules=['properties','realty_loads','brokers','realty_activity','broker_portal','realty_clients'];
    const access={businessRole:'CORREDOR',technicalRole:'SELLER',accessScope:'ASSIGNED',scopeUserIds:[user.id],policy:{actions:{commercial:['VIEW','CREATE','EDIT'],operations:['VIEW','CREATE','EDIT'],overview:['VIEW']}}};
    let rows=[],operation=null;
    await context.addInitScript(({user})=>{localStorage.setItem('inbox_session',JSON.stringify(user));document.cookie=`inbox_session=${encodeURIComponent(JSON.stringify(user))};path=/`;}, {user});
    await context.route('**/*',async route=>{
      const url=new URL(route.request().url()),p=url.pathname.replace(/^\/api/,'');
      if(url.origin===frontendUrl&&!url.pathname.startsWith('/api/'))return route.continue();
      if(process.env.QA_DEBUG) console.log('API simulada:',p);
      const cors={'access-control-allow-origin':frontendUrl,'access-control-allow-credentials':'true','access-control-allow-headers':'Content-Type','access-control-allow-methods':'GET,POST,OPTIONS'};
      if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers:cors});
      let body=[];
      if(p==='/auth/me')body={user,tenant:{id:user.tenantId,industry:'REAL_ESTATE',name:'QA Broker'},modules};
      else if(p==='/modules/me')body={modules,industry:'REAL_ESTATE',role:'SELLER'};
      else if(p==='/broker/access/me')body=access;
      else if(p==='/broker/overview')body={properties:[],recommendations:[]};
      else if(p==='/broker/catalog')body={operationStages:{SALE:workflow.SALE_STAGES,RENTAL:workflow.RENTAL_STAGES,ADMINISTRATION:workflow.ADMINISTRATION_STAGES},journey:BROKER_JOURNEY_CATALOG,recordDefinitions:{},recordAreas:{}};
      else if(p==='/broker/operations')body=operation?[operation]:[];
      else if(p==='/broker/sales/qa-op')body={operation,property:{id:'qa-p',title:'Casa de prueba',data:{}},saleCase:{...sale.normalizeBrokerSaleCase(),id:'qa-case',currentStage:operation.data.stage},capture:null,nextStage:'EVALUACION_COMERCIAL',readiness:sale.brokerSaleReadiness({targetStage:'EVALUACION_COMERCIAL'}),options:sale.BROKER_SALE_OPTIONS};
      else if(p==='/industry-records/users')body=[user];
      else if(p==='/broker/prospects'&&route.request().method()==='POST'){
        const input=route.request().postDataJSON(); const data=core.prospectInput(input);
        const row={id:'qa-prospect',title:data.title,assignedToId:user.id,createdAt:new Date().toISOString(),data:core.prospectEvent({...data,stage:'PROSPECCION',stageEnteredAt:new Date().toISOString()},'PROSPECTO_CREADO',user.id)};
        rows=[row];body=core.prospectPresentation(row);
      } else if(p==='/broker/prospects')body={items:rows.map(r=>core.prospectPresentation(r)),total:rows.length,page:1,pageSize:100};
      else if(p.endsWith('/conversion-preview'))body=brokerConversionPlan(rows[0],route.request().postDataJSON());
      else if(p.endsWith('/actions')){
        const input=route.request().postDataJSON(),r=rows[0];let d=r.data;
        if(input.action==='ADVANCE')d=core.prospectTransition(d,input.stage);
        if(input.action==='VALUE')d={...d,valuation:{amount:Number(input.amount),rationale:input.rationale,method:'EVALUACION_PROFESIONAL'}};
        if(input.action==='SIGN'){
          const plan=brokerConversionPlan(r,input);
          operation=brokerOperationPayload({id:'qa-op',title:'Venta · Casa de prueba',data:{operationType:'SALE',stage:plan.initialStage,propertyId:'qa-p',timeline:[],conversion:{...plan,ownerName:plan.owner.name,propertyTitle:plan.property.title,address:plan.property.address,comuna:plan.property.comuna,convertedAt:new Date().toISOString(),convertedBy:user.id,captureHistory:d.timeline}}});
          d={...d,mandate:plan.terms,outcome:'CONVERTED',conversion:{propertyId:'qa-p',ownerId:'qa-o',operationId:'qa-op',mandateId:'qa-m'},convertedAt:new Date().toISOString()};
        }
        const events={ADVANCE:'ETAPA_ACTUALIZADA',NOTE:'NOTA_REGISTRADA',VALUE:'VALORIZACION_REGISTRADA',SIGN:'MANDATO_FIRMADO'};
        r.data=core.prospectEvent(d,events[input.action],user.id,{note:input.note});body=core.prospectPresentation(r);
      } else if(p.endsWith('/owner'))body={id:'qa-o',name:'Ana Pérez',rut:'',phone:'56912345678',email:'',propertyId:'qa-p',propertyTitle:'Casa de prueba'};
      else if(p==='/broker/prospects/qa-prospect')body=core.prospectPresentation(rows[0]);
      else if(/notification|alerts|alertas/.test(p))body={items:[],notifications:[],unreadCount:0};
      await route.fulfill({status:200,contentType:'application/json',headers:cors,body:JSON.stringify(body)});
    });
    const page=await context.newPage();
    page.setDefaultTimeout(Number(process.env.PLAYWRIGHT_TIMEOUT_MS || 10000));
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(`${frontendUrl}/realty?view=operations`);
    if(process.env.QA_DEBUG) { await page.waitForTimeout(2500); console.log((await page.locator('body').innerText()).slice(0,4000),errors); await page.screenshot({path:path.join(out,'diagnostico.png')}); }
    const root=page.getByRole('region',{name:'Captación de propietarios'});
    await root.getByRole('button',{name:'Nuevo prospecto',exact:true}).click();
    for(const [label,value] of [['Nombre del propietario','Ana Pérez'],['Teléfono','56912345678'],['Nombre del inmueble','Casa de prueba'],['Dirección','Los Alerces 120'],['Comuna','Providencia'],['Expectativa de precio','120000000']])await root.getByLabel(label,{exact:true}).fill(value);
    await root.getByLabel(/^Origen \(obligatorio\)/).selectOption('Formulario web');
    await root.getByRole('button',{name:'Guardar prospecto',exact:true}).click();
    await root.getByRole('button',{name:'Avanzar a Contacto',exact:true}).click();
    await root.getByRole('button',{name:'Avanzar a Tasación preliminar',exact:true}).click();
    await root.getByLabel('Valor preliminar',{exact:true}).fill('100000000');
    await root.getByLabel('Fundamento y fuentes',{exact:true}).fill('Comparación profesional de inmuebles similares de Providencia.');
    await root.getByRole('button',{name:'Guardar evaluación',exact:true}).click();
    await root.getByText(/Brecha de 20.0%/).waitFor();
    await root.getByLabel('Nota interna',{exact:true}).fill('Visita realizada y precio revisado con la propietaria.');
    await root.getByRole('button',{name:'Registrar nota',exact:true}).click();
    await root.getByRole('button',{name:'Avanzar a Negociación de mandato',exact:true}).click();
    await root.getByRole('heading',{name:'Tasación preliminar',exact:true}).scrollIntoViewIfNeeded();
    await page.screenshot({path:path.join(out,'captacion-escritorio.png')});
    await root.getByRole('button',{name:'Registrar mandato firmado',exact:true}).click();
    await root.getByLabel('Fecha de firma',{exact:true}).fill('2026-01-01');
    await root.getByLabel('Referencia del documento firmado',{exact:true}).fill('QA-MANDATO-001');
    await root.getByLabel('Confirmo que cuento con la evidencia de firma.').check();
    await root.getByRole('button',{name:'Revisar conversión',exact:true}).click();
    await root.getByRole('region',{name:'Revisión de conversión'}).waitFor();
    assert.equal(rows[0].data.outcome,undefined,'La revisión previa no convierte');
    await page.screenshot({path:path.join(out,'conversion-revision.png')});
    await root.getByRole('button',{name:'Confirmar y crear negocio',exact:true}).click();
    await root.getByText('Mandato registrado. Negocio y propietario vinculados.',{exact:true}).waitFor();
    await root.getByRole('button',{name:'Ver en Propietarios',exact:true}).click();
    await root.getByText('Propietario registrado: Ana Pérez',{exact:true}).waitFor();
    await root.getByRole('heading',{name:'Propietario registrado: Ana Pérez',exact:true}).scrollIntoViewIfNeeded();
    await page.screenshot({path:path.join(out,'captacion-convertida.png')});
    await page.setViewportSize({width:390,height:844});
    const closeMenu=page.locator('button').filter({hasText:'×'}).first();
    if(await closeMenu.isVisible())await closeMenu.click();
    await root.getByRole('heading',{name:'Propietario registrado: Ana Pérez',exact:true}).scrollIntoViewIfNeeded();
    await page.screenshot({path:path.join(out,'captacion-movil.png')});
    if(process.env.QA_DEBUG) console.log(await root.evaluate(el=>{const a=[];for(let n=el;n;n=n.parentElement){const r=n.getBoundingClientRect(),s=getComputedStyle(n);a.push({class:n.className,width:r.width,left:r.left,min:s.minWidth,grid:s.gridTemplateColumns,pad:s.padding});}return a;}));
    const overflow=await root.evaluate(el=>el.scrollWidth>el.clientWidth+2);
    assert.equal(overflow,false,'La captación no debe desbordarse horizontalmente');
    assert.equal(await root.evaluate(el=>el.getBoundingClientRect().right<=innerWidth+1),true,'La ficha debe caber en el viewport móvil');
    await page.evaluate(()=>{document.documentElement.dataset.theme='purple';document.documentElement.dataset.designSystem='dark';});
    await page.screenshot({path:path.join(out,'captacion-movil-oscuro.png')});
    await page.setViewportSize({width:1440,height:1050});
    await page.goto(`${frontendUrl}/realty?view=broker_os&tab=operations&operationId=qa-op`);
    const handoff=page.getByRole('region',{name:'Condiciones de origen del negocio'}).first();
    await handoff.waitFor();
    assert.match(await handoff.innerText(),/QA-MANDATO-001/);
    assert.match(await handoff.innerText(),/100.000.000 CLP/);
    await handoff.locator('summary').click();
    assert.match(await handoff.innerText(),/Visita realizada y precio revisado/);
    await handoff.scrollIntoViewIfNeeded();
    await page.screenshot({path:path.join(out,'conversion-en-negocios.png')});
    await handoff.getByRole('link',{name:'Ver captación de origen'}).click();
    await page.getByRole('link',{name:'Abrir negocio',exact:true}).waitFor();
    assert.deepEqual(errors,[],'No debe haber errores JavaScript');
    console.log('QA web: alta, etapas, tasación, brecha, nota, mandato, propietario y ancho móvil OK. API simulada; sin acceso a producción.');
  } finally { await browser.close(); }
})().catch(e=>{console.error(e);process.exitCode=1;});
