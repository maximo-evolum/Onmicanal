import { FinanceOperationError, findAllFinanceRecords, withFinanceWrite } from "./finance-integrity.service.js";
import { planFinanceAllocation, assertReconciliationPeriodOpen } from "./finance-allocation.service.js";
import { financeDocumentState } from "./finance-document-values.service.js";
import { auditDifference, DIFFERENCE_CATEGORIES, differenceFingerprint, differenceData as data } from "./finance-difference-evidence.service.js";

const fail = (code, message) => { throw new FinanceOperationError(code, message); };
const text = (v) => String(v || "").trim();
const note = (v) => { const s = text(v); if (s.length < 10 || s.length > 1500) fail(422, "Motivo y respaldo deben contener entre 10 y 1.500 caracteres."); return s; };
const history = (r) => Array.isArray(data(r).history) ? data(r).history : [];
const types = ["finance_invoice", "bank_movement", "finance_reconciliation", "finance_invoice_receipt", "finance_reconciliation_difference"];
const load = (db, tenantId) => findAllFinanceRecords(db, { where: { tenantId, recordType: { in: types } } });
const find = (records, id, type) => { const r = records.find((r) => r.id === id && r.recordType === type); if (!r) fail(404, "Registro no disponible en esta empresa."); return r; };
const authenticated = (tenantId, userId) => { if (!tenantId || !userId) fail(401, "Falta la sesión autenticada."); };
async function log(tx, tenantId, userId, action, record, detail) { await tx.tenantAuditLog.create({ data: { tenantId, actorUserId: userId, action, entity: "finance_reconciliation_difference", entityId: record.id, metadata: detail } }); }
function plan(records, movement, invoice, settlementAmount, category) {
  const m = data(movement), positive = (n) => Number.isSafeInteger(n) && n > 0;
  if (!positive(m.amount) || !positive(settlementAmount) || settlementAmount <= m.amount) fail(422, "La justificación debe cubrir una diferencia positiva entre la deuda saldada y el abono. Los excesos se conservan como saldo a favor.");
  if (!DIFFERENCE_CATEGORIES[category]) fail(422, "Selecciona una causa admitida para la diferencia.");
  const amount = settlementAmount - m.amount;
  if (category === "ROUNDING" && amount > 100) fail(422, "Un redondeo no puede superar 100 CLP. No reclasifiques comisiones o descuentos como redondeos.");
  if (m.currency !== "CLP" || data(invoice).currency !== "CLP" || m.excluded || ["EXCLUDED", "RECONCILED", "CLOSED"].includes(movement.status)) fail(422, "El abono y la factura deben estar vigentes e identificados en CLP.");
  if (records.some((r) => data(r).movementId === movement.id && ((r.recordType === "finance_reconciliation" && r.status === "APPROVED") || (r.recordType === "finance_invoice_receipt" && r.status !== "REVERSED")))) fail(409, "El abono ya tiene comprobantes o conciliación. No se aplicará otra vez.");
  const [item] = planFinanceAllocation({ ...movement, data: { ...m, amount: settlementAmount } }, [invoice], [{ invoiceId: invoice.id, amount: settlementAmount }]);
  if (!Number.isSafeInteger(item.state.paidAmount + m.amount) || !Number.isSafeInteger(item.state.justifiedDifference + amount)) fail(422, "Los importes superan el rango admitido.");
  return { amount, state: item.state };
}
export async function proposeFinanceDifference(db, { tenantId, userId, movementId, invoiceId, settlementAmount, category, reason, evidence }) {
  authenticated(tenantId, userId); reason = note(reason); evidence = note(evidence);
  return withFinanceWrite(db, async (tx) => {
    const records = await load(tx, tenantId), movement = find(records, movementId, "bank_movement"), invoice = find(records, invoiceId, "finance_invoice");
    if (records.some((r) => r.recordType === "finance_reconciliation_difference" && r.status === "PROPOSED" && data(r).movementId === movementId)) fail(409, "Ya hay una propuesta pendiente para este abono. Revísala o recházala antes de crear otra.");
    await assertReconciliationPeriodOpen(tx, tenantId, movement);
    const p = plan(records, movement, invoice, settlementAmount, category), at = new Date().toISOString();
    const difference = await tx.industryRecord.create({ data: { tenantId, recordType: "finance_reconciliation_difference", title: `Diferencia · ${invoice.title}`.slice(0, 220), status: "PROPOSED", data: { movementId, invoiceId, invoiceTitle: invoice.title, movementTitle: movement.title, amount: p.amount, bankAmount: data(movement).amount, settlementAmount, category, reason, evidence, currency: "CLP", transactionDate: String(data(movement).transactionDate || data(movement).date).slice(0, 10), sourceVersion: { movement: differenceFingerprint(movement), invoice: differenceFingerprint(invoice) }, proposedAt: at, proposedById: userId } } });
    await log(tx, tenantId, userId, "FINANCE_DIFFERENCE_PROPOSED", difference, { category, amount: p.amount, reason, evidence }); return { difference };
  });
}
export async function approveFinanceDifference(db, { tenantId, userId, id, expectedVersion, confirmation }) {
  authenticated(tenantId, userId); if (confirmation !== "APROBAR") fail(422, "Confirma escribiendo APROBAR.");
  return withFinanceWrite(db, async (tx) => {
    const records = await load(tx, tenantId), difference = find(records, id, "finance_reconciliation_difference"), d = data(difference);
    if (difference.status !== "PROPOSED" || differenceFingerprint(difference) !== expectedVersion) fail(409, "La propuesta cambió o ya fue resuelta. Actualiza la lista.");
    const movement = find(records, d.movementId, "bank_movement"), invoice = find(records, d.invoiceId, "finance_invoice");
    if (differenceFingerprint(movement) !== d.sourceVersion?.movement || differenceFingerprint(invoice) !== d.sourceVersion?.invoice) fail(409, "Cambió el abono o la factura. Rechaza la propuesta y prepara una nueva con datos actuales.");
    await assertReconciliationPeriodOpen(tx, tenantId, movement);
    const p = plan(records, movement, invoice, d.settlementAmount, d.category), at = new Date().toISOString(), m = data(movement);
    if (p.amount !== d.amount || m.amount !== d.bankAmount) fail(409, "Los importes de la propuesta no coinciden con la fuente.");
    const rec = await tx.industryRecord.create({ data: { tenantId, recordType: "finance_reconciliation", title: `Conciliación con diferencia · ${invoice.title}`.slice(0, 220), status: "APPROVED", data: { movementId: movement.id, invoiceId: invoice.id, invoiceIds: [invoice.id], allocations: [{ invoiceId: invoice.id, amount: m.amount, documentTitle: invoice.title }], amount: m.amount, differenceId: id, differenceAmount: d.amount, settlementAmount: d.settlementAmount, currency: "CLP", transactionDate: d.transactionDate, reconciliationType: "JUSTIFIED_DIFFERENCE", reason: d.reason, approvedAt: at, approvedById: userId } } });
    const receipt = await tx.industryRecord.create({ data: { tenantId, recordType: "finance_invoice_receipt", title: `Cobro bancario · ${invoice.title}`.slice(0, 220), status: "RECONCILED", data: { invoiceId: invoice.id, movementId: movement.id, reconciliationId: rec.id, differenceId: id, amount: m.amount, currency: "CLP", paymentDate: d.transactionDate, source: "bank_reconciliation", registeredById: userId } } });
    const balance = p.state.balance - d.settlementAmount, paidAmount = p.state.paidAmount + m.amount, justifiedDifferenceTotal = p.state.justifiedDifference + d.amount, status = balance === 0 ? "PAID" : "PARTIAL";
    await tx.industryRecord.update({ where: { id: invoice.id }, data: { status, data: { ...data(invoice), balance, paidAmount, justifiedDifferenceTotal, status, paidAt: balance === 0 ? at : null, history: [...history(invoice), { type: "JUSTIFIED_DIFFERENCE_APPLIED", differenceId: id, reconciliationId: rec.id, amount: d.amount, bankAmount: m.amount, at, userId }] } } });
    await tx.industryRecord.update({ where: { id: movement.id }, data: { status: "MATCHED", data: { ...m, status: "MATCHED", reconciliationId: rec.id, reconciledAt: at, reconciledById: userId } } });
    const updated = await tx.industryRecord.update({ where: { id }, data: { status: "APPROVED", data: { ...d, reconciliationId: rec.id, receiptId: receipt.id, approvedAt: at, approvedById: userId } } });
    await log(tx, tenantId, userId, "FINANCE_DIFFERENCE_APPROVED", updated, { bankAmount: m.amount, differenceAmount: d.amount, balance, reason: d.reason, evidence: d.evidence });
    return { difference: updated, balance };
  });
}
export async function rejectFinanceDifference(db, { tenantId, userId, id, reason }) {
  authenticated(tenantId, userId); reason = note(reason);
  return withFinanceWrite(db, async (tx) => {
    const records = await load(tx, tenantId), difference = find(records, id, "finance_reconciliation_difference");
    if (difference.status !== "PROPOSED") fail(409, "Sólo se rechazan propuestas pendientes.");
    await assertReconciliationPeriodOpen(tx, tenantId, { data: { transactionDate: data(difference).transactionDate } });
    const updated = await tx.industryRecord.update({ where: { id }, data: { status: "REJECTED", data: { ...data(difference), rejectedAt: new Date().toISOString(), rejectedById: userId, rejectionReason: reason } } });
    await log(tx, tenantId, userId, "FINANCE_DIFFERENCE_REJECTED", updated, { reason }); return { difference: updated };
  });
}
export async function reverseFinanceDifference(db, { tenantId, userId, id, reason }) {
  authenticated(tenantId, userId); reason = note(reason);
  return withFinanceWrite(db, async (tx) => {
    const records = await load(tx, tenantId), difference = find(records, id, "finance_reconciliation_difference"), d = data(difference);
    if (difference.status === "REVERSED") return { alreadyReversed: true };
    const audit = auditDifference(difference, records); if (!audit.valid) fail(409, audit.errors.join(" "));
    const movement = find(records, d.movementId, "bank_movement"), invoice = find(records, d.invoiceId, "finance_invoice"), rec = find(records, d.reconciliationId, "finance_reconciliation"), receipt = find(records, d.receiptId, "finance_invoice_receipt");
    await assertReconciliationPeriodOpen(tx, tenantId, movement);
    const s = financeDocumentState(invoice), balance = s.balance + d.settlementAmount, paidAmount = s.paidAmount - d.bankAmount, justifiedDifferenceTotal = s.justifiedDifference - d.amount;
    if (!s.included || paidAmount < 0 || justifiedDifferenceTotal < 0 || balance + justifiedDifferenceTotal > s.amount) fail(409, "Hay ajustes posteriores incompatibles. No se aplicó una reversa parcial.");
    const at = new Date().toISOString(), reversal = { reversedAt: at, reversedById: userId, reversalReason: reason }, status = paidAmount || justifiedDifferenceTotal ? "PARTIAL" : "OPEN";
    await tx.industryRecord.update({ where: { id: invoice.id }, data: { status, data: { ...data(invoice), balance, paidAmount, justifiedDifferenceTotal, status, paidAt: null, history: [...history(invoice), { type: "JUSTIFIED_DIFFERENCE_REVERSED", differenceId: id, at, userId, reason }] } } });
    for (const r of [difference, rec, receipt]) await tx.industryRecord.update({ where: { id: r.id }, data: { status: "REVERSED", data: { ...data(r), ...reversal } } });
    await tx.industryRecord.update({ where: { id: movement.id }, data: { status: "PENDING", data: { ...data(movement), status: "PENDING", reconciliationId: null, reconciledAt: null, reconciledById: null, history: [...history(movement), { type: "JUSTIFIED_DIFFERENCE_REVERSED", differenceId: id, at, userId, reason }] } } });
    await log(tx, tenantId, userId, "FINANCE_DIFFERENCE_REVERSED", difference, { reason }); return { alreadyReversed: false };
  });
}
export async function listFinanceDifferences(db, { tenantId, page = 1, query = "", status = "" }) {
  if (!tenantId) fail(401, "Falta la empresa autenticada."); page = Number(page);
  if (!Number.isSafeInteger(page) || page < 1 || !["", "PROPOSED", "APPROVED", "REJECTED", "REVERSED"].includes(status)) fail(422, "Filtros inválidos.");
  const records = await load(db, tenantId), q = text(query).toLocaleLowerCase("es");
  const items = records.filter((r) => r.recordType === "finance_reconciliation_difference" && (!status || r.status === status) && (!q || `${r.title} ${data(r).invoiceTitle} ${data(r).movementTitle} ${data(r).reason}`.toLocaleLowerCase("es").includes(q))).sort((a, b) => String(data(b).proposedAt).localeCompare(String(data(a).proposedAt)) || a.id.localeCompare(b.id));
  return { page, pages: Math.max(1, Math.ceil(items.length / 25)), total: items.length, categories: DIFFERENCE_CATEGORIES, records: items.slice((page - 1) * 25, page * 25).map((r) => ({ ...r, version: differenceFingerprint(r), validation: r.status === "APPROVED" ? auditDifference(r, records) : null })) };
}
