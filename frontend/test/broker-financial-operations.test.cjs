/** Archivo: Comprueba que la interfaz de finanzas operativas de Broker OS use rutas y límites consistentes. */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const api = fs.readFileSync(path.resolve(__dirname, "../lib/api.ts"), "utf8");
const workspace = fs.readFileSync(path.resolve(__dirname, "../components/broker-operations-workspace.tsx"), "utf8");
const access = fs.readFileSync(path.resolve(__dirname, "../lib/broker-access.ts"), "utf8");

test("La web consulta la cola financiera derivada y expone solo acciones internas", () => {
  assert.match(api, /export function getBrokerFinancialOperations/);
  assert.match(api, /\/broker\/finance\/operations/);
  assert.match(api, /actBrokerFinancialCollection/);
  assert.match(workspace, /Finanzas operativas/);
  assert.match(workspace, /Preparar recordatorio/);
  assert.match(workspace, /Registrar pago informado/);
  assert.match(workspace, /No envía recordatorios, cobra, transfiere dinero ni emite documentos tributarios/);
});

test("La vista conserva el origen y separa revisión de pago informado", () => {
  assert.match(workspace, /Abrir origen/);
  assert.match(workspace, /Requiere revisión humana antes de declararlo pagado/);
  assert.match(workspace, /Vencimientos a 60 días/);
  assert.match(workspace, /Liquidación por corredor/);
  assert.match(workspace, /Vista simulada de arrendatario/);
  assert.match(workspace, /misma fuente y estados que Administración/i);
  assert.match(access, /canBrokerFinance/);
  assert.match(access, /financial_operations/);
});
