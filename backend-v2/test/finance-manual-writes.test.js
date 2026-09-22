import test from "node:test";
import assert from "node:assert/strict";
import { financialDate, registerManualSettlement, writeManualFinanceRecord, assertFinancialDraftScope } from "../src/services/finance-manual-writes.service.js";

test("borrador rechaza cambio de usuario o empresa autenticada", () => {
  for (const scope of [{ tenantId: "b", userId: "u" }, { tenantId: "a", userId: "other" }, {}, null]) assert.throws(() => assertFinancialDraftScope(scope, "a", "u"), (error) => error.status === 409);
  assert.doesNotThrow(() => assertFinancialDraftScope({ tenantId: "a", userId: "u" }, "a", "u"));
  assert.doesNotThrow(() => assertFinancialDraftScope(undefined, "a", "u"));
});

function createInvoice(db, extra = {}) {
  const nextData = extra.nextData || { invoiceNumber: "F-1", amount: 100, balance: 100, issueDate: "2026-01-10", dueDate: "2026-02-10" };
  return writeManualFinanceRecord(db, { tenantId: "a", userId: "admin", recordType: "finance_invoice", nextData, nextStatus: "ISSUED", operation: "CREATE", idempotencyKey: "invoice-operation-0001", creationContext: { title: "Factura F-1" },
    write: (tx, data) => tx.industryRecord.create({ data: { tenantId: extra.tenantId || "a", recordType: "finance_invoice", status: "ISSUED", data } }), audit: { action: "CREATE", metadata: {} }, ...extra });
}
test("creación repetida y concurrente conserva una factura y una auditoría", async () => {
  const db = database(); const [a, b] = await Promise.all([createInvoice(db), createInvoice(db)]);
  assert.equal(a.id, b.id); assert.equal(b.manualReplayed, true); assert.equal(db.rows.length, 1); assert.equal(db.audits.length, 1);
});
test("reintento de creación ya confirmada funciona incluso con mes cerrado", async () => {
  const db = database(); const first = await createInvoice(db); close(db, "2026-01");
  assert.equal((await createInvoice(db)).id, first.id); assert.equal(db.audits.length, 1);
});
test("clave de creación no admite cambiar contenido ni título", async () => {
  const db = database(); await createInvoice(db);
  await assert.rejects(createInvoice(db, { creationContext: { title: "Otra" } }), /otros datos/);
  await assert.rejects(createInvoice(db, { nextData: { amount: 200, issueDate: "2026-01-10" } }), /otros datos/);
});
test("clave de creación está aislada por empresa", async () => {
  const db = database(); const first = await createInvoice(db); const second = await createInvoice(db, { tenantId: "b" });
  assert.notEqual(first.id, second.id); assert.equal(db.rows.length, 2);
});
test("creación rechaza claves e identificadores internos manipulados", async () => {
  const db = database(); await assert.rejects(createInvoice(db, { idempotencyKey: "x" }), /inválido/);
  await assert.rejects(createInvoice(db, { nextData: { manualCreationKey: "forged" } }), /internos/); assert.equal(db.rows.length, 0);
});
test("creación rechaza vencimiento anterior y monto no entero", async () => {
  for (const fields of [{ amount: 1.5 }, { dueDate: "2026-01-01" }, { amount: -1 }]) {
    const db = database(); await assert.rejects(createInvoice(db, { nextData: { issueDate: "2026-01-10", amount: 100, ...fields } })); assert.equal(db.rows.length, 0);
  }
});
test("fallo de auditoría revierte la creación y permite reintento", async () => {
  const db = database(); const original = db.tenantAuditLog.create; db.tenantAuditLog.create = async () => { throw new Error("audit error"); };
  await assert.rejects(createInvoice(db), /audit error/); assert.equal(db.rows.length, 0);
  db.tenantAuditLog.create = original; await createInvoice(db); assert.equal(db.rows.length, 1);
});

function database() {
  let rows = [], controls = [], audits = [], seq = 0; let tail = Promise.resolve();
  const matches = (row, where = {}) => Object.entries(where).every(([key, value]) => value?.in ? value.in.includes(row[key]) : value?.path ? value.path.reduce((x, p) => x?.[p], row[key]) === value.equals : row[key] === value);
  const db = {
    get rows() { return rows; }, get controls() { return controls; }, get audits() { return audits; },
    $transaction: (fn, options) => {
      assert.equal(options.isolationLevel, "Serializable");
      const result = tail.then(async () => { const before = structuredClone({ rows, controls, audits });
        try { return await fn(db); } catch (e) { rows = before.rows; controls = before.controls; audits = before.audits; throw e; }
      }); tail = result.catch(() => {}); return result;
    },
    financePeriodControl: { upsert: async ({ where, create }) => { let row = controls.find((row) => matches(row, where.tenantId_period)); if (!row) { row = structuredClone(create); controls.push(row); } else row.lockVersion++; return structuredClone(row); } },
    industryRecord: {
      findFirst: async ({ where }) => structuredClone(rows.find((row) => matches(row, where)) || null),
      create: async ({ data }) => { const row = { id: `new-${++seq}`, updatedAt: "now", ...structuredClone(data) }; rows.push(row); return structuredClone(row); },
      update: async ({ where, data }) => { const row = rows.find((row) => matches(row, where)); Object.assign(row, structuredClone(data), { updatedAt: `v${++seq}` }); return structuredClone(row); },
      delete: async ({ where }) => { const row = rows.find((row) => matches(row, where)); rows = rows.filter((row) => !matches(row, where)); return row; }
    },
    tenantAuditLog: { create: async ({ data }) => { audits.push(structuredClone(data)); return data; } }
  }; return db;
}
function seeded(type = "finance_invoice") {
  const db = database(); db.rows.push({ id: "doc", tenantId: "a", recordType: type, title: "Factura de prueba", status: "OPEN", updatedAt: "v0", data: { amount: 100, balance: 100, paidAmount: 0, issueDate: "2026-01-10", currency: "CLP" } }); return db;
}
const close = (db, period, tenantId = "a") => db.controls.push({ tenantId, period, status: "CLOSED", lockVersion: 0 });
const pay = (db, args = {}) => registerManualSettlement(db, { tenantId: "a", userId: "admin", documentId: "doc", kind: "RECEIPT", amount: 60, paymentDate: "2026-02-02", reference: "Comprobante", idempotencyKey: "operacion-prueba-0001", ...args });
function edit(db, args = {}) {
  const existing = structuredClone(db.rows.find((row) => row.id === "doc"));
  const nextData = { ...existing.data, amount: 200, balance: 200 };
  return writeManualFinanceRecord(db, { tenantId: "a", userId: "admin", recordType: existing.recordType, existing, nextData, nextStatus: existing.status, operation: "UPDATE",
    write: (tx) => tx.industryRecord.update({ where: { id: "doc" }, data: { data: nextData } }), audit: { action: "TEST_EDIT" }, ...args });
}

test("fechas reales y explícitas sin corregir silenciosamente días inválidos", () => {
  for (const date of [undefined, "", "2026-02-30", "2026-13-01", "10/01/2026", "2026-02-02T00:00:00Z"]) assert.throws(() => financialDate(date), /fecha válida/);
  assert.equal(financialDate("2024-02-29"), "2024-02-29");
});
test("cobro posterior permite factura de período cerrado y conserva cierre", async () => {
  const db = seeded(); close(db, "2026-01"); const old = structuredClone(db.controls[0]); const result = await pay(db);
  assert.equal(result.remainingBalance, 40); assert.deepEqual(db.controls[0], old); assert.equal(db.audits[0].metadata.period, "2026-02");
});
test("bloquea fecha efectiva cerrada aunque la factura sea de otro mes", async () => {
  const db = seeded(); close(db, "2026-02"); await assert.rejects(pay(db), /cerrado/); assert.equal(db.rows.length, 1); assert.equal(db.audits.length, 0);
});
test("reapertura permite registrar con su fecha efectiva", async () => {
  const db = seeded(); close(db, "2026-02"); db.controls[0].status = "OPEN";
  const result = await pay(db, { amount: 100 }); assert.equal(result.invoice.data.paidAt, "2026-02-02"); assert.equal(result.invoice.status, "PAID");
});
test("pago a proveedor usa el mismo control y devuelve contrato de API", async () => {
  const db = seeded("finance_payable"); const result = await pay(db, { kind: "PAYMENT" });
  assert.equal(result.payment.recordType, "finance_payable_payment"); assert.equal(result.payable.data.balance, 40); assert.equal(db.audits[0].action, "FINANCE_PAYABLE_PAYMENT_REGISTERED");
});

test("un pago posterior conserva los pagos históricos inferidos del saldo y los ajustes", async () => {
  for (const type of ["finance_invoice", "finance_payable"]) {
    const db = seeded(type);
    db.rows[0].data = { ...db.rows[0].data, amount: 200, creditNotesTotal: 20, debitNotesTotal: 10, balance: 90 };
    delete db.rows[0].data.paidAmount;
    const result = await pay(db, { kind: type === "finance_payable" ? "PAYMENT" : "RECEIPT", amount: 60 });
    const document = result.invoice || result.payable;
    assert.equal(document.data.paidAmount, 160);
    assert.equal(document.data.balance, 30);
    assert.equal(document.data.creditNotesTotal, 20);
    assert.equal(document.data.debitNotesTotal, 10);
  }
});

test("un saldo inconsistente no permite registrar pagos ni altera el documento", async () => {
  const db = seeded(); db.rows[0].data.balance = 40;
  const before = structuredClone(db.rows[0]);
  await assert.rejects(pay(db, { amount: 10 }), /revisión/);
  assert.deepEqual(db.rows[0], before); assert.equal(db.rows.length, 1); assert.equal(db.audits.length, 0);
});
test("no permite cruzar empresas ni documento de tipo incorrecto", async () => {
  const db = seeded(); await assert.rejects(pay(db, { tenantId: "b" }), /no encontrado/); await assert.rejects(pay(db, { kind: "PAYMENT" }), /no encontrado/);
});
test("montos inválidos y sobrepagos no escriben datos", async () => {
  for (const amount of [0, -1, 1.5, NaN, Infinity, "abc", 101]) { const db = seeded(); await assert.rejects(pay(db, { amount })); assert.equal(db.rows.length, 1); }
});
test("no cobra documentos anulados ni convierte monedas", async () => {
  for (const mutate of [(d) => d.status = "CANCELLED", (d) => d.data.currency = "USD", (d) => d.status = "PAID"]) {
    const db = seeded(); mutate(db.rows[0]); await assert.rejects(pay(db)); assert.equal(db.rows.length, 1);
  }
});
test("reintento idéntico devuelve comprobante original incluso tras cerrar", async () => {
  const db = seeded(); const first = await pay(db); close(db, "2026-02"); const second = await pay(db);
  assert.equal(first.receipt.id, second.receipt.id); assert.equal(second.replayed, true); assert.equal(db.rows[0].data.balance, 40); assert.equal(db.audits.length, 1);
});
test("no recicla identificador con monto fecha referencia o documento distinto", async () => {
  const db = seeded(); await pay(db);
  for (const args of [{ amount: 20 }, { reference: "Otra" }, { paymentDate: "2026-02-03" }]) await assert.rejects(pay(db, args), /otros datos/);
  await assert.rejects(pay(db, { idempotencyKey: "" }), /identificador/);
});
test("dos solicitudes iguales concurrentes generan sólo un comprobante", async () => {
  const db = seeded(); const results = await Promise.all([pay(db), pay(db)]);
  assert.equal(results[0].receipt.id, results[1].receipt.id); assert.equal(db.audits.length, 1);
});
test("pagos concurrentes distintos releen saldo y evitan sobrepago", async () => {
  const db = seeded(); const results = await Promise.allSettled([pay(db), pay(db, { idempotencyKey: "operacion-prueba-0002" })]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1); assert.equal(db.rows[0].data.balance, 40);
});
test("fallo de auditoría revierte comprobante y saldo", async () => {
  const db = seeded(); db.tenantAuditLog.create = async () => { throw new Error("auditoría caída"); };
  await assert.rejects(pay(db), /auditoría/); assert.equal(db.rows.length, 1); assert.equal(db.rows[0].data.balance, 100); assert.equal(db.controls.length, 0);
});
test("edición de documento abierto conserva auditoría atómica", async () => {
  const db = seeded(); await edit(db); assert.equal(db.rows[0].data.amount, 200); assert.deepEqual(db.audits[0].metadata.periods, ["2026-01"]);
});
test("no se elude un cierre cambiando fecha de emisión al mes abierto", async () => {
  const db = seeded(); close(db, "2026-01"); await assert.rejects(edit(db, { nextData: { ...db.rows[0].data, issueDate: "2026-02-01" } }), /cerrado/); assert.equal(db.rows[0].data.issueDate, "2026-01-10");
});
test("también bloquea el mes nuevo al mover documento desde mes abierto", async () => {
  const db = seeded(); close(db, "2026-02"); await assert.rejects(edit(db, { nextData: { ...db.rows[0].data, issueDate: "2026-02-01" } }), /cerrado/);
});
test("edición obsoleta no pisa un cobro que llegó mientras se llenaba la ficha", async () => {
  const db = seeded(); const old = structuredClone(db.rows[0]); await pay(db); await assert.rejects(edit(db, { existing: old }), /cambió/); assert.equal(db.rows[0].data.balance, 40);
});
test("no elimina ni edita documento con comprobantes", async () => {
  const db = seeded(); await pay(db); await assert.rejects(edit(db), /historial/);
  await assert.rejects(edit(db, { operation: "DELETE", write: (tx) => tx.industryRecord.delete({ where: { id: "doc" } }) }), /historial/);
});
test("no admite fabricar estado pagado o saldo por CRUD", async () => {
  for (const args of [{ nextStatus: "PAID" }, { nextData: { amount: 100, balance: 50, issueDate: "2026-01-10" } }, { nextData: { amount: 100, balance: 100, paidAmount: 10, issueDate: "2026-01-10" } }]) await assert.rejects(edit(seeded(), args), /directamente|estado pagado/);
});
test("ajuste aplicado no puede ser alterado directamente", async () => {
  const db = seeded("finance_document_adjustment"); db.rows[0].status = "APPLIED"; await assert.rejects(edit(db), /ajuste aplicado/);
});
test("ajuste pendiente y movimiento manual respetan sus fechas", async () => {
  for (const type of ["finance_document_adjustment", "bank_movement"]) {
    const db = seeded(type); db.rows[0].data.date = "2026-01-10"; close(db, "2026-01"); await assert.rejects(edit(db), /cerrado/);
  }
});
test("creación en mes cerrado se rechaza antes de escribir", async () => {
  const db = seeded(); close(db, "2026-01"); await assert.rejects(edit(db, { existing: undefined, operation: "CREATE" }), /cerrado/);
});
test("los módulos no financieros mantienen su operación anterior", async () => {
  const db = seeded(); let called = false;
  await writeManualFinanceRecord(db, { recordType: "property", write: async (client) => { assert.equal(client, db); called = true; } });
  assert.equal(called, true); assert.equal(db.controls.length, 0);
});
test("auditoría fallida revierte también ajustes manuales", async () => {
  const db = seeded(); db.tenantAuditLog.create = async () => { throw new Error("audit"); };
  await assert.rejects(edit(db), /audit/); assert.equal(db.rows[0].data.amount, 100);
});
