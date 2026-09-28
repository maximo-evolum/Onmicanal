import { createHash } from "node:crypto";
import { FinanceOperationError, findAllFinanceRecords, withFinanceWrite } from "./finance-integrity.service.js";
import { financialDate } from "./finance-manual-writes.service.js";
import { financeDocumentState, financeDocumentSide, financeParty } from "./finance-document-values.service.js";
import { assertFinancePeriodOpen } from "./finance-period-control.service.js";

const data = (r) => r?.data || {};
const fail = (status, message) => { throw new FinanceOperationError(status, message); };
const spec = (kind) => {
  if (kind === "RECEIPT") return { entryType: "finance_invoice_receipt", docType: "finance_invoice", relation: "invoiceId", historyId: "receiptId", registered: "RECEIPT_REGISTERED" };
  if (kind === "PAYMENT") return { entryType: "finance_payable_payment", docType: "finance_payable", relation: "payableId", historyId: "paymentId", registered: "PAYMENT_REGISTERED" };
  fail(422, "Selecciona cobros de clientes o pagos a proveedores.");
};
const types = ["finance_invoice", "finance_payable", "finance_invoice_receipt", "finance_payable_payment", "finance_reconciliation", "finance_reconciliation_difference", "finance_credit_application", "finance_customer_credit"];
const load = (db, tenantId) => findAllFinanceRecords(db, { where: { tenantId, recordType: { in: types } } });
const authenticated = (tenantId, userId) => { if (!tenantId || !userId) fail(401, "Se requiere una sesión autenticada."); };

export function planManualSettlementReversal(records, { tenantId, kind, id }) {
  const s = spec(kind), entry = records.find((r) => r.id === id && r.tenantId === tenantId && r.recordType === s.entryType);
  if (!entry) fail(404, "Comprobante no encontrado en esta empresa.");
  const e = data(entry);
  if (entry.status === "REVERSED") fail(409, "Este comprobante ya fue revertido.");
  if (entry.status !== "REGISTERED" || e.source !== "manual" || e.reversedAt) fail(409, "Sólo se revierten aquí cobros o pagos manuales vigentes. Utiliza el flujo de conciliación o de saldos a favor para los demás.");
  if (e.movementId || e.reconciliationId || e.groupId || e.creditId || e.creditApplicationId || e.applicationId || e.settlementId) fail(409, "El comprobante está vinculado a otra operación. Revierte primero desde su flujo de origen.");
  const linked = records.some((r) => r.id !== id && !["REVERSED", "REJECTED", "CANCELLED"].includes(r.status) &&
    ![s.docType, s.entryType].includes(r.recordType) && (data(r).receiptId === id || data(r).paymentId === id || (Array.isArray(data(r).receiptIds) && data(r).receiptIds.includes(id))));
  if (linked) fail(409, "Hay una operación vigente que utiliza este comprobante. No se puede revertir aisladamente.");
  const date = financialDate(e.paymentDate), amount = e.amount;
  if (!Number.isSafeInteger(amount) || amount <= 0 || String(e.currency || "CLP").toUpperCase() !== "CLP") fail(409, "El comprobante no tiene un importe válido en CLP.");
  const document = records.find((r) => r.id === e[s.relation] && r.tenantId === tenantId && r.recordType === s.docType);
  if (!document) fail(409, "Falta el documento original: no se modificará el saldo sin respaldo.");
  const d = data(document), state = financeDocumentState(document);
  if (String(d.currency || "CLP").toUpperCase() !== "CLP" || (kind === "RECEIPT" && financeDocumentSide(document) !== "CUSTOMER")) fail(409, "La moneda o el tipo de documento no corresponde al comprobante.");
  if (!state.included || !Number.isSafeInteger(state.paidAmount) || !Number.isSafeInteger(state.balance) || state.paidAmount < amount) fail(409, "El saldo del documento no respalda la reversa. Revisa su calidad de datos.");
  const history = Array.isArray(d.history) ? d.history : [];
  const evidence = history.filter((h) => h?.type === s.registered && h[s.historyId] === id);
  if (evidence.length !== 1 || evidence[0].amount !== amount || evidence[0].paymentDate !== date || history.some((h) => h?.type === `${kind}_REVERSED` && h[s.historyId] === id)) fail(409, "El historial no respalda el importe y fecha originales del comprobante. Requiere revisión.");
  const live = records.filter((r) => r.recordType === s.entryType && r.tenantId === tenantId && data(r)[s.relation] === document.id && r.status !== "REVERSED" && !data(r).reversedAt);
  const total = live.reduce((sum, r) => sum + Number(data(r).amount), 0);
  if (live.some((r) => !Number.isSafeInteger(Number(data(r).amount)) || Number(data(r).amount) <= 0) || !Number.isSafeInteger(total) || total > state.paidAmount) fail(409, "Los comprobantes vigentes superan o no respaldan el pago acumulado del documento.");
  const balance = state.balance + amount, paidAmount = state.paidAmount - amount;
  if (!Number.isSafeInteger(balance) || balance > state.amount - state.justifiedDifference) fail(409, "La reversa produciría un saldo inconsistente.");
  const status = paidAmount > 0 ? "PARTIAL" : "OPEN";
  const version = createHash("sha256").update(JSON.stringify([entry, document, live.slice().sort((a, b) => a.id.localeCompare(b.id))])).digest("hex");
  return { entry, document, version, amount, paymentDate: date, period: date.slice(0, 7), before: { balance: state.balance, paidAmount: state.paidAmount }, after: { balance, paidAmount, status } };
}

export async function previewManualSettlementReversal(db, input) {
  authenticated(input.tenantId, input.userId);
  return withFinanceWrite(db, async (tx) => {
    const plan = planManualSettlementReversal(await load(tx, input.tenantId), input);
    await assertFinancePeriodOpen(tx, input.tenantId, plan.period);
    return { version: plan.version, amount: plan.amount, paymentDate: plan.paymentDate, period: plan.period, documentId: plan.document.id, title: plan.document.title, before: plan.before, after: plan.after };
  });
}

export async function reverseManualSettlement(db, input) {
  const { tenantId, userId, id, kind, expectedVersion, confirmation } = input;
  authenticated(tenantId, userId); const s = spec(kind);
  const reason = String(input.reason || "").trim();
  if (reason.length < 10 || reason.length > 1000) fail(422, "Indica un motivo de entre 10 y 1000 caracteres.");
  if (confirmation !== "REVERTIR") fail(422, "Confirma escribiendo REVERTIR después de revisar los saldos.");
  return withFinanceWrite(db, async (tx) => {
    const records = await load(tx, tenantId), existing = records.find((r) => r.id === id && r.tenantId === tenantId && r.recordType === s.entryType);
    if (!existing) fail(404, "Comprobante no encontrado en esta empresa.");
    if (existing.status === "REVERSED") {
      if (data(existing).reversalVersion !== expectedVersion || data(existing).reversalReason !== reason || data(existing).reversedById !== userId) fail(409, "El comprobante ya fue revertido. Consulta su historial; no se aplicó otra reversa.");
      return { entry: existing, alreadyReversed: true };
    }
    const plan = planManualSettlementReversal(records, input);
    await assertFinancePeriodOpen(tx, tenantId, plan.period);
    if (!expectedVersion || plan.version !== expectedVersion) fail(409, "El comprobante o el saldo cambió. Genera una nueva vista previa antes de revertir.");
    const at = new Date().toISOString(), d = data(plan.document);
    const document = await tx.industryRecord.update({ where: { id: plan.document.id }, data: { status: plan.after.status, data: { ...d, ...plan.after, paidAt: null,
      history: [...d.history, { type: `${kind}_REVERSED`, at, [s.historyId]: id, amount: plan.amount, paymentDate: plan.paymentDate, reason, userId }] } } });
    const entry = await tx.industryRecord.update({ where: { id }, data: { status: "REVERSED", data: { ...data(existing), reversedAt: at, reversedById: userId, reversalReason: reason, reversalVersion: expectedVersion, reversalPeriod: plan.period, balanceBeforeReversal: plan.before.balance, balanceAfterReversal: plan.after.balance } } });
    await tx.tenantAuditLog.create({ data: { tenantId, actorUserId: userId, action: `FINANCE_MANUAL_${kind}_REVERSED`, entity: s.entryType, entityId: id,
      metadata: { documentId: document.id, amount: plan.amount, paymentDate: plan.paymentDate, period: plan.period, reason, before: plan.before, after: plan.after } } });
    return { entry, document, alreadyReversed: false };
  });
}

export async function listManualSettlements(db, { tenantId, kind, period = "", query = "", page = 1, status = "ALL" }) {
  if (!tenantId) fail(401, "Se requiere una empresa autenticada."); const s = spec(kind);
  page = Number(page);
  if (!Number.isSafeInteger(page) || page < 1 || (period && !/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) || !["ALL", "REGISTERED", "REVERSED"].includes(status)) fail(422, "Filtros de historial inválidos.");
  const records = await load(db, tenantId), index = new Map(records.map((r) => [r.id, r])), q = String(query).trim().toLocaleLowerCase("es");
  const rows = records.filter((r) => r.recordType === s.entryType && (data(r).source === "manual" || r.status === "REGISTERED") && (status === "ALL" || r.status === status)).map((r) => {
    const d = data(r), doc = index.get(d[s.relation]), party = doc ? financeParty(doc) : null;
    return { entry: r, documentTitle: doc?.title || "Documento no disponible", partyName: party?.name || "", partyRut: party?.rut || "" };
  }).filter((r) => (!period || !data(r.entry).paymentDate || String(data(r.entry).paymentDate).startsWith(period + "-")) && (!q || `${r.entry.title} ${r.documentTitle} ${r.partyName} ${r.partyRut} ${data(r.entry).reference || ""}`.toLocaleLowerCase("es").includes(q)))
    .sort((a, b) => String(data(b.entry).paymentDate || "").localeCompare(String(data(a.entry).paymentDate || "")) || a.entry.id.localeCompare(b.entry.id));
  return { page, pages: Math.max(1, Math.ceil(rows.length / 25)), total: rows.length, records: rows.slice((page - 1) * 25, page * 25).map((r) => {
    let blockedReason = "";
    try { planManualSettlementReversal(records, { tenantId, kind, id: r.entry.id }); } catch (e) { if (!(e instanceof FinanceOperationError)) throw e; blockedReason = e.message; }
    return { ...r, canReverse: !blockedReason, blockedReason };
  }) };
}
