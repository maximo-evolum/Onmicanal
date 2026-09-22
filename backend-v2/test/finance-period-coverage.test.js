import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildPeriodCoverage, periodBounds, validateCoverageDeclarations, applyPeriodCoverage, reviewFinancePeriodCoverage } from "../src/services/finance-period-coverage.service.js";
import { getFinanceMonthlyClosePreview } from "../src/services/finance-monthly-close.service.js";
import { closeFinancePeriod, reopenFinancePeriod } from "../src/services/finance-period-control.service.js";
import { financeActionForRecordMutation, FINANCE_ACTIONS, canPerformFinanceAction } from "../src/services/finance-security.service.js";

const account = { bankKey: "santander", accountAlias: "Operaciones", accountLast4: "1234", accountType: "Cuenta corriente" };
const now = new Date("2026-03-05T12:00:00Z");
const row = (id, recordType, data = {}, status = "OPEN") => ({ id, tenantId: "t", recordType, status, data, title: id, updatedAt: "2026-02-01" });
const invoice = () => row("i", "finance_invoice", { amount: 100, balance: 100, issueDate: "2026-01-03", currency: "CLP" });
const bank = (id = "m", date = "2026-01-05") => row(id, "bank_movement", { ...account, amount: 100, direction: "CREDIT", transactionDate: date, currency: "CLP", description: "Transferencia según cartola original" });
const build = (records = [], extra = {}) => buildPeriodCoverage({ tenantId: "t", period: "2026-01", records, now, ...extra });
const declarations = (coverage) => coverage.sources.map((s) => ({ sourceId: s.id, status: s.count || s.statements ? "COMPLETE" : "NO_ACTIVITY", from: coverage.from, to: coverage.to, expectedCount: s.count, evidence: "Revisión del reporte original del mes, todas las páginas y fuentes." }));
function reviewed(records, extra = {}) {
  const c = build(records, extra);
  const review = row("review", "finance_period_coverage", { period: c.period, fingerprint: c.fingerprint, declarations: declarations(c), inventoryConfirmed: true, reviewedAt: now.toISOString(), reviewedById: "admin" }, "REVIEWED");
  return [...records, review];
}

test("mes calendario, incluido febrero bisiesto, y rechazo de período inválido", () => {
  assert.equal(periodBounds("2024-02").to, "2024-02-29"); assert.equal(periodBounds("2026-02").to, "2026-02-28");
  for (const p of ["2026-13", "", "enero", "26-01"]) assert.throws(() => periodBounds(p));
});
test("tener registros, incluso al principio y fin del mes, nunca certifica cobertura automáticamente", () => {
  const c = build([invoice(), bank("a", "2026-01-01"), bank("b", "2026-01-31")]);
  assert.equal(c.complete, false); assert.equal(c.status, "PENDING");
  assert.equal(c.sources.find((s) => s.kind === "BANK").count, 2);
});
test("días sin movimientos no se marcan como huecos", () => {
  const c = build(reviewed([bank()])); assert.equal(c.complete, true); assert.equal(c.blockers.length, 0);
});
test("detecta varias cuentas, también la configurada que no recibió cartolas", () => {
  const c = build([bank()], { accounts: [account, { ...account, accountLast4: "5678" }] });
  const banks = c.sources.filter((s) => s.kind === "BANK"); assert.equal(banks.length, 2); assert.deepEqual(banks.map((s) => s.count).sort(), [0, 1]);
});
test("no acepta declarar completa una fuente sin registros ni cartolas", () => {
  const c = build(); const d = declarations(c); d[0].status = "COMPLETE";
  assert.throws(() => validateCoverageDeclarations(c, { inventoryConfirmed: true, declarations: d }), /no tiene datos/);
});
test("mes sin actividad requiere declaración expresa de todas las fuentes", () => {
  assert.equal(build().complete, false);
  const c = build(reviewed([])); assert.equal(c.complete, true);
  const preview = applyPeriodCoverage({ period: c.period, status: "REQUIRES_REVIEW", blockers: [{ type: "SIN_DATOS_DEL_PERIODO", id: "none" }] }, c);
  assert.equal(preview.status, "READY_TO_CLOSE");
});
test("una revisión no elimina bloqueos de conciliación", () => {
  const c = build(reviewed([bank()])); const p = applyPeriodCoverage({ period: c.period, blockers: [{ id: "r", type: "MOVIMIENTO_SIN_CONCILIAR" }] }, c);
  assert.equal(p.status, "REQUIRES_REVIEW"); assert.equal(p.blockers[0].id, "r");
});
test("no acepta sin actividad o fuera de alcance si existen registros", () => {
  const c = build([bank()]); for (const status of ["NO_ACTIVITY", "NOT_APPLICABLE"]) {
    const d = declarations(c); d.find((x) => x.sourceId.startsWith("bank:")).status = status;
    assert.throws(() => validateCoverageDeclarations(c, { inventoryConfirmed: true, declarations: d }), /tiene registros/);
  }
});
test("exige inventario, evidencias, fuentes exactas y revisión del mes entero", () => {
  const c = build([invoice()]); const d = declarations(c);
  for (const entries of [d.slice(1), [...d, d[0]], [d[0], d[0], d[2]], d.map((x) => ({ ...x, evidence: "sí" })), d.map((x) => ({ ...x, from: "2026-01-02" })), d.map((x) => ({ ...x, to: "2026-01-30" })), d.map((x) => ({ ...x, to: "2026-02-30" }))]) assert.throws(() => validateCoverageDeclarations(c, { inventoryConfirmed: true, declarations: entries }));
  assert.throws(() => validateCoverageDeclarations(c, { inventoryConfirmed: false, declarations: d }));
});
test("fechas desconocidas y movimientos sin cuenta impiden la verificación", () => {
  const c = build([row("i", "finance_invoice", { amount: 100 }), row("m", "bank_movement", { transactionDate: "2026-01-01", amount: 10 })]);
  assert.ok(c.blockers.some((b) => b.type === "COBERTURA_FECHA_DESCONOCIDA")); assert.ok(c.blockers.some((b) => b.type === "COBERTURA_CUENTA_DESCONOCIDA"));
});
test("la cantidad informada por la fuente original debe coincidir exactamente", () => {
  const c = build([invoice()]);
  for (const expectedCount of [undefined, -1, 1.5, "1", 0, 2]) {
    const d = declarations(c); d[0].expectedCount = expectedCount;
    assert.throws(() => validateCoverageDeclarations(c, { inventoryConfirmed: true, declarations: d }));
  }
});
test("un banco sin alias ni últimos dígitos no distingue la cuenta", () => {
  const c = build([], { accounts: [{ bankKey: "santander", accountAlias: "Cuenta sin nombre" }] }); assert.ok(c.blockers.some((b) => b.type === "COBERTURA_CUENTA_DESCONOCIDA"));
});
test("cargas pendientes, fallidas o sin rango impiden afirmar mes completo", () => {
  for (const job of [{ status: "FAILED" }, { status: "PROCESSING" }, { status: "READY", periodRange: { from: "2026-01-03", to: "2026-01-30" } }]) {
    const c = build([], { jobs: [{ id: "j", ...job }] }); assert.ok(c.blockers.some((b) => b.type === "IMPORTACION_PENDIENTE"));
  }
  assert.equal(build([], { jobs: [{ id: "j", status: "READY", periodRange: { from: "2025-12-01", to: "2025-12-31" } }] }).blockers.length, 0);
});
test("período actual o futuro no puede verificarse como terminado", () => {
  for (const period of ["2026-03", "2026-04"]) assert.ok(build([], { period }).blockers.some((b) => b.type === "COBERTURA_PERIODO_EN_CURSO"));
  assert.ok(build([], { now: new Date("2026-02-01T01:00:00Z") }).blockers.some((b) => b.type === "COBERTURA_PERIODO_EN_CURSO"));
});
test("cambiar monto, estado, fecha, inventario o reabrir invalida revisión", () => {
  for (const mutate of [(rs) => { rs[0].data.amount++; }, (rs) => { rs[0].status = "DELETED"; }, (rs) => { rs[0].data.issueDate = "2026-01-04"; }, (rs) => rs.push(bank()), (rs) => rs.push(row("reopen", "finance_period_reopening", { period: "2026-01" }))]) {
    const records = reviewed([invoice()]); mutate(records); const c = build(records); assert.equal(c.complete, false); assert.equal(c.status, "STALE");
  }
  assert.equal(build(reviewed([invoice()]), { accounts: [account] }).complete, false);
});
test("la huella es estable ante orden de consulta y claves JSON", () => {
  const records = [invoice(), bank()]; const accounts = [account, { ...account, accountLast4: "5678" }];
  assert.equal(build(records, { accounts }).fingerprint, build([...records].reverse(), { accounts: [...accounts].reverse() }).fingerprint);
});
test("no mezcla revisiones ni documentos de otra empresa", () => {
  const records = reviewed([invoice()]).map((r) => ({ ...r, tenantId: "other" })); const c = build(records);
  assert.equal(c.review, null); assert.equal(c.sources[0].count, 0); assert.equal(c.fingerprint, build().fingerprint);
});
test("una revisión con inventario o declaraciones manipuladas no habilita el cierre", () => {
  const records = reviewed([invoice()]); records[1].data.inventoryConfirmed = false; assert.equal(build(records).complete, false);
});

function database() {
  let rows = [], audits = [], control = null; let seq = 0, tail = Promise.resolve();
  const match = (r, where) => Object.entries(where).every(([k, v]) => v?.in ? v.in.includes(r[k]) : r[k] === v);
  const db = {
    get rows() { return rows; }, get audits() { return audits; }, get control() { return control; },
    tenantChannelConfig: { findMany: async ({ where }) => { assert.equal(where.tenantId, "t"); return []; } },
    financeBankImportJob: { findMany: async () => [] },
    $transaction: (fn, options) => { assert.equal(options.isolationLevel, "Serializable"); const result = tail.then(async () => { const before = structuredClone({ rows, audits, control }); try { return await fn(db); } catch (e) { ({ rows, audits, control } = before); throw e; } }); tail = result.catch(() => {}); return result; },
    financePeriodControl: {
      upsert: async ({ create, update }) => { if (!control) control = structuredClone(create); else control.lockVersion += update.lockVersion.increment; return structuredClone(control); },
      update: async ({ data }) => { if (data.version) control.version += data.version.increment; if (data.status) control.status = data.status; if (data.latestCloseId) control.latestCloseId = data.latestCloseId; return structuredClone(control); }
    },
    industryRecord: {
      findMany: async ({ where, cursor, skip = 0, take }) => { const found = rows.filter((r) => match(r, where)); const start = cursor ? found.findIndex((r) => r.id === cursor.id) + skip : 0; return structuredClone(found.slice(start, start + take)); },
      findFirst: async ({ where }) => structuredClone(rows.find((r) => match(r, where)) || null),
      create: async ({ data }) => { const r = { id: `r${++seq}`, createdAt: new Date().toISOString(), ...structuredClone(data) }; rows.push(r); return structuredClone(r); }
    }, tenantAuditLog: { create: async ({ data }) => { audits.push(data); } }
  }; return db;
}
async function request(db, extra = {}) {
  const { coverage } = await getFinanceMonthlyClosePreview({ tenantId: "t", period: "2026-01", db });
  return { tenantId: "t", userId: "admin", period: "2026-01", expectedVersion: db.control?.version || 0, fingerprint: coverage.fingerprint, confirmation: "VERIFICAR", inventoryConfirmed: true, declarations: declarations(coverage), ...extra };
}
test("flujo real: no permite cierre vacío; revisión sin actividad lo habilita y guarda evidencia", async () => {
  const db = database(); const args = { tenantId: "t", userId: "admin", period: "2026-01", expectedVersion: 0, confirmation: "CERRAR" };
  await assert.rejects(closeFinancePeriod(db, args), /cobertura/);
  await reviewFinancePeriodCoverage(db, await request(db));
  const p = await getFinanceMonthlyClosePreview({ tenantId: "t", period: "2026-01", db }); assert.equal(p.status, "READY_TO_CLOSE");
  const result = await closeFinancePeriod(db, { ...args, expectedVersion: 1 });
  assert.equal(result.close.data.coverage.complete, true); assert.equal(result.close.data.coverage.review.reviewedById, "admin");
  assert.equal(db.audits[0].action, "FINANCE_PERIOD_COVERAGE_REVIEWED");
  await assert.rejects(reviewFinancePeriodCoverage(db, await request(db)), /cerrado/);
});
test("la reapertura real exige volver a verificar y conserva la fotografía", async () => {
  const db = database(); await reviewFinancePeriodCoverage(db, await request(db));
  const c = await closeFinancePeriod(db, { tenantId: "t", userId: "admin", period: "2026-01", expectedVersion: 1, confirmation: "CERRAR" });
  await reopenFinancePeriod(db, { tenantId: "t", userId: "admin", period: "2026-01", closeId: c.close.id, expectedVersion: 2, confirmation: "REABRIR", reason: "Corregir datos del período revisado" });
  const p = await getFinanceMonthlyClosePreview({ tenantId: "t", period: "2026-01", db }); assert.equal(p.coverage.status, "STALE"); assert.equal(c.close.data.coverage.complete, true);
});
test("cambio concurrente de datos, versión o confirmación no guarda revisión", async () => {
  const db = database(); const args = await request(db); db.rows.push(invoice());
  await assert.rejects(reviewFinancePeriodCoverage(db, args), /datos cambiaron/);
  for (const extra of [{ expectedVersion: 99 }, { confirmation: "" }, { userId: null }]) await assert.rejects(reviewFinancePeriodCoverage(db, await request(db, extra)));
  assert.equal(db.audits.length, 0); assert.equal(db.rows.length, 1);
});
test("fallo de auditoría revierte revisión y versión", async () => {
  const db = database(); db.tenantAuditLog.create = async () => { throw new Error("audit failed"); };
  await assert.rejects(reviewFinancePeriodCoverage(db, await request(db)), /audit failed/); assert.equal(db.rows.length, 0); assert.equal(db.control, null);
});
test("doble confirmación concurrente guarda una sola revisión", async () => {
  const db = database(); const args = await request(db); const results = await Promise.allSettled([reviewFinancePeriodCoverage(db, args), reviewFinancePeriodCoverage(db, args)]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1); assert.equal(db.rows.length, 1);
});
test("permisos de cobertura son de cierre y no se puede fabricar por CRUD genérico", () => {
  assert.equal(financeActionForRecordMutation("finance_period_coverage"), FINANCE_ACTIONS.CLOSE_PERIOD);
  for (const role of ["AGENT", "SELLER", "VIEWER"]) assert.equal(canPerformFinanceAction(role, FINANCE_ACTIONS.CLOSE_PERIOD), false);
  const source = readFileSync(new URL("../src/routes/industry-records.routes.js", import.meta.url), "utf8");
  assert.match(source, /if \(recordType === "finance_period_coverage"\)/);
  const router = readFileSync(new URL("../src/routes/finance.routes.js", import.meta.url), "utf8");
  assert.match(router, /monthly-close\/:period\/coverage", requireRole\(ROLE_GROUPS.MANAGERS\), requireFinancePermission\(FINANCE_ACTIONS.CLOSE_PERIOD\)/);
});
