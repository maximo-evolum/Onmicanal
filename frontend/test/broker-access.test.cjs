/** Archivo: Comprueba el comportamiento de interfaz o integración de broker access.test. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const filename = path.resolve(__dirname, '../lib/broker-access.ts');
const compiled = new Module(filename, module);
compiled._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, filename);
const { canBroker, canBrokerTab, canBrokerLink } = compiled.exports;
const context = { technicalRole: 'SELLER', policy: { actions: { operations: ['VIEW', 'CREATE', 'EDIT'], commercial: ['VIEW', 'CREATE', 'EDIT'], overview: ['VIEW'], documents: ['VIEW'], ai: ['VIEW'] } } };
test('La web cierra permisos mientras se carga el perfil', () => {
  assert.equal(canBroker(null, 'operations'), false);
  assert.equal(canBrokerLink(null, '/realty?view=broker_os'), false);
});
test('No muestra rutas de administración a un corredor', () => {
  assert.equal(canBrokerLink(context, '/realty?view=brokers'), false);
  assert.equal(canBrokerLink(context, '/realty?view=buyers'), true);
  assert.equal(canBrokerTab(context, 'access'), false);
  assert.equal(canBrokerTab(context, 'configuration'), false);
  assert.equal(canBrokerTab(context, 'financing'), false);
});
test('Los parámetros de subárea no evitan los permisos', () => {
  assert.equal(canBrokerLink(context, '/realty?view=broker_os&area=financing'), false);
  assert.equal(canBrokerLink(context, '/realty?view=broker_os&tab=access'), false);
  assert.equal(canBrokerLink(context, '/realty?view=broker_os&area=documents'), true);
});
test('Admin restringido y solo lectura no reciben escritura adicional', () => {
  assert.equal(canBroker({ ...context, technicalRole: 'ADMIN' }, 'access', 'CONFIGURE'), false);
  assert.equal(canBroker({ ...context, technicalRole: 'VIEWER' }, 'operations', 'EDIT'), false);
  assert.equal(canBroker({ ...context, technicalRole: 'SUPER_ADMIN' }, 'access', 'CONFIGURE'), true);
});
test('No afecta al menú de otras verticales ni del CRM', () => {
  for (const href of ['/finance', '/inbox', '/connections']) assert.equal(canBrokerLink(null, href), true);
});
test('Las decisiones de la web coinciden con todas las políticas backend', async () => {
  const api = await import('../../backend-v2/src/services/broker-access.service.js');
  for (const businessRole of api.BROKER_BUSINESS_ROLES) {
    for (const technicalRole of ['AGENT', 'ADMIN', 'VIEWER', 'SUPER_ADMIN']) {
      const access = { ...api.normalizeBrokerAccessProfile({ businessRole }, { role: technicalRole }), technicalRole };
      for (const area of ['operations', 'commercial', 'documents', 'financing', 'access', 'configuration', 'ai']) {
        for (const action of api.BROKER_ACCESS_ACTIONS) assert.equal(canBroker(access, area, action), api.canBrokerAction(access, area, action), `${businessRole}/${technicalRole}/${area}/${action}`);
      }
    }
  }
});
