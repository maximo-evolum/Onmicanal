import { createHash } from "node:crypto";
import { FinanceOperationError, findAllFinanceRecords, withFinanceWrite } from "./finance-integrity.service.js";
import { planFinanceAllocation, assertReconciliationPeriodOpen, allocationReason, applyFinanceAllocationInTransaction, reverseFinanceAllocationInTransaction } from "./finance-allocation.service.js";
import { financeDocumentState } from "./finance-document-values.service.js";
import { creditDay, validCreditRut, invoiceCreditRut } from "./finance-customer-credit-ledger.service.js";
import { auditFinanceGroup } from "./finance-group-evidence.service.js";

const data = (r) => r?.data || {}, fail = (status, message) => { throw new FinanceOperationError(status, message); };
const types = ["bank_movement", "finance_invoice", "finance_reconciliation", "finance_invoice_receipt", "finance_reconciliation_group", "finance_reconciliation_difference"];
const load = (db, tenantId) => findAllFinanceRecords(db, { where: { tenantId, recordType: { in: types } } });
const authenticated = (tenantId, userId) => { if (!tenantId || !userId) fail(401, "Falta la sesión autenticada."); };
function inputCells(input) {
  if (!Array.isArray(input) || !input.length || input.length > 200) fail(422, "Selecciona entre 1 y 200 cruces; no se recortará la distribución.");
  const seen = new Set();
  const cells = input.map((a) => {
    if (typeof a?.movementId !== "string" || !a.movementId.trim() || typeof a?.invoiceId !== "string" || !a.invoiceId.trim() || !Number.isSafeInteger(a.amount) || a.amount <= 0) fail(422, "Cada cruce requiere abono, factura y monto entero positivo.");
    const key = JSON.stringify([a.movementId, a.invoiceId]); if (seen.has(key)) fail(422, "Hay un cruce de abono y factura repetido."); seen.add(key);
    return { movementId: a.movementId, invoiceId: a.invoiceId, amount: a.amount };
  }).sort((a, b) => a.movementId.localeCompare(b.movementId) || a.invoiceId.localeCompare(b.invoiceId));
  if (new Set(cells.map((a) => a.movementId)).size > 10 || new Set(cells.map((a) => a.invoiceId)).size > 20) fail(422, "El grupo admite hasta 10 abonos y 20 facturas. Divide lotes mayores sin reutilizar movimientos.");
  return cells;
}
export function planFinanceGroup(records, input) {
  const cells = inputCells(input), index = new Map(records.map((r) => [r.id, r]));
  const find = (id, type) => { const r = index.get(id); if (r?.recordType !== type) fail(404, "Falta un abono o factura de esta empresa."); return r; };
  const movements = [...new Set(cells.map((a) => a.movementId))].map((id) => find(id, "bank_movement"));
  const invoices = [...new Set(cells.map((a) => a.invoiceId))].map((id) => find(id, "finance_invoice"));
  const customerRut = invoiceCreditRut(invoices[0]);
  if (!validCreditRut(customerRut) || invoices.some((r) => invoiceCreditRut(r) !== customerRut || data(r).currency !== "CLP" || r.tenantId !== movements[0].tenantId)) fail(422, "Las facturas deben pertenecer a la misma empresa y cliente con RUT válido, en CLP.");
  for (const movement of movements) {
    const m = data(movement), entries = cells.filter((a) => a.movementId === movement.id);
    if (movement.tenantId !== invoices[0].tenantId || m.currency !== "CLP" || m.excluded || !creditDay(m.transactionDate || m.date) || ["EXCLUDED", "CLOSED", "RECONCILED"].includes(movement.status)) fail(422, "Hay un movimiento excluido, sin fecha válida, de otra empresa o moneda.");
    if (records.some((r) => data(r).movementId === movement.id && ((r.recordType === "finance_reconciliation" && r.status === "APPROVED") || (r.recordType === "finance_invoice_receipt" && r.status !== "REVERSED") || (r.recordType === "finance_reconciliation_difference" && r.status === "PROPOSED")))) fail(409, "Un abono tiene conciliación, cobros o una diferencia pendiente. Resuélvelos antes de agrupar.");
    planFinanceAllocation(movement, entries.map((a) => index.get(a.invoiceId)), entries.map(({ invoiceId, amount }) => ({ invoiceId, amount })));
  }
  const documents = invoices.map((invoice) => {
    const state = financeDocumentState(invoice), applied = cells.filter((a) => a.invoiceId === invoice.id).reduce((sum, a) => sum + a.amount, 0);
    if (!state.included || !Number.isSafeInteger(applied) || !Number.isSafeInteger(state.paidAmount + applied) || applied > state.balance) fail(409, "La suma de abonos supera el saldo de una factura. No se descartan sobrepagos: utiliza Saldos a favor.");
    return { id: invoice.id, title: invoice.title, balance: state.balance, applied, remaining: state.balance - applied };
  });
  const total = cells.reduce((sum, a) => sum + a.amount, 0); if (!Number.isSafeInteger(total)) fail(422, "El total excede el rango admitido.");
  const selected = [...movements, ...invoices].sort((a, b) => a.id.localeCompare(b.id));
  const version = createHash("sha256").update(JSON.stringify({ cells, selected: selected.map((r) => [r.id, r.status, r.updatedAt, r.data]) })).digest("hex");
  return { version, customerRut, currency: "CLP", total, periods: [...new Set(movements.map((r) => creditDay(data(r).transactionDate || data(r).date).slice(0, 7)))].sort(), allocations: cells, documents,
    movements: movements.map((r) => ({ id: r.id, title: r.title, amount: data(r).amount, date: creditDay(data(r).transactionDate || data(r).date) })) };
}
async function checkedPlan(tx, tenantId, allocations) {
  const records = await load(tx, tenantId), plan = planFinanceGroup(records, allocations);
  // Lock all involved periods in a stable order before any financial write.
  for (const m of [...plan.movements].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))) await assertReconciliationPeriodOpen(tx, tenantId, { data: { transactionDate: m.date } });
  return plan;
}
export async function previewFinanceGroup(db, { tenantId, userId, allocations }) {
  authenticated(tenantId, userId);
  // Period locks serialize preview with close/reopen; no balances are modified.
  return withFinanceWrite(db, (tx) => checkedPlan(tx, tenantId, allocations));
}
export async function approveFinanceGroup(db, { tenantId, userId, allocations, expectedVersion, reason, confirmation }) {
  authenticated(tenantId, userId); reason = allocationReason(reason);
  if (confirmation !== "APROBAR") fail(422, "Confirma escribiendo APROBAR tras revisar la distribución.");
  return withFinanceWrite(db, async (tx) => {
    const plan = await checkedPlan(tx, tenantId, allocations);
    if (plan.version !== expectedVersion) fail(409, "Cambió la distribución, un abono o una factura. Genera una nueva vista previa.");
    const at = new Date().toISOString();
    const group = await tx.industryRecord.create({ data: { tenantId, recordType: "finance_reconciliation_group", title: `Grupo · ${plan.movements.length} abonos / ${plan.documents.length} facturas`, status: "APPROVED", data: { ...plan, amount: plan.total, reason, approvedAt: at, approvedById: userId, reconciliationIds: [] } } });
    const reconciliationIds = [];
    for (const movement of [...plan.movements].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))) {
      const result = await applyFinanceAllocationInTransaction(tx, { tenantId, userId, movementId: movement.id, allocations: plan.allocations.filter((a) => a.movementId === movement.id).map(({ invoiceId, amount }) => ({ invoiceId, amount })), reason, manual: true });
      reconciliationIds.push(result.reconciliation.id);
      await tx.industryRecord.update({ where: { id: result.reconciliation.id }, data: { data: { ...data(result.reconciliation), groupId: group.id, reconciliationType: "GROUPED_BATCH" } } });
    }
    const saved = await tx.industryRecord.update({ where: { id: group.id }, data: { data: { ...data(group), reconciliationIds } } });
    await tx.tenantAuditLog.create({ data: { tenantId, actorUserId: userId, action: "FINANCE_GROUP_APPROVED", entity: "finance_reconciliation_group", entityId: group.id, metadata: { allocations: plan.allocations, total: plan.total, periods: plan.periods, reason } } });
    return { group: saved };
  });
}
export async function reverseFinanceGroup(db, { tenantId, userId, id, reason }) {
  authenticated(tenantId, userId); reason = allocationReason(reason);
  return withFinanceWrite(db, async (tx) => {
    const records = await load(tx, tenantId), group = records.find((r) => r.id === id && r.recordType === "finance_reconciliation_group");
    if (!group) fail(404, "Grupo no disponible en esta empresa.");
    if (group.status === "REVERSED") return { alreadyReversed: true };
    const evidence = auditFinanceGroup(group, records); if (!evidence.valid) fail(409, evidence.errors.join(" "));
    const ids = data(group).reconciliationIds;
    const children = ids.map((id) => records.find((r) => r.id === id)).sort((a, b) => String(data(a).transactionDate).localeCompare(String(data(b).transactionDate)) || a.id.localeCompare(b.id));
    for (const child of children) await assertReconciliationPeriodOpen(tx, tenantId, { data: { transactionDate: data(child).transactionDate } });
    for (const child of children) await reverseFinanceAllocationInTransaction(tx, { tenantId, userId, reconciliationId: child.id, reason, groupId: id });
    await tx.industryRecord.update({ where: { id }, data: { status: "REVERSED", data: { ...data(group), reversedAt: new Date().toISOString(), reversedById: userId, reversalReason: reason } } });
    await tx.tenantAuditLog.create({ data: { tenantId, actorUserId: userId, action: "FINANCE_GROUP_REVERSED", entity: "finance_reconciliation_group", entityId: id, metadata: { reason, reconciliationIds: ids } } });
    return { alreadyReversed: false };
  });
}
export async function listFinanceGroups(db, { tenantId, page = 1, query = "", period = "" }) {
  if (!tenantId) fail(401, "Falta la empresa autenticada."); page = Number(page);
  if (!Number.isSafeInteger(page) || page < 1 || (period && !/^\d{4}-(0[1-9]|1[0-2])$/.test(period))) fail(422, "Filtros de consulta inválidos.");
  const records = await load(db, tenantId), q = String(query).trim().toLocaleLowerCase("es");
  const groups = records.filter((r) => r.recordType === "finance_reconciliation_group" && (!period || (Array.isArray(data(r).periods) && data(r).periods.includes(period))) && (!q || `${r.title} ${data(r).customerRut} ${data(r).reason} ${(Array.isArray(data(r).documents) ? data(r).documents : []).map((d) => d?.title || "").join(" ")}`.toLocaleLowerCase("es").includes(q))).sort((a, b) => String(data(b).approvedAt).localeCompare(String(data(a).approvedAt)) || a.id.localeCompare(b.id));
  return { page, pages: Math.max(1, Math.ceil(groups.length / 25)), total: groups.length, records: groups.slice((page - 1) * 25, page * 25).map((g) => ({ ...g, validation: g.status === "APPROVED" ? auditFinanceGroup(g, records) : null })) };
}
