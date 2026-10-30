/** Archivo: Verifica la integración web del registro documental consolidado de Broker OS. */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const api = fs.readFileSync(path.resolve(__dirname, "../lib/api.ts"), "utf8");
const indexComponent = fs.readFileSync(path.resolve(__dirname, "../components/broker-document-index.tsx"), "utf8");
const workspace = fs.readFileSync(path.resolve(__dirname, "../components/broker-operations-workspace.tsx"), "utf8");

test("El registro documental consulta un índice derivado y conserva sus filtros", () => {
  assert.match(api, /export function getBrokerDocumentIndex/);
  assert.match(api, /\/broker\/documents\/index/);
  assert.match(indexComponent, /Aplicar filtros/);
  assert.match(indexComponent, /Propiedad/);
  assert.match(indexComponent, /Persona/);
  assert.match(indexComponent, /Vencimiento/);
});

test("La vista documental declara sus límites y permite volver al registro de origen", () => {
  assert.match(indexComponent, /sin duplicar archivos ni cambiar una operación/i);
  assert.match(indexComponent, /firma electrónica externa/i);
  assert.match(indexComponent, /Abrir registro de origen/);
  assert.match(workspace, /BrokerDocumentIndexPanel/);
  assert.match(workspace, /getBrokerDocumentIndex/);
  assert.match(workspace, /broker-record-\$\{requestedRecordId\}/);
  assert.match(workspace, /scrollIntoView/);
});
