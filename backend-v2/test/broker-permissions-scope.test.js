/** Archivo: Verifica mediante pruebas automatizadas el comportamiento de broker permissions scope.test. */
import test from "node:test";
import assert from "node:assert/strict";
import { brokerRecordWhere, canBrokerAction, defaultBrokerBusinessRole, normalizeBrokerAccessProfile, loadBrokerAccessContext, validateBrokerAccessProfile, brokerAssigneeAllowed } from "../src/services/broker-access.service.js";
import { brokerGenericAccessMiddleware, brokerGenericWhere, brokerGenericRecordAllowed } from "../src/services/broker-record-access.service.js";

const access = (role = "CORREDOR", technicalRole = "SELLER") => ({ ...normalizeBrokerAccessProfile({ businessRole: role }), technicalRole, scopeUserIds: ["u1"], scopeTenantIds: ["t1"] });
const request = (overrides = {}) => ({ path: "/industry-records", method: "GET", tenantId: "t1", tenant: { industry: "REAL_ESTATE" }, user: { id: "u1", role: "SELLER" }, query: {}, body: {}, brokerAccess: access(), ...overrides });

// Evaluador mínimo de filtros Prisma para comprobar que la intersección no
// permite cruzar tenant, responsable o tipo; no sustituye una prueba PostgreSQL.
function matches(row, where) {
  return Object.entries(where).every(([key, value]) => {
    if (key === "AND") return (Array.isArray(value) ? value : [value]).every(w => matches(row, w));
    if (key === "OR") return value.some(w => matches(row, w));
    if (key === "NOT") return (Array.isArray(value) ? value : [value]).every(w => !matches(row, w));
    if (value && typeof value === "object") return Object.entries(value).every(([op, val]) => op === "in" ? val.includes(row[key]) : op === "notIn" ? !val.includes(row[key]) : op === "startsWith" ? String(row[key]).startsWith(val) : row[key] === val);
    return row[key] === value;
  });
}

for (const title of ["Gerente", "Finanzas", "Coordinador", "Administración", "CEO"]) {
  test(`El cargo editable ${title} no eleva permisos`, () => {
    assert.equal(defaultBrokerBusinessRole({ role: "SELLER", name: title, jobTitle: title }), "CORREDOR");
    assert.equal(defaultBrokerBusinessRole({ role: "VIEWER", name: title }), "LECTURA");
  });
}
test("Sin contexto o con rol desconocido no se concede acceso", () => {
  assert.equal(canBrokerAction(null, "operations", "VIEW"), false);
  assert.equal(canBrokerAction({ businessRole: "invalid", policy: { actions: { "*": ["APPROVE"] } } }, "financing", "APPROVE"), false);
  assert.deepEqual(brokerRecordWhere({ tenantId: "t1" }).assignedToId, { in: [] });
});
test("Un administrador con perfil restringido no evita la política", () => {
  assert.equal(canBrokerAction(access("CORREDOR", "ADMIN"), "financing", "APPROVE"), false);
  assert.equal(canBrokerAction(access("CORREDOR", "SUPER_ADMIN"), "financing", "APPROVE"), true);
  assert.equal(canBrokerAction(access("CEO", "VIEWER"), "operations", "EDIT"), false);
});
test("Tenant y responsable del filtro nunca amplían el alcance", () => {
  const req = request();
  const outside = { tenantId: "t2", assignedToId: "u2", recordType: "property" };
  assert.equal(matches(outside, brokerRecordWhere(req, { tenantId: "t2", assignedToId: "u2" })), false);
  assert.equal(matches({ ...outside, tenantId: "t1", assignedToId: "u1" }, brokerRecordWhere(req, { recordType: "property" })), true);
});
test("Holding permite consulta explícita, pero no escritura cruzada", () => {
  const req = request({ brokerAccess: { ...access("CEO"), scopeUserIds: null, scopeTenantIds: ["t1", "t2"] } });
  assert.equal(matches({ tenantId: "t2" }, brokerRecordWhere(req)), true);
  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) assert.equal(matches({ tenantId: "t2" }, brokerRecordWhere({ ...req, method })), false);
});
test("El listado genérico protege también consultas sin tipo", () => {
  const where = brokerGenericWhere(request());
  assert.equal(matches({ tenantId: "t1", assignedToId: "u1", recordType: "property" }, where), true);
  for (const row of [
    { tenantId: "t2", assignedToId: "u1", recordType: "property" },
    { tenantId: "t1", assignedToId: "u2", recordType: "property" },
    { tenantId: "t1", assignedToId: "u1", recordType: "broker_access_profile" },
    { tenantId: "t1", assignedToId: "u1", recordType: "operation_financing" },
  ]) assert.equal(matches(row, where), false);
  assert.equal(matches({ tenantId: "t1", recordType: "finance_invoice" }, where), true);
  assert.equal(matches({ tenantId: "t1", recordType: "property", assignedToId: "u1" }, brokerGenericWhere(request({ brokerAccess: null }))), false);
});
test("Perfiles internos no se editan por metadatos ni API genérica", () => {
  for (const action of ["VIEW", "CREATE", "EDIT", "DELETE"]) assert.equal(brokerGenericRecordAllowed(request({ brokerAccess: access("CEO") }), "broker_access_profile", action), false);
});
test("Validación rechaza roles, alcances y agrupaciones incompletas", () => {
  assert.ok(validateBrokerAccessProfile({ businessRole: "inventado", accessScope: "COMPANY" }));
  assert.ok(validateBrokerAccessProfile({ businessRole: "CORREDOR", accessScope: "TEAM" }));
  assert.ok(validateBrokerAccessProfile({ businessRole: "CORREDOR", accessScope: "BRANCH" }));
  assert.ok(validateBrokerAccessProfile({ businessRole: "CEO", accessScope: "COMPANY" }, { role: "VIEWER" }));
  assert.equal(validateBrokerAccessProfile({ businessRole: "CORREDOR", accessScope: "TEAM", teamKey: "ventas" }), null);
});
test("Equipo respeta sucursal, última versión y usuarios activos", async () => {
  const profiles = [
    { userId: "u1", businessRole: "COORDINADOR_COMERCIAL", accessScope: "TEAM", teamKey: "ventas", branchKey: "norte" },
    { userId: "u2", teamKey: "otro", branchKey: "norte" },
    { userId: "u2", teamKey: "ventas", branchKey: "norte" },
    { userId: "u3", teamKey: "ventas", branchKey: "sur" },
    { userId: "u4", teamKey: "ventas", branchKey: "norte" },
    { userId: "u5", teamKey: "ventas", branchKey: "norte" },
  ];
  const db = { industryRecord: { findMany: async () => profiles.map(data => ({ data })) }, workspaceUser: { findMany: async ({ where }) => where.id.in.filter(id => id !== "u5").map(id => ({ id })) } };
  const result = await loadBrokerAccessContext({ prisma: db, tenantId: "t1", user: { id: "u1", role: "AGENT" } });
  assert.deepEqual(result.scopeUserIds.sort(), ["u1", "u4"]);
  assert.equal(brokerAssigneeAllowed(result, "u3"), false);
});

async function guard(overrides, existing = null) {
  const req = request(overrides);
  const db = { industryRecord: {
    findMany: async () => [],
    findFirst: async ({ where }) => existing && matches(existing, where) ? existing : null,
  } };
  const result = { status: 200, next: false };
  const res = { status(code) { result.status = code; return this; }, json(body) { result.body = body; return this; } };
  await brokerGenericAccessMiddleware(db)(req, res, error => { if (error) throw error; result.next = true; });
  return { ...result, req };
}
test("API genérica impide leer o crear perfiles de permisos", async () => {
  assert.equal((await guard({ query: { type: "broker_access_profile" } })).status, 403);
  assert.equal((await guard({ method: "POST", body: { recordType: "broker_access_profile" } })).status, 403);
  assert.equal((await guard({ method: "POST", body: { recordType: "  BROKER ACCESS PROFILE  " } })).status, 403);
  assert.equal((await guard({ method: "GET", path: "/industry-records/", query: { type: "broker access profile" } })).status, 403);
  assert.equal((await guard({ method: "GET", path: "/INDUSTRY-RECORDS/", query: { type: "broker access profile" } })).status, 403);
  const trailingSlash = await guard({ method: "GET", path: "/industry-records/", brokerAccess: undefined });
  assert.equal(trailingSlash.next, true);
  assert.deepEqual(trailingSlash.req.brokerAccess.scopeUserIds, ["u1"]);
});
test("API genérica bloquea cambios al registro ajeno", async () => {
  const row = { id: "p2", tenantId: "t1", assignedToId: "u2", recordType: "property" };
  for (const path of ["/industry-records/p2", "/industry-records/p2/metadata"]) assert.equal((await guard({ path, method: "PATCH" }, row)).status, 404);
});
test("Crear asigna al autor y rechaza asignaciones arbitrarias", async () => {
  const valid = await guard({ method: "POST", body: { recordType: "property" } });
  assert.equal(valid.next, true);
  assert.equal(valid.req.body.assignedToId, "u1");
  assert.equal((await guard({ method: "POST", body: { recordType: "property", assignedToId: "u2" } })).status, 403);
  assert.equal((await guard({ method: "POST", body: { recordType: "property", data: { assignedBrokerId: "u2" } } })).status, 403);
});
test("El corredor no administra usuarios ni balancea carteras ajenas", async () => {
  assert.equal((await guard({ method: "POST", path: "/industry-records/brokers" })).status, 403);
  assert.equal((await guard({ method: "POST", path: "/industry-records/assignments/balance", body: { recordType: "property" } })).status, 403);
});
test("No se altera una escritura específica de Finance OS", async () => {
  assert.equal((await guard({ method: "POST", body: { recordType: "finance_invoice" }, tenant: { industry: "FINANCE" } })).next, true);
});
