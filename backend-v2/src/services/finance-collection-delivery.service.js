import { createHash } from "node:crypto";
import { FinanceOperationError, findAllFinanceRecords, withFinanceWrite } from "./finance-integrity.service.js";
import { assertFinancePeriodOpen } from "./finance-period-control.service.js";
import { financeActivityDate, collectionInvoiceParty, isCollectionCustomerInvoice } from "./finance-case-actions.service.js";
import { getInvoiceFinancialState } from "./finance.service.js";
import { canPerformFinanceAction, FINANCE_ACTIONS } from "./finance-security.service.js";
import { collectionRecipient, prepareCollectionTransport, dispatchCollectionMessage } from "./finance-collection-transport.service.js";

const TYPE = "finance_collection_delivery";
const fail = (status, text) => { throw new FinanceOperationError(status, text); };
const hash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const dataOf = (row) => row?.data || {};
function access({ tenantId, userId, role }, action) {
  if (!tenantId || !userId) fail(401, "Se requiere una sesión y empresa válidas.");
  if (!canPerformFinanceAction(role, action)) fail(403, "Tu rol no permite esta acción de cobranza.");
}
async function record(db, tenantId, id, recordType) {
  const row = await db.industryRecord.findFirst({ where: { id: String(id || ""), tenantId, recordType } });
  if (!row) fail(404, "Registro no encontrado en esta empresa.");
  return row;
}
async function evidence(db, tenantId, caseId, now) {
  const item = await record(db, tenantId, caseId, "finance_collection_case");
  const invoice = await record(db, tenantId, dataOf(item).invoiceId, "finance_invoice");
  const d = dataOf(invoice), c = dataOf(item), state = getInvoiceFinancialState(invoice, now);
  if (["CLOSED", "PAID"].includes(item.status) || !isCollectionCustomerInvoice(invoice) || !state.included || state.balance <= 0 || !Number.isSafeInteger(state.balance) || state.balance > state.amount || String(d.currency || "CLP").toUpperCase() !== "CLP") fail(409, "El documento no tiene saldo válido en CLP para cobrar, está cerrado o es de demostración/proveedor.");
  if (d.contactOptOut || c.contactOptOut || d.doNotContact || c.doNotContact || d.contactConsent === false || c.contactConsent === false) fail(409, "El cliente tiene contacto bloqueado o consentimiento revocado. No se puede enviar cobranza.");
  const dueDate = String(d.dueDate || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate) || !Number.isFinite(Date.parse(dueDate)) || new Date(dueDate).toISOString().slice(0, 10) !== dueDate) fail(409, "Corrige el vencimiento del documento antes de preparar el mensaje.");
  const party = collectionInvoiceParty(invoice);
  const snapshot = { invoiceId: invoice.id, caseId: item.id, balance: state.balance, currency: "CLP", dueDate, name: String(party.name), rut: party.rut, number: String(d.invoiceNumber || d.number || invoice.title), version: Number(c.workflowVersion || 0), invoiceUpdatedAt: invoice.updatedAt || null };
  return { item, invoice, snapshot, snapshotHash: hash(snapshot) };
}
const publicRow = (row) => ({ id: row.id, status: row.status, ...Object.fromEntries(["caseId", "invoiceId", "channel", "recipient", "sender", "subject", "body", "balance", "currency", "createdAt", "expiresAt", "approvedAt", "finishedAt", "approvedById", "providerMessageId", "detail", "previewHash"].map((key) => [key, dataOf(row)[key] ?? null])) });
async function audit(db, ctx, row, action) {
  await db.tenantAuditLog.create({ data: { tenantId: ctx.tenantId, actorUserId: ctx.userId, action, entity: TYPE, entityId: row.id, metadata: { caseId: row.data.caseId, channel: row.data.channel, status: row.status } } });
}
function render(transport, snapshot) {
  const amount = new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 }).format(snapshot.balance);
  const parameters = [snapshot.name, snapshot.number, `${amount} CLP`, snapshot.dueDate];
  const subject = `Recordatorio de saldo: ${snapshot.number}`;
  const body = transport.channel === "gmail"
    ? `Hola ${snapshot.name}:\n\nSegún nuestros registros, el documento ${snapshot.number} tiene un saldo pendiente de ${amount} CLP, con vencimiento ${snapshot.dueDate}.\n\nSi ya realizaste el pago o no reconoces este saldo, responde a este correo para revisar el comprobante antes de continuar la gestión.\n\nGracias.`
    : transport.templateBody.replace(/{{([1-4])}}/g, (_, n) => parameters[Number(n) - 1]) + (transport.footer ? `\n${transport.footer}` : "");
  return { parameters, subject, body };
}

export async function previewCollectionDelivery(db, ctx, dependencies = {}) {
  access(ctx, FINANCE_ACTIONS.PREPARE);
  const { tenantId, input = {}, now = new Date() } = ctx;
  const recipient = collectionRecipient(input.channel, input.recipient);
  if (input.consentConfirmed !== true || typeof input.consentNote !== "string" || input.consentNote.trim().length < 10 || input.consentNote.length > 1000) fail(422, "Confirma que el destinatario corresponde al cliente y registra el respaldo de autorización de contacto (10–1.000 caracteres).");
  // Check tenant/case before any provider access.
  await evidence(db, tenantId, input.caseId, now);
  const transport = await (dependencies.prepare || prepareCollectionTransport)(db, { tenantId, channel: input.channel, templateName: input.templateName, language: input.language });
  return withFinanceWrite(db, async (tx) => {
    const current = await evidence(tx, tenantId, input.caseId, now);
    const content = render(transport, current.snapshot);
    const previewHash = hash([current.snapshotHash, transport.configId, transport.sender, input.channel, recipient, content]);
    const row = await tx.industryRecord.create({ data: { tenantId, recordType: TYPE, title: `Envío de cobranza ${current.snapshot.number}`.slice(0, 220), status: "DRAFT", data: {
      ...content, caseId: input.caseId, invoiceId: current.invoice.id, channel: input.channel, recipient, sender: transport.sender, configId: transport.configId,
      templateName: transport.templateName || null, language: transport.language || null,
      balance: current.snapshot.balance, currency: "CLP", snapshotHash: current.snapshotHash, previewHash,
      consentConfirmed: true, consentNote: input.consentNote.trim(), preparedById: ctx.userId, createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + 15 * 60000).toISOString(), detail: "Vista previa. Aún no se ha enviado." } } });
    await audit(tx, ctx, row, "FINANCE_COLLECTION_DELIVERY_PREPARED");
    return publicRow(row);
  });
}

export async function sendCollectionDelivery(db, ctx, dependencies = {}) {
  access(ctx, FINANCE_ACTIONS.SEND_COLLECTION);
  const { tenantId, input = {}, now = new Date() } = ctx;
  if (input.approved !== true) fail(422, "Debes aprobar expresamente el destinatario y contenido antes de enviar.");
  const old = await record(db, tenantId, ctx.id, TYPE);
  if (input.previewHash !== old.data.previewHash) fail(409, "La vista previa no coincide. Revisa el mensaje de nuevo.");
  if (old.status !== "DRAFT") return publicRow(old); // Replay only; never another send.
  if (Date.parse(old.data.expiresAt) <= now.getTime()) fail(409, "La vista previa venció. Prepara una nueva para comprobar el saldo.");
  const transport = await (dependencies.prepare || prepareCollectionTransport)(db, { tenantId, channel: old.data.channel, templateName: old.data.templateName, language: old.data.language });
  const claimed = await withFinanceWrite(db, async (tx) => {
    const row = await record(tx, tenantId, ctx.id, TYPE);
    if (row.status !== "DRAFT") return { row, claimed: false };
    const current = await evidence(tx, tenantId, row.data.caseId, now);
    const content = render(transport, current.snapshot);
    if (row.data.previewHash !== hash([current.snapshotHash, transport.configId, transport.sender, row.data.channel, row.data.recipient, content])) fail(409, "Cambió el saldo, caso, remitente o plantilla. Prepara y aprueba una nueva vista previa.");
    const active = await tx.tenantChannelConfig.findFirst({ where: { id: transport.configId, tenantId, isActive: true, ...(transport.configUpdatedAt ? { updatedAt: transport.configUpdatedAt } : {}) } });
    if (!active) fail(409, "La conexión se desactivó. No se envió el mensaje.");
    await assertFinancePeriodOpen(tx, tenantId, financeActivityDate(now).slice(0, 7));
    const previous = await findAllFinanceRecords(tx, { where: { tenantId, recordType: TYPE, data: { path: ["invoiceId"], equals: row.data.invoiceId } } });
    if (previous.some((r) => r.id !== row.id && (["SENDING", "UNKNOWN"].includes(r.status) || (r.status === "ACCEPTED" && now.getTime() - Date.parse(r.data.approvedAt) < 86400000)))) fail(409, "Ya existe un envío pendiente de verificar o aceptado en las últimas 24 horas para este documento. No se enviará otro.");
    const nextData = { ...row.data, approvedById: ctx.userId, approvedAt: now.toISOString(), detail: "Envío iniciado. No lo repitas; consulta su resultado." };
    const claim = await tx.industryRecord.updateMany({ where: { id: row.id, tenantId, status: "DRAFT" }, data: { status: "SENDING", data: nextData } });
    if (claim.count !== 1) fail(409, "Otra solicitud ya está enviando este mensaje.");
    const next = { ...row, status: "SENDING", data: nextData };
    await audit(tx, ctx, next, "FINANCE_COLLECTION_DELIVERY_APPROVED");
    return { row: next, claimed: true };
  });
  if (!claimed.claimed) return publicRow(claimed.row);
  // Outside retriable transaction: financial serialization must never replay a network send.
  let result;
  try { result = await (dependencies.dispatch || dispatchCollectionMessage)(transport, { id: claimed.row.id, ...claimed.row.data }); }
  catch { result = { status: "UNKNOWN", detail: "Resultado por verificar en el proveedor. No reenvíes el mensaje." }; }
  const row = await withFinanceWrite(db, async (tx) => {
    const saved = await record(tx, tenantId, ctx.id, TYPE);
    if (saved.status !== "SENDING") return saved;
    const next = await tx.industryRecord.update({ where: { id: saved.id }, data: { status: result.status, data: { ...saved.data, ...result, finishedAt: new Date().toISOString() } } });
    const item = await record(tx, tenantId, saved.data.caseId, "finance_collection_case");
    const d = dataOf(item);
    await tx.industryRecord.update({ where: { id: item.id }, data: { data: { ...d, reminderStatus: result.detail, lastDeliveryId: saved.id, workflowVersion: Number(d.workflowVersion || 0) + 1, history: [...(Array.isArray(d.history) ? d.history : []), { at: next.data.finishedAt, type: `DELIVERY_${result.status}`, detail: result.detail, deliveryId: saved.id, userId: ctx.userId }] } } });
    await audit(tx, ctx, next, `FINANCE_COLLECTION_DELIVERY_${result.status}`);
    return next;
  });
  return publicRow(row);
}

export async function listCollectionDeliveries(db, ctx) {
  access(ctx, FINANCE_ACTIONS.VIEW);
  if (ctx.caseId) await record(db, ctx.tenantId, ctx.caseId, "finance_collection_case");
  const rows = await findAllFinanceRecords(db, { where: { tenantId: ctx.tenantId, recordType: TYPE, ...(ctx.caseId ? { data: { path: ["caseId"], equals: ctx.caseId } } : {}) }, orderBy: { createdAt: "desc" } });
  return { deliveries: rows.map(publicRow) };
}
