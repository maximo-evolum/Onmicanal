/** Archivo: Comprueba que la web conecte el Dashboard Ejecutivo y Tracker a contratos de Broker OS. */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const api = fs.readFileSync(path.resolve(__dirname, "../lib/api.ts"), "utf8");
const workspace = fs.readFileSync(path.resolve(__dirname, "../components/broker-operations-workspace.tsx"), "utf8");
const tracker = fs.readFileSync(path.resolve(__dirname, "../components/broker-operation-tracker.tsx"), "utf8");
const dashboard = fs.readFileSync(path.resolve(__dirname, "../components/broker-executive-dashboard.tsx"), "utf8");
const access = fs.readFileSync(path.resolve(__dirname, "../lib/broker-access.ts"), "utf8");

test("La web expone el tablero ejecutivo con forecast explícitamente potencial", () => {
  assert.match(api, /getBrokerExecutiveDashboard/);
  assert.match(api, /saveBrokerForecastAssumptions/);
  assert.match(api, /\/broker\/executive-dashboard/);
  assert.match(workspace, /Dashboard Ejecutivo/);
  assert.match(dashboard, /Forecast explicable/i);
  assert.match(access, /executive_dashboard/);
});

test("El Tracker consume la misma operación, contexto, documentos y controles previos al avance", () => {
  assert.match(api, /getBrokerOperationTracker/);
  assert.match(api, /updateBrokerOperationTrackerChecklist/);
  assert.match(api, /completeBrokerOperationTrackerStage/);
  assert.match(workspace, /Operation Tracker/);
  assert.match(tracker, /Responsable y riesgo/);
  assert.match(tracker, /Documentos asociados/);
  assert.match(tracker, /Completar hito y avanzar/);
  assert.match(tracker, /sin duplicar etapas/i);
  assert.match(access, /operation_tracker/);
});
