import test from "node:test";
import assert from "node:assert/strict";
import { assignMovementOwner, listMovementOwners } from "../src/services/finance-movement-owner.service.js";
const initialDate = "2026-01-10T00:00:00.000Z";
const input = { tenantId: "a", userId: "admin", role: "ADMIN", movementId: "m", assignedToId: "agent", expectedVersion: initialDate, reason: "Revisar el origen del abono", operationKey: "assign-operation-0001" };
function fixture({ status = "PENDING", date = "2026-01-02", closed = false, active = true, userTenant = "a", userRole = "AGENT", movementTenant = "a" } = {}) {
  let movement = { id: "m", tenantId: movementTenant, recordType: "bank_movement", status, assignedToId: null, updatedAt: new Date(initialDate), data: { amount: 100, direction: "CREDIT", transactionDate: date, sourceFile: "Cartola" } };
  const audits = []; let updates = 0, locks = 0;
  const tx = {
    industryRecord: { findFirst: async ({ where }) => where.tenantId === movement.tenantId && where.id === movement.id ? structuredClone(movement) : null,
      update: async ({ data }) => { updates++; movement = { ...movement, ...data, updatedAt: new Date(new Date(movement.updatedAt).getTime() + 1) }; return structuredClone(movement); } },
    workspaceUser: { findFirst: async ({ where }) => where.tenantId === userTenant && (where.isActive === undefined || active) && (!where.role || where.role.in.includes(userRole)) ? { id: where.id, name: `Persona ${where.id}` } : null },
    tenantAuditLog: { findFirst: async ({ where }) => audits.find((a) => a.tenantId === where.tenantId && a.entityId === where.entityId && a.metadata.operationKey === where.metadata.equals) || null,
      create: async ({ data }) => { audits.push(data); return data; } },
    financePeriodControl: { upsert: async () => { locks++; return { status: closed ? "CLOSED" : "OPEN" }; } }
  };
  const db = { $transaction: async (fn, options) => { assert.equal(options.isolationLevel, "Serializable"); return fn(tx); } };
  return { db, audits, read: () => ({ movement, updates, locks }) };
}
test("asigna, reasigna y retira responsable sin cambiar los datos financieros", async () => {
  const f = fixture(); const before = JSON.stringify(f.read().movement.data);
  let result = await assignMovementOwner(f.db, input);
  result = await assignMovementOwner(f.db, { ...input, assignedToId: "other", expectedVersion: result.version, operationKey: "assign-operation-0002" });
  await assignMovementOwner(f.db, { ...input, assignedToId: null, expectedVersion: result.version, operationKey: "assign-operation-0003" });
  assert.equal(f.read().movement.assignedToId, null); assert.equal(f.audits.length, 3);
  assert.equal(f.audits[1].metadata.previousAssignedToId, "agent");
  assert.equal(f.audits[1].metadata.assignmentSummary, "Persona agent → Persona other");
  assert.equal(JSON.stringify(f.read().movement.data), before); assert.equal(f.read().movement.status, "PENDING");
});
test("reintento idéntico no duplica cambio ni auditoría", async () => {
  const f = fixture(); await assignMovementOwner(f.db, input);
  assert.equal((await assignMovementOwner(f.db, input)).replayed, true);
  assert.equal(f.read().updates, 1); assert.equal(f.audits.length, 1);
  await assert.rejects(assignMovementOwner(f.db, { ...input, assignedToId: "other" }), { status: 409 });
});
test("bloquea roles no administrativos antes de escribir", async () => {
  for (const role of ["AGENT", "SELLER", "VIEWER", "UNKNOWN"]) await assert.rejects(assignMovementOwner({}, { ...input, role }), { status: 403 });
});
test("rechaza usuarios ajenos, inactivos y observadores", async () => {
  for (const options of [{ userTenant: "b" }, { active: false }, { userRole: "VIEWER" }]) {
    const f = fixture(options); await assert.rejects(assignMovementOwner(f.db, input), { status: 422 }); assert.equal(f.read().updates, 0);
  }
});
test("rechaza movimiento de otra empresa y versiones antiguas", async () => {
  await assert.rejects(assignMovementOwner(fixture({ movementTenant: "b" }).db, input), { status: 404 });
  const f = fixture(); await assert.rejects(assignMovementOwner(f.db, { ...input, expectedVersion: "2025-01-01" }), { status: 409 }); assert.equal(f.read().updates, 0);
});
test("bloquea período cerrado y movimientos excluidos", async () => {
  for (const options of [{ closed: true }, { status: "EXCLUDED" }, { status: "DELETED" }]) {
    const f = fixture(options); await assert.rejects(assignMovementOwner(f.db, input), { status: 409 }); assert.equal(f.read().updates, 0);
  }
});
test("organiza revisión sin fecha sin inventar período ni cambiar fecha", async () => {
  const f = fixture({ date: "" }); await assignMovementOwner(f.db, input);
  assert.equal(f.read().locks, 0); assert.equal(f.read().movement.data.transactionDate, ""); assert.equal(f.audits[0].metadata.dateUnresolved, true);
});
test("exige motivo y clave válidos, incluso para quitar responsable", async () => {
  for (const change of [{ reason: "x" }, { operationKey: "x" }, { expectedVersion: "bad" }, { assignedToId: undefined }]) await assert.rejects(assignMovementOwner({}, { ...input, ...change }), { status: 400 });
});
test("lista todo el personal por empresa sin exponer correo ni contraseña", async () => {
  let calls = 0;
  const users = Array.from({ length: 501 }, (_, i) => ({ id: String(i), name: `Persona ${i}`, isActive: true }));
  const db = { workspaceUser: { findMany: async (q) => { calls++; assert.equal(q.where.tenantId, "a"); assert.deepEqual(q.select, { id: true, name: true, isActive: true }); const offset = q.cursor ? Number(q.cursor.id) + 1 : 0; return users.slice(offset, offset + q.take); } } };
  assert.equal((await listMovementOwners(db, "a")).length, 501); assert.equal(calls, 2);
});
