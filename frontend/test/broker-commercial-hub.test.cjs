/** Archivo: Comprueba que la web de Broker OS consuma el centro de Marketing, Agenda e Inbox de forma segura. */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const api = fs.readFileSync(path.resolve(__dirname, "../lib/api.ts"), "utf8");
const workspace = fs.readFileSync(path.resolve(__dirname, "../components/broker-operations-workspace.tsx"), "utf8");
const access = fs.readFileSync(path.resolve(__dirname, "../lib/broker-access.ts"), "utf8");
const composer = fs.readFileSync(path.resolve(__dirname, "../components/composer.tsx"), "utf8");

test("La web consulta el centro comercial y expone las operaciones Broker necesarias", () => {
  assert.match(api, /export function getBrokerCommercialHub/);
  assert.match(api, /\/broker\/commercial-hub/);
  assert.match(api, /createBrokerMarketingPrediction/);
  assert.match(api, /createBrokerAgendaItem/);
  assert.match(api, /actBrokerAgendaItem/);
  assert.match(api, /actBrokerChat/);
  assert.match(workspace, /Marketing, agenda y chats/);
});

test("La interfaz aclara los límites humanos y conserva la trazabilidad de Inbox", () => {
  assert.match(workspace, /Requiere revisión humana/i);
  assert.match(workspace, /no envían mensajes/i);
  assert.match(workspace, /Vincular o convertir/i);
  assert.match(workspace, /Crear comprador/i);
  assert.match(workspace, /Preparar captación/i);
  assert.match(access, /canBrokerCommercialHub/);
  assert.match(access, /commercial_hub/);
  assert.match(composer, /Usar como borrador/);
  assert.match(composer, /revísala y edítala antes de enviarla/i);
});
