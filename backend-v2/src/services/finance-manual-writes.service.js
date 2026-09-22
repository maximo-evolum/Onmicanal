import { isDeepStrictEqual } from "node:util";
import { createHash } from "node:crypto";
import { FinanceOperationError, withFinanceWrite } from "./finance-integrity.service.js";
import { assertFinancePeriodOpen } from "./finance-period-control.service.js";
import { getInvoiceFinancialState } from "./finance.service.js";

const dataOf = (record) => record?.data || {};
const fail = (status, message) => { throw new FinanceOperationError(status, message); };
export function assertFinancialDraftScope(scope, tenantId, userId) {
  if (scope !== undefined && (!scope || scope.tenantId !== tenantId || scope.userId !== userId)) fail(409, "La cuenta activa cambió. Este borrador pertenece a otra sesión; no se guardó en esta empresa.");
}
export function financialDate(value) {
  const date = String(value || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) fail(422, "Ingresa una fecha válida (AAAA-MM-DD); no se puede adivinar el período contable.");
  return date;
}
const wholeAmount = (value) => {
  const amount = Number(value);
  if (!Number.isSafeInteger(amount) || amount <= 0) fail(422, "Ingresa un monto entero positivo en CLP.");
  return amount;
};

export async function registerManualSettlement(db, { tenantId, userId, documentId, kind, amount, paymentDate, reference = "", idempotencyKey }) {
  if (!["RECEIPT", "PAYMENT"].includes(kind)) fail(400, "Tipo de registro no válido.");
  const paid = wholeAmount(amount); const date = financialDate(paymentDate);
  const key = String(idempotencyKey || "");
  if (!/^[a-zA-Z0-9_-]{16,100}$/.test(key)) fail(400, "Se requiere un identificador de operación para evitar cobros o pagos duplicados. Actualiza la aplicación.");
  const ref = String(reference || "").trim();
  if (ref.length > 240) fail(422, "La referencia no puede superar 240 caracteres.");
  const incoming = kind === "RECEIPT";
  const recordType = incoming ? "finance_invoice" : "finance_payable";
  const receiptType = incoming ? "finance_invoice_receipt" : "finance_payable_payment";
  const relation = incoming ? "invoiceId" : "payableId";
  return withFinanceWrite(db, async (tx) => {
    const document = await tx.industryRecord.findFirst({ where: { id: documentId, tenantId, recordType } });
    if (!document) fail(404, "Documento no encontrado en esta empresa.");
    const data = dataOf(document);
    const previous = await tx.industryRecord.findFirst({ where: { tenantId, recordType: receiptType, data: { path: ["operationKey"], equals: key } } });
    if (previous) {
      const old = dataOf(previous);
      if (old[relation] !== documentId || old.amount !== paid || old.paymentDate !== date || old.reference !== ref) fail(409, "El identificador ya se utilizó con otros datos. Revisa el registro antes de iniciar otra operación.");
      return { [incoming ? "receipt" : "payment"]: previous, [incoming ? "invoice" : "payable"]: document, remainingBalance: getInvoiceFinancialState(document).balance, replayed: true };
    }
    // The payment affects its effective month, not the invoice's issue month.
    await assertFinancePeriodOpen(tx, tenantId, date.slice(0, 7));
    if (String(data.currency || "CLP").toUpperCase() !== "CLP") fail(422, "Este registro manual admite CLP. No se convierte moneda automáticamente.");
    if ([document.status, data.status].some((status) => ["CANCELLED", "CANCELED", "VOID", "ANULADA", "ANULADO", "DELETED", "REJECTED"].includes(String(status || "").toUpperCase()))) fail(409, "No se puede registrar un pago sobre un documento anulado o rechazado.");
    const state = getInvoiceFinancialState(document);
    if (!state.included) fail(409, "El documento requiere revisión o está fuera de la cartera operativa. No se registró el pago.");
    if (!state.balance || state.status === "PAID") fail(409, "El documento no tiene saldo pendiente.");
    if (!Number.isSafeInteger(state.balance) || state.balance > state.amount || !Number.isSafeInteger(Number(data.paidAmount || 0) + paid)) fail(409, "El saldo del documento es inconsistente. Revisa sus datos antes de registrar el pago.");
    if (paid > state.balance) fail(409, "El monto supera el saldo pendiente actual. Actualiza la vista.");
    const remainingBalance = state.balance - paid;
    const now = new Date().toISOString();
    const entry = await tx.industryRecord.create({ data: { tenantId, recordType: receiptType, title: `${incoming ? "Cobro" : "Pago"} ${document.title}`.slice(0, 220), status: "REGISTERED",
      data: { [relation]: documentId, amount: paid, paymentDate: date, reference: ref, operationKey: key, source: "manual", registeredById: userId || null, registeredAt: now } } });
    const status = remainingBalance === 0 ? "PAID" : "PARTIAL";
    const updated = await tx.industryRecord.update({ where: { id: documentId }, data: { status, data: { ...data, status, balance: remainingBalance,
      paidAmount: state.paidAmount + paid, paidAt: remainingBalance === 0 ? date : data.paidAt || null,
      history: [...(Array.isArray(data.history) ? data.history : []), { at: now, type: incoming ? "RECEIPT_REGISTERED" : "PAYMENT_REGISTERED", amount: paid, paymentDate: date, reference: ref, [incoming ? "receiptId" : "paymentId"]: entry.id }] } } });
    await tx.tenantAuditLog.create({ data: { tenantId, actorUserId: userId || null, action: incoming ? "FINANCE_INVOICE_RECEIPT_REGISTERED" : "FINANCE_PAYABLE_PAYMENT_REGISTERED", entity: recordType, entityId: documentId,
      metadata: { entryId: entry.id, amount: paid, paymentDate: date, period: date.slice(0, 7), operationKey: key } } });
    return { [incoming ? "receipt" : "payment"]: entry, [incoming ? "invoice" : "payable"]: updated, remainingBalance, replayed: false };
  });
}

export const MANUAL_FINANCE_RECORDS = new Set(["finance_invoice", "finance_payable", "finance_document_adjustment", "bank_movement"]);
function recordDate(recordType, data) {
  return financialDate(recordType === "bank_movement" ? data.transactionDate || data.date : data.issueDate || data.date);
}

// Validation and mutation share a transaction. Callers may have prepared metadata
// outside it; stale versions are rejected instead of overwriting a concurrent payment.
export async function writeManualFinanceRecord(db, { tenantId, userId, recordType, existing, nextData, nextStatus, operation, write, audit, idempotencyKey, creationContext = {} }) {
  if (!MANUAL_FINANCE_RECORDS.has(recordType)) return write(db);
  if (nextData && ("manualCreationKey" in nextData || "manualCreationHash" in nextData) && !existing) fail(422, "Los identificadores internos no se ingresan manualmente.");
  const key = idempotencyKey == null ? null : String(idempotencyKey);
  if (key !== null && (operation !== "CREATE" || !/^[a-zA-Z0-9_-]{16,100}$/.test(key))) fail(422, "Identificador de creación inválido.");
  const hash = key ? createHash("sha256").update(JSON.stringify({ recordType, nextData, nextStatus, creationContext })).digest("hex") : null;
  return withFinanceWrite(db, async (tx) => {
    if (key) {
      const previous = await tx.industryRecord.findFirst({ where: { tenantId, recordType, data: { path: ["manualCreationKey"], equals: key } } });
      if (previous) {
        if (previous.data?.manualCreationHash !== hash) fail(409, "Este intento ya se guardó con otros datos. Recupera la factura antes de volver a crearla.");
        return { ...previous, manualReplayed: true };
      }
    }
    let current;
    if (existing) {
      current = await tx.industryRecord.findFirst({ where: { id: existing.id, tenantId, recordType } });
      if (!current) fail(404, "Registro financiero no encontrado.");
      if (String(current.updatedAt) !== String(existing.updatedAt) || current.status !== existing.status || !isDeepStrictEqual(current.data, existing.data)) fail(409, "El registro cambió mientras lo editabas. Actualiza la vista; no se sobrescribieron datos.");
    }
    const before = dataOf(current); const after = nextData ?? before;
    if ((after.justifiedDifferenceTotal ?? 0) !== (before.justifiedDifferenceTotal ?? 0)) fail(409, "Las diferencias justificadas sólo se aplican o revierten desde su flujo de aprobación.");
    if (current && (before.manualCreationKey !== after.manualCreationKey || before.manualCreationHash !== after.manualCreationHash)) fail(409, "No se pueden modificar los identificadores de creación de este documento.");
    const dates = [...new Set([...(current ? [recordDate(recordType, before)] : []), ...(operation !== "DELETE" ? [recordDate(recordType, after)] : [])].map((date) => date.slice(0, 7)))].sort();
    for (const period of dates) await assertFinancePeriodOpen(tx, tenantId, period);
    if (recordType === "bank_movement" && (before.importBatchId || after.importBatchId || before.sourceBatchId || after.sourceBatchId || before.consentId || after.consentId || before.reconciliationId || before.reconciledAt || after.reconciliationId || after.reconciledAt || [current?.status, nextStatus].includes("MATCHED"))) fail(409, "Utiliza el flujo de cartolas o conciliación para modificar un movimiento con evidencia asociada.");
    if (recordType === "finance_document_adjustment" && [current?.status, nextStatus, before.status, after.status].some((status) => String(status || "").toUpperCase() === "APPLIED")) fail(409, "Un ajuste aplicado no se modifica directamente. Requiere una corrección documentada.");
    if (current) {
      const link = recordType === "finance_payable" ? "payableId" : recordType === "bank_movement" ? "movementId" : "invoiceId";
      const evidence = await tx.industryRecord.findFirst({ where: { tenantId, recordType: { in: ["finance_invoice_receipt", "finance_payable_payment", "finance_reconciliation", "finance_document_adjustment"] }, data: { path: [link], equals: current.id } } });
      if (evidence) fail(409, "Este registro tiene historial financiero. No se puede editar o eliminar directamente; utiliza un ajuste documentado.");
    }
    if (["finance_invoice", "finance_payable"].includes(recordType)) {
      if (operation !== "DELETE") {
        if (String(after.currency || "CLP").toUpperCase() === "CLP") wholeAmount(after.amount ?? after.totalAmount);
        if (after.dueDate && financialDate(after.dueDate) < recordDate(recordType, after)) fail(422, "El vencimiento no puede ser anterior a la emisión.");
      }
      for (const data of [before, ...(operation === "DELETE" ? [] : [after])]) {
        if (Number(data.paidAmount || 0) > 0 || Number(data.creditNotesTotal || 0) > 0 || Number(data.debitNotesTotal || 0) > 0 || (data.balance != null && Number(data.balance) !== Number(data.amount ?? data.total))) fail(409, "Los saldos pagados o ajustados no se editan directamente. Utiliza Registrar cobro/pago o la migración histórica para saldos de apertura.");
      }
      if (operation !== "DELETE" && ["PAID", "PARTIAL", "PAGADA", "PAGADO"].includes(String(nextStatus || after.status || "").toUpperCase())) fail(409, "El estado pagado se obtiene registrando un cobro o pago, no editando la ficha.");
    }
    const result = await write(tx, key ? { ...nextData, manualCreationKey: key, manualCreationHash: hash } : nextData);
    await tx.tenantAuditLog.create({ data: { tenantId, actorUserId: userId || null, action: audit.action, entity: recordType, entityId: result?.id || existing?.id,
      metadata: { ...audit.metadata, periods: dates, operation } } });
    return result;
  });
}
