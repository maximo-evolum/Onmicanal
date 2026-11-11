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

test("CRM, Dashboard y Pipeline comparten la jerarquía visual de Modelo A", () => {
  const dashboard = source("app/dashboard/page.tsx");
  const crm = source("app/crm-principal/page.tsx");
  const pipeline = source("app/pipeline/page.tsx");
  const css = source("app/globals.css");

  assert.match(dashboard, /executive-topbar executive-dashboard-header model-a-page-header/);
  assert.match(dashboard, /executive-kpi-grid model-a-executive-kpis/);
  assert.match(crm, /crm-main-header model-a-page-header/);
  assert.match(pipeline, /pipeline-pro-topbar pipeline-pro-header-main model-a-page-header/);
  assert.match(pipeline, /pipeline-month-summary model-a-executive-kpis/);
  assert.match(css, /MODELO A · aplicación transversal a CRM, Core y módulos operativos/);
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

test("Broker usa un único menú EV y el rail cerrado no conserva la burbuja antigua", () => {
  const sidebar = source("components/evolum-sidebar.tsx");
  const chrome = source("components/evolum-workspace-chrome.tsx");
  const broker = source("components/broker-operations-workspace.tsx");
  const css = source("app/globals.css");

  assert.match(sidebar, /view=broker_os&tab=operations/);
  assert.match(sidebar, /if \(!navigationOpen\) return <>\{workspaceChrome\}<\/>/);
  assert.doesNotMatch(sidebar, /className="evolum-menu-bubble"/);
  assert.doesNotMatch(sidebar, /className="inbox-nav-toggle"/);
  assert.doesNotMatch(sidebar, /Espacio activo/);
  assert.doesNotMatch(chrome, /evolum-workspace-context-tabs/);
  assert.doesNotMatch(chrome, /evolum-workspace-module-select/);
  assert.doesNotMatch(broker, /broker-os-tabs/);
  assert.match(broker, /broker-kpis model-a-executive-kpis/);
  assert.match(broker, /broker-command-center/);
  assert.match(broker, /operationCaptureOpen/);
  assert.match(broker, /broker-operation-capture/);
  assert.match(broker, /broker-operations-support/);
  assert.match(broker, /brokerRecommendationHref/);
  assert.match(css, /\.module-with-menu-shell,/);
  assert.match(css, /\.crm-main\.nav-collapsed \.crm-main-workspace/);
  assert.match(css, /\.evolum-workspace-chrome\.is-menu-collapsed/);
  assert.match(css, /\.crm-main\s*\)\s*>\s*\.evolum-workspace-chrome\.is-menu-open/);
});

test("el inicio no ofrece accesos de configuración que la cuenta no puede abrir", () => {
  const crm = source("app/crm-principal/page.tsx");
  assert.match(crm, /const canConfigureAgent = state\.modulesLoaded && moduleAllowed\(/);
  assert.match(crm, /const canManageConnections = state\.modulesLoaded && moduleAllowed\(/);
  assert.match(crm, /canManageConnections && integrationAccessItems\.length \? <section className="crm-main-panel crm-main-connections"/);
  assert.match(crm, /href="\/connections">Gestionar conexiones<\/Link>/);
  assert.match(crm, /canConfigureAgent \? <section className="crm-main-panel crm-main-knowledge"/);
});
