/** Archivo: Comprueba la integración web del workspace de propietarios Broker. */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const component = fs.readFileSync(path.resolve(__dirname, "../components/broker-owners-workspace.tsx"), "utf8");
const realtyPage = fs.readFileSync(path.resolve(__dirname, "../app/realty/page.tsx"), "utf8");
const sidebar = fs.readFileSync(path.resolve(__dirname, "../components/evolum-sidebar.tsx"), "utf8");

test("Propietarios usa el workspace protegido y no realiza contactos externos", () => {
  assert.match(component, /getBrokerOwners/);
  assert.match(component, /getBrokerOwnerWorkspace/);
  assert.match(component, /recordBrokerOwnerManagement/);
  assert.match(component, /no contacta al propietario/i);
  assert.doesNotMatch(component, /window\.open|mailto:|wa\.me|api\.whatsapp/i);
});

test("La ficha ofrece navegación contextual sin duplicar datos del expediente", () => {
  assert.match(component, />Propiedad</);
  assert.match(component, />Captación</);
  assert.match(component, />Operación \(/);
  assert.match(component, />Contrato \(/);
  assert.match(component, />Administración \(/);
  assert.match(component, /view=broker_os&tab=operations/);
  assert.match(component, /view=broker_os&tab=administration_preview/);
});

test("Propietarios queda disponible como vista y navegación de Broker OS", () => {
  assert.match(realtyPage, /owners:\s*\{ label: "Propietarios y cartera"/);
  assert.match(sidebar, /\["Propietarios", "\/realty\?view=owners"/);
  assert.match(sidebar, /view=owners/);
});
