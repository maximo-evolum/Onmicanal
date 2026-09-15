import { FinanceOperationError, findAllFinanceRecords } from "./finance-integrity.service.js";
const text = (v) => String(v ?? "");
const iso = (v) => v && Number.isFinite(new Date(v).getTime()) ? new Date(v).toISOString() : "";
const array = (v) => Array.isArray(v) ? v : [];
export async function readMovementTrace(db, { tenantId, movementId, access, cursor }) {
  const movement = await db.industryRecord.findFirst({ where: { tenantId, id: movementId, recordType: "bank_movement" } });
  if (!movement) throw new FinanceOperationError(404, "Movimiento no encontrado en esta empresa.");
  const types = [...(access.reconciliation ? ["finance_reconciliation"] : []), ...(access.exceptions ? ["finance_exception"] : []), ...(access.invoices ? ["finance_invoice_receipt"] : [])];
  const related = types.length ? await findAllFinanceRecords(db, { where: { tenantId, recordType: { in: types }, data: { path: ["movementId"], equals: movementId } } }) : [];
  const ids = new Set();
  if (access.invoices) for (const row of related) { const d = row.data || {}; if (typeof d.invoiceId === "string") ids.add(d.invoiceId); for (const id of array(d.invoiceIds)) if (typeof id === "string") ids.add(id); for (const a of array(d.allocations)) if (typeof a?.invoiceId === "string") ids.add(a.invoiceId); }
  const documents = ids.size ? await findAllFinanceRecords(db, { where: { tenantId, recordType: "finance_invoice", id: { in: [...ids] } } }) : [];
  const summaries = [...related, ...documents].map((row) => {
    const d = row.data || {}, document = row.recordType === "finance_invoice";
    return { id: row.id, kind: row.recordType, title: text(row.title), status: row.status, date: text(d.paymentDate || d.issueDate || d.approvedAt || d.createdAt || iso(row.createdAt)),
      amount: typeof d.amount === "number" ? d.amount : null, balance: document && typeof d.balance === "number" ? d.balance : null, currency: text(d.currency || "CLP"),
      party: document ? text(d.customerName || d.clientName || d.partyName) : "", reference: text(d.reference || d.invoiceNumber || d.documentNumber),
      reason: text(d.reversalReason || d.reason || d.detail), reversedAt: text(d.reversedAt),
      allocations: access.invoices ? array(d.allocations).filter((a) => a && Number.isFinite(a.amount) && documents.some((i) => i.id === a.invoiceId)).map((a) => ({ invoiceId: a.invoiceId, amount: a.amount })) : [] };
  });
  const auditEntities = [movementId, ...related.map((r) => r.id)];
  const where = { tenantId, entityId: { in: auditEntities } };
  if (cursor && !await db.tenantAuditLog.findFirst({ where: { ...where, id: cursor } })) throw new FinanceOperationError(400, "Página de historial inválida para este movimiento.");
  const audits = await db.tenantAuditLog.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 26, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) });
  const page = audits.slice(0, 25);
  return { movementId, records: summaries, access, events: page.map((a) => ({ id: a.id, date: iso(a.createdAt), action: a.action, actor: a.actorUserId ? "Usuario registrado" : "Proceso automático", reason: [a.action === "FINANCE_MOVEMENT_OWNER_CHANGED" ? text(a.metadata?.assignmentSummary) : "", text(a.metadata?.reason || a.metadata?.detail)].filter(Boolean).join(" · "), entityId: a.entityId })), nextCursor: audits.length > 25 ? page.at(-1).id : null };
}
