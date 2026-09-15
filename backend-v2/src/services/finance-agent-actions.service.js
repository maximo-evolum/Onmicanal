import { FinanceOperationError, findAllFinanceRecords, withFinanceWrite } from "./finance-integrity.service.js";
import { lockFinancePeriod, assertFinancePeriodOpen } from "./finance-period-control.service.js";
import { financialDate } from "./finance-manual-writes.service.js";
import { getFinanceReconciliationSuggestions, getInvoiceFinancialState, financeAgingSegment } from "./finance.service.js";

const dataOf = (r) => r?.data || {};
const fail = (status, message) => { throw new FinanceOperationError(status, message); };
const normalized = (value) => String(value || "").toUpperCase();
const demo = (d) => d.demoOnly || d.isDemo || d.isSimulated || d.trainingRun || ["demo", "seed", "simulation"].includes(String(d.source || "").toLowerCase());
const dateOf = (value) => { try { return financialDate(String(value || "").slice(0, 10)); } catch { return null; } };
const keyOf = (d) => `${d.invoiceId || ""}:${d.movementId || ""}:${d.type || ""}`;

export async function prepareFinanceExceptionCases(db, { tenantId, userId, readPolicy }) {
  if (!tenantId) fail(401, "Se requiere una empresa autenticada.");
  return withFinanceWrite(db, async (tx) => {
    const policy = await readPolicy(tx);
    if (!policy.autoCreateExceptions) return { created: [], skipped: "POLICY_DISABLED", deferred: [], analyzedMovements: 0 };
    const [suggestions, existing, movements] = await Promise.all([
      getFinanceReconciliationSuggestions({ tenantId, limit: null, db: tx }),
      findAllFinanceRecords(tx, { where: { tenantId, recordType: "finance_exception" } }),
      findAllFinanceRecords(tx, { where: { tenantId, recordType: "bank_movement" } })
    ]);
    // Resolved cases are evidence too. Do not recreate them on every analysis.
    const known = new Set(existing.map((r) => keyOf(dataOf(r))));
    const suggested = new Map(suggestions.map((s) => [s.movement.id, s]));
    const candidates = []; const deferred = [];
    for (const movement of movements) {
      const d = dataOf(movement);
      if (["MATCHED", "CLOSED", "REVIEW", "REJECTED"].includes(normalized(movement.status)) || !["CREDIT", "ABONO"].includes(normalized(d.direction || d.movementType)) || ["COMMISSION_OR_FEE", "INTERNAL_TRANSFER"].includes(normalized(d.movementKind)) || demo(d)) continue;
      const suggestion = suggested.get(movement.id);
      if (suggestion && !(suggestion.partial || suggestion.overpayment || suggestion.difference > 1)) continue;
      const type = suggestion ? suggestion.partial ? "PARTIAL_PAYMENT" : "AMOUNT_DIFFERENCE" : "UNIDENTIFIED_INCOME";
      const invoiceId = suggestion?.invoice.id || null;
      if (known.has(keyOf({ invoiceId, movementId: movement.id, type }))) continue;
      const date = dateOf(d.transactionDate || d.date);
      if (!date) { deferred.push({ id: movement.id, reason: "INVALID_SOURCE_DATE" }); continue; }
      candidates.push({ movement, suggestion, type, invoiceId, date, period: date.slice(0, 7) });
    }
    const controls = new Map();
    for (const period of [...new Set(candidates.map((c) => c.period))].sort()) controls.set(period, await lockFinancePeriod(tx, tenantId, period));
    const created = [];
    for (const c of candidates) {
      if (controls.get(c.period).status === "CLOSED") { deferred.push({ id: c.movement.id, period: c.period, reason: "CLOSED_PERIOD" }); continue; }
      const d = dataOf(c.movement); const s = c.suggestion;
      const record = await tx.industryRecord.create({ data: { tenantId, recordType: "finance_exception", status: "OPEN",
        title: `${s ? c.type === "PARTIAL_PAYMENT" ? "Pago parcial" : "Diferencia de monto" : "Ingreso sin documento identificado"} · ${s?.invoice.title || c.movement.title}`.slice(0, 220),
        data: { type: c.type, invoiceId: c.invoiceId, movementId: c.movement.id, transactionDate: c.date, currency: d.currency || "CLP", amount: d.amount || 0,
          priority: s ? "MEDIUM" : "HIGH", suggestedBy: "finance_exceptions_agent", createdAt: new Date().toISOString(),
          ...(s ? { confidence: s.confidence, difference: s.difference, reasons: s.reasons } : { detail: "El abono no tiene una factura candidata en el universo consultado. Revisa referencia, RUT, contraparte o medio de pago antes de conciliar." }) } } });
      known.add(keyOf(dataOf(record))); created.push(record);
    }
    if (created.length) await tx.tenantAuditLog.create({ data: { tenantId, actorUserId: userId || null, action: "FINANCE_AGENT_EXCEPTIONS_PREPARED", entity: "finance_exception",
      metadata: { count: created.length, periods: [...controls.keys()].filter((p) => controls.get(p).status !== "CLOSED"), deferredCount: deferred.length, analyzedMovements: movements.length } } });
    return { created, skipped: null, deferred, analyzedMovements: movements.length };
  });
}

export async function generateFinanceCollectionCases(db, { tenantId, userId, now = new Date() }) {
  if (!tenantId) fail(401, "Se requiere una empresa autenticada.");
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now).map((p) => [p.type, p.value]));
  const activityDate = financialDate(`${parts.year}-${parts.month}-${parts.day}`);
  return withFinanceWrite(db, async (tx) => {
    // A collection draft is an activity of today, not a rewrite of an old
    // invoice. Closed historical invoices may still have outstanding debt.
    await assertFinancePeriodOpen(tx, tenantId, activityDate.slice(0, 7));
    const [invoices, cases] = await Promise.all([
      findAllFinanceRecords(tx, { where: { tenantId, recordType: "finance_invoice" } }),
      findAllFinanceRecords(tx, { where: { tenantId, recordType: "finance_collection_case" } })
    ]);
    const known = new Set(cases.map((r) => dataOf(r).invoiceId).filter(Boolean));
    const created = []; const deferred = [];
    for (const invoice of invoices) {
      const d = dataOf(invoice);
      if (known.has(invoice.id) || ["PAID", "ANNULLED", "CANCELLED", "REJECTED", "ANULADA", "VOID", "DELETED"].includes(normalized(invoice.status || d.status)) || ["SUPPLIER", "PURCHASE"].includes(normalized(d.documentSide)) || normalized(d.direction) === "PURCHASE" || demo(d)) continue;
      const state = getInvoiceFinancialState(invoice, now);
      if (!(state.balance > 0)) continue;
      const dueDate = dateOf(d.dueDate); const issueDate = dateOf(d.issueDate || d.emissionDate);
      if (!dueDate || !issueDate || dueDate < issueDate) { deferred.push({ id: invoice.id, reason: "INVALID_DOCUMENT_DATES" }); continue; }
      if (dueDate >= activityDate) continue;
      const currency = normalized(d.currency || "CLP");
      if (currency !== "CLP") { deferred.push({ id: invoice.id, reason: "UNSUPPORTED_CURRENCY" }); continue; }
      const amount = Number(d.amount ?? d.total ?? d.value);
      if (!Number.isSafeInteger(amount) || !Number.isSafeInteger(state.balance) || amount <= 0 || state.balance > state.amount) { deferred.push({ id: invoice.id, reason: "INVALID_BALANCE" }); continue; }
      const segment = financeAgingSegment(new Date(`${dueDate}T00:00:00Z`), new Date(`${activityDate}T00:00:00Z`));
      const record = await tx.industryRecord.create({ data: { tenantId, recordType: "finance_collection_case", title: `Cobranza ${d.invoiceNumber || invoice.title}`.slice(0, 220), status: "PENDING",
        data: { invoiceId: invoice.id, invoiceNumber: d.invoiceNumber || invoice.title, customerName: d.customerName || d.clientName || d.customer || "Cliente sin nombre",
          clientRut: d.clientRut || d.customerRut || d.rut || null, balance: state.balance, currency, issueDate, dueDate, operatingDate: activityDate,
          agingBucket: segment.label, agingCode: segment.code, daysPastDue: segment.daysPastDue, recommendedAction: segment.action,
          channel: "manual", requiresApproval: true, nextActionAt: now.toISOString(),
          history: [{ at: now.toISOString(), type: "CASE_CREATED", detail: `${segment.action}. Borrador interno para revisión humana; no se enviaron mensajes.` }] } } });
      known.add(invoice.id); created.push(record);
    }
    if (created.length) await tx.tenantAuditLog.create({ data: { tenantId, actorUserId: userId || null, action: "FINANCE_COLLECTION_CASES_GENERATED", entity: "finance_collection_case",
      metadata: { count: created.length, activityDate, deferredCount: deferred.length, analyzedInvoices: invoices.length } } });
    return { created, count: created.length, deferred, analyzedInvoices: invoices.length };
  });
}
