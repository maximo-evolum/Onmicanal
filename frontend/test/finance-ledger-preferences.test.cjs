const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const path = require('node:path');
const api = {};
const source = fs.readFileSync(path.join(__dirname, '../lib/finance-ledger-preferences.ts'), 'utf8');
vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports: api });
const { ledgerPreferenceKey, readLedgerPreferences, normalizeLedgerFilters, defaultColumns } = api;
test('claves separadas por usuario y empresa', () => {
  assert.notEqual(ledgerPreferenceKey('a','1'), ledgerPreferenceKey('a','2'));
  assert.notEqual(ledgerPreferenceKey('a','1'), ledgerPreferenceKey('b','1'));
  assert.notEqual(ledgerPreferenceKey('a:b','c'), ledgerPreferenceKey('a','b:c'));
  assert.throws(() => ledgerPreferenceKey('', '1'));
});
test('sin preferencias mantiene columnas originales', () => {
  assert.equal(JSON.stringify(readLedgerPreferences(null).columns), JSON.stringify(defaultColumns));
});
test('no permite introducir empresa cuenta o período desde un filtro guardado', () => {
  const filters = normalizeLedgerFilters({ tenantId:'other', accountKey:'other', period:'2020-01', search:'Cliente' });
  assert.equal(filters.search, 'Cliente');
  for (const key of ['tenantId','accountKey','period']) assert.equal(key in filters, false);
});
test('normaliza tipos estados orden y tamaño de página', () => {
  const filters = normalizeLedgerFilters({direction:'invalid',status:'invalid',sort:'invalid',pageSize:'9999'});
  assert.equal(filters.direction,'ALL'); assert.equal(filters.pageSize,'25'); assert.equal(filters.sort,'date_desc');
});
test('columnas desconocidas duplicadas y vacías no rompen tabla', () => {
  const a = readLedgerPreferences(JSON.stringify({version:1, columns:['amount','amount','secret'], saved:[]}));
  assert.equal(JSON.stringify(a.columns), '["amount"]');
  assert.ok(readLedgerPreferences(JSON.stringify({version:1,columns:[],saved:[]})).columns.length > 0);
});
test('limita nombres cantidad y búsquedas recuperadas', () => {
  const value = {version:1,columns:['date'],saved:Array.from({length:30}, () => ({name:'x'.repeat(100),filters:{search:'z'.repeat(1000)}}))};
  const result = readLedgerPreferences(JSON.stringify(value));
  assert.equal(result.saved.length,20); assert.equal(result.saved[0].name.length,60); assert.equal(result.saved[0].filters.search.length,200);
});
test('corrupción y versión incompatible producen error explícito', () => {
  assert.throws(() => readLedgerPreferences('{broken'));
  assert.throws(() => readLedgerPreferences('{"version":2}'));
});
test('ida y vuelta conserva el filtro y selección de columnas', () => {
  const value = {version:1,columns:['date','amount','sourceFile'],saved:[{name:'Pendientes',filters:normalizeLedgerFilters({status:'PENDING',min:'1000'})}]};
  assert.equal(JSON.stringify(readLedgerPreferences(JSON.stringify(value))),JSON.stringify(value));
});

test('filtros antiguos conservan vista normal y fechas sin inventar ámbito', () => {
  const old = normalizeLedgerFilters({from:'2025-01-01',to:'2025-01-31'});
  assert.equal(old.dateScope,'PERIOD'); assert.equal(old.from,'2025-01-01');
  assert.equal(normalizeLedgerFilters({dateScope:'invalid'}).dateScope,'PERIOD');
});
test('vista sin fecha se guarda y limpia rangos incompatibles', () => {
  const filters = normalizeLedgerFilters({dateScope:'UNDATED',from:'2025-01-01',to:'2025-01-31',status:'REVIEW'});
  assert.equal(filters.dateScope,'UNDATED'); assert.equal(filters.from,''); assert.equal(filters.to,''); assert.equal(filters.status,'REVIEW');
  const stored = readLedgerPreferences(JSON.stringify({version:1,columns:['date'],saved:[{name:'Sin fecha',filters}]}));
  assert.equal(stored.saved[0].filters.dateScope,'UNDATED');
});

test('filtros especializados se guardan sin romper preferencias anteriores', () => {
  assert.equal(normalizeLedgerFilters({}).confidence, 'ALL');
  const filters = normalizeLedgerFilters({importRevision:'0',confidence:'HIGH'});
  const stored = readLedgerPreferences(JSON.stringify({version:1,columns:['importRevision','confidenceLabel'],saved:[{name:'Revisión inicial',filters}]}));
  assert.equal(stored.saved[0].filters.importRevision,'0'); assert.equal(stored.saved[0].filters.confidence,'HIGH');
  const invalid = normalizeLedgerFilters({importRevision:'-1',confidence:'99'});
  assert.equal(invalid.importRevision,''); assert.equal(invalid.confidence,'ALL');
});
test('responsable se conserva separado del contexto de empresa', () => {
  assert.equal(normalizeLedgerFilters({owner:'NONE'}).owner,'NONE');
  const filters = normalizeLedgerFilters({owner:'agent',tenantId:'otra'});
  assert.equal(filters.owner,'agent'); assert.equal('tenantId' in filters,false);
});
