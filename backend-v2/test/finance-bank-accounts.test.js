import test from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import express from "express";
import { createServer } from "node:http";
import { listFinanceBankAccounts, saveFinanceBankAccount, resolveFinanceBankAccount } from "../src/services/finance-bank-accounts.service.js";
import { financeAccountKey, filterFinanceContext, buildFinanceContextCoverage } from "../src/services/finance-context.service.js";
import { normalizeBankStatementRows, bankMovementFingerprint, summarizeBankStatementRows, withBankStatementNet, readBankStatementFile, detectBankStatementCurrency } from "../src/services/finance-bank-statements.service.js";
import { normalizeBankReviewRows, exportBankReviewCsv } from "../src/services/finance-bank-review.service.js";
import { financeRecordCurrency, validFinanceAmount } from "../src/services/finance-currency.service.js";
import { buildPeriodCoverage } from "../src/services/finance-period-coverage.service.js";
import { getFinanceMonthlyClosePreview } from "../src/services/finance-monthly-close.service.js";
import { prisma } from "../src/lib/db.js";
import { financeRouter } from "../src/routes/finance.routes.js";
import { industryRecordsRouter } from "../src/routes/industry-records.routes.js";

const input = (patch = {}) => ({ bankKey: "bancoestado", accountAlias: "Operaciones", accountLast4: "1234", accountType: "Cuenta corriente", currency: "CLP", ...patch });
function database() {
  const db = { rows: [], audits: [] };
  const matches = (r, where) => Object.entries(where || {}).every(([key, value]) => value && typeof value === "object" ? value.in ? value.in.includes(r[key]) : true : r[key] === value);
  db.industryRecord = {
    findMany: async ({ where, cursor, skip = 0, take = 500 }) => { const rows = db.rows.filter((r) => matches(r, where)).sort((a, b) => a.id.localeCompare(b.id)); const start = cursor ? rows.findIndex((r) => r.id === cursor.id) + skip : 0; return structuredClone(rows.slice(start, start + take)); },
    findFirst: async ({ where }) => structuredClone(db.rows.find((r) => matches(r, where)) || null),
    create: async ({ data }) => { db.rows.push(structuredClone(data)); return structuredClone(data); },
    update: async ({ where, data }) => { const r = db.rows.find((r) => matches(r, where)); if (!r) throw Error("No encontrado"); Object.assign(r, structuredClone(data)); return structuredClone(r); }
  };
  db.tenantAuditLog = { create: async ({ data }) => { db.audits.push(structuredClone(data)); return data; } };
  db.financeBankImportJob = { findMany: async () => [] };
  db.tenantChannelConfig = { findMany: async () => [] };
  db.$transaction = async (fn, options) => { assert.equal(options.isolationLevel, "Serializable"); const before = structuredClone({ rows: db.rows, audits: db.audits }); try { return await fn(db); } catch (e) { db.rows = before.rows; db.audits = before.audits; throw e; } };
  return db;
}
const save = (db, patch = {}, extra = {}) => saveFinanceBankAccount(db, { tenantId: "a", userId: "admin", input: input(patch), ...extra });
const movement = (value = 10, currency = "CLP") => ({ Fecha: "01/01/2026", Glosa: "Abono de cliente", Abono: value, Moneda: currency });
const record = (id, recordType, data, status = "ACTIVE") => ({ id, tenantId: "a", recordType, data, status, title: id });

test("cuentas: crea identidad estable, moneda y auditoría sin guardar número completo", async () => {
  const db = database(), account = await save(db);
  assert.equal(account.bankAccountId, account.id); assert.equal(account.version, 1); assert.equal(account.status, "ACTIVE"); assert.equal(account.currency, "CLP");
  assert.equal(db.audits[0].action, "FINANCE_BANK_ACCOUNT_CREATED"); assert.equal(db.audits[0].actorUserId, "admin");
  await assert.rejects(save(db, { accountLast4: "123456789" }), (e) => e.status === 400);
  assert.equal(db.rows.length, 1);
});
test("cuentas: separa monedas y cuentas con iguales últimos dígitos", async () => {
  const db = database(), a = await save(db), b = await save(db, { currency: "USD" }), c = await save(db, { accountAlias: "Recaudación" });
  assert.equal(new Set([a, b, c].map(financeAccountKey)).size, 3);
  await assert.rejects(save(db, { accountAlias: "  OPERACIONES " }), (e) => e.status === 409);
});
test("cuentas: renombrar mantiene clave, huellas de movimientos e historial", async () => {
  const db = database(), a = await save(db);
  const before = normalizeBankStatementRows([movement()], a)[0];
  const b = await save(db, { ...a, accountAlias: "Nuevo nombre" }, { id: a.id });
  const after = normalizeBankStatementRows([movement()], b)[0];
  assert.equal(financeAccountKey(a), financeAccountKey(b)); assert.equal(before.fingerprint, after.fingerprint); assert.equal(b.version, 2);
  const rows = [record("m", "bank_movement", before), ...db.rows];
  const coverage = buildFinanceContextCoverage(rows, { period: "2026-01", accountKey: financeAccountKey(a), currency: "CLP" });
  assert.equal(coverage.accounts.length, 1); assert.equal(coverage.accounts[0].alias, "Nuevo nombre"); assert.equal(coverage.accounts[0].identification, "registered");
});
test("cuentas: moneda, banco, dígitos y tipo inmutables; versión antigua rechazada", async () => {
  const db = database(), a = await save(db);
  for (const patch of [{ currency: "USD" }, { bankKey: "bci" }, { accountLast4: "9999" }, { accountType: "Cuenta vista" }, { version: 0 }]) await assert.rejects(save(db, { ...a, ...patch }, { id: a.id }), (e) => e.status === 409);
  assert.equal(db.rows[0].data.version, 1);
});
test("cuentas: aislamiento de tenant tanto en lectura como edición y resolución", async () => {
  const db = database(), a = await save(db);
  assert.deepEqual(await listFinanceBankAccounts(db, "b"), []);
  await assert.rejects(save(db, { ...a }, { id: a.id, tenantId: "b" }), (e) => e.status === 404);
  await assert.rejects(resolveFinanceBankAccount(db, "b", { bankAccountId: a.id }), (e) => e.status === 404);
  const resolved = await resolveFinanceBankAccount(db, "a", { bankAccountId: a.id, currency: "USD", accountAlias: "Falsificado" });
  assert.equal(resolved.currency, "CLP"); assert.equal(resolved.accountAlias, "Operaciones");
});
test("cuentas: desactivar bloquea nuevas cargas pero no borra historial; reactivar conserva ID", async () => {
  const db = database(), a = await save(db);
  const b = await save(db, { ...a, status: "INACTIVE" }, { id: a.id });
  await assert.rejects(resolveFinanceBankAccount(db, "a", { bankAccountId: a.id }), (e) => e.status === 409);
  assert.equal((await listFinanceBankAccounts(db, "a"))[0].status, "INACTIVE");
  await save(db, { ...b, status: "ACTIVE" }, { id: a.id });
  assert.equal((await resolveFinanceBankAccount(db, "a", { bankAccountId: a.id })).bankAccountId, a.id);
});
test("cuentas: entradas inválidas y sesión ausente se rechazan sin escribir", async () => {
  const db = database();
  for (const patch of [{ currency: "XYZ" }, { accountAlias: "ab" }, { bankKey: "desconocido" }, { accountType: "inventado" }]) await assert.rejects(save(db, patch), (e) => e.status === 400);
  await assert.rejects(save(db, {}, { input: null }), (e) => e.status === 400);
  await assert.rejects(save(db, {}, { tenantId: "" }), (e) => e.status === 401);
  assert.equal(db.rows.length, 0);
});
test("cuentas: fallo de auditoría revierte la creación", async () => {
  const db = database(); db.tenantAuditLog.create = async () => { throw Error("fallo de auditoría simulado"); };
  await assert.rejects(save(db), /simulado/); assert.deepEqual(db.rows, []);
});
test("monedas: CLP entero, USD/EUR centavos y UF cuatro decimales sin redondear el original", () => {
  for (const [currency, value] of [["CLP", 1234], ["USD", 1234.56], ["EUR", 12.34], ["UF", 0.125]]) {
    const [r] = normalizeBankStatementRows([movement(value, currency)], input({ currency }));
    assert.equal(r.amount, value); assert.equal(r.currency, currency); assert.equal(r.needsReview, false);
  }
  const [invalid] = normalizeBankStatementRows([movement(0.125, "USD")], input({ currency: "USD" }));
  assert.equal(invalid.amount, 0.125); assert.ok(invalid.reviewReasons.some((r) => r.includes("precisión")));
  assert.equal(validFinanceAmount(Infinity, "USD"), false); assert.equal(validFinanceAmount(Number.MAX_SAFE_INTEGER, "USD"), false);
});
test("monedas: no mezcla filas ni convierte una cartola distinta de la cuenta", () => {
  assert.throws(() => normalizeBankStatementRows([movement(1, "USD"), movement(2, "CLP")], input()), (e) => e.status === 400);
  assert.throws(() => normalizeBankStatementRows([movement(2, "USD")], input()), (e) => e.status === 409);
  assert.throws(() => normalizeBankStatementRows([movement(2, "XYZ")], input()), (e) => e.status === 400);
  const rows = normalizeBankStatementRows([movement(2, "USD")], { bankKey: "bancoestado" }); assert.equal(rows[0].currency, "USD");
});
test("monedas: Excel numérico conserva 0.125 UF durante lectura, mapeo y nueva revisión", async () => {
  const wb = new ExcelJS.Workbook(), sh = wb.addWorksheet("Cartola");
  sh.addRow(["Fecha", "Glosa", "Abono", "Moneda"]); sh.addRow(["01/01/2026", "Pago de cliente", 0.125, "UF"]);
  const source = await readBankStatementFile({ originalname: "cartola.xlsx", buffer: Buffer.from(await wb.xlsx.writeBuffer()) });
  assert.equal(source[0].Abono, 0.125);
  const preview = normalizeBankReviewRows(JSON.parse(JSON.stringify(source)), input({ currency: "UF" }), { mapping: { credit: "Abono" } });
  assert.equal(preview[0].amount, 0.125); assert.equal(preview[0].needsReview, false);
});
test("monedas: CSV chileno conserva coma decimal y exportación indica la moneda", async () => {
  const source = await readBankStatementFile({ originalname: "cartola.csv", buffer: Buffer.from("Fecha;Glosa;Abono;Moneda\n01/01/2026;Pago cliente;1.234,56;USD") });
  const rows = normalizeBankReviewRows(source, input({ currency: "USD" }));
  assert.equal(rows[0].amount, 1234.56);
  const csv = exportBankReviewCsv({ sourceRows: source, normalizedRows: rows, revision: 1 }, { revision: 1 });
  assert.match(csv, /"Moneda"/); assert.match(csv, /"USD"/);
});
test("monedas: detecta carátula explícita y respeta la hoja seleccionada", async () => {
  const wb = new ExcelJS.Workbook();
  wb.addWorksheet("Pesos").addRow(["Moneda:", "PESOS DE CHILE"]);
  wb.addWorksheet("Dólares").addRow(["Currency", "USD"]);
  const file = { originalname: "archivo.xlsx", buffer: Buffer.from(await wb.xlsx.writeBuffer()) };
  assert.equal(await detectBankStatementCurrency(file, { sheet: "Pesos" }), "CLP");
  assert.equal(await detectBankStatementCurrency(file, { sheet: "Dólares" }), "USD");
  await assert.rejects(detectBankStatementCurrency(file), /varias monedas/);
  assert.equal(await detectBankStatementCurrency({ originalname: "USD.csv", buffer: Buffer.from("Fecha;Descripción;Monto\n01/01/2026;Venta USD;10") }), "");
});
test("monedas: UF con punto ambiguo exige revisión, no importa una magnitud supuesta", () => {
  const rows = normalizeBankStatementRows([movement("1.234", "UF"), movement("1,234", "UF"), movement("0.125", "UF")], input({ currency: "UF" }));
  assert.ok(rows[0].reviewReasons.some((r) => r.includes("ambiguo")));
  assert.equal(rows[1].amount, 1.234); assert.equal(rows[1].needsReview, false);
  assert.equal(rows[2].amount, 0.125); assert.equal(rows[2].needsReview, false);
});
test("monedas: huellas distinguen centavos, divisa, sentido y cuenta", () => {
  const base = normalizeBankStatementRows([movement(0.1, "USD")], input({ currency: "USD", bankAccountId: "a" }))[0];
  const changed = [{ amount: 0.2 }, { currency: "EUR" }, { direction: "DEBIT" }, { bankAccountId: "b" }].map((patch) => bankMovementFingerprint({ ...base, ...patch }));
  assert.equal(new Set([base.fingerprint, ...changed]).size, 5);
  const legacy = normalizeBankStatementRows([movement()], input())[0];
  const { currency, ...withoutCurrency } = legacy;
  assert.equal(bankMovementFingerprint(legacy), bankMovementFingerprint(withoutCurrency));
  assert.equal(financeAccountKey(input()), financeAccountKey({ ...input(), currency: undefined }));
});
test("monedas: resumen conserva fracciones y rechaza sumar monedas distintas", () => {
  const rows = normalizeBankStatementRows([movement(0.1, "USD"), movement(0.2, "USD"), { Fecha: "02/01/2026", Glosa: "Pago proveedor", Cargo: 0.1, Moneda: "USD" }], input({ currency: "USD" }));
  const summary = withBankStatementNet(summarizeBankStatementRows(rows)); assert.equal(summary.credits, 0.3); assert.equal(summary.net, 0.2);
  assert.throws(() => summarizeBankStatementRows([...rows, { ...rows[0], currency: "CLP" }]), /monedas distintas/);
});
test("monedas: contexto hereda cuenta y moneda desde el lote y conserva excepciones", () => {
  const a = input({ currency: "USD", bankAccountId: "a" });
  const rows = [record("s", "bank_statement", { account: a, coverage: { from: "2026-01-01", to: "2026-01-31" } }), record("m", "bank_movement", { importBatchId: "s", transactionDate: "2026-01-02", amount: 1 }), record("e", "finance_exception", { movementId: "m" })];
  const index = new Map(rows.map((r) => [r.id, r])); assert.equal(financeRecordCurrency(rows[2], index), "USD");
  const ctx = { period: "2026-01", accountKey: financeAccountKey(a), currency: "USD" };
  assert.equal(filterFinanceContext(rows, ctx).length, 3); assert.equal(filterFinanceContext(rows, { ...ctx, currency: "CLP" }).length, 0);
  assert.equal(buildFinanceContextCoverage(rows, ctx).accounts[0].currency, "USD");
});
test("monedas: cobertura CLP considera cuentas activas vacías pero no cuentas USD ni inactivas vacías", () => {
  const rows = [record("clp", "finance_bank_account", input({ bankAccountId: "clp" })), record("usd", "finance_bank_account", input({ currency: "USD", bankAccountId: "usd" })), record("inactive", "finance_bank_account", input({ bankAccountId: "inactive" }), "INACTIVE")];
  const coverage = buildPeriodCoverage({ tenantId: "a", period: "2026-01", records: rows });
  assert.equal(coverage.sources.filter((s) => s.kind === "BANK").length, 1);
  assert.equal(coverage.sources.find((s) => s.kind === "BANK").count, 0);
});
test("monedas: cierre no atribuye actividad a la creación de una cuenta ni mezcla otra moneda", async () => {
  const db = database(); await save(db); await save(db, { currency: "USD" });
  db.rows.push(record("usd-m", "bank_movement", { ...input({ currency: "USD" }), amount: 100, transactionDate: "2026-01-01", direction: "CREDIT" }));
  const close = await getFinanceMonthlyClosePreview({ db, tenantId: "a", period: "2026-01" });
  assert.ok(close.blockers.some((b) => b.type === "SIN_DATOS_DEL_PERIODO"));
});
test("HTTP cuentas: permisos, empresa autenticada y protección de la ruta genérica", async (t) => {
  const db = database(), originalTx = prisma.$transaction, originalRead = prisma.industryRecord.findMany, originalModules = prisma.tenantModule.findMany;
  let enabled = true;
  prisma.tenantModule.findMany = async ({ where }) => where.module.in.map((module) => ({ module, enabled, source: "MANUAL" }));
  prisma.$transaction = (fn, opts) => db.$transaction(fn, opts); prisma.industryRecord.findMany = (args) => db.industryRecord.findMany(args);
  t.after(() => { prisma.$transaction = originalTx; prisma.industryRecord.findMany = originalRead; prisma.tenantModule.findMany = originalModules; });
  const app = express(); app.use(express.json()); app.use((req, _res, next) => { req.tenantId = req.headers["x-test-tenant"] || "a"; req.tenant = { id: req.tenantId, industry: "FINANCE" }; req.user = { id: "http-admin", tenantId: req.tenantId, role: req.headers["x-test-role"] || "SUPER_ADMIN" }; next(); }); app.use(financeRouter); app.use(industryRecordsRouter);
  const server = createServer(app); await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve)); t.after(() => { server.closeAllConnections(); server.close(); });
  const call = async (path, method = "GET", body, role = "SUPER_ADMIN", tenant = "a") => { const res = await fetch(`http://127.0.0.1:${server.address().port}${path}`, { method, headers: { "Content-Type": "application/json", "x-test-role": role, "x-test-tenant": tenant }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(5000) }); return { status: res.status, data: await res.json() }; };
  assert.equal((await call("/finance/bank-accounts", "POST", input(), "VIEWER")).status, 403);
  assert.equal((await call("/finance/bank-accounts", "POST", input(), "AGENT")).status, 403);
  enabled = false; assert.equal((await call("/finance/bank-accounts", "POST", input(), "ADMIN")).status, 403); enabled = true;
  const created = await call("/finance/bank-accounts", "POST", { ...input(), tenantId: "forged", userId: "forged" }); assert.equal(created.status, 201);
  assert.equal(db.rows[0].tenantId, "a"); assert.equal(db.audits[0].actorUserId, "http-admin");
  assert.equal((await call("/finance/bank-accounts")).data.accounts.length, 1);
  assert.equal((await call("/finance/bank-accounts", "GET", null, "SUPER_ADMIN", "b")).data.accounts.length, 0);
  assert.equal((await call(`/finance/bank-accounts/${created.data.account.id}`, "PATCH", { ...created.data.account, accountAlias: "Intrusión" }, "SUPER_ADMIN", "b")).status, 404);
  assert.equal((await call("/industry-records", "POST", { recordType: "finance_bank_account", title: "Atajo", data: input() })).status, 409);
});
