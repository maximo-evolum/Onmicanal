import test from "node:test";
import assert from "node:assert/strict";
import { applyFinanceAllocation, reverseFinanceAllocation, planFinanceAllocation, validateAllocationInput, sendFinanceMovementToReview } from "../src/services/finance-allocation.service.js";

const movement = (id = "m", amount = 100) => ({ id, tenantId: "a", recordType: "bank_movement", title: "Transferencia cliente", status: "PENDING", data: { amount, currency: "CLP", direction: "CREDIT", transactionDate: "2026-01-20", rut: "11111111-1" } });
const invoice = (id = "i", amount = 100) => ({ id, tenantId: "a", recordType: "finance_invoice", title: `Factura ${id}`, status: "OPEN", data: { amount, balance: amount, paidAmount: 0, currency: "CLP", clientRut: "11111111-1", clientName: "Cliente de pruebas", issueDate: "2026-01-01" } });
// Local transaction adapter with rollback and tenant/JSON filtering. PostgreSQL
// serialization still requires integration tests against a disposable database.
function database(initial) {
  let rows = structuredClone(initial); let seq = 0;
  const matches = (row, where = {}) => Object.entries(where).every(([key, value]) => {
    if (value?.in) return value.in.includes(row[key]);
    if (value?.path) return value.path.reduce((obj, part) => obj?.[part], row[key]) === value.equals;
    return row[key] === value;
  });
  const db = { get rows() { return rows; },
    tenantAuditLog: { create: async ({ data }) => data },
    $transaction: async (fn, opts) => { assert.equal(opts.isolationLevel, "Serializable"); const old = structuredClone(rows); try { return await fn(db); } catch (e) { rows = old; throw e; } },
    industryRecord: {
      findFirst: async ({ where }) => structuredClone(rows.find((row) => matches(row, where)) || null),
      findMany: async ({ where, take = 500, cursor, skip = 0 }) => { const found = rows.filter((row) => matches(row, where)).sort((a, b) => a.id.localeCompare(b.id)); const start = cursor ? found.findIndex((row) => row.id === cursor.id) + skip : 0; return structuredClone(found.slice(start, start + take)); },
      create: async ({ data }) => { const row = { id: `created-${++seq}`, ...structuredClone(data) }; rows.push(row); return structuredClone(row); },
      update: async ({ where, data }) => { const row = rows.find((item) => matches(item, where)); assert.ok(row); Object.assign(row, structuredClone(data)); return structuredClone(row); }
    }
  }; return db;
}
const apply = (db, allocations = [{ invoiceId: "i", amount: 100 }], extras = {}) => applyFinanceAllocation(db, { tenantId: "a", userId: "admin", movementId: "m", allocations, reason: "Comprobante revisado con el cliente", manual: true, ...extras });
const reverse = (db, id, extras = {}) => reverseFinanceAllocation(db, { tenantId: "a", userId: "admin", reconciliationId: id, reason: "Asignación incorrecta verificada", ...extras });

test("distribuye un abono parcialmente entre dos documentos y conserva montos explícitos", async () => {
  const db = database([movement(), invoice("i", 90), invoice("j", 70)]);
  const result = await apply(db, [{ invoiceId: "i", amount: 60 }, { invoiceId: "j", amount: 40 }]);
  assert.deepEqual(result.invoices.map((row) => [row.id, row.data.balance]), [["i", 30], ["j", 30]]);
  assert.equal(result.reconciliation.data.reason, "Comprobante revisado con el cliente");
  assert.equal(db.rows.find((row) => row.id === "m").status, "MATCHED");
  assert.equal(db.rows.filter((row) => row.recordType === "finance_invoice_receipt").length, 2);
});
test("aprobar sugerencias usa el mismo escritor sin recortar a tres facturas", async () => {
  const ids = ["i", "j", "k", "l"];
  const db = database([movement(), ...ids.map((id) => invoice(id, 25))]);
  const result = await applyFinanceAllocation(db, { tenantId: "a", userId: "admin", movementId: "m", invoiceIds: ids });
  assert.equal(result.invoices.length, 4); assert.equal(result.remainingBalance, 0);
});
test("no admite sumar tolerancias ocultas ni montos excedentes", async () => {
  for (const value of [99, 101]) { const db = database([movement(), invoice("i", 200)]); await assert.rejects(apply(db, [{ invoiceId: "i", amount: value }]), /exactamente/); assert.equal(db.rows.length, 2); }
});
test("rechaza filas repetidas, montos fraccionarios y selección de más de cien", () => {
  for (const list of [[{ invoiceId: "i", amount: 50 }, { invoiceId: "i", amount: 50 }], [{ invoiceId: "i", amount: 1.5 }], Array.from({ length: 101 }, (_, i) => ({ invoiceId: String(i), amount: 1 }))]) assert.throws(() => validateAllocationInput(list));
});
test("bloquea sobrepago de una factura aunque el total del grupo cuadre", async () => {
  const db = database([movement(), invoice("i", 30), invoice("j", 100)]);
  await assert.rejects(apply(db, [{ invoiceId: "i", amount: 40 }, { invoiceId: "j", amount: 60 }]), /saldo/);
});
test("no mezcla empresas ni clientes al asignar", async () => {
  const other = invoice("j"); other.tenantId = "b";
  await assert.rejects(apply(database([movement(), other]), [{ invoiceId: "j", amount: 100 }]), /empresa/);
  other.tenantId = "a"; other.data.clientRut = "22222222-2";
  await assert.rejects(apply(database([movement(), invoice(), other]), [{ invoiceId: "i", amount: 50 }, { invoiceId: "j", amount: 50 }]), /mismo cliente/);
});
test("rechaza cargos, traspasos, moneda distinta, anticipos y documentos anulados", () => {
  for (const mutate of [
    (m) => { m.data.direction = "DEBIT"; }, (m) => { m.data.movementKind = "INTERNAL_TRANSFER"; },
    (m) => { m.data.currency = "USD"; }, (m) => { m.data.transactionDate = "2025-12-01"; },
    (_, i) => { i.status = "ANNULLED"; }, (_, i) => { i.data.documentSide = "SUPPLIER"; }
  ]) { const m = movement(), i = invoice(); mutate(m, i); assert.throws(() => planFinanceAllocation(m, [i], [{ invoiceId: "i", amount: 100 }])); }
});
test("exige un motivo para asignación manual y reversa", async () => {
  const db = database([movement(), invoice()]); await assert.rejects(apply(db, undefined, { reason: "" }), /motivo/);
  await assert.rejects(reverse(db, "x", { reason: "corto" }), /motivo/);
});
test("reintentar aprobación no duplica pagos", async () => {
  const db = database([movement(), invoice()]); await apply(db); const count = db.rows.length;
  await assert.rejects(apply(db), /conciliado/); assert.equal(db.rows.length, count); assert.equal(db.rows.find((r) => r.id === "i").data.paidAmount, 100);
});
test("reversa restaura saldos y conserva comprobantes; reintento es idempotente", async () => {
  const db = database([movement(), invoice()]); const result = await apply(db); const count = db.rows.length;
  await reverse(db, result.reconciliation.id);
  assert.equal(db.rows.length, count); assert.equal(db.rows.find((r) => r.id === "i").data.balance, 100);
  assert.equal(db.rows.find((r) => r.id === "m").status, "PENDING");
  assert.equal(db.rows.find((r) => r.recordType === "finance_invoice_receipt").status, "REVERSED");
  assert.equal((await reverse(db, result.reconciliation.id)).alreadyReversed, true);
  assert.equal(db.rows.find((r) => r.id === "i").data.balance, 100);
});
test("permite varios abonos a una factura y revertir uno sin borrar el otro", async () => {
  const db = database([movement("m", 40), movement("n", 60), invoice()]);
  const first = await apply(db, [{ invoiceId: "i", amount: 40 }]);
  await apply(db, [{ invoiceId: "i", amount: 60 }], { movementId: "n" });
  await reverse(db, first.reconciliation.id);
  const row = db.rows.find((r) => r.id === "i"); assert.equal(row.data.balance, 40); assert.equal(row.data.paidAmount, 60); assert.equal(row.status, "PARTIAL");
  assert.equal(db.rows.find((r) => r.id === "n").status, "MATCHED");
});
test("reversa de grupo es atómica si un documento fue modificado", async () => {
  const db = database([movement(), invoice("i", 50), invoice("j", 50)]);
  const result = await apply(db, [{ invoiceId: "i", amount: 50 }, { invoiceId: "j", amount: 50 }]);
  db.rows.find((r) => r.id === "j").data.creditNotesTotal = 20;
  await assert.rejects(reverse(db, result.reconciliation.id), /ajustes posteriores/);
  assert.equal(db.rows.find((r) => r.id === "i").data.balance, 0); assert.equal(db.rows.find((r) => r.id === "m").status, "MATCHED");
});
test("bloquea conciliaciones y reversas en períodos cerrados de la empresa", async () => {
  const close = { id: "c", tenantId: "a", recordType: "finance_monthly_close", status: "CLOSED", data: { period: "2026-01" } };
  await assert.rejects(apply(database([movement(), invoice(), close])), /cerrado/);
  const db = database([movement(), invoice()]); const result = await apply(db); db.rows.push(close);
  await assert.rejects(reverse(db, result.reconciliation.id), /cerrado/);
  close.tenantId = "b"; await apply(database([movement(), invoice(), close]));
});
test("no permite reversa de otra empresa ni sin los recibos que acreditan el saldo", async () => {
  const db = database([movement(), invoice()]); const result = await apply(db);
  await assert.rejects(reverse(db, result.reconciliation.id, { tenantId: "b" }), /no encontrada/);
  db.rows.find((r) => r.recordType === "finance_invoice_receipt").data.amount = 99;
  await assert.rejects(reverse(db, result.reconciliation.id), /no cuadran/);
  assert.equal(db.rows.find((r) => r.id === "i").data.balance, 0);
});
test("se puede volver a conciliar tras una reversa sin reciclar el historial", async () => {
  const db = database([movement(), invoice()]); const first = await apply(db); await reverse(db, first.reconciliation.id); const next = await apply(db);
  assert.notEqual(first.reconciliation.id, next.reconciliation.id);
  assert.equal(db.rows.filter((r) => r.recordType === "finance_reconciliation").length, 2);
});

test("si falla la auditoría no se confirma una actualización parcial", async () => {
  const db = database([movement(), invoice()]);
  db.tenantAuditLog.create = async () => { throw new Error("Auditoría no disponible"); };
  await assert.rejects(apply(db), /Auditoría/);
  assert.equal(db.rows.length, 2); assert.equal(db.rows.find((row) => row.id === "i").data.balance, 100);
});

test("enviar a revisión no puede deshacer una aprobación ni duplicar excepciones", async () => {
  const db = database([movement(), invoice()]);
  const review = () => sendFinanceMovementToReview(db, { tenantId: "a", userId: "admin", movementId: "m", detail: "Validar origen del pago" });
  const applied = await apply(db); await assert.rejects(review(), /conciliado/);
  await reverse(db, applied.reconciliation.id); await review(); await assert.rejects(review(), /revisión/);
  assert.equal(db.rows.filter((row) => row.recordType === "finance_exception").length, 1);
  await assert.rejects(apply(db), /revisión/);
});
