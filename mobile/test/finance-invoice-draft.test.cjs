const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const exportsObject = {};
const source = fs.readFileSync(path.join(__dirname, '../src/finance-invoice-draft.ts'), 'utf8');
vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports: exportsObject, console });
const { invoiceDraftRepository, newInvoiceDraft, invoiceDraftKey, invoicePayload } = exportsObject;
const scope = { tenantId: 'company-a', userId: 'user-a' };
function storage() { const data = new Map(); return { data, getItemAsync: async (key) => data.get(key) || null, setItemAsync: async (key, value) => { data.set(key, value); } }; }
function draft() { const value = newInvoiceDraft(scope); value.fields = { number: 'F-1', customer: 'Cliente de prueba', rut: '', amount: '100', issueDate: '2026-01-01', dueDate: '2026-02-01' }; return value; }
test('recupera contenido y clave tras reconstruir repositorio', async () => {
  const store = storage(), value = draft(); await invoiceDraftRepository(store).save(value);
  const loaded = await invoiceDraftRepository(store).load(scope);
  assert.equal(loaded.operationKey, value.operationKey); assert.equal(loaded.fields.customer, value.fields.customer);
});
test('no cruza usuario ni empresa al recuperar', async () => {
  const store = storage(), repo = invoiceDraftRepository(store); await repo.save(draft());
  for (const other of [{ ...scope, tenantId: 'company-b' }, { ...scope, userId: 'user-b' }]) assert.equal((await repo.load(other)).fields.number, '');
});
test('datos manipulados de otra cuenta se rechazan y conservan', async () => {
  const store = storage(), value = draft(); value.scope = { ...scope, userId: 'other' };
  const raw = JSON.stringify(value); store.data.set(invoiceDraftKey(scope), raw);
  await assert.rejects(invoiceDraftRepository(store).load(scope), /no corresponde/);
  assert.equal(store.data.get(invoiceDraftKey(scope)), raw);
});
test('borrador corrupto no se sustituye por uno vacío', async () => {
  const store = storage(); store.data.set(invoiceDraftKey(scope), '{broken');
  await assert.rejects(invoiceDraftRepository(store).load(scope), /conservó/);
  assert.equal(store.data.get(invoiceDraftKey(scope)), '{broken');
});
test('rechaza alcance ausente o ambiguo', () => {
  for (const bad of [{ tenantId: '', userId: 'a' }, { tenantId: 'a.b', userId: 'c' }]) assert.throws(() => invoiceDraftKey(bad));
});
test('confirmación pendiente conserva exactamente el payload y no crea otra clave', async () => {
  const store = storage(), value = draft(); value.phase = 'pending'; await invoiceDraftRepository(store).save(value);
  const recovered = await invoiceDraftRepository(store).load(scope);
  assert.equal(JSON.stringify(invoicePayload(recovered)), JSON.stringify(invoicePayload(value)));
  assert.equal(recovered.phase, 'pending');
});
test('escrituras rápidas se serializan y conserva la última edición', async () => {
  const store = storage(), repo = invoiceDraftRepository(store), value = draft();
  await Promise.all(['Uno', 'Dos', 'Tres'].map((customer) => repo.save({ ...value, fields: { ...value.fields, customer } })));
  assert.equal((await repo.load(scope)).fields.customer, 'Tres');
});
test('fallo de almacenamiento no se oculta y permite reintentar', async () => {
  const store = storage(); let failed = true; const base = store.setItemAsync;
  store.setItemAsync = async (...args) => { if (failed) throw new Error('storage full'); return base(...args); };
  const repo = invoiceDraftRepository(store); await assert.rejects(repo.save(draft()), /storage full/);
  failed = false; await repo.save(draft()); assert.equal((await repo.load(scope)).fields.number, 'F-1');
});
test('validación impide montos y fechas ambiguos', () => {
  for (const field of [{ amount: '1.000' }, { amount: '0' }, { dueDate: '2025-12-31' }, { issueDate: '2026-02-30' }]) { const value = draft(); Object.assign(value.fields, field); assert.throws(() => invoicePayload(value)); }
});
test('reemplazo tras confirmar limpia campos y cambia clave', async () => {
  const store = storage(), repo = invoiceDraftRepository(store), old = draft(); await repo.save(old); const fresh = newInvoiceDraft(scope); await repo.save(fresh);
  const loaded = await repo.load(scope); assert.equal(loaded.fields.number, ''); assert.notEqual(loaded.operationKey, old.operationKey);
});
test('componente persiste estado pendiente antes de enviar y usa almacén cifrado', () => {
  const component = fs.readFileSync(path.join(__dirname, '../src/components/FinanceInvoiceForm.tsx'), 'utf8');
  assert.match(component, /SecureStore\.setItemAsync/);
  assert.ok(component.indexOf('await repository.save(pending)') < component.indexOf('await createMobileFinanceInvoice(payload)'));
  assert.match(component, /draft.phase === "editing" &&/);
});
