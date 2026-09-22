import { createHash } from "node:crypto";
import { FinanceOperationError, withFinanceWrite } from "./finance-integrity.service.js";
import { financeAccountKey, financeRecordAccount, financeOperationalDate } from "./finance-context.service.js";
import { financeDocumentSide } from "./finance-document-values.service.js";
import { assertFinancePeriodOpen } from "./finance-period-control.service.js";
import { getFinanceMonthlyClosePreview } from "./finance-monthly-close.service.js";
import { historicalCoverageBlockers } from "./finance-historical-quality.service.js";

const dataOf = (r) => r?.data || {};
const text = (v) => String(v ?? "").trim();
const inactive = (r) => ["DELETED", "EXCLUDED", "REPROCESSED"].includes(r.status) || dataOf(r).excluded === true;
const day = (v) => { const s = text(v).slice(0, 10); return /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s ? s : ""; };
const canonical = (value) => Array.isArray(value) ? value.map(canonical) : value && typeof value === "object" ? value instanceof Date ? value.toISOString() : Object.fromEntries(Object.keys(value).sort().map((k) => [k, canonical(value[k])])) : value;
const fail = (message, status = 400) => { throw new FinanceOperationError(status, message); };

export function periodBounds(period) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(text(period))) fail("Selecciona un período válido (AAAA-MM).");
  const [year, month] = period.split("-").map(Number);
  return { from: `${period}-01`, to: `${period}-${new Date(Date.UTC(year, month, 0)).getUTCDate()}` };
}

// A range of movement dates is NOT proof that a statement covers a whole month.
// External completeness requires an accountable human review, invalidated by changes.
export function buildPeriodCoverage({ tenantId, period, records, jobs = [], accounts = [], now = new Date() }) {
  const bounds = periodBounds(period);
  records = records.filter((r) => r.tenantId === tenantId);
  const index = new Map(records.map((r) => [r.id, r]));
  const known = new Map();
  const addAccount = (a) => { const key = financeAccountKey(a); if (key) known.set(key, { id: `bank:${key}`, label: `${text(a.bank || a.bankKey)} · ${text(a.accountAlias) || "Cuenta sin nombre"}${a.accountLast4 ? ` · ****${text(a.accountLast4)}` : ""}`, kind: "BANK", count: 0, statements: 0, dates: [], identified: Boolean(text(a.accountLast4) || (text(a.accountAlias) && text(a.accountAlias).toLowerCase() !== "cuenta sin nombre")) }); return key; };
  for (const a of accounts) addAccount(a);
  for (const r of records) if (!inactive(r) && ["bank_statement", "bank_movement", "finance_open_banking_consent"].includes(r.recordType)) addAccount(financeRecordAccount(r, index));
  const sources = [
    { id: "customers", label: "Documentos emitidos a clientes", kind: "DOCUMENTS", count: 0, statements: 0, dates: [] },
    { id: "suppliers", label: "Documentos recibidos de proveedores", kind: "DOCUMENTS", count: 0, statements: 0, dates: [] }
  ];
  const blockers = historicalCoverageBlockers(records, period);
  const periodBatches = new Set(records.filter((r) => r.recordType === "bank_movement" && !inactive(r) && day(financeOperationalDate(r, index)).startsWith(period + "-")).map((r) => dataOf(r).importBatchId || dataOf(r).sourceBatchId).filter(Boolean));
  for (const source of known.values()) if (!source.identified) blockers.push({ type: "COBERTURA_CUENTA_DESCONOCIDA", id: `coverage-identity-${source.id}`, title: `${source.label}: agrega un alias identificable o los últimos cuatro dígitos para distinguir la cuenta.` });
  for (const r of records) {
    if (inactive(r)) continue;
    const document = ["finance_invoice", "finance_payable"].includes(r.recordType);
    const movement = r.recordType === "bank_movement";
    if (!document && !movement && r.recordType !== "bank_statement") continue;
    if (text(dataOf(r).currency || "CLP").toUpperCase() !== "CLP") continue;
    const date = day(financeOperationalDate(r, index));
    if ((document || movement) && !date) {
      blockers.push({ type: "COBERTURA_FECHA_DESCONOCIDA", id: `coverage-date-${r.id}`, title: `${r.title || r.id}: falta una fecha válida para determinar a qué período pertenece.` });
      continue;
    }
    if (document && date.startsWith(period + "-")) { const s = sources[financeDocumentSide(r) === "SUPPLIER" ? 1 : 0]; s.count++; s.dates.push(date); }
    if (movement && date.startsWith(period + "-")) {
      const key = financeAccountKey(financeRecordAccount(r, index));
      if (!key) blockers.push({ type: "COBERTURA_CUENTA_DESCONOCIDA", id: `coverage-account-${r.id}`, title: `${r.title || r.id}: identifica el banco y la cuenta antes de verificar el período.` });
      else { const s = known.get(key); s.count++; s.dates.push(date); }
    }
    if (r.recordType === "bank_statement") {
      const s = known.get(financeAccountKey(financeRecordAccount(r, index)));
      const linked = periodBatches.has(r.id);
      const range = dataOf(r).coverage;
      if (s && (linked || (day(range?.from) && day(range?.to) && range.from <= bounds.to && range.to >= bounds.from))) s.statements++;
    }
  }
  sources.push(...[...known.values()].sort((a, b) => a.id.localeCompare(b.id)));
  if (!known.size) sources.push({ id: "bank:none", label: "Inventario bancario sin cuentas registradas", kind: "BANK", count: 0, statements: 0, dates: [] });
  const todayParts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now).map((p) => [p.type, p.value]));
  if (bounds.to >= `${todayParts.year}-${todayParts.month}-${todayParts.day}`) blockers.push({ type: "COBERTURA_PERIODO_EN_CURSO", id: `coverage-future-${period}`, title: "El período aún no ha terminado en Chile. Puedes revisar los datos, pero no certificar el mes completo ni cerrarlo." });
  for (const job of jobs) {
    const range = job.status === "READY" ? job.periodRange : null;
    if (!day(range?.from) || !day(range?.to) || (range.from <= bounds.to && range.to >= bounds.from)) blockers.push({ type: "IMPORTACION_PENDIENTE", id: `coverage-job-${job.id}`, title: `Resuelve la carga pendiente: ${job.sourceFile || job.id}.` });
  }
  const fingerprint = createHash("sha256").update(JSON.stringify(canonical({ tenantId, period, accounts: accounts.map(canonical).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
    records: records.filter((r) => r.recordType !== "finance_period_coverage").sort((a, b) => a.id.localeCompare(b.id)).map((r) => ({ id: r.id, type: r.recordType, status: r.status, data: r.data, updatedAt: r.updatedAt })), jobs: [...jobs].sort((a, b) => a.id.localeCompare(b.id)) }))).digest("hex");
  const reviews = records.filter((r) => r.recordType === "finance_period_coverage" && r.status === "REVIEWED" && dataOf(r).period === period).sort((a, b) => text(dataOf(b).reviewedAt).localeCompare(text(dataOf(a).reviewedAt)) || b.id.localeCompare(a.id));
  const review = reviews[0];
  const current = review && dataOf(review).fingerprint === fingerprint;
  const sourceViews = sources.map(({ dates, ...s }) => ({ ...s, firstMovementOrDocumentDate: dates.sort()[0] || null, lastMovementOrDocumentDate: dates.at(-1) || null }));
  let reviewValid = false;
  if (current) { try { validateCoverageDeclarations({ sources: sourceViews, ...bounds }, dataOf(review)); reviewValid = true; } catch {} }
  return { period, ...bounds, fingerprint, sources: sourceViews, blockers,
    complete: Boolean(current && reviewValid && !blockers.length), status: current && reviewValid && !blockers.length ? "REVIEWED" : review ? "STALE" : "PENDING",
    review: review ? { id: review.id, reviewedAt: dataOf(review).reviewedAt, reviewedById: dataOf(review).reviewedById, declarations: Array.isArray(dataOf(review).declarations) ? dataOf(review).declarations : [], inventoryConfirmed: dataOf(review).inventoryConfirmed } : null,
    basis: "Cobertura declarada por una persona autorizada y vinculada a los datos actuales. No es una certificación automática del banco, SII o ERP. Los días sin movimientos no demuestran faltantes ni ausencia de actividad." };
}

export function validateCoverageDeclarations(coverage, input) {
  if (input.inventoryConfirmed !== true) fail("Confirma que están registradas todas las cuentas y fuentes documentales de la empresa para este período.");
  if (!Array.isArray(input.declarations) || input.declarations.length !== coverage.sources.length) fail("Revisa todas las fuentes del período, sin omitir ni agregar cuentas desconocidas.");
  const seen = new Set();
  return input.declarations.map((entry) => {
    const source = coverage.sources.find((s) => s.id === entry?.sourceId);
    if (!source || seen.has(source.id)) fail("La fuente de cobertura es inválida o está repetida.");
    seen.add(source.id);
    const status = entry.status, evidence = text(entry.evidence), from = day(entry.from), to = day(entry.to);
    if (!Number.isSafeInteger(entry.expectedCount) || entry.expectedCount < 0) fail(`Indica cuántos registros contiene la fuente original de ${source.label}.`);
    if (entry.expectedCount !== source.count) fail(`${source.label}: la fuente original indica ${entry.expectedCount} registro(s), pero hay ${source.count} cargado(s). Resuelve la diferencia antes de verificar.`, 409);
    if (!["COMPLETE", "NO_ACTIVITY", "NOT_APPLICABLE"].includes(status)) fail(`Indica el resultado de revisión de ${source.label}.`);
    if (evidence.length < 10 || evidence.length > 1500) fail(`Anota la referencia y explicación de ${source.label} (10 a 1.500 caracteres).`);
    if (!from || !to || from > coverage.from || to < coverage.to || from > to) fail(`La revisión de ${source.label} debe cubrir desde ${coverage.from} hasta ${coverage.to}.`);
    if (status === "COMPLETE" && !source.count && !source.statements) fail(`${source.label} no tiene datos cargados: importa los documentos o declara y respalda la ausencia de actividad.`);
    if (status !== "COMPLETE" && source.count > 0) fail(`${source.label} tiene registros del mes: no puede declararse sin actividad ni fuera de alcance.`);
    if (status === "NOT_APPLICABLE" && source.kind !== "BANK") fail("Sólo una cuenta bancaria sin movimientos puede declararse fuera de alcance, con motivo.");
    return { sourceId: source.id, status, evidence, from, to, expectedCount: entry.expectedCount };
  });
}

export function applyPeriodCoverage(preview, coverage) {
  const blockers = [...preview.blockers.filter((b) => !(coverage.complete && b.type === "SIN_DATOS_DEL_PERIODO")), ...coverage.blockers];
  if (!coverage.complete) blockers.push({ type: "COBERTURA_PENDIENTE", id: `coverage-review-${preview.period}`, title: coverage.status === "STALE" ? "Los datos cambiaron o la revisión ya no es válida. Vuelve a verificar la cobertura del mes." : "Falta verificar el período completo: cuentas bancarias, documentos de clientes y proveedores." });
  return { ...preview, coverage, blockers: [...new Map(blockers.map((b) => [b.id, b])).values()], status: blockers.length ? "REQUIRES_REVIEW" : "READY_TO_CLOSE" };
}

export async function reviewFinancePeriodCoverage(db, { tenantId, userId, period, expectedVersion, fingerprint, confirmation, declarations, inventoryConfirmed }) {
  if (!tenantId || !userId) fail("Se requiere una empresa y un usuario autenticados.", 401);
  periodBounds(period);
  if (confirmation !== "VERIFICAR") fail("Confirma la revisión con la palabra VERIFICAR.");
  return withFinanceWrite(db, async (tx) => {
    const control = await assertFinancePeriodOpen(tx, tenantId, period);
    if (!Number.isInteger(expectedVersion) || control.version !== expectedVersion) fail("El período cambió. Actualiza la vista antes de verificar.", 409);
    const preview = await getFinanceMonthlyClosePreview({ tenantId, period, db: tx });
    const coverage = preview.coverage;
    if (fingerprint !== coverage.fingerprint) fail("Los datos cambiaron mientras revisabas. Actualiza la vista y verifica nuevamente.", 409);
    if (coverage.blockers.length) fail("Resuelve las cargas pendientes, fechas, cuentas o período en curso antes de verificar la cobertura.", 409);
    const clean = validateCoverageDeclarations(coverage, { declarations, inventoryConfirmed });
    const record = await tx.industryRecord.create({ data: { tenantId, recordType: "finance_period_coverage", title: `Revisión de cobertura ${period}`, status: "REVIEWED", data: {
      period, fingerprint, declarations: clean, inventoryConfirmed: true, reviewedAt: new Date().toISOString(), reviewedById: userId, basis: "HUMAN_ATTESTATION"
    } } });
    await tx.financePeriodControl.update({ where: { tenantId_period: { tenantId, period } }, data: { version: { increment: 1 } } });
    await tx.tenantAuditLog.create({ data: { tenantId, actorUserId: userId, action: "FINANCE_PERIOD_COVERAGE_REVIEWED", entity: "finance_period_coverage", entityId: record.id, metadata: { period, fingerprint, sources: clean.map((s) => s.sourceId) } } });
    return { reviewId: record.id };
  });
}
