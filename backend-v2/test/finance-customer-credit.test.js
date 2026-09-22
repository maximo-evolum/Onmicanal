import test from "node:test";
import assert from "node:assert/strict";
import { registerCustomerCredit, applyCustomerCredit, reverseCustomerCredit, reverseCustomerCreditApplication, listCustomerCredits } from "../src/services/finance-customer-credit.service.js";
import { auditCustomerCredit, validCreditRut, customerCreditsForClose } from "../src/services/finance-customer-credit-ledger.service.js";
import { buildFinanceMonthlyClosePreview } from "../src/services/finance-monthly-close.service.js";
import { financeActionForRecordMutation, FINANCE_ACTIONS } from "../src/services/finance-security.service.js";
import { reverseFinanceAllocation } from "../src/services/finance-allocation.service.js";
import { canPerformFinanceAction } from "../src/services/finance-security.service.js";
import { assertWorkflowFinancialSafety } from "../src/services/finance-workflow-guard.service.js";

const row = (id, recordType, data = {}, status = "PENDING") => ({ id, tenantId: "a", recordType, title: id, status, data });
const bank = (amount = 150) => row("m", "bank_movement", { amount, direction: "CREDIT", currency: "CLP", transactionDate: "2025-01-10", rut: "11111111-1", bankKey: "santander_chile", description: "Transferencia cliente" });
const invoice = (id = "i", amount = 100, date = "2025-02-01") => row(id, "finance_invoice", { amount, balance: amount, paidAmount: 0, currency: "CLP", clientRut: "11111111-1", clientName: "Cliente de prueba", issueDate: date }, "OPEN");
function database(initial = [bank(), invoice()]) {
  let rows = structuredClone(initial), controls = [], audits = [], seq = 0, tail = Promise.resolve();
  const match = (r, where = {}) => Object.entries(where).every(([k, v]) => v?.in ? v.in.includes(r[k]) : v?.path ? v.path.reduce((o, key) => o?.[key], r[k]) === v.equals : r[k] === v);
  const db = { get rows() { return rows; }, get controls() { return controls; }, get audits() { return audits; },
    $transaction: (fn, opts) => { assert.equal(opts.isolationLevel, "Serializable"); const p = tail.then(async () => { const snapshot = structuredClone({ rows, controls, audits }); try { return await fn(db); } catch (e) { ({ rows, controls, audits } = snapshot); throw e; } }); tail = p.catch(() => {}); return p; },
    financePeriodControl: { upsert: async ({ where, create }) => { let r = controls.find((r) => match(r, where.tenantId_period)); if (!r) { r = structuredClone(create); controls.push(r); } else r.lockVersion++; return structuredClone(r); } },
    industryRecord: {
      findFirst: async ({ where }) => structuredClone(rows.find((r) => match(r, where)) || null),
      findMany: async ({ where, take = 500, cursor, skip = 0 }) => { const list = rows.filter((r) => match(r, where)).sort((a, b) => a.id.localeCompare(b.id)); const start = cursor ? list.findIndex((r) => r.id === cursor.id) + skip : 0; return structuredClone(list.slice(start, start + take)); },
      create: async ({ data }) => { const r = { id: `new-${++seq}`, ...structuredClone(data) }; rows.push(r); return structuredClone(r); },
      update: async ({ where, data }) => { const r = rows.find((r) => match(r, where)); assert.ok(r); Object.assign(r, structuredClone(data)); return structuredClone(r); }
    }, tenantAuditLog: { create: async ({ data }) => { audits.push(structuredClone(data)); return data; } }
  }; return db;
}
const register = (db, extra = {}) => registerCustomerCredit(db, { tenantId: "a", userId: "admin", movementId: "m", customerRut: "11.111.111-1", customerName: "Cliente de prueba", kind: "ADVANCE", reason: "Comprobante y cliente verificados por administración", ...extra });
const apply = (db, id, extra = {}) => applyCustomerCredit(db, { tenantId: "a", userId: "admin", creditId: id, expectedVersion: db.rows.find((r) => r.id === id).data.version, applicationDate: "2025-02-10", allocations: [{ invoiceId: "i", amount: 100 }], reason: "Aplicación solicitada por el cliente a su factura", ...extra });
const reverseApp = (db, id) => reverseCustomerCreditApplication(db, { tenantId: "a", userId: "admin", applicationId: id, reason: "Corrección de aplicación documentada por el cliente" });
const reverse = (db, id) => reverseCustomerCredit(db, { tenantId: "a", userId: "admin", creditId: id, reason: "Corrección de identificación del abono con respaldo" });

test("valida RUT chileno y no agrupa clientes sólo por nombre", () => { assert.ok(validCreditRut("11.111.111-1")); assert.equal(validCreditRut("11.111.111-2"), false); assert.equal(validCreditRut("Cliente"), false); });
test("registra anticipo sin factura: banco una vez y ninguna deuda artificial", async () => {
  const db = database([bank()]), { credit } = await register(db);
  assert.equal(credit.data.availableAmount, 150); assert.equal(db.rows.filter((r) => r.recordType === "bank_movement").length, 1);
  assert.equal(db.rows.filter((r) => r.recordType === "finance_invoice_receipt").length, 0);
  assert.equal(auditCustomerCredit(credit, db.rows).valid, true);
  const close = buildFinanceMonthlyClosePreview(db.rows, "2025-01"); assert.equal(close.metrics.incoming, 150); assert.equal(close.metrics.collected, 0); assert.equal(close.metrics.customerCreditAvailable, 150); assert.equal(close.status, "READY_TO_CLOSE");
});
test("sobrepago aplica deuda exacta, conserva remanente y no vuelve a sumar banco", async () => {
  const db = database(), { credit } = await register(db, { kind: "OVERPAYMENT" }); const result = await apply(db, credit.id);
  assert.equal(result.availableAmount, 50); assert.equal(db.rows.find((r) => r.id === "i").data.balance, 0);
  const receipt = db.rows.find((r) => r.recordType === "finance_invoice_receipt"); assert.equal(receipt.data.source, "customer_credit"); assert.equal(receipt.data.movementId, undefined);
  const feb = buildFinanceMonthlyClosePreview(db.rows, "2025-02"); assert.equal(feb.metrics.incoming, 0); assert.equal(feb.metrics.collected, 100); assert.equal(feb.metrics.customerCreditAvailable, 50); assert.equal(feb.status, "READY_TO_CLOSE");
  assert.equal(customerCreditsForClose(db.rows, "2025-01").availableAmount, 150);
});
test("aplica remanente después a varias facturas hasta agotar sin negativos", async () => {
  const db = database([bank(), invoice(), invoice("j", 20), invoice("k", 30)]), { credit } = await register(db);
  await apply(db, credit.id); await apply(db, credit.id, { allocations: [{ invoiceId: "j", amount: 20 }, { invoiceId: "k", amount: 30 }] });
  const saved = db.rows.find((r) => r.id === credit.id); assert.equal(saved.status, "USED"); assert.equal(auditCustomerCredit(saved, db.rows).available, 0);
  await assert.rejects(apply(db, credit.id, { allocations: [{ invoiceId: "j", amount: 1 }] }), /saldo a favor/);
});
test("impide exceso por factura y por saldo a favor sin cambios parciales", async () => {
  const db = database(), { credit } = await register(db); const before = structuredClone(db.rows);
  await assert.rejects(apply(db, credit.id, { allocations: [{ invoiceId: "i", amount: 101 }] }), /factura/);
  await assert.rejects(apply(db, credit.id, { allocations: [{ invoiceId: "i", amount: 151 }] }), /saldo a favor/); assert.deepEqual(db.rows, before);
});
test("no cruza tenants, RUT, moneda, cargos, traspasos o demostraciones", async () => {
  for (const patch of [{ direction: "DEBIT" }, { currency: "USD" }, { amount: -10 }, { amount: 0 }, { movementKind: "INTERNAL_TRANSFER" }, { isDemo: true }, { rut: "22222222-2" }]) { const m = bank(); Object.assign(m.data, patch); const db = database([m]); await assert.rejects(register(db)); assert.equal(db.rows.length, 1); }
  const db = database(), { credit } = await register(db);
  await assert.rejects(apply(db, credit.id, { tenantId: "other" }), /no encontrado/);
  db.rows.find((r) => r.id === "i").data.clientRut = "22222222-2"; await assert.rejects(apply(db, credit.id), /mismo cliente/);
});
test("no aplica anticipo antes del abono o antes de existir factura", async () => {
  const db = database(), { credit } = await register(db);
  for (const applicationDate of ["2025-01-01", "2025-01-15", "2025-02-30", "2999-01-01"]) await assert.rejects(apply(db, credit.id, { applicationDate }));
});
test("reversión de aplicación restaura deuda y crédito sin borrar evidencia", async () => {
  const db = database(), { credit } = await register(db), { application } = await apply(db, credit.id);
  await assert.rejects(reverse(db, credit.id), /primero/); await reverseApp(db, application.id);
  assert.equal(db.rows.find((r) => r.id === "i").data.balance, 100); assert.equal(db.rows.find((r) => r.id === credit.id).data.availableAmount, 150);
  assert.equal(db.rows.find((r) => r.recordType === "finance_invoice_receipt").status, "REVERSED"); assert.equal((await reverseApp(db, application.id)).alreadyReversed, true);
  await reverse(db, credit.id); assert.equal(db.rows.find((r) => r.id === "m").status, "PENDING"); assert.equal((await reverse(db, credit.id)).alreadyReversed, true);
  const next = await register(db); assert.notEqual(next.credit.id, credit.id); assert.equal(auditCustomerCredit(next.credit, db.rows).valid, true);
});
test("doble clic al registrar o aplicar no duplica saldos ni pagos", async () => {
  const db = database(); const results = await Promise.allSettled([register(db), register(db)]); assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  const credit = db.rows.find((r) => r.recordType === "finance_customer_credit"); const version = credit.data.version;
  const apps = await Promise.allSettled([apply(db, credit.id, { expectedVersion: version }), apply(db, credit.id, { expectedVersion: version })]); assert.equal(apps.filter((r) => r.status === "fulfilled").length, 1); assert.equal(db.rows.filter((r) => r.recordType === "finance_invoice_receipt").length, 1);
});
test("protege cierres: permite usar en mes nuevo anticipo de un mes cerrado", async () => {
  const db = database(), { credit } = await register(db); db.controls.find((c) => c.period === "2025-01").status = "CLOSED";
  const { application } = await apply(db, credit.id); db.controls.find((c) => c.period === "2025-02").status = "CLOSED";
  await assert.rejects(reverseApp(db, application.id), /cerrado/);
  db.controls.find((c) => c.period === "2025-02").status = "OPEN"; await reverseApp(db, application.id); await assert.rejects(reverse(db, credit.id), /cerrado/);
});
test("reversa bancaria genérica no salta el historial del crédito", async () => {
  const db = database(), { credit } = await register(db);
  await assert.rejects(reverseFinanceAllocation(db, { tenantId: "a", userId: "admin", reconciliationId: credit.data.reconciliationId, reason: "Intento de reversa por la ruta anterior" }), /Anticipos/);
});
test("si falla auditoría revierte toda la reserva", async () => {
  const db = database(), before = structuredClone(db.rows); db.tenantAuditLog.create = async () => { throw Error("audit down"); };
  await assert.rejects(register(db), /audit down/); assert.deepEqual(db.rows, before);
});
test("si falla auditoría al aplicar restaura factura, crédito y comprobantes", async () => {
  const db = database(), { credit } = await register(db), before = structuredClone(db.rows); db.tenantAuditLog.create = async () => { throw Error("audit down"); };
  await assert.rejects(apply(db, credit.id), /audit down/); assert.deepEqual(db.rows, before);
});
test("comprobantes alterados bloquean nuevas aplicaciones, reversión y cierre", async () => {
  const db = database(), { credit } = await register(db); await apply(db, credit.id); db.rows.find((r) => r.recordType === "finance_invoice_receipt").data.amount = 99;
  assert.equal(auditCustomerCredit(db.rows.find((r) => r.id === credit.id), db.rows).valid, false);
  await assert.rejects(apply(db, credit.id), /comprobante/); assert.ok(buildFinanceMonthlyClosePreview(db.rows, "2025-02").blockers.some((b) => b.type === "SALDO_FAVOR_INCONSISTENTE"));
});
test("la consulta separa empresas y no oculta remanentes por fecha", async () => {
  const db = database(), { credit } = await register(db); await apply(db, credit.id);
  const result = await listCustomerCredits(db, { tenantId: "a" }); assert.equal(result.total, 1); assert.equal(result.availableAmount, 50); assert.equal(result.records[0].ledger.applications.length, 1);
  assert.equal((await listCustomerCredits(db, { tenantId: "b" })).total, 0);
});
test("aplicaciones huérfanas no permiten cerrar aunque falte su abono", () => {
  const app = row("x", "finance_credit_application", { creditId: "missing", applicationDate: "2025-02-10" }, "APPLIED");
  assert.ok(customerCreditsForClose([app], "2025-02").blockers.length);
});
test("ambas entidades requieren aprobación y no son registros preparatorios", () => {
  for (const type of ["finance_customer_credit", "finance_credit_application"]) assert.equal(financeActionForRecordMutation(type), FINANCE_ACTIONS.APPROVE_RECONCILIATION);
});

test("un recibo bancario previo impide reservar aunque el movimiento diga pendiente", async () => {
  const db = database([bank(), invoice(), row("receipt", "finance_invoice_receipt", { movementId: "m", amount: 100 }, "RECONCILED")]);
  await assert.rejects(register(db), /ya respalda/); assert.equal(db.rows.length, 3);
});

test("el cierre y la aplicación detectan una segunda aprobación para el mismo abono", async () => {
  const db = database(), { credit } = await register(db); db.rows.push(row("duplicate", "finance_reconciliation", { movementId: "m" }, "APPROVED"));
  await assert.rejects(apply(db, credit.id), /adicionales/); assert.ok(customerCreditsForClose(db.rows, "2025-02").blockers.length);
});

test("roles de consulta y agentes no aprueban saldos; workflows no alteran sus registros", () => {
  for (const role of ["VIEWER", "AGENT", "SELLER"]) assert.equal(canPerformFinanceAction(role, FINANCE_ACTIONS.APPROVE_RECONCILIATION), false);
  for (const role of ["ADMIN", "OWNER", "SUPER_ADMIN"]) assert.equal(canPerformFinanceAction(role, FINANCE_ACTIONS.APPROVE_RECONCILIATION), true);
  for (const recordType of ["finance_customer_credit", "finance_credit_application"]) for (const action of [{ type: "create_record", recordType }, { type: "set_field", field: "availableAmount", value: 999 }]) assert.throws(() => assertWorkflowFinancialSafety([action], { recordType }));
});

test("saldo de factura alterado y asignación corrupta se detectan sin certificar cierre", async () => {
  const db = database(), { credit } = await register(db); const { application } = await apply(db, credit.id);
  const inv = db.rows.find((r) => r.id === "i"); inv.status = "OPEN"; Object.assign(inv.data, { status: "OPEN", balance: 100, paidAmount: 0 });
  assert.equal(auditCustomerCredit(db.rows.find((r) => r.id === credit.id), db.rows).valid, false);
  db.rows.find((r) => r.id === application.id).data.allocations = [null];
  assert.ok(customerCreditsForClose(db.rows, "2025-02").blockers.length);
});
