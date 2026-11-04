/** Archivo: Comprueba el contrato visible de Cuenta y equipo en Broker OS. */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const accessFile = path.join(root, "lib", "broker-access.ts");
const compiled = new Module(accessFile, module);
compiled._compile(ts.transpileModule(fs.readFileSync(accessFile, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, accessFile);
const { canBrokerTab } = compiled.exports;
const api = fs.readFileSync(path.join(root, "lib", "api.ts"), "utf8");
const panel = fs.readFileSync(path.join(root, "components", "broker-account-configuration.tsx"), "utf8");
const workspace = fs.readFileSync(path.join(root, "components", "broker-operations-workspace.tsx"), "utf8");

const admin = { technicalRole: "ADMIN", policy: { actions: { access: ["VIEW", "CONFIGURE"] } } };
const broker = { technicalRole: "AGENT", policy: { actions: { operations: ["VIEW"], commercial: ["VIEW"] } } };

test("Cuenta y equipo solo está disponible para quien configura accesos", () => {
  assert.equal(canBrokerTab(admin, "account"), true);
  assert.equal(canBrokerTab(broker, "account"), false);
});

test("La interfaz usa rutas auditables para perfiles, carga y baja segura", () => {
  for (const token of ["/broker/account", "/broker/access/workload", "/broker/access/profiles", "/broker/access/users/${encodeURIComponent(userId)}/status", "/broker/access/assignments/balanced"]) assert.match(api, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  for (const token of ["crear una configuración restrictiva", "Desactivar cuenta", "Asignar con carga balanceada", "Deshabilitar no borra", "externalReadiness"]) assert.match(panel, new RegExp(token, "i"));
  assert.match(workspace, /BrokerAccountConfigurationPanel/);
  assert.match(workspace, /\["account", "Cuenta y equipo"\]/);
});

test("Cuenta y equipo comunica carga, error recuperable y foco visible", () => {
  for (const token of ["aria-busy={loading || busy}", "broker-account-load-error", "Reintentar carga", "role=\"alert\"", "role=\"status\""]) {
    assert.match(panel, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  const styles = fs.readFileSync(path.join(root, "app", "globals.css"), "utf8");
  assert.match(styles, /\.broker-account-panel :is\(button,a,input,select,textarea,summary\):focus-visible/);
  assert.match(styles, /@media \(prefers-reduced-motion:reduce\)/);
});
