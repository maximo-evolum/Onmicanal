/** Archivo: Comprueba que la interfaz de matching use acciones internas y explique sus límites. */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const component = fs.readFileSync(path.resolve(__dirname, "../components/realty-workspace.tsx"), "utf8");
const api = fs.readFileSync(path.resolve(__dirname, "../lib/api.ts"), "utf8");

test("Compradores consulta coincidencias, muestra advertencias y registra solo decisiones internas", () => {
  assert.match(component, /getRealtyLeadMatches/);
  assert.match(component, /getBrokerMatchActions/);
  assert.match(component, /createBrokerMatchAction/);
  assert.match(component, /Preparar ficha/);
  assert.match(component, /Solicitar visita/);
  assert.match(component, /Descartar coincidencia/);
  assert.match(component, /No se ejecutó contacto externo ni visita confirmada/);
  assert.doesNotMatch(component, /window\.open|mailto:|wa\.me|api\.whatsapp/i);
});

test("Inventario consume alertas calculadas y la API conserva sus contratos tipados", () => {
  assert.match(component, /inventory\.alerts/);
  assert.match(component, /Alertas de inventario/);
  assert.match(api, /export type RealtyMatchCompatibility/);
  assert.match(api, /externalContactExecuted: false/);
  assert.match(api, /visitConfirmed: false/);
});
