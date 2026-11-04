/** Archivo: Comprueba que las vistas AI Ops y Case Management comuniquen límites y enlaces a fuentes reales. */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("AI Ops conserva la naturaleza explicable y de solo lectura", () => {
  const source = fs.readFileSync(path.resolve(__dirname, "../components/broker-ai-ops.tsx"), "utf8");
  assert.match(source, /Prioridades explicables, no acciones automáticas/);
  assert.match(source, /no acciones automáticas/);
  assert.match(source, /no ejecutan automatizaciones/);
  assert.match(source, /Motivo:/);
  assert.match(source, /Responsable/);
  assert.match(source, /Datos insuficientes/);
  assert.match(source, /getBrokerAiOps/);
});

test("Case Management referencia módulos reales y distingue inventario físico del comercial", () => {
  const source = fs.readFileSync(path.resolve(__dirname, "../components/broker-case-management.tsx"), "utf8");
  assert.match(source, /Inventario físico de entrega/);
  assert.match(source, /inventario comercial/);
  assert.match(source, /Operation Tracker/);
  assert.match(source, /\/realty\?view=broker_os&tab=commissions/);
  assert.match(source, /No crea registros, no replica documentos/);
});

test("las nuevas vistas respetan las áreas de acceso de Broker", () => {
  const source = fs.readFileSync(path.resolve(__dirname, "../lib/broker-access.ts"), "utf8");
  assert.match(source, /ai_ops: "ai"/);
  assert.match(source, /case_management: "overview"/);
});
