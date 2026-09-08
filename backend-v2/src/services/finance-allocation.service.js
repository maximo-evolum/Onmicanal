import { FinanceOperationError, withFinanceWrite, findAllFinanceRecords } from "./finance-integrity.service.js";
import { financeRecordData as dataOf, getInvoiceFinancialState, sameFinanceInvoiceParty, scoreFinanceReconciliation } from "./finance.service.js";

const fail = (status, message) => { throw new FinanceOperationError(status, message); };
const history = (data) => Array.isArray(data.history) ? data.history : [];
const pesos = (value) => typeof value === "number" && Number.isSafeInteger(value) && value > 0;
export function allocationReason(value) {
  const reason = String(value || "").trim();
  if (reason.length < 10 || reason.length > 1000) fail(400, "Describe el motivo con entre 10 y 1.000 caracteres.");
  return reason;
}
export function validateAllocationInput(input) {
  if (!Array.isArray(input) || !input.length || input.length > 100) fail(400, "Selecciona entre 1 y 100 documentos; no se recortará la selección.");
  const ids = new Set();
  for (const item of input) {
    if (typeof item?.invoiceId !== "string" || !item.invoiceId.trim() || ids.has(item.invoiceId)) fail(400, "Los documentos deben ser válidos y no estar repetidos.");
    if (!pesos(item.amount)) fail(400, "Cada asignación debe ser un monto positivo en pesos enteros.");
    ids.add(item.invoiceId);
  }
  return input.map(({ invoiceId, amount }) => ({ invoiceId, amount }));
}

export async function assertReconciliationPeriodOpen(tx, tenantId, movement) {
  const data = dataOf(movement);
  const date = String(data.transactionDate || data.date || "").slice(0, 10);
  if (!/^\d{4}-(0[1-9]|1[0-2])-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) fail(400, "El movimiento necesita una fecha válida antes de conciliar o revertir.");
  const closed = await tx.industryRecord.findFirst({ where: { tenantId, recordType: "finance_monthly_close", status: "CLOSED", data: { path: ["period"], equals: date.slice(0, 7) } } });
  if (closed) fail(409, `El período ${date.slice(0, 7)} está cerrado. No se puede modificar esta conciliación.`);
}

export function planFinanceAllocation(movement, invoices, allocations) {
  const bank = dataOf(movement);
  if (["MATCHED", "REVIEW", "REJECTED", "DELETED"].includes(String(movement.status).toUpperCase()) || bank.reconciliationId) fail(409, "El movimiento ya está conciliado, eliminado o pendiente de resolver una revisión.");
  if (["COMMISSION_OR_FEE", "INTERNAL_TRANSFER"].includes(String(bank.movementKind || "").toUpperCase())) fail(400, "Comisiones y traspasos internos no se aplican a cuentas por cobrar.");
  if (String(bank.currency || "CLP").toUpperCase() !== "CLP") fail(400, "La asignación actual admite pesos chilenos; otras monedas requieren un flujo cambiario.");
  const amount = Number(bank.amount);
  if (!pesos(amount)) fail(400, "El abono debe tener un monto positivo en pesos enteros.");
  if (!invoices.length || invoices.length !== allocations.length) fail(404, "No se encontraron todos los documentos de esta empresa.");
  if (invoices.length > 1 && !sameFinanceInvoiceParty(invoices)) fail(400, "Los documentos agrupados deben pertenecer al mismo cliente.");
  const index = new Map(invoices.map((invoice) => [invoice.id, invoice]));
  const plan = validateAllocationInput(allocations).map((allocation) => {
    const invoice = index.get(allocation.invoiceId);
    if (!invoice) fail(404, "Documento no encontrado en esta empresa.");
    const score = scoreFinanceReconciliation(invoice, movement);
    if (!score.eligible) fail(400, score.blockers.join(" "));
    const state = getInvoiceFinancialState(invoice);
    if (state.status === "PAID" || allocation.amount > state.balance) fail(409, "Una asignación supera el saldo disponible o corresponde a un documento pagado. Actualiza los datos.");
    if (!Number.isSafeInteger(state.balance)) fail(400, "El saldo del documento no está expresado en pesos enteros.");
    return { ...allocation, invoice, state, score };
  });
  const total = plan.reduce((sum, item) => sum + item.amount, 0);
  if (!Number.isSafeInteger(total) || total !== amount) fail(400, "La suma asignada debe coincidir exactamente con el abono. No se descartan diferencias ni remanentes.");
  return plan;
}

// Both suggestion approval and manual allocation use this same atomic writer.
export async function applyFinanceAllocation(db, { tenantId, userId, movementId, allocations, invoiceIds, reason, manual = false }) {
  if (manual) reason = allocationReason(reason);
  const explicit = allocations !== undefined ? validateAllocationInput(allocations) : null;
  const ids = explicit ? explicit.map((item) => item.invoiceId) : invoiceIds;
  if (!Array.isArray(ids) || !ids.length || ids.length > 100 || new Set(ids).size !== ids.length || ids.some((id) => typeof id !== "string" || !id.trim())) fail(400, "Selecciona entre 1 y 100 facturas distintas.");
  return withFinanceWrite(db, async (tx) => {
    const movement = await tx.industryRecord.findFirst({ where: { id: movementId, tenantId, recordType: "bank_movement" } });
    if (!movement) fail(404, "Movimiento no encontrado.");
    await assertReconciliationPeriodOpen(tx, tenantId, movement);
    const invoices = await tx.industryRecord.findMany({ where: { tenantId, recordType: "finance_invoice", id: { in: ids } } });
    let requested = explicit;
    if (!requested) {
      // Old suggestion clients remain compatible; grouped suggestions must
      // still cover every selected balance exactly, without database-order allocation.
      requested = ids.map((id) => {
        const invoice = invoices.find((item) => item.id === id);
        if (!invoice) fail(404, "Factura no encontrada.");
        return { invoiceId: id, amount: ids.length === 1 ? Number(dataOf(movement).amount) : getInvoiceFinancialState(invoice).balance };
      });
    }
    const plan = planFinanceAllocation(movement, invoices, requested);
    const now = new Date().toISOString();
    const bank = dataOf(movement);
    const confidence = Math.min(...plan.map((item) => item.score.confidence));
    const reasons = plan.flatMap((item) => item.score.reasons);
    const reconciliation = await tx.industryRecord.create({ data: { tenantId, recordType: "finance_reconciliation", title: `${plan.length} documento(s) · ${movement.title}`.slice(0, 220), status: "APPROVED", data: {
      movementId, invoiceId: ids.length === 1 ? ids[0] : null, invoiceIds: ids, allocations: plan.map((item) => ({ invoiceId: item.invoiceId, amount: item.amount, documentTitle: item.invoice.title })), amount: bank.amount,
      currency: "CLP", transactionDate: bank.transactionDate || bank.date, account: bank.account || null,
      confidence, matchReasons: reasons, matchEvidence: plan.flatMap((item) => item.score.evidence), matchLimitations: plan.flatMap((item) => item.score.limitations),
      reconciliationType: manual ? "MANUAL_ALLOCATION" : ids.length > 1 ? "GROUPED_PAYMENT" : "BANK_PAYMENT",
      reason: reason || "Aprobación humana de sugerencia", approvedAt: now, approvedById: userId || null
    } } });
    await tx.industryRecord.update({ where: { id: movement.id }, data: { status: "MATCHED", data: { ...bank, status: "MATCHED", reconciliationId: reconciliation.id, reconciledAt: now, reconciledById: userId || null } } });
    const updated = [];
    for (const item of plan) {
      const data = dataOf(item.invoice);
      const balance = item.state.balance - item.amount;
      const status = balance === 0 ? "PAID" : "PARTIAL";
      const receipt = await tx.industryRecord.create({ data: { tenantId, recordType: "finance_invoice_receipt", title: `Cobro conciliado ${item.invoice.title}`.slice(0, 220), status: "RECONCILED", data: { invoiceId: item.invoiceId, amount: item.amount, paymentDate: bank.transactionDate || bank.date, reference: bank.reference || null, movementId, reconciliationId: reconciliation.id, source: "bank_reconciliation", registeredById: userId || null } } });
      updated.push(await tx.industryRecord.update({ where: { id: item.invoiceId }, data: { status, data: { ...data, balance, paidAmount: Number(data.paidAmount ?? Math.max(0, item.state.amount - item.state.balance)) + item.amount, status, paidAt: balance === 0 ? now : null, lastReconciliationId: reconciliation.id, history: [...history(data), { at: now, type: "BANK_RECONCILIATION_APPLIED", amount: item.amount, movementId, reconciliationId: reconciliation.id, receiptId: receipt.id, userId, reason: reason || "Aprobación humana de sugerencia" }] } } }));
    }
    await tx.tenantAuditLog.create({ data: { tenantId, actorUserId: userId || null, action: "FINANCE_RECONCILIATION_APPROVED", entity: "finance_reconciliation", entityId: reconciliation.id, metadata: { movementId, allocations: requested, reason: reason || "Aprobación humana de sugerencia", manual } } });
    return { reconciliation, invoices: updated, confidence, reasons, remainingBalance: plan.reduce((sum, item) => sum + item.state.balance - item.amount, 0) };
  });
}

export async function reverseFinanceAllocation(db, { tenantId, userId, reconciliationId, reason }) {
  reason = allocationReason(reason);
  return withFinanceWrite(db, async (tx) => {
    const reconciliation = await tx.industryRecord.findFirst({ where: { id: reconciliationId, tenantId, recordType: "finance_reconciliation" } });
    if (!reconciliation) fail(404, "Conciliación no encontrada.");
    if (reconciliation.status === "REVERSED") return { reconciliation, alreadyReversed: true };
    if (reconciliation.status !== "APPROVED") fail(409, "Sólo se puede revertir una conciliación aprobada.");
    const rec = dataOf(reconciliation);
    const movement = await tx.industryRecord.findFirst({ where: { id: rec.movementId, tenantId, recordType: "bank_movement" } });
    if (!movement || movement.status !== "MATCHED" || dataOf(movement).reconciliationId !== reconciliation.id) fail(409, "El vínculo con el movimiento cambió. Requiere revisión antes de revertir.");
    await assertReconciliationPeriodOpen(tx, tenantId, movement);
    const receipts = await findAllFinanceRecords(tx, { where: { tenantId, recordType: "finance_invoice_receipt", data: { path: ["reconciliationId"], equals: reconciliationId } } });
    const total = receipts.reduce((sum, receipt) => sum + Number(dataOf(receipt).amount), 0);
    if (!receipts.length || total !== Number(dataOf(movement).amount) || receipts.some((receipt) => receipt.status !== "RECONCILED" || !pesos(dataOf(receipt).amount) || dataOf(receipt).movementId !== movement.id)) fail(409, "Los comprobantes no cuadran con el abono. No se aplicó ninguna reversa.");
    const ids = receipts.map((receipt) => dataOf(receipt).invoiceId);
    if (new Set(ids).size !== ids.length) fail(409, "Hay comprobantes duplicados que requieren revisión.");
    const invoices = await tx.industryRecord.findMany({ where: { tenantId, recordType: "finance_invoice", id: { in: ids } } });
    const plan = receipts.map((receipt) => {
      const detail = dataOf(receipt); const invoice = invoices.find((item) => item.id === detail.invoiceId);
      if (!invoice) fail(409, "Falta un documento vinculado; no se puede revertir parcialmente.");
      const data = dataOf(invoice); const state = getInvoiceFinancialState(invoice);
      const paid = Number(data.paidAmount ?? Math.max(0, state.amount - state.balance));
      if (!Number.isSafeInteger(paid) || !Number.isSafeInteger(state.balance) || ["ANNULLED", "CANCELLED", "REJECTED", "ANULADA"].includes(invoice.status) || paid < detail.amount || state.balance + detail.amount > state.amount) fail(409, "El documento tiene ajustes posteriores incompatibles. Revisa sus pagos o notas antes de revertir.");
      return { receipt, invoice, data, amount: detail.amount, balance: state.balance + detail.amount, paid: paid - detail.amount };
    });
    const now = new Date().toISOString();
    for (const item of plan) {
      const status = item.paid > 0 ? "PARTIAL" : "OPEN";
      await tx.industryRecord.update({ where: { id: item.invoice.id }, data: { status, data: { ...item.data, balance: item.balance, paidAmount: item.paid, paidAt: null, status, lastReconciliationId: item.data.lastReconciliationId === reconciliationId ? null : item.data.lastReconciliationId, history: [...history(item.data), { at: now, type: "BANK_RECONCILIATION_REVERSED", reconciliationId, receiptId: item.receipt.id, amount: item.amount, reason, userId }] } } });
      await tx.industryRecord.update({ where: { id: item.receipt.id }, data: { status: "REVERSED", data: { ...dataOf(item.receipt), reversedAt: now, reversedById: userId || null, reversalReason: reason } } });
    }
    const bank = dataOf(movement);
    await tx.industryRecord.update({ where: { id: movement.id }, data: { status: "PENDING", data: { ...bank, status: "PENDING", reconciliationId: null, reconciledAt: null, reconciledById: null, history: [...history(bank), { at: now, type: "RECONCILIATION_REVERSED", reconciliationId, reason, userId }] } } });
    const updated = await tx.industryRecord.update({ where: { id: reconciliationId }, data: { status: "REVERSED", data: { ...rec, reversedAt: now, reversedById: userId || null, reversalReason: reason } } });
    await tx.tenantAuditLog.create({ data: { tenantId, actorUserId: userId || null, action: "FINANCE_RECONCILIATION_REVERSED", entity: "finance_reconciliation", entityId: reconciliationId, metadata: { movementId: movement.id, reason, restored: plan.map((item) => ({ invoiceId: item.invoice.id, amount: item.amount })) } } });
    return { reconciliation: updated, alreadyReversed: false };
  });
}

export async function sendFinanceMovementToReview(db, { tenantId, userId, movementId, detail }) {
  return withFinanceWrite(db, async (tx) => {
    const movement = await tx.industryRecord.findFirst({ where: { id: movementId, tenantId, recordType: "bank_movement" } });
    if (!movement) fail(404, "Movimiento no encontrado.");
    const data = dataOf(movement);
    if (["MATCHED", "REVIEW", "REJECTED", "DELETED"].includes(movement.status) || data.reconciliationId) fail(409, "El movimiento ya fue conciliado o enviado a revisión. Actualiza la vista.");
    await assertReconciliationPeriodOpen(tx, tenantId, movement);
    const now = new Date().toISOString();
    const updatedMovement = await tx.industryRecord.update({ where: { id: movement.id }, data: { status: "REVIEW", data: { ...data, status: "REVIEW", reviewReason: detail, reviewedAt: now } } });
    const exception = await tx.industryRecord.create({ data: { tenantId, recordType: "finance_exception", title: `Revisión ${movement.title}`.slice(0, 220), status: "OPEN", data: { type: "UNMATCHED_MOVEMENT", movementId, detail, priority: "MEDIUM", suggestedBy: "finance_reconciliation" } } });
    await tx.tenantAuditLog.create({ data: { tenantId, actorUserId: userId || null, action: "FINANCE_RECONCILIATION_REJECTED", entity: "bank_movement", entityId: movementId, metadata: { detail, exceptionId: exception.id } } });
    return { updatedMovement, exception };
  });
}
