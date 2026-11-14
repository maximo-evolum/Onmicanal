/** Archivo: Evita que el menú EV conserve módulos al cambiar de cuenta. */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const sidebar = fs.readFileSync(path.join(root, "components", "evolum-sidebar.tsx"), "utf8");
const auth = fs.readFileSync(path.join(root, "lib", "auth.tsx"), "utf8");
const moduleAccess = fs.readFileSync(path.join(root, "lib", "module-access.ts"), "utf8");

test("el cambio de sesión limpia el menú y valida el tenant antes de aplicar una respuesta", () => {
  for (const token of [
    'window.addEventListener("evolum-session-updated", refreshMenuForCurrentSession)',
    "setEnabledModules(null)",
    "setIndustry(null)",
    "setBrokerSessionKey(currentKey)",
    "data.user.id !== session.id",
    "data.user.tenantId || null",
    "menuSessionKeyRef.current === expectedSessionKey",
    "evolum-module-access-updated"
  ]) assert.equal(sidebar.includes(token), true, token);
  assert.equal(auth.includes('notifySessionUpdated();'), true);
});

test("un corredor estándar solo recibe módulos de operación Broker", () => {
  for (const moduleKey of ["realty_loads", "realty_activity", "realty_clients", "documents", "broker_portal"]) {
    assert.match(moduleAccess, new RegExp(`"${moduleKey}"`));
  }
  assert.match(moduleAccess, /isStandardBrokerAccount\(role, jobTitle, industry\) && !brokerModuleAllowlist\.has\(moduleKey\)/);
});

test("la sincronización de permisos no actualiza el menú durante otro render", () => {
  assert.match(moduleAccess, /const modulesRef = useRef<string\[\] \| null>\(null\)/);
  assert.doesNotMatch(moduleAccess, /setModules\(\(current\) => \{[\s\S]*?storeTenantAccess/);
  assert.match(moduleAccess, /modulesRef\.current = nextModules;\s*setModules\(nextModules\);[\s\S]*?storeTenantAccess/s);
});
