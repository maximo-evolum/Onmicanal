/** Archivo: Comprueba el comportamiento de interfaz o integración de finance usability.test. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
function load(relative) {
  const filename = path.resolve(__dirname, '..', relative);
  const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const module = new Module(filename, moduleParent);
  module.filename = filename; module.paths = Module._nodeModulePaths(path.dirname(filename));
  const original = module.require.bind(module);
  module.require = name => name.endsWith('.module.css') ? new Proxy({}, { get: (_target, key) => key === '__esModule' ? false : String(key) }) : original(name);
  module._compile(source, filename); return module.exports;
}
const moduleParent = module;
const { canIncorporateSelectedImports: canImport, filterLoadedImports } = load('lib/finance-import-presentation.ts');
const { FinanceFeedback, FinanceLoading } = load('components/finance-feedback.tsx');
const { FinanceImportStatus } = load('components/finance-import-status.tsx');
const ready = () => ({ selected: true, account: { bankKey: 'santander_chile' }, preview: {} });
test('incorporar exige selección válida, no basta con tener una revisión en pantalla', () => {
  assert.equal(canImport([]), false); assert.equal(canImport([{ ...ready(), selected: false }]), false);
  assert.equal(canImport([ready()]), true);
  for (const item of [{ ...ready(), reviewDirty: true }, { ...ready(), account: {} }, { ...ready(), preview: { duplicate: { blocked: true } } }, { ...ready(), preview: { periodProtection: { blocked: true } } }]) assert.equal(canImport([item]), false);
  assert.equal(canImport([ready(), { ...ready(), reviewDirty: true }]), false);
  assert.equal(canImport([ready(), { ...ready(), selected: false, reviewDirty: true }]), true);
});
test('búsqueda y filtro combinan nombre y estado sin modificar los datos', () => {
  const rows = [{ sourceFile: 'Cartola Enero.xlsx', status: 'READY' }, { sourceFile: 'Cartola febrero.xlsx', status: 'FAILED' }];
  assert.deepEqual(filterLoadedImports(rows, ' ENERO ', 'READY'), [rows[0]]);
  assert.deepEqual(filterLoadedImports(rows, 'enero', 'FAILED'), []);
  assert.equal(filterLoadedImports(rows, '', 'ALL').length, 2); assert.equal(rows.length, 2);
});
test('errores se anuncian como alertas y no como éxito', () => {
  const html = renderToStaticMarkup(React.createElement(FinanceFeedback, { message: 'Error de prueba', kind: 'error', onDismiss() {} }));
  assert.match(html, /role="alert"/); assert.match(html, /No se pudo completar/); assert.match(html, /aria-label="Cerrar mensaje"/); assert.doesNotMatch(html, /Operación completada/);
  const info = renderToStaticMarkup(React.createElement(FinanceFeedback, { message: 'Original guardado' }));
  assert.match(info, /role="status"/); assert.doesNotMatch(info, /role="alert"/);
});
test('mensajes externos se muestran como texto y carga no inventa un porcentaje', () => {
  const html = renderToStaticMarkup(React.createElement(FinanceFeedback, { message: '<img src=x onerror=alert(1)>' }));
  assert.doesNotMatch(html, /<img/); assert.match(html, /&lt;img/);
  const loading = renderToStaticMarkup(React.createElement(FinanceLoading));
  assert.match(loading, /role="status"/); assert.doesNotMatch(loading, /aria-valuenow/);
});
test('todos los estados de importación tienen nombre comprensible y próximo paso', () => {
  const states = { RECEIVED: 'En cola', PROCESSING: 'Analizando', READY: 'Lista para revisar', FAILED: 'Necesita atención', IMPORTED: 'Incorporada', CANCELLED: 'Cancelada' };
  for (const [status, label] of Object.entries(states)) {
    const html = renderToStaticMarkup(React.createElement(FinanceImportStatus, { job: { status, revision: 1, attempts: 1, updatedAt: '2026-10-04T12:00:00Z' } }));
    assert.ok(html.includes(label)); assert.match(html, /Última actualización/); assert.doesNotMatch(html, /Invalid Date/);
  }
  const readyHtml = renderToStaticMarkup(React.createElement(FinanceImportStatus, { job: { status: 'READY', revision: 1, updatedAt: 'invalid' } }));
  assert.match(readyHtml, /Todavía no se han incorporado/); assert.match(readyHtml, /Fecha no disponible/);
});
