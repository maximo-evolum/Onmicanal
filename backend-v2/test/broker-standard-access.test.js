/** Archivo: Verifica la provisión segura del perfil estándar para corredores. */
import test from "node:test";
import assert from "node:assert/strict";
import {
  ensureStandardBrokerAccessForTenant,
  ensureStandardBrokerAccessProfile,
  isStandardBrokerAccount,
  standardBrokerAccessProfileData
} from "../src/services/broker-standard-access.service.js";

function createDb({ users = [], profiles = [] } = {}) {
  const rows = [...profiles];
  return {
    rows,
    workspaceUser: {
      async findMany() { return users; }
    },
    industryRecord: {
      async findFirst({ where }) {
        return rows.find((row) => row.tenantId === where.tenantId
          && row.recordType === where.recordType
          && row.status === where.status
          && String(row.data?.userId || "") === String(where.data?.equals || "")) || null;
      },
      async findMany() { return rows; },
      async create({ data }) {
        const row = { id: `profile-${rows.length + 1}`, ...data };
        rows.push(row);
        return row;
      }
    }
  };
}

test("solo un corredor de Broker OS recibe el perfil estándar", () => {
  assert.equal(isStandardBrokerAccount({ industry: "Inmobiliaria", user: { role: "SELLER" } }), true);
  assert.equal(isStandardBrokerAccount({ industry: "REAL_ESTATE", user: { role: "AGENT", jobTitle: "Corredor asociado" } }), true);
  assert.equal(isStandardBrokerAccount({ industry: "FINANCE", user: { role: "SELLER", jobTitle: "Ejecutivo" } }), false);
  assert.deepEqual(standardBrokerAccessProfileData({ id: "broker-1" }), {
    userId: "broker-1",
    businessRole: "CORREDOR",
    accessScope: "ASSIGNED",
    teamKey: null,
    branchKey: null,
    version: 1
  });
});

test("la provisión estándar no sobrescribe un perfil configurado manualmente", async () => {
  const db = createDb({
    profiles: [{ id: "manual-1", tenantId: "tenant-broker", recordType: "broker_access_profile", status: "ACTIVE", data: { userId: "broker-1", businessRole: "COORDINADOR_COMERCIAL", accessScope: "TEAM" } }]
  });
  const result = await ensureStandardBrokerAccessProfile(db, {
    tenantId: "tenant-broker",
    industry: "REAL_ESTATE",
    user: { id: "broker-1", name: "Ana", role: "SELLER" }
  });

  assert.equal(result.created, false);
  assert.equal(db.rows.length, 1);
  assert.equal(db.rows[0].data.businessRole, "COORDINADOR_COMERCIAL");
});

test("la regularización agrega perfiles faltantes de cuentas existentes sin tocar otras funciones", async () => {
  const db = createDb({
    users: [
      { id: "broker-1", name: "Ana", email: "ana@demo.test", role: "SELLER", jobTitle: "Corredora inmobiliaria", isActive: true },
      { id: "coord-1", name: "Luis", email: "luis@demo.test", role: "AGENT", jobTitle: "Coordinador comercial", isActive: true },
      { id: "inactive", name: "Marcela", email: "marcela@demo.test", role: "SELLER", jobTitle: "Corredora", isActive: false }
    ]
  });

  const result = await ensureStandardBrokerAccessForTenant(db, { tenantId: "tenant-broker", industry: "INMOBILIARIA" });

  assert.deepEqual(result, { inspected: 1, created: 1 });
  assert.equal(db.rows.length, 1);
  assert.equal(db.rows[0].assignedToId, "broker-1");
  assert.equal(db.rows[0].data.accessScope, "ASSIGNED");
});

test("una cuenta inactiva espera a ser activada antes de recibir el perfil", async () => {
  const db = createDb();
  const result = await ensureStandardBrokerAccessProfile(db, {
    tenantId: "tenant-broker",
    industry: "REAL_ESTATE",
    user: { id: "broker-inactivo", name: "Claudio", role: "SELLER", isActive: false }
  });

  assert.equal(result.created, false);
  assert.equal(db.rows.length, 0);
});
