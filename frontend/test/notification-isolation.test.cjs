/** Archivo: Evita que el cliente vuelva a mostrar avisos de otra vertical. */
const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");

const root = join(__dirname, "..");

test("el centro de notificaciones aplica una defensa visual para Finanzas en Broker OS", () => {
  const source = readFileSync(join(root, "components", "notification-center.tsx"), "utf8");

  assert.match(source, /function visibleInCurrentVertical/);
  assert.equal(source.includes('target.startsWith("/finance")'), true);
  assert.match(source, /nubox\|finanza\|cartola\|conciliaci/);
  assert.match(source, /\.filter\(visibleInCurrentVertical\)/);
});

test("el contrato del cliente recibe el alcance calculado por el servidor", () => {
  const source = readFileSync(join(root, "lib", "api.ts"), "utf8");
  assert.match(source, /scope\?: string \| null/);
});
