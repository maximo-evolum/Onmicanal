/** Archivo: Protege la aplicación transversal del formato ejecutivo Modelo A. */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = (relativePath) => fs.readFileSync(path.resolve(__dirname, "..", relativePath), "utf8");

test("el layout global mantiene Modelo A como formato compartido", () => {
  const layout = source("app/layout.tsx");
  assert.match(layout, /data-ui-layout="model-a"/);
});

test("las pantallas que eran excepciones usan puntos de extensión semánticos", () => {
  assert.match(source("app/finance/page.tsx"), /finance-header model-a-page-header/);
  assert.match(source("app/onboarding/page.tsx"), /onboarding-pro-hero model-a-page-header/);
  assert.match(source("app/onboarding/page.tsx"), /onboarding-status-panel model-a-executive-kpis/);
  assert.match(source("app/shifts/page.tsx"), /shifts-hero model-a-page-header/);
  assert.match(source("components/inbox-shell.tsx"), /inbox-app-header model-a-page-header/);
  assert.match(source("components/data-management-workspace.tsx"), /data-management-workspace model-a-data-workspace/);
});

test("Modelo A ordena contexto, captura, registros e Inbox en tema claro y oscuro", () => {
  const css = source("app/globals.css");
  assert.match(css, /PRIORIDAD ALTA · FORMATO MODELO A/);
  assert.match(css, /\.finance-product-workspace \.finance-context-controls/);
  assert.match(css, /\.onboarding-status-panel\.model-a-executive-kpis/);
  assert.match(css, /\.model-a-data-workspace \.data-records-panel/);
  assert.match(css, /\.inbox-app-header\.model-a-page-header/);
  assert.match(css, /\[data-ui-layout="model-a"\]\[data-design-system="dark"\]/);
  assert.match(css, /@media \(max-width: 700px\)/);
});
