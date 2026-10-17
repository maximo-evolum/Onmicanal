/** Archivo: Comprueba el comportamiento de interfaz o integración de broker journey.test. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const filename = path.resolve(__dirname, '../components/broker-journey.tsx');
const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
const compiled = new Module(filename, module);
compiled.filename = filename;
compiled.paths = Module._nodeModulePaths(path.dirname(filename));
const originalRequire = compiled.require.bind(compiled);
compiled.require = name => {
  if (name === '@/lib/api') return {}; // sin red ni autenticación en pruebas de presentación
  if (name.endsWith('.module.css')) return new Proxy({}, { get: (_target, key) => key === '__esModule' ? false : String(key) });
  return originalRequire(name);
};
compiled._compile(source, filename);
const { BrokerJourneySummary, BrokerPipelineView, BrokerConversionSummary } = compiled.exports;
const contract = import('../../backend-v2/src/services/broker-operation-contract.service.js');
test('el negocio conserva condiciones e historial de conversión sin simular firma legal',()=>{
  const operation={data:{conversion:{prospectId:'captacion-1',ownerName:'Ana Pérez',origin:'Referido',propertyTitle:'Casa Los Robles',address:'Los Robles 20',comuna:'Temuco',convertedAt:'2026-10-12T10:00:00Z',convertedBy:'u1',terms:{currency:'UF',publicationPrice:5200,commissionPct:2.5,exclusivityDays:90,signedAt:'2026-01-01',expiresAt:'2026-04-01',evidenceReference:'Mandato <script>alert(1)</script>'},captureHistory:[{at:'2026-01-01',action:'NOTA_REGISTRADA',note:'Propietaria confirmó condiciones',userId:'u1'}]}}};
  const html=renderToStaticMarkup(React.createElement(BrokerConversionSummary,{operation}));
  for(const text of ['Ana Pérez','UF','2.5','90 días','Propietaria confirmó condiciones','prospectId=captacion-1','no certifica una firma'])assert.ok(html.includes(text),text);
  assert.doesNotMatch(html,/<script>/);
  assert.equal(renderToStaticMarkup(React.createElement(BrokerConversionSummary,{operation:{data:{}}})), '');
});
async function markup(stage = 'PROMESA', type = 'SALE') {
  const { brokerOperationPayload, BROKER_JOURNEY_CATALOG: catalog } = await contract;
  const operation = brokerOperationPayload({ id: 'op-demo', data: { stage, operationType: type } });
  return renderToStaticMarkup(React.createElement(BrokerJourneySummary, { operation, catalog, tracker: true }));
}

test('negocio y Tracker muestran las etiquetas derivadas por el backend', async () => {
  const html = await markup();
  assert.match(html, /Cierre legal/);
  assert.match(html, /Negociación/);
  assert.match(html, /Promesa de compraventa/);
  assert.equal((html.match(/<li/g) || []).length, 9);
  assert.equal((html.match(/aria-current="step"/g) || []).length, 1);
  assert.match(html, /no acredita hitos anteriores ni firmas/);
  assert.doesNotMatch(html, /completado|firmado automáticamente/i);
});

test('estado histórico desconocido es una advertencia, no progreso falso', async () => {
  const html = await markup('ETAPA_ANTIGUA');
  assert.match(html, /role="alert"/);
  assert.match(html, /Requiere revisión/);
  assert.doesNotMatch(html, /aria-current="step"/);
});

test('el arriendo no presenta hitos jurídicos de venta', async () => {
  const html = await markup('CONTRATO', 'RENTAL');
  assert.match(html, /No aplica al flujo de venta/);
  assert.doesNotMatch(html, /<ol|Inscripción en el Conservador/);
});

test('la cancelación no marca ningún hito como activo', async () => {
  const html = await markup('CANCELADA');
  assert.match(html, /Finalizado/);
  assert.doesNotMatch(html, /aria-current="step"/);
});

test('contenido histórico se escapa antes de mostrarlo', async () => {
  const html = await markup('<script>alert(1)</script>');
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
});

test('el acceso a Pipeline ya no usa ni modifica la etapa de la propiedad', () => {
  const page = fs.readFileSync(path.resolve(__dirname, '../app/pipeline/page.tsx'), 'utf8');
  assert.match(page, /BrokerCanonicalPipeline/);
  assert.doesNotMatch(page, /updateIndustryRecord|RealtyPipelineBoard/);
  const properties = fs.readFileSync(path.resolve(__dirname, '../components/realty-workspace.tsx'), 'utf8');
  assert.doesNotMatch(properties, /onStageChange|function updateStage/);
  assert.match(properties, /Ver negocios de esta propiedad/);
});

test('Pipeline usa ocho columnas, enlaza el mismo ID y no ofrece un selector de etapa', async () => {
  const { brokerOperationPayload, BROKER_JOURNEY_CATALOG: catalog } = await contract;
  const operations = [brokerOperationPayload({ id: 'op-venta', title: 'Venta de prueba', data: { operationType: 'SALE', stage: 'PROMESA' } })];
  const html = renderToStaticMarkup(React.createElement(BrokerPipelineView, { operations, catalog, onRefresh() {} }));
  assert.equal((html.match(/class="column"/g) || []).length, 8);
  assert.match(html, /operationId=op-venta/);
  assert.match(html, /Negociación · 1/);
  assert.doesNotMatch(html, /<select/);
});

test('Pipeline separa carga y error sin presentar datos anteriores como actuales', () => {
  const loading = renderToStaticMarkup(React.createElement(BrokerPipelineView, { operations: [], loading: true, onRefresh() {} }));
  assert.match(loading, /Cargando operaciones/);
  assert.match(loading, /disabled/);
  const error = renderToStaticMarkup(React.createElement(BrokerPipelineView, { operations: [], error: 'Sin conexión de prueba', onRefresh() {} }));
  assert.match(error, /role="alert"/);
  assert.doesNotMatch(error, /operaciones cargadas/);
});

test('evidencia visual opcional se guarda fuera del proyecto', async () => {
  const output = process.env.BROKER_VISUAL_QA_DIR;
  if (!output) return;
  const root = path.resolve('E:/Entregables_EVOLUM_OS');
  const destination = path.resolve(output);
  assert.ok(destination.startsWith(root + path.sep), 'La evidencia debe quedar en Entregables_EVOLUM_OS');
  const { brokerOperationPayload, BROKER_JOURNEY_CATALOG: catalog } = await contract;
  const operation = brokerOperationPayload({ id: 'operacion-demostracion', title: 'Venta departamento Providencia', data: { operationType: 'SALE', stage: 'PROMESA' } });
  const render = element => renderToStaticMarkup(element);
  const body = render(React.createElement(BrokerJourneySummary, { operation, catalog, tracker: true })) + render(React.createElement(BrokerPipelineView, { operations: [operation], catalog, onRefresh() {} }));
  const css = fs.readFileSync(path.resolve(__dirname, '../components/broker-journey.module.css'), 'utf8');
  fs.mkdirSync(destination, { recursive: true });
  for (const theme of ['light', 'dark']) {
    fs.writeFileSync(path.join(destination, `etapas-${theme}.html`), `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>QA componentes Broker OS</title><style>body{margin:0;padding:20px;font:16px/1.5 system-ui;background:${theme === 'dark' ? '#181329' : '#f4f7f8'};color:${theme === 'dark' ? '#ede9fa' : '#202634'}}main{max-width:1100px;margin:auto;min-width:0}*{box-sizing:border-box}${css}</style><main><h1>Broker OS · Datos y etapas coherentes</h1><p>Prueba visual de componentes reales con datos sintéticos, sin conexión a producción.</p>${body}</main></html>`);
  }
});
