/** Archivo: Comprueba la presentación del contrato único de lectura operativa Broker. */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");

const filename = path.resolve(__dirname, "../components/broker-operational-summary.tsx");
const source = ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
const compiled = new Module(filename, module);
compiled.filename = filename;
compiled.paths = Module._nodeModulePaths(path.dirname(filename));
const originalRequire = compiled.require.bind(compiled);
compiled.require = name => {
  if (name === "@/lib/api") return {};
  if (name === "next/link") return ({ href, children, ...props }) => React.createElement("a", { href, ...props }, children);
  return originalRequire(name);
};
compiled._compile(source, filename);
const { BrokerOperationalSummary } = compiled.exports;

test("el resumen Broker muestra métricas y prioridades del contrato único", () => {
  const model = {
    version: "BROKER_OPERATIONAL_READ_MODEL_V1",
    generatedAt: "2026-10-28T12:00:00.000Z",
    kpis: { properties: 2, activeOperations: 1, scheduledVisits: 0, openAlerts: 1, activeRentals: 0, openMaintenance: 0, openPostSale: 0, activeFinancing: 0 },
    reporting: { portfolioValue: 150000000, projectedCommission: 3000000, propertyCompleteness: 50, portfolioHealth: 70, propertiesReady: 1, byOperationType: [], aiEvaluations: { total: 0, confirmed: 0, needsAdjustment: 0, pending: 0 } },
    pipeline: { total: 2, active: 1, terminal: 1, byStage: { "SALE:EVALUACION_COMERCIAL": 1 } },
    priorities: [{ id: "property-1-completion", priority: "HIGH", area: "commercial", title: "Completar ficha", detail: "Falta foto principal.", propertyId: "property-1", impact: "PUBLICACION_Y_MATCHING", requiresApproval: false }]
  };
  const html = renderToStaticMarkup(React.createElement(BrokerOperationalSummary, { model }));
  assert.match(html, /Lectura operativa única/);
  assert.match(html, /150\.000/);
  assert.match(html, /Completar ficha/);
  assert.match(html, /propertyId=property-1/);
  assert.match(html, /no pago ejecutado/i);
});
