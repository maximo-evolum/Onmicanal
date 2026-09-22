import { createHash } from "node:crypto";
import { FinanceOperationError, findAllFinanceRecords, withFinanceWrite } from "./finance-integrity.service.js";
import { assertFinancePeriodOpen } from "./finance-period-control.service.js";
import { financialDate } from "./finance-manual-writes.service.js";
import { getInvoiceFinancialState, financeAgingSegment } from "./finance.service.js";

const dataOf = (r) => r?.data || {};
const text = (v) => String(v ?? "").trim();
const upper = (v) => text(v).toUpperCase();
const fail = (status, message) => { throw new FinanceOperationError(status, message); };
function requireTenant(tenantId) { if (!text(tenantId)) fail(400, "Falta el contexto de empresa."); }
const historyOf = (d) => Array.isArray(d.history) ? d.history : [];
export function financeActivityDate(now = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}
function date(value) { return financialDate(value instanceof Date ? value.toISOString().slice(0, 10) : text(value).slice(0, 10)); }
function reason(value) { const r = text(value); if (r.length < 10 || r.length > 2000) fail(422, "Explica el motivo con entre 10 y 2.000 caracteres."); return r; }
function version(record, expected) {
  if (!Number.isInteger(expected) || expected < 0) fail(428, "Actualiza la vista antes de guardar este caso.");
  if (Number(dataOf(record).workflowVersion || 0) !== expected) fail(409, "El caso cambió desde que abriste la vista. Recarga antes de guardar; no se sobrescribieron cambios.");
}
async function lockDates(tx, tenantId, values) {
  const periods = [...new Set(values.map((v) => date(v).slice(0, 7)))].sort();
  for (const period of periods) await assertFinancePeriodOpen(tx, tenantId, period);
  return periods;
}
async function getRecord(tx, tenantId, id, recordType) {
  if (!text(id)) fail(422, "Falta el registro de origen. Revisa los datos antes de continuar.");
  const r = await tx.industryRecord.findFirst({ where: { id, tenantId, recordType } });
  if (!r) fail(404, "Registro no encontrado en esta empresa."); return r;
}
async function audit(tx, tenantId, userId, action, record, metadata) {
  await tx.tenantAuditLog.create({ data: { tenantId, actorUserId: userId || null, action, entity: record.recordType, entityId: record.id, metadata } });
}
export function isCollectionCustomerInvoice(r) {
  const d = dataOf(r);
  const supplierOnly = Boolean(text(d.supplierName || d.supplier || d.providerName)) && !text(d.customerName || d.customer || d.clientName);
  const supplierSide = [d.documentSide, d.side, d.direction, d.kind, d.documentFlow, d.counterpartyType].some((value) => ["SUPPLIER", "PROVIDER", "PAYABLE", "PURCHASE", "COMPRA", "PROVEEDOR", "EGRESO"].includes(upper(value)));
  return !["ANNULLED", "CANCELLED", "REJECTED", "ANULADA", "VOID", "DELETED"].includes(upper(r.status))
    && !supplierOnly && !supplierSide
    && !d.demoOnly && !d.isDemo && !d.isSimulated && !d.trainingRun && !["demo", "seed", "simulation"].includes(text(d.source).toLowerCase());
}
function validAmounts(record, state) {
  if (!state.included) return false;
  const d = dataOf(record);
  const amounts = [d.amount ?? d.total ?? d.value, d.balance ?? state.amount, d.creditNotesTotal ?? d.creditNoteAmount ?? 0, d.debitNotesTotal ?? d.debitNoteAmount ?? 0];
  return amounts.every((value) => value !== "" && Number.isSafeInteger(Number(value)) && Number(value) >= 0) && state.originalAmount > 0 && state.balance <= state.amount;
}
export function collectionPartyKey({ name, rut }) { return text(rut).replace(/[^0-9kK]/g, "").toUpperCase() || text(name).toLocaleLowerCase("es"); }
export function collectionInvoiceParty(r) { const d = dataOf(r); return { name: d.customerName || d.customer || d.clientName || "Cliente sin nombre", rut: d.clientRut || d.customerRut || d.rut || null }; }

export async function updateCollectionCase(db, { tenantId, userId, id, input, canReopen = false, now = new Date() }) {
  requireTenant(tenantId);
  return withFinanceWrite(db, async (tx) => {
    const record = await getRecord(tx, tenantId, id, "finance_collection_case"); const d = dataOf(record); version(record, input.expectedVersion);
    const invoice = await getRecord(tx, tenantId, d.invoiceId, "finance_invoice"); const financial = getInvoiceFinancialState(invoice, now);
    const status = upper(input.status || record.status); const oldStatus = upper(record.status);
    const active = ["MONITORING", "PENDING", "CONTACTED", "PROMISE", "ESCALATED"];
    if (![...active, "PAID", "CLOSED"].includes(status)) fail(422, "Estado de cobranza no válido.");
    const reopening = ["PAID", "CLOSED"].includes(oldStatus) && status !== oldStatus;
    if (reopening && (!canReopen || !["PENDING", "MONITORING"].includes(status))) fail(403, "Solo un administrador puede reabrir el caso a Pendiente o Monitoreo.");
    if (!isCollectionCustomerInvoice(invoice) && status !== "CLOSED") fail(409, "La factura está anulada, no es de cliente o es de demostración. Solo puede cerrarse el caso con un motivo.");
    if (status !== "CLOSED" && (upper(invoice.data?.currency || "CLP") !== "CLP" || !validAmounts(invoice, financial))) fail(409, "La factura tiene moneda, monto o saldo inválidos. Corrige el documento antes de gestionar su cobranza.");
    if (status === "PAID" && financial.balance !== 0) fail(409, "La factura todavía tiene saldo. Registra el cobro o conciliación antes de marcar el caso como pagado.");
    if (reopening && !(financial.balance > 0)) fail(409, "La factura no tiene saldo pendiente para reabrir cobranza.");
    const note = reason(input.note);
    const channel = text(input.channel || d.channel || "manual").toLowerCase();
    if (!["manual", "email", "whatsapp", "sms"].includes(channel)) fail(422, "Canal de seguimiento no válido.");
    const patch = {};
    if (input.nextActionAt) { if (!Number.isFinite(Date.parse(input.nextActionAt))) fail(422, "La próxima acción requiere una fecha válida."); patch.nextActionAt = new Date(input.nextActionAt).toISOString(); }
    if (status === "PROMISE") {
      const due = date(input.promiseDueDate || d.promiseDueDate); const amount = Number(input.promiseAmount ?? d.promiseAmount);
      if (due < financeActivityDate(now) || !Number.isSafeInteger(amount) || amount <= 0 || amount > financial.balance) fail(422, "La promesa requiere fecha vigente y un monto positivo que no supere el saldo.");
      patch.promiseDueDate = due; patch.promiseAmount = amount;
    }
    const periods = await lockDates(tx, tenantId, [d.operatingDate || record.createdAt, financeActivityDate(now)]);
    const next = await tx.industryRecord.update({ where: { id }, data: { status, data: { ...d, ...patch, status, channel, balance: financial.balance, workflowVersion: Number(d.workflowVersion || 0) + 1,
      operatingDate: financeActivityDate(now), history: [...historyOf(d), { at: now.toISOString(), type: reopening ? "CASE_REOPENED" : "CASE_UPDATED", status, detail: note, userId: userId || null }] } } });
    await audit(tx, tenantId, userId, "FINANCE_COLLECTION_CASE_UPDATED", next, { oldStatus, status, note, periods, expectedVersion: input.expectedVersion });
    return { case: next };
  });
}

export async function updateFinanceExceptionCase(db, { tenantId, userId, id, input, canReopen = false, now = new Date() }) {
  requireTenant(tenantId);
  return withFinanceWrite(db, async (tx) => {
    const record = await getRecord(tx, tenantId, id, "finance_exception"); const d = dataOf(record); version(record, input.expectedVersion);
    const status = upper(input.status || record.status); const oldStatus = upper(record.status); const resolution = reason(input.resolution);
    if (["MIGRATION_REVIEW", "BANK_STATEMENT_IMPORT_REVIEW"].includes(d.type) && ["RESOLVED", "CLOSED"].includes(status) && !d.correctedRecordId) fail(409, "Completa la fila desde Revisión histórica antes de resolverla. No basta cambiar el estado de la excepción.");
    if (d.correctedRecordId && !["RESOLVED", "CLOSED"].includes(status)) fail(409, "La fila ya generó un registro operativo. Corrige ese registro; no se reabre la fila para importarla otra vez.");
    const reopening = ["RESOLVED", "CLOSED"].includes(oldStatus) && status !== oldStatus && status !== "CLOSED";
    if (!["OPEN", "IN_REVIEW", "RESOLVED", "CLOSED"].includes(status)) fail(422, "Estado de excepción no válido.");
    if (reopening && status !== "CLOSED" && (!canReopen || status !== "OPEN")) fail(403, "Solo un administrador puede reabrir la excepción.");
    if (status === "CLOSED" && !["RESOLVED", "CLOSED"].includes(oldStatus)) fail(409, "Resuelve y documenta la excepción antes de cerrarla.");
    let origin = d.transactionDate || d.operatingDate || d.movement?.transactionDate || d.movement?.date;
    if (d.movementId) { const movement = await getRecord(tx, tenantId, d.movementId, "bank_movement"); origin = movement.data?.transactionDate || movement.data?.date; }
    if (!origin && !d.importBatchId && !d.movementId && !d.movement) origin = record.createdAt;
    const periods = await lockDates(tx, tenantId, [origin, financeActivityDate(now)]);
    const terminal = ["RESOLVED", "CLOSED"].includes(status);
    const next = await tx.industryRecord.update({ where: { id }, data: { status, data: { ...d, status, resolution, workflowVersion: Number(d.workflowVersion || 0) + 1,
      resolvedAt: terminal ? now.toISOString() : null, resolvedById: terminal ? userId || null : null,
      history: [...historyOf(d), { at: now.toISOString(), type: reopening ? "EXCEPTION_REOPENED" : "EXCEPTION_UPDATED", status, detail: resolution, userId: userId || null }] } } });
    await audit(tx, tenantId, userId, "FINANCE_EXCEPTION_UPDATED", next, { oldStatus, status, resolution, periods });
    return { exception: next };
  });
}

export async function prepareCollectionReminders(db, { tenantId, userId, partyKey, now = new Date() }) {
  requireTenant(tenantId);
  if (!text(partyKey)) fail(422, "Selecciona un cliente.");
  return withFinanceWrite(db, async (tx) => {
    const activityDate = financeActivityDate(now);
    const invoices = await findAllFinanceRecords(tx, { where: { tenantId, recordType: "finance_invoice" } });
    const cases = await findAllFinanceRecords(tx, { where: { tenantId, recordType: "finance_collection_case" } });
    const selected = invoices.filter((r) => collectionPartyKey(collectionInvoiceParty(r)) === partyKey && isCollectionCustomerInvoice(r) && (getInvoiceFinancialState(r, now).balance > 0 || !validAmounts(r, getInvoiceFinancialState(r, now))));
    if (!selected.length) fail(404, "No hay facturas válidas pendientes para este cliente.");
    const deferred = []; const candidates = [];
    for (const invoice of selected) {
      const d = dataOf(invoice); const state = getInvoiceFinancialState(invoice, now);
      if (upper(invoice.status) === "PAID" || upper(d.currency || "CLP") !== "CLP" || !validAmounts(invoice, state)) { deferred.push({ id: invoice.id, reason: "INVALID_BALANCE_OR_CURRENCY" }); continue; }
      let due; try { due = date(d.dueDate); if (date(d.issueDate) > due) throw Error(); } catch { deferred.push({ id: invoice.id, reason: "INVALID_DOCUMENT_DATES" }); continue; }
      const matching = cases.filter((r) => dataOf(r).invoiceId === invoice.id);
      if (matching.length > 1) fail(409, "Hay casos duplicados para una factura. Requieren revisión antes de preparar recordatorios.");
      const current = matching[0];
      if (current && ["CLOSED", "PAID"].includes(upper(current.status))) { deferred.push({ id: invoice.id, reason: "CASE_REQUIRES_REOPENING" }); continue; }
      candidates.push({ invoice, state, due, current });
    }
    if (!candidates.length) return { prepared: [], count: 0, deferred, replayed: false };
    const key = createHash("sha256").update(JSON.stringify({ partyKey, activityDate, documents: candidates.map((c) => [c.invoice.id, c.state.balance, c.due]).sort(([a], [b]) => a.localeCompare(b)) })).digest("hex");
    const previous = await tx.industryRecord.findFirst({ where: { tenantId, recordType: "finance_reminder_batch", data: { path: ["operationKey"], equals: key } } });
    if (previous) return { prepared: [], count: 0, originalCount: previous.data.count, deferred, replayed: true };
    const periods = await lockDates(tx, tenantId, [activityDate, ...candidates.filter((c) => c.current).map((c) => c.current.data?.operatingDate || c.current.createdAt)]);
    const prepared = [];
    for (const c of candidates) {
      const party = collectionInvoiceParty(c.invoice); const old = dataOf(c.current); const segment = financeAgingSegment(new Date(c.due + "T00:00:00Z"), new Date(activityDate + "T00:00:00Z"));
      const nextData = { ...old, invoiceId: c.invoice.id, invoiceNumber: c.invoice.data?.invoiceNumber || c.invoice.title, customerName: party.name, clientRut: party.rut,
        balance: c.state.balance, currency: "CLP", agingBucket: segment.label, agingCode: segment.code, daysPastDue: segment.daysPastDue, recommendedAction: segment.action,
        operatingDate: activityDate, channel: old.channel || "manual", requiresApproval: true, reminderStatus: "Borrador pendiente de aprobación", lastReminderAt: now.toISOString(), lastReminderKey: key,
        workflowVersion: Number(old.workflowVersion || 0) + 1, history: [...historyOf(old), { at: now.toISOString(), type: "REMINDER_DRAFT_PREPARED", detail: "Borrador interno preparado; no se envió ningún mensaje.", userId: userId || null }] };
      const row = c.current ? await tx.industryRecord.update({ where: { id: c.current.id }, data: { data: nextData } }) : await tx.industryRecord.create({ data: { tenantId, recordType: "finance_collection_case", title: `Cobranza ${nextData.invoiceNumber}`.slice(0, 220), status: segment.code === "POR_VENCER" ? "MONITORING" : "PENDING", data: nextData } });
      prepared.push(row);
    }
    const batch = await tx.industryRecord.create({ data: { tenantId, recordType: "finance_reminder_batch", title: `Recordatorios ${activityDate}`, status: "DRAFT", data: { operationKey: key, activityDate, partyKey, count: prepared.length, caseIds: prepared.map((r) => r.id), requiresApproval: true } } });
    await audit(tx, tenantId, userId, "FINANCE_COLLECTION_REMINDERS_PREPARED", batch, { partyKey, count: prepared.length, periods });
    return { prepared, count: prepared.length, deferred, replayed: false };
  });
}

export async function createAdministrativeException(db, { tenantId, userId, input, now = new Date() }) {
  requireTenant(tenantId);
  const title = text(input.title); const detail = reason(input.detail); const key = text(input.idempotencyKey);
  if (!title || title.length > 220 || !/^[\w-]{16,100}$/.test(key)) fail(422, "Completa el título y vuelve a intentar desde el formulario actualizado.");
  const payloadHash = createHash("sha256").update(JSON.stringify([title, detail, text(input.type)])).digest("hex");
  return withFinanceWrite(db, async (tx) => {
    const old = await tx.industryRecord.findFirst({ where: { tenantId, recordType: "finance_exception", data: { path: ["creationKey"], equals: key } } });
    if (old) { if (old.data.creationHash !== payloadHash) fail(409, "Esta solicitud ya se utilizó con otros datos. Recarga el formulario."); return { exception: old, replayed: true }; }
    const operatingDate = financeActivityDate(now); await lockDates(tx, tenantId, [operatingDate]);
    const row = await tx.industryRecord.create({ data: { tenantId, recordType: "finance_exception", title, status: "OPEN", data: { type: text(input.type).slice(0, 80) || "MANUAL_REVIEW", detail, priority: "MEDIUM", operatingDate, createdAt: now.toISOString(), workflowVersion: 0, creationKey: key, creationHash: payloadHash, source: "manual_administrative" } } });
    await audit(tx, tenantId, userId, "FINANCE_ADMINISTRATIVE_EXCEPTION_CREATED", row, { operatingDate });
    return { exception: row, replayed: false };
  });
}
