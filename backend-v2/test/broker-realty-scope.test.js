/** Archivo: Verifica mediante pruebas automatizadas el comportamiento de broker realty scope.test. */
import test from "node:test";
import assert from "node:assert/strict";
import { getRealtyIntelligence, getRealtyLeadMatches, getRealtyPropertyMatches, realtyLeadScope } from "../src/services/realty-intelligence.service.js";
import { normalizeBrokerAccessProfile } from "../src/services/broker-access.service.js";
const access = { ...normalizeBrokerAccessProfile({ businessRole: "CORREDOR" }), scopeUserIds: ["u1"], scopeTenantIds: ["t1"] };
function fakeDb() { return Object.fromEntries(["industryRecord", "lead", "workspaceUser", "campaign"].map(model => [model, { findFirst: async () => null, findMany: async () => [] }])); }

test("Matching consulta solo propiedad y compradores dentro del alcance", async t => {
  const prisma = fakeDb();
  const calls = [];
  t.mock.method(prisma.industryRecord, "findFirst", async args => { calls.push(["property", args]); return null; });
  t.mock.method(prisma.lead, "findMany", async args => { calls.push(["leads", args]); return []; });
  const result = await getRealtyPropertyMatches({ tenantId: "t1", access, propertyId: "p2", db: prisma });
  assert.equal(result, null);
  assert.deepEqual(calls[0][1].where.assignedToId, { in: ["u1"] });
  assert.equal(calls[0][1].where.tenantId, "t1");
  assert.deepEqual(calls[1][1].where.AND[0], { tenantId: "t1", conversation: { assignedToId: { in: ["u1"] }, tenantId: "t1" } });
});
test("Matching inverso no permite un comprador ajeno", async t => {
  const prisma = fakeDb();
  t.mock.method(prisma.lead, "findFirst", async args => { assert.deepEqual(args.where, realtyLeadScope("t1", access, { id: "l2" })); return null; });
  t.mock.method(prisma.industryRecord, "findMany", async args => { assert.deepEqual(args.where.assignedToId, { in: ["u1"] }); return []; });
  assert.equal(await getRealtyLeadMatches({ tenantId: "t1", access, leadId: "l2", db: prisma }), null);
});
test("Indicadores se calculan sobre registros filtrados, no toda la empresa", async t => {
  const prisma = fakeDb();
  t.mock.method(prisma.industryRecord, "findMany", async args => { assert.deepEqual(args.where.assignedToId, { in: ["u1"] }); return []; });
  t.mock.method(prisma.workspaceUser, "findMany", async args => { assert.deepEqual(args.where.id, { in: ["u1"] }); return []; });
  t.mock.method(prisma.lead, "findMany", async args => { assert.equal(args.where.AND[0].tenantId, "t1"); return []; });
  t.mock.method(prisma.campaign, "findMany", async () => { throw new Error("No debe consultar campañas globales"); });
  const result = await getRealtyIntelligence({ tenantId: "t1", access, db: prisma });
  assert.equal(result.inventory.total, 0);
  assert.equal(result.marketing.campaigns, 0);
});
test("Sin perfil los compradores no quedan expuestos", () => {
  assert.deepEqual(realtyLeadScope("t1", null).AND[0].conversation.assignedToId, { in: [] });
});
