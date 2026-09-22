import { FinanceOperationError, withFinanceWrite, findAllFinanceRecords } from "./finance-integrity.service.js";
import { assertFinancePeriodOpen } from "./finance-period-control.service.js";
import { financeDocumentState, financeDocumentSide, financeDocumentDate } from "./finance-document-values.service.js";
import { auditCustomerCredit, creditData as data, creditRut, creditDay, invoiceCreditRut, positiveCreditAmount, validCreditRut } from "./finance-customer-credit-ledger.service.js";

const fail = (status, message) => { throw new FinanceOperationError(status, message); };
const types = ["finance_customer_credit", "finance_credit_application", "finance_invoice", "finance_invoice_receipt", "bank_movement", "finance_reconciliation"];
const load = (db, tenantId) => findAllFinanceRecords(db, { where: { tenantId, recordType: { in: types } } });
const history = (r) => Array.isArray(data(r).history) ? data(r).history : [];
function session(tenantId, userId) { if (!tenantId || !userId) fail(401, "Se requiere empresa y usuario autenticados."); }
function reasonOf(value) { const v = String(value || "").trim(); if (v.length < 10 || v.length > 1000) fail(422, "Indica motivo y respaldo entre 10 y 1.000 caracteres."); return v; }
function today() { const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date()).map((v) => [v.type, v.value])); return `${p.year}-${p.month}-${p.day}`; }
function dateOf(value) { const v = creditDay(value); if (!v || v > today()) fail(422, "Indica una fecha operativa válida, no futura."); return v; }
function get(records, id, type) { const r = records.find((v) => v.id === id && v.recordType === type); if (!r) fail(404, "Registro no encontrado en esta empresa."); return r; }
function checkedCredit(credit, records) { const audit = auditCustomerCredit(credit, records); if (!audit.valid) fail(409, audit.errors.join(" ")); return audit; }
async function audit(tx, tenantId, userId, action, record, reason) { await tx.tenantAuditLog.create({ data: { tenantId, actorUserId: userId, action, entity: record.recordType, entityId: record.id, metadata: { reason, creditId: data(record).creditId || record.id } } }); }
const isDemo = (d) => d.demoOnly === true || d.isDemo === true || d.isSimulated === true || d.trainingRun || ["demo", "seed", "simulation"].includes(String(d.source || "").toLowerCase());

export async function registerCustomerCredit(db, { tenantId, userId, movementId, customerRut, customerName, kind, reason }) {
  session(tenantId, userId); reason = reasonOf(reason); customerRut = creditRut(customerRut); customerName = String(customerName || "").trim();
  if (!validCreditRut(customerRut) || !customerName || customerName.length > 200) fail(422, "Identifica al cliente con nombre y RUT válido; no se asigna por similitud de nombre.");
  if (!["ADVANCE", "OVERPAYMENT", "REMAINDER"].includes(kind)) fail(422, "Selecciona anticipo, sobrepago o remanente.");
  return withFinanceWrite(db, async (tx) => {
    const records = await load(tx, tenantId), movement = get(records, movementId, "bank_movement"), m = data(movement);
    if (records.some((r) => data(r).movementId === movementId && ((r.recordType === "finance_reconciliation" && r.status === "APPROVED") || (r.recordType === "finance_invoice_receipt" && r.status !== "REVERSED")))) fail(409, "El abono ya respalda una conciliación o comprobante. Revisa sus vínculos antes de reservarlo.");
    if (["MATCHED", "RECONCILED", "REVIEW", "REJECTED", "DELETED", "EXCLUDED"].includes(movement.status) || m.reconciliationId || m.excluded || records.some((r) => r.recordType === "finance_customer_credit" && r.status !== "REVERSED" && data(r).movementId === movementId)) fail(409, "El abono ya está utilizado o requiere revisión. No se duplicó el saldo.");
    if (!positiveCreditAmount(m.amount) || String(m.currency || "").toUpperCase() !== "CLP" || !["CREDIT", "ABONO"].includes(String(m.direction || m.movementType || "").toUpperCase()) || ["INTERNAL_TRANSFER", "COMMISSION_OR_FEE"].includes(m.movementKind) || isDemo(m)) fail(422, "Sólo se admite un abono externo operativo identificado en CLP; no cargos, traspasos ni simulaciones.");
    if (m.rut && creditRut(m.rut) !== customerRut) fail(422, "El RUT del abono no coincide con el cliente. Revisa el origen antes de asignarlo.");
    const transactionDate = dateOf(m.transactionDate || m.date); await assertFinancePeriodOpen(tx, tenantId, transactionDate.slice(0, 7));
    const at = new Date().toISOString();
    const credit = await tx.industryRecord.create({ data: { tenantId, recordType: "finance_customer_credit", title: `Saldo a favor · ${customerName}`.slice(0, 220), status: "AVAILABLE", data: { movementId, customerRut, customerName, kind, amount: m.amount, availableAmount: m.amount, currency: "CLP", transactionDate, reason, version: 1, registeredAt: at, registeredById: userId } } });
    const reconciliation = await tx.industryRecord.create({ data: { tenantId, recordType: "finance_reconciliation", title: `Abono destinado a saldo a favor · ${customerName}`.slice(0, 220), status: "APPROVED", data: { movementId, customerCreditId: credit.id, reconciliationType: "CUSTOMER_CREDIT", amount: m.amount, currency: "CLP", transactionDate, allocations: [], invoiceIds: [], reason, approvedAt: at, approvedById: userId } } });
    const updated = await tx.industryRecord.update({ where: { id: credit.id }, data: { data: { ...data(credit), reconciliationId: reconciliation.id } } });
    await tx.industryRecord.update({ where: { id: movementId }, data: { status: "MATCHED", data: { ...m, status: "MATCHED", reconciliationId: reconciliation.id, reconciledAt: at, reconciledById: userId } } });
    await audit(tx, tenantId, userId, "FINANCE_CUSTOMER_CREDIT_REGISTERED", updated, reason);
    return { credit: updated };
  });
}

export async function applyCustomerCredit(db, { tenantId, userId, creditId, expectedVersion, allocations, applicationDate, reason }) {
  session(tenantId, userId); reason = reasonOf(reason); applicationDate = dateOf(applicationDate);
  if (!Array.isArray(allocations) || !allocations.length || allocations.length > 100 || allocations.some((a) => typeof a?.invoiceId !== "string" || !positiveCreditAmount(a.amount)) || new Set(allocations.map((a) => a.invoiceId)).size !== allocations.length) fail(422, "Selecciona entre 1 y 100 facturas distintas con montos positivos en pesos enteros.");
  return withFinanceWrite(db, async (tx) => {
    const records = await load(tx, tenantId), credit = get(records, creditId, "finance_customer_credit"), d = data(credit), ledger = checkedCredit(credit, records);
    if (expectedVersion !== d.version) fail(409, "El saldo cambió. Actualiza antes de volver a aplicar.");
    if (applicationDate < d.transactionDate) fail(422, "La aplicación no puede ser anterior al abono original.");
    await assertFinancePeriodOpen(tx, tenantId, applicationDate.slice(0, 7));
    const total = allocations.reduce((s, a) => s + a.amount, 0);
    if (!positiveCreditAmount(total) || total > ledger.available) fail(409, "La asignación supera el saldo a favor disponible.");
    const plan = allocations.map((a) => {
      const invoice = get(records, a.invoiceId, "finance_invoice"), inv = data(invoice), financial = financeDocumentState(invoice);
      if (invoiceCreditRut(invoice) !== creditRut(d.customerRut) || financeDocumentSide(invoice) !== "CUSTOMER") fail(422, "Sólo se puede aplicar a facturas del mismo cliente, identificado por RUT.");
      if (!financial.included || !Number.isSafeInteger(financial.balance) || !Number.isSafeInteger(financial.paidAmount + a.amount) || a.amount > financial.balance || String(inv.currency || "").toUpperCase() !== "CLP" || !financeDocumentDate(invoice) || financeDocumentDate(invoice) > applicationDate || isDemo(inv)) fail(409, "La factura no está vigente, su fecha es posterior, su moneda no coincide o el monto supera su saldo.");
      return { ...a, invoice, financial };
    });
    const at = new Date().toISOString();
    const application = await tx.industryRecord.create({ data: { tenantId, recordType: "finance_credit_application", title: `Aplicación de saldo · ${d.customerName}`, status: "APPLIED", data: { creditId, amount: total, currency: "CLP", applicationDate, allocations: plan.map((p) => ({ invoiceId: p.invoiceId, amount: p.amount, documentTitle: p.invoice.title })), reason, appliedAt: at, appliedById: userId } } });
    for (const p of plan) {
      const balance = p.financial.balance - p.amount, paidAmount = p.financial.paidAmount + p.amount, status = balance === 0 ? "PAID" : "PARTIAL";
      await tx.industryRecord.create({ data: { tenantId, recordType: "finance_invoice_receipt", title: `Aplicación saldo a favor · ${p.invoice.title}`.slice(0, 220), status: "RECONCILED", data: { invoiceId: p.invoiceId, creditId, creditApplicationId: application.id, sourceMovementId: d.movementId, source: "customer_credit", amount: p.amount, currency: "CLP", paymentDate: applicationDate, registeredById: userId, reason } } });
      await tx.industryRecord.update({ where: { id: p.invoiceId }, data: { status, data: { ...data(p.invoice), balance, paidAmount, status, paidAt: balance === 0 ? at : null, history: [...history(p.invoice), { type: "CUSTOMER_CREDIT_APPLIED", at, applicationId: application.id, creditId, amount: p.amount, reason, userId }] } } });
    }
    const availableAmount = ledger.available - total;
    await tx.industryRecord.update({ where: { id: creditId }, data: { status: availableAmount === 0 ? "USED" : "AVAILABLE", data: { ...d, availableAmount, version: d.version + 1 } } });
    await audit(tx, tenantId, userId, "FINANCE_CUSTOMER_CREDIT_APPLIED", application, reason);
    return { application, availableAmount };
  });
}

export async function reverseCustomerCreditApplication(db, { tenantId, userId, applicationId, reason }) {
  session(tenantId, userId); reason = reasonOf(reason);
  return withFinanceWrite(db, async (tx) => {
    const records = await load(tx, tenantId), application = get(records, applicationId, "finance_credit_application"), a = data(application);
    if (application.status === "REVERSED") return { alreadyReversed: true };
    const credit = get(records, a.creditId, "finance_customer_credit"), d = data(credit); checkedCredit(credit, records);
    await assertFinancePeriodOpen(tx, tenantId, dateOf(a.applicationDate).slice(0, 7));
    const at = new Date().toISOString();
    for (const item of a.allocations) {
      const invoice = get(records, item.invoiceId, "finance_invoice"), s = financeDocumentState(invoice);
      if (!s.included || s.paidAmount < item.amount || s.balance + item.amount > s.amount) fail(409, "Hay ajustes posteriores incompatibles; no se revirtió parcialmente.");
      const paidAmount = s.paidAmount - item.amount, balance = s.balance + item.amount, status = paidAmount > 0 ? "PARTIAL" : "OPEN";
      await tx.industryRecord.update({ where: { id: invoice.id }, data: { status, data: { ...data(invoice), paidAmount, balance, status, paidAt: null, history: [...history(invoice), { type: "CUSTOMER_CREDIT_REVERSED", at, applicationId, amount: item.amount, reason, userId }] } } });
    }
    for (const receipt of records.filter((r) => r.recordType === "finance_invoice_receipt" && data(r).creditApplicationId === applicationId)) await tx.industryRecord.update({ where: { id: receipt.id }, data: { status: "REVERSED", data: { ...data(receipt), reversedAt: at, reversedById: userId, reversalReason: reason } } });
    await tx.industryRecord.update({ where: { id: a.creditId }, data: { status: "AVAILABLE", data: { ...d, availableAmount: d.availableAmount + a.amount, version: d.version + 1 } } });
    await tx.industryRecord.update({ where: { id: applicationId }, data: { status: "REVERSED", data: { ...a, reversedAt: at, reversedById: userId, reversalReason: reason } } });
    await audit(tx, tenantId, userId, "FINANCE_CUSTOMER_CREDIT_APPLICATION_REVERSED", application, reason);
    return { alreadyReversed: false };
  });
}

export async function reverseCustomerCredit(db, { tenantId, userId, creditId, reason }) {
  session(tenantId, userId); reason = reasonOf(reason);
  return withFinanceWrite(db, async (tx) => {
    const records = await load(tx, tenantId), credit = get(records, creditId, "finance_customer_credit"), d = data(credit);
    if (credit.status === "REVERSED") return { alreadyReversed: true };
    const ledger = checkedCredit(credit, records);
    if (ledger.applications.some((a) => a.status === "APPLIED")) fail(409, "Revierte primero las aplicaciones vigentes. El abono ya fue utilizado en facturas.");
    await assertFinancePeriodOpen(tx, tenantId, d.transactionDate.slice(0, 7));
    const movement = get(records, d.movementId, "bank_movement"), reconciliation = get(records, d.reconciliationId, "finance_reconciliation"), at = new Date().toISOString();
    const reversal = { reversedAt: at, reversedById: userId, reversalReason: reason };
    await tx.industryRecord.update({ where: { id: creditId }, data: { status: "REVERSED", data: { ...d, availableAmount: 0, version: d.version + 1, ...reversal } } });
    await tx.industryRecord.update({ where: { id: reconciliation.id }, data: { status: "REVERSED", data: { ...data(reconciliation), ...reversal } } });
    await tx.industryRecord.update({ where: { id: movement.id }, data: { status: "PENDING", data: { ...data(movement), status: "PENDING", reconciliationId: null, reconciledAt: null, reconciledById: null, history: [...history(movement), { type: "CUSTOMER_CREDIT_ORIGIN_REVERSED", at, creditId, reason, userId }] } } });
    await audit(tx, tenantId, userId, "FINANCE_CUSTOMER_CREDIT_REVERSED", credit, reason);
    return { alreadyReversed: false };
  });
}

export async function listCustomerCredits(db, { tenantId, page = 1, query = "" }) {
  if (!tenantId) fail(401, "Falta la empresa autenticada.");
  page = Number(page); if (!Number.isSafeInteger(page) || page < 1) fail(400, "Página inválida.");
  const records = await load(db, tenantId), q = String(query).trim().toLowerCase();
  const credits = records.filter((r) => r.recordType === "finance_customer_credit" && (!q || `${data(r).customerName} ${data(r).customerRut} ${r.title}`.toLowerCase().includes(q) || creditRut(data(r).customerRut).includes(creditRut(q))));
  credits.sort((a, b) => String(data(b).registeredAt).localeCompare(String(data(a).registeredAt)) || a.id.localeCompare(b.id));
  const entries = credits.map((r) => { const ledger = r.status === "REVERSED" ? { valid: true, errors: [], available: 0, applied: 0, applications: records.filter((a) => a.recordType === "finance_credit_application" && data(a).creditId === r.id) } : checkedRead(r, records); return { ...r, ledger }; });
  return { page, pages: Math.max(1, Math.ceil(entries.length / 25)), total: entries.length, availableAmount: entries.reduce((sum, r) => sum + (r.ledger.valid ? r.ledger.available : 0), 0), reviewCount: entries.filter((r) => !r.ledger.valid).length, records: entries.slice((page - 1) * 25, page * 25) };
}
const checkedRead = (credit, records) => auditCustomerCredit(credit, records);
