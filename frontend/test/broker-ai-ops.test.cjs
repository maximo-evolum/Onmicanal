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
  assert.match(source, /ai_governance: "ai"/);
  assert.match(source, /case_management: "overview"/);
});

test("Gobierno IA declara simulación sin envío y estados técnicos verificables", () => {
  const source = fs.readFileSync(path.resolve(__dirname, "../components/broker-ai-governance.tsx"), "utf8");
  assert.match(source, /Simular reglas sin envío/);
  assert.match(source, /No se creó una alerta, no se contactó a nadie y no se modificó ningún registro/);
  assert.match(source, /Los trece agentes sin promesas falsas/);
  assert.match(source, /Contacto externo bloqueado|contacto externo bloqueado/i);
  assert.match(source, /createBrokerAiGovernanceRule/);
  assert.match(source, /updateBrokerAiGovernanceRule/);
});
