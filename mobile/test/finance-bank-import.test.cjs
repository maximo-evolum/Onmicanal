const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../src/api/client.ts'), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function client(fetch) {
  const writes = [];
  const storage = { getItem: async () => JSON.stringify({ cached: true }), setItem: async (...args) => writes.push(args), removeItem: async () => {} };
  class NativeFormData { constructor() { this.parts = []; } append(...args) { this.parts.push(args); } }
  const sandbox = { exports: {}, process: { env: { EXPO_PUBLIC_API_BASE_URL: 'https://example.invalid/api' } }, fetch, AbortController, setTimeout, clearTimeout, FormData: NativeFormData,
    require: (name) => name.includes('async-storage') ? { __esModule: true, default: storage } : name.includes('secure-store') ? { getItemAsync: async () => 'test-token' } : {} };
  vm.runInNewContext(compiled, sandbox);
  return { api: sandbox.exports, writes };
}
test('envía el archivo original como multipart sin forzar cabecera JSON', async () => {
  let captured;
  const { api } = client(async (url, init) => { captured = { url, init }; return { ok: true, json: async () => ({ jobId: 'job', revision: 1 }) }; });
  const result = await api.previewMobileBankFile({ uri: 'file:///cartola.xlsx', name: 'cartola.xlsx', mimeType: 'application/test' });
  assert.equal(result.jobId, 'job');
  assert.match(captured.url, /bank-statements\/preview-file$/);
  assert.equal(captured.init.headers['Content-Type'], undefined);
  assert.equal(captured.init.headers.Authorization, 'Bearer test-token');
  assert.equal(captured.init.body.parts[0][1].uri, 'file:///cartola.xlsx');
});
test('factura móvil usa fecha explícita e identificador de reintento', async () => {
  let body;
  const { api } = client(async (_url, init) => { body = JSON.parse(init.body); return { ok: true, json: async () => ({ id: 'invoice' }) }; });
  await api.createMobileFinanceInvoice({ number: 'F-1', customer: 'Cliente', rut: '', amount: 100, issueDate: '2026-01-10', dueDate: '2026-02-10', idempotencyKey: 'invoice-operation-0001', expectedScope: { tenantId: 'tenant-a', userId: 'user-a' } });
  assert.equal(body.idempotencyKey, 'invoice-operation-0001'); assert.equal(body.data.issueDate, '2026-01-10'); assert.equal(body.data.balance, 100);
  assert.deepEqual(body.expectedScope, { tenantId: 'tenant-a', userId: 'user-a' });
});
test('factura móvil sin conexión no se encola ni devuelve éxito simulado', async () => {
  const { api, writes } = client(async () => { throw new Error('offline'); });
  await assert.rejects(api.createMobileFinanceInvoice({ number: 'F-1', idempotencyKey: 'invoice-operation-0001' }), /No se pudo conectar/);
  assert.equal(writes.length, 0);
});
test('confirmación envía solamente trabajo y revisión, nunca filas locales', async () => {
  let captured;
  const { api } = client(async (url, init) => { captured = init; return { ok: true, json: async () => ({ imported: 1248 }) }; });
  assert.equal((await api.confirmMobileBankImport('job', 3)).imported, 1248);
  assert.deepEqual(JSON.parse(captured.body), { jobId: 'job', revision: 3 });
});
test('revisión y recuperación no usan caché si falla la red', async () => {
  const { api } = client(async () => { throw new Error('offline'); });
  await assert.rejects(api.getMobileBankRows('job', 1, 2), /No se pudo conectar/);
  await assert.rejects(api.getMobileBankJobs(), /No se pudo conectar/);
  await assert.rejects(api.getMobileBankPreview('job'), /No se pudo conectar/);
});
test('una confirmación sin conexión no se guarda en cola ni aparenta éxito', async () => {
  const { api, writes } = client(async () => { throw new Error('offline'); });
  await assert.rejects(api.confirmMobileBankImport('job', 1), /No se pudo conectar/);
  assert.equal(writes.length, 0);
});
test('propaga el conflicto de revisión del servidor', async () => {
  const { api } = client(async () => ({ ok: false, status: 409, json: async () => ({ error: 'La revisión cambió' }) }));
  await assert.rejects(api.confirmMobileBankImport('job', 1), /La revisión cambió/);
});
test('las páginas de revisión conservan versión y no cortan la consulta a 300 filas', async () => {
  let url;
  const { api } = client(async (target) => { url = target; return { ok: true, json: async () => ({ page: 14, pages: 50, rows: [] }) }; });
  assert.equal((await api.getMobileBankRows('job', 7, 14)).page, 14);
  assert.match(url, /revision=7&page=14$/);
  const app = fs.readFileSync(path.join(__dirname, '../App.tsx'), 'utf8');
  assert.doesNotMatch(app, /rows\.slice\(0, 300\)/);
  assert.match(app, /<FinanceBankImport /);
});
