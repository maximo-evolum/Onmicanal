import { Router } from "express";
import multer from "multer";
import { randomUUID } from "node:crypto";
import { prisma } from "../lib/db.js";
import { MODULES } from "../lib/modules.js";
import { requireRole, ROLE_GROUPS } from "../middleware/tenant-access.js";
import { ensureTenantModuleEligibility } from "../services/tenant-modules.service.js";
import {
  financeRecordData,
  getFinanceOverview,
  getFinanceReconciliationSuggestions,
  getInvoiceFinancialState,
  scoreFinanceReconciliation
} from "../services/finance.service.js";
import { getFinanceAgentWorkspace, prepareFinanceAgentExceptions, updateFinanceAgentPolicy } from "../services/finance-agents.service.js";
import { recordAuditLog } from "../lib/audit.js";
import {
  downloadNuboxSaleFile,
  financeSyncHistory,
  getNuboxSale,
  getNuboxSaleDetails,
  getNuboxSaleReferences,
  issueNuboxSales,
  syncNuboxForTenant
} from "../services/finance-sync.service.js";
import { MAX_MIGRATION_FILE_BYTES, MAX_MIGRATION_ROWS, normalizeHistoricalFinanceRows, readHistoricalFinanceFile, summarizeHistoricalFinanceRows } from "../services/finance-migration.service.js";

export const financeRouter = Router();
const historicalMigrationUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_MIGRATION_FILE_BYTES, files: 1 }
});

async function requireFinanceModule(req, res, module) {
  if (req.user?.role === "SUPER_ADMIN") return true;
  const enabled = await ensureTenantModuleEligibility({ tenantId: req.tenantId, module, tenant: req.tenant });
  if (!enabled) {
    res.status(403).json({ error: "Este modulo de Finance OS no esta habilitado para la cuenta." });
    return false;
  }
  return true;
}

function cleanText(value, fallback = "") {
  const normalized = String(value || "").trim();
  return normalized || fallback;
}

function financeHistory(data) {
  return Array.isArray(data?.history) ? data.history.slice(-99) : [];
}

function financeCaseUpdate(input = {}) {
  const status = cleanText(input.status).toUpperCase();
  const allowedStatuses = new Set(["PENDING", "CONTACTED", "PROMISE", "PAID", "ESCALATED", "CLOSED"]);
  return {
    ...(allowedStatuses.has(status) ? { status } : {}),
    ...(cleanText(input.channel) ? { channel: cleanText(input.channel).toLowerCase() } : {}),
    ...(cleanText(input.nextActionAt) ? { nextActionAt: cleanText(input.nextActionAt) } : {}),
    ...(cleanText(input.promiseDueDate) ? { promiseDueDate: cleanText(input.promiseDueDate) } : {}),
    ...(input.promiseAmount !== undefined && input.promiseAmount !== null && input.promiseAmount !== "" ? { promiseAmount: Number(input.promiseAmount) || 0 } : {})
  };
}

function safeAmount(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

function payableState(record, now = new Date()) {
  const data = financeRecordData(record);
  const amount = safeAmount(data.amount ?? data.total);
  const balance = data.balance === undefined || data.balance === null || data.balance === ""
    ? amount
    : Math.min(amount, safeAmount(data.balance));
  const status = String(record.status || data.status || "OPEN").toUpperCase();
  const dueDate = data.dueDate ? new Date(String(data.dueDate)) : null;
  const overdue = status !== "PAID" && dueDate && !Number.isNaN(dueDate.getTime()) && dueDate < now;
  return { amount, balance, status: balance === 0 ? "PAID" : overdue ? "OVERDUE" : status, dueDate };
}

function normalizedDocumentSide(value) {
  const candidate = cleanText(value).toUpperCase();
  if (["SUPPLIER", "PROVIDER", "PAYABLE", "PURCHASE", "COMPRA", "PROVEEDOR", "EGRESO"].includes(candidate)) return "SUPPLIER";
  if (["CUSTOMER", "CLIENT", "RECEIVABLE", "SALE", "VENTA", "CLIENTE", "INGRESO"].includes(candidate)) return "CUSTOMER";
  return null;
}

// Compatibilidad con importaciones anteriores a finance_payable. La fuente y
// los campos de contraparte definen el lado económico; no el nombre mostrado.
function financeDocumentSide(record) {
  if (record.recordType === "finance_payable") return "SUPPLIER";
  const data = financeRecordData(record);
  const hasSupplier = Boolean(cleanText(data.supplierName || data.supplier || data.providerName));
  const hasCustomer = Boolean(cleanText(data.customerName || data.customer || data.clientName));
  // Las importaciones antiguas pueden contener documentSide heredado como
  // CUSTOMER aunque el registro solo traiga una contraparte proveedora. Los
  // campos de contraparte son la fuente más específica cuando no hay ambigüedad.
  if (hasSupplier && !hasCustomer) return "SUPPLIER";
  if (hasCustomer && !hasSupplier) return "CUSTOMER";
  const explicit = normalizedDocumentSide(data.documentSide || data.side || data.direction || data.kind || data.documentFlow || data.counterpartyType);
  if (explicit) return explicit;
  return "CUSTOMER";
}

function financeParty(record) {
  const data = financeRecordData(record);
  const isPayable = financeDocumentSide(record) === "SUPPLIER";
  return {
    side: isPayable ? "SUPPLIER" : "CUSTOMER",
    name: cleanText(isPayable ? (data.supplierName || data.supplier || data.providerName) : (data.customerName || data.customer || data.clientName), isPayable ? "Proveedor sin nombre" : "Cliente sin nombre"),
    rut: cleanText(isPayable ? (data.supplierRut || data.rut) : (data.clientRut || data.rut)) || null
  };
}

function financePartyKey({ name, rut }) {
  return cleanText(rut).replace(/[^0-9kK]/g, "") || cleanText(name).toLocaleLowerCase("es");
}

function invoiceState(record, now = new Date()) {
  return getInvoiceFinancialState(record, now);
}

function isoDate(value) {
  const date = value ? new Date(String(value)) : null;
  return date && !Number.isNaN(date.getTime()) ? date : null;
}

async function nuboxDocumentForTenant(tenantId, recordId) {
  const record = await prisma.industryRecord.findFirst({
    where: { id: recordId, tenantId, recordType: "finance_invoice" },
    select: { id: true, data: true, title: true }
  });
  const data = financeRecordData(record || {});
  const nuboxDocumentId = cleanText(data.nuboxDocumentId);
  if (!record || cleanText(data.source).toLowerCase() !== "nubox" || !nuboxDocumentId) {
    const error = new Error("Este documento no proviene de Nubox o no tiene un identificador remoto disponible.");
    error.statusCode = 404;
    throw error;
  }
  return { record, nuboxDocumentId };
}

function nuboxRouteError(res, error, fallback) {
  const status = Number(error?.statusCode) || (/identificador|formato solicitado|entre 1 y 20|idempotencia/i.test(String(error?.message || "")) ? 400 : 502);
  return res.status(status).json({ error: error instanceof Error ? error.message : fallback });
}

financeRouter.get("/finance/overview", async (req, res) => {
  try {
    if (!(await requireFinanceModule(req, res, MODULES.FINANCE_ANALYTICS))) return;
    res.json(await getFinanceOverview({ tenantId: req.tenantId }));
  } catch (error) {
    console.error("Finance overview error:", error);
    res.status(500).json({ error: "No se pudo cargar el dashboard financiero" });
  }
});

financeRouter.get("/finance/customers", async (req, res) => {
  try {
    if (!(await requireFinanceModule(req, res, MODULES.FINANCE_INVOICES))) return;
    const invoices = await prisma.industryRecord.findMany({ where: { tenantId: req.tenantId, recordType: "finance_invoice" }, orderBy: { updatedAt: "desc" }, take: 1000 });
    const customers = new Map();
    for (const invoice of invoices) {
      if (financeDocumentSide(invoice) !== "CUSTOMER") continue;
      const data = financeRecordData(invoice);
      const name = cleanText(data.customerName || data.customer || data.clientName, "Cliente sin nombre");
      const key = `${cleanText(data.rut || data.clientRut).replace(/[^0-9kK]/g, "") || name.toLocaleLowerCase("es")}`;
      const state = getInvoiceFinancialState(invoice);
      const item = customers.get(key) || { key, name, rut: cleanText(data.rut || data.clientRut) || null, invoices: 0, openInvoices: 0, totalAmount: 0, outstandingAmount: 0, overdueAmount: 0, lastActivityAt: invoice.updatedAt };
      item.invoices += 1;
      item.totalAmount += state.amount;
      item.outstandingAmount += state.balance;
      if (state.status !== "PAID") item.openInvoices += 1;
      if (state.status === "OVERDUE") item.overdueAmount += state.balance;
      if (new Date(invoice.updatedAt) > new Date(item.lastActivityAt)) item.lastActivityAt = invoice.updatedAt;
      customers.set(key, item);
    }
    res.json({ customers: [...customers.values()].sort((left, right) => right.outstandingAmount - left.outstandingAmount) });
  } catch (error) {
    console.error("Finance customers error:", error);
    res.status(500).json({ error: "No se pudo construir la cartera de clientes" });
  }
});

// Portal documental: reúne las facturas de venta y los documentos de compra
// sin confundirlos. Cada fila conserva su flujo propio (cobro o pago).
financeRouter.get("/finance/documents", async (req, res) => {
  try {
    if (!(await requireFinanceModule(req, res, MODULES.FINANCE_INVOICES))) return;
    const requestedType = cleanText(req.query?.type, "all").toLowerCase();
    if (!["all", "customers", "suppliers"].includes(requestedType)) {
      return res.status(400).json({ error: "El filtro de documentos no es válido." });
    }
    // Las migraciones históricas antiguas pudieron guardar una compra como
    // finance_invoice. Se consulta también ese tipo y luego se filtra por el
    // lado financiero real del documento.
    const includeInvoices = true;
    let includePayables = requestedType !== "customers";
    // Los documentos de proveedores pertenecen al módulo de Cuentas por pagar.
    // Un acceso a Facturas por cobrar no concede, por sí solo, visibilidad de esa cartera.
    if (includePayables && req.user?.role !== "SUPER_ADMIN") {
      includePayables = await ensureTenantModuleEligibility({ tenantId: req.tenantId, module: MODULES.FINANCE_PAYABLES, tenant: req.tenant });
    }
    if (requestedType === "suppliers" && !includePayables) {
      return res.status(403).json({ error: "Cuentas por pagar no está habilitado para esta cuenta." });
    }
    const recordTypes = [
      ...(includeInvoices ? ["finance_invoice"] : []),
      ...(includePayables ? ["finance_payable"] : [])
    ];
    const now = new Date();
    const records = await prisma.industryRecord.findMany({
      where: { tenantId: req.tenantId, recordType: { in: recordTypes } },
      orderBy: { updatedAt: "desc" },
      take: 1000
    });
    const documents = records.map((record) => {
      const data = financeRecordData(record);
      const party = financeParty(record);
      const state = party.side === "SUPPLIER" ? payableState(record, now) : invoiceState(record, now);
      return {
        id: record.id,
        recordType: record.recordType,
        side: party.side,
        documentNumber: cleanText(data.documentNumber || data.invoiceNumber || data.number, "Sin folio"),
        partyName: party.name,
        partyRut: party.rut,
        status: state.status,
        issueDate: data.issueDate || record.createdAt,
        dueDate: data.dueDate || null,
        amount: state.amount,
        balance: state.balance,
        paidAmount: Math.max(0, state.amount - state.balance),
        nuboxDocument: cleanText(data.source).toLowerCase() === "nubox" && Boolean(cleanText(data.nuboxDocumentId)),
        createdAt: record.createdAt,
        updatedAt: record.updatedAt
      };
    }).filter((document) => requestedType === "all" || (requestedType === "customers" ? document.side === "CUSTOMER" : document.side === "SUPPLIER"));
    res.json({ documents });
  } catch (error) {
    console.error("Finance documents error:", error);
    res.status(500).json({ error: "No se pudo cargar el portal de documentos financieros." });
  }
});

// Recursos complementarios de una venta Nubox. Se recibe el id interno de
// EVOLUM, no un id remoto arbitrario, para asegurar el aislamiento por tenant.
financeRouter.get("/finance/documents/:id/nubox", async (req, res) => {
  try {
    if (!(await requireFinanceModule(req, res, MODULES.FINANCE_INVOICES))) return;
    const { nuboxDocumentId } = await nuboxDocumentForTenant(req.tenantId, req.params.id);
    res.json({ sale: await getNuboxSale({ tenantId: req.tenantId, documentId: nuboxDocumentId }) });
  } catch (error) {
    console.error("Finance Nubox document error:", error);
    return nuboxRouteError(res, error, "No se pudo obtener el documento desde Nubox.");
  }
});

financeRouter.get("/finance/documents/:id/nubox/details", async (req, res) => {
  try {
    if (!(await requireFinanceModule(req, res, MODULES.FINANCE_INVOICES))) return;
    const { nuboxDocumentId } = await nuboxDocumentForTenant(req.tenantId, req.params.id);
    res.json({ details: await getNuboxSaleDetails({ tenantId: req.tenantId, documentId: nuboxDocumentId }) });
  } catch (error) {
    console.error("Finance Nubox details error:", error);
    return nuboxRouteError(res, error, "No se pudo obtener el detalle del documento desde Nubox.");
  }
});

financeRouter.get("/finance/documents/:id/nubox/references", async (req, res) => {
  try {
    if (!(await requireFinanceModule(req, res, MODULES.FINANCE_INVOICES))) return;
    const { nuboxDocumentId } = await nuboxDocumentForTenant(req.tenantId, req.params.id);
    res.json({ references: await getNuboxSaleReferences({ tenantId: req.tenantId, documentId: nuboxDocumentId }) });
  } catch (error) {
    console.error("Finance Nubox references error:", error);
    return nuboxRouteError(res, error, "No se pudieron obtener las referencias del documento desde Nubox.");
  }
});

financeRouter.get("/finance/documents/:id/nubox/:format", async (req, res) => {
  try {
    if (!(await requireFinanceModule(req, res, MODULES.FINANCE_INVOICES))) return;
    const { nuboxDocumentId } = await nuboxDocumentForTenant(req.tenantId, req.params.id);
    const format = String(req.params.format).toLowerCase();
    const file = await downloadNuboxSaleFile({ tenantId: req.tenantId, documentId: nuboxDocumentId, format });
    res.setHeader("Content-Type", file.contentType || (format === "pdf" ? "application/pdf" : "application/xml"));
    res.setHeader("Content-Disposition", `attachment; filename="nubox-${nuboxDocumentId}.${format}"`);
    res.send(file.payload);
  } catch (error) {
    console.error("Finance Nubox download error:", error);
    return nuboxRouteError(res, error, "No se pudo descargar el archivo desde Nubox.");
  }
});

// Nubox emite documentos hacia su plataforma y eventualmente al SII. Por ese
// motivo esta ruta exige rol administrador, confirmación literal e idempotencia.
financeRouter.post("/finance/nubox/sales/issuance", requireRole(ROLE_GROUPS.MANAGERS), async (req, res) => {
  try {
    if (!(await requireFinanceModule(req, res, MODULES.FINANCE_INVOICES))) return;
    if (cleanText(req.body?.confirmation) !== "EMITIR") {
      return res.status(400).json({ error: "Confirma la emisión escribiendo EMITIR. Esta acción crea documentos en Nubox." });
    }
    const documents = Array.isArray(req.body?.documents) ? req.body.documents : [];
    const issued = await issueNuboxSales({ tenantId: req.tenantId, documents, idempotenceId: randomUUID() });
    await recordAuditLog(req, "NUBOX_SALES_ISSUANCE_REQUESTED", "finance_nubox_sales", req.tenantId, { count: documents.length });
    res.status(202).json({ ok: true, issued, message: "La emisión fue solicitada a Nubox. Revisa el estado del documento antes de comunicarlo al cliente." });
  } catch (error) {
    console.error("Finance Nubox issuance error:", error);
    return nuboxRouteError(res, error, "Nubox no pudo recibir la solicitud de emisión.");
  }
});

// Cartera agrupada por cliente para que Cobranza trabaje desde una sola fila
// por razón social, con las cifras que se ven en la vista operativa.
financeRouter.get("/finance/collections/portfolio", async (req, res) => {
  try {
    if (!(await requireFinanceModule(req, res, MODULES.FINANCE_COLLECTIONS))) return;
    const [invoices, cases] = await Promise.all([
      prisma.industryRecord.findMany({ where: { tenantId: req.tenantId, recordType: "finance_invoice" }, orderBy: { updatedAt: "desc" }, take: 1000 }),
      prisma.industryRecord.findMany({ where: { tenantId: req.tenantId, recordType: "finance_collection_case" }, orderBy: { updatedAt: "desc" }, take: 1000 })
    ]);
    const now = new Date();
    const rows = new Map();
    for (const invoice of invoices) {
      const data = financeRecordData(invoice);
      const party = financeParty(invoice);
      const key = financePartyKey(party);
      const state = invoiceState(invoice, now);
      const row = rows.get(key) || {
        key,
        name: party.name,
        rut: party.rut,
        documents: 0,
        openDocuments: 0,
        overdueDocuments: 0,
        dueSoonAmount: 0,
        overdueAmount: 0,
        totalDebt: 0,
        oldestInvoiceDate: null,
        averagePaymentDays: [],
        reminders: 0,
        lastReminderAt: null,
        latestCaseId: null,
        reminderStatus: "Sin recordatorio preparado"
      };
      row.documents += 1;
      if (state.status !== "PAID") {
        row.openDocuments += 1;
        row.totalDebt += state.balance;
        if (state.status === "OVERDUE") {
          row.overdueDocuments += 1;
          row.overdueAmount += state.balance;
        }
        const dueDate = state.dueDate;
        if (dueDate && dueDate >= now && dueDate.getTime() - now.getTime() <= 30 * 24 * 60 * 60 * 1000) row.dueSoonAmount += state.balance;
      }
      const issuedAt = isoDate(data.issueDate || invoice.createdAt);
      const paidAt = isoDate(data.paidAt);
      if (state.status === "PAID" && issuedAt && paidAt) row.averagePaymentDays.push(Math.max(0, Math.round((paidAt.getTime() - issuedAt.getTime()) / (24 * 60 * 60 * 1000))));
      const candidateDate = state.dueDate || issuedAt;
      if (candidateDate && (!row.oldestInvoiceDate || candidateDate < new Date(row.oldestInvoiceDate))) row.oldestInvoiceDate = candidateDate.toISOString();
      rows.set(key, row);
    }
    for (const collectionCase of cases) {
      const data = financeRecordData(collectionCase);
      const party = { name: cleanText(data.customerName || data.customer || data.clientName, "Cliente sin nombre"), rut: cleanText(data.clientRut || data.rut) || null };
      const key = financePartyKey(party);
      const row = rows.get(key);
      if (!row) continue;
      const history = financeHistory(data);
      const reminders = history.filter((entry) => ["REMINDER_PREPARED", "REMINDER_DRAFT_PREPARED"].includes(String(entry?.type || "").toUpperCase()));
      row.reminders += reminders.length;
      const latestReminder = reminders.at(-1)?.at || data.lastReminderAt || null;
      if (latestReminder && (!row.lastReminderAt || new Date(latestReminder) > new Date(row.lastReminderAt))) row.lastReminderAt = latestReminder;
      if (!row.latestCaseId || new Date(collectionCase.updatedAt) > new Date(rows.get(key).caseUpdatedAt || 0)) {
        row.latestCaseId = collectionCase.id;
        row.caseUpdatedAt = collectionCase.updatedAt;
        row.reminderStatus = data.reminderStatus || (reminders.length ? "Recordatorio preparado" : "Seguimiento pendiente");
      }
    }
    const portfolio = [...rows.values()].map((row) => ({
      ...row,
      averagePaymentDays: row.averagePaymentDays.length ? Math.round(row.averagePaymentDays.reduce((sum, value) => sum + value, 0) / row.averagePaymentDays.length) : null,
      caseUpdatedAt: undefined
    })).sort((left, right) => right.totalDebt - left.totalDebt);
    res.json({ portfolio });
  } catch (error) {
    console.error("Finance collection portfolio error:", error);
    res.status(500).json({ error: "No se pudo cargar la cartera de cobranza." });
  }
});

// Registrar un cobro es una acción humana y trazable. No dispara mensajes ni
// cambios hacia Nubox/ERP: solo actualiza el registro interno de EVOLUM.
financeRouter.post("/finance/invoices/:id/receipts", requireRole(ROLE_GROUPS.MANAGERS), async (req, res) => {
  try {
    if (!(await requireFinanceModule(req, res, MODULES.FINANCE_INVOICES))) return;
    const invoice = await prisma.industryRecord.findFirst({ where: { id: req.params.id, tenantId: req.tenantId, recordType: "finance_invoice" } });
    if (!invoice) return res.status(404).json({ error: "Factura no encontrada." });
    const receiptAmount = safeAmount(req.body?.amount);
    const current = invoiceState(invoice);
    if (!receiptAmount) return res.status(400).json({ error: "Ingresa un monto de cobro válido." });
    if (!current.balance) return res.status(409).json({ error: "Esta factura ya está pagada." });
    if (receiptAmount > current.balance) return res.status(400).json({ error: "El cobro no puede superar el saldo pendiente." });
    const now = new Date();
    const reference = cleanText(req.body?.reference);
    const paymentDate = cleanText(req.body?.paymentDate) || now.toISOString().slice(0, 10);
    const remainingBalance = Math.max(0, current.balance - receiptAmount);
    const result = await prisma.$transaction(async (tx) => {
      const receipt = await tx.industryRecord.create({
        data: {
          tenantId: req.tenantId,
          recordType: "finance_invoice_receipt",
          title: `Cobro ${financeRecordData(invoice).invoiceNumber || invoice.title}`.slice(0, 220),
          status: "REGISTERED",
          data: { invoiceId: invoice.id, amount: receiptAmount, paymentDate, reference, registeredById: req.user?.id || null }
        }
      });
      const data = financeRecordData(invoice);
      const history = financeHistory(data);
      const updatedInvoice = await tx.industryRecord.update({
        where: { id: invoice.id },
        data: {
          status: remainingBalance === 0 ? "PAID" : "PARTIAL",
          data: {
            ...data,
            balance: remainingBalance,
            paidAmount: safeAmount(data.paidAmount) + receiptAmount,
            status: remainingBalance === 0 ? "PAID" : "PARTIAL",
            paidAt: remainingBalance === 0 ? now.toISOString() : data.paidAt || null,
            history: [...history, { at: now.toISOString(), type: "RECEIPT_REGISTERED", amount: receiptAmount, reference, receiptId: receipt.id }]
          }
        }
      });
      return { receipt, invoice: updatedInvoice };
    });
    await recordAuditLog(req, "FINANCE_INVOICE_RECEIPT_REGISTERED", "finance_invoice", invoice.id, { receiptId: result.receipt.id, amount: receiptAmount, paymentDate });
    res.status(201).json({ ...result, remainingBalance });
  } catch (error) {
    console.error("Register finance invoice receipt error:", error);
    res.status(500).json({ error: "No se pudo registrar el cobro de la factura." });
  }
});

// Prepara un borrador interno de recordatorio. El envío siempre queda fuera de
// esta ruta y requiere canal, consentimiento y aprobación posterior.
financeRouter.post("/finance/collections/portfolio/:partyKey/reminders", requireRole(ROLE_GROUPS.STAFF), async (req, res) => {
  try {
    if (!(await requireFinanceModule(req, res, MODULES.FINANCE_COLLECTIONS))) return;
    const partyKey = cleanText(req.params.partyKey);
    if (!partyKey) return res.status(400).json({ error: "Cliente inválido." });
    const invoices = await prisma.industryRecord.findMany({ where: { tenantId: req.tenantId, recordType: "finance_invoice" }, take: 1000 });
    const selected = invoices.filter((invoice) => financePartyKey(financeParty(invoice)) === partyKey && invoiceState(invoice).balance > 0);
    if (!selected.length) return res.status(404).json({ error: "No hay documentos abiertos para este cliente." });
    const cases = await prisma.industryRecord.findMany({ where: { tenantId: req.tenantId, recordType: "finance_collection_case", status: { notIn: ["PAID", "CLOSED"] } }, take: 1000 });
    const existingByInvoice = new Map(cases.map((item) => [String(financeRecordData(item).invoiceId || ""), item]));
    const now = new Date().toISOString();
    const prepared = [];
    for (const invoice of selected) {
      const state = invoiceState(invoice);
      const data = financeRecordData(invoice);
      const party = financeParty(invoice);
      const existing = existingByInvoice.get(invoice.id);
      const event = { at: now, type: "REMINDER_DRAFT_PREPARED", detail: "Borrador preparado. No se envió ningún mensaje.", userId: req.user?.id || null };
      if (existing) {
        const updated = await prisma.industryRecord.update({ where: { id: existing.id }, data: { data: { ...financeRecordData(existing), reminderStatus: "Recordatorio preparado", lastReminderAt: now, history: [...financeHistory(financeRecordData(existing)), event] } } });
        prepared.push(updated);
      } else {
        const created = await prisma.industryRecord.create({ data: { tenantId: req.tenantId, recordType: "finance_collection_case", title: `Cobranza ${data.invoiceNumber || invoice.title}`.slice(0, 220), status: "PENDING", data: { invoiceId: invoice.id, invoiceNumber: data.invoiceNumber || invoice.title, customerName: party.name, clientRut: party.rut, balance: state.balance, channel: "manual", reminderStatus: "Recordatorio preparado", lastReminderAt: now, nextActionAt: now, history: [{ at: now, type: "CASE_CREATED", detail: "Caso preparado para revisión humana." }, event] } } });
        prepared.push(created);
      }
    }
    await recordAuditLog(req, "FINANCE_COLLECTION_REMINDERS_PREPARED", "finance_collection_case", req.tenantId, { partyKey, count: prepared.length });
    res.status(201).json({ prepared, count: prepared.length });
  } catch (error) {
    console.error("Prepare finance collection reminders error:", error);
    res.status(500).json({ error: "No se pudieron preparar los recordatorios." });
  }
});

financeRouter.get("/finance/payables/summary", async (req, res) => {
  try {
    if (!(await requireFinanceModule(req, res, MODULES.FINANCE_PAYABLES))) return;
    const payables = await prisma.industryRecord.findMany({
      where: { tenantId: req.tenantId, recordType: "finance_payable" },
      orderBy: { updatedAt: "desc" },
      take: 1000
    });
    const now = new Date();
    const summary = payables.reduce((total, record) => {
      const state = payableState(record, now);
      total.total += 1;
      total.registeredAmount += state.amount;
      total.pendingAmount += state.balance;
      if (state.status === "PAID") total.paid += 1;
      if (state.status === "OVERDUE") {
        total.overdue += 1;
        total.overdueAmount += state.balance;
      }
      return total;
    }, { total: 0, paid: 0, overdue: 0, registeredAmount: 0, pendingAmount: 0, overdueAmount: 0 });
    res.json({ summary, payables });
  } catch (error) {
    console.error("Finance payables summary error:", error);
    res.status(500).json({ error: "No se pudieron cargar las cuentas por pagar." });
  }
});

financeRouter.post("/finance/payables/:id/payments", requireRole(ROLE_GROUPS.MANAGERS), async (req, res) => {
  try {
    if (!(await requireFinanceModule(req, res, MODULES.FINANCE_PAYABLES))) return;
    const payable = await prisma.industryRecord.findFirst({ where: { id: req.params.id, tenantId: req.tenantId, recordType: "finance_payable" } });
    if (!payable) return res.status(404).json({ error: "Cuenta por pagar no encontrada." });
    const paymentAmount = safeAmount(req.body?.amount);
    if (!paymentAmount) return res.status(400).json({ error: "Ingresa un monto de pago válido." });
    const state = payableState(payable);
    if (!state.balance) return res.status(409).json({ error: "Esta cuenta ya se encuentra pagada." });
    if (paymentAmount > state.balance) return res.status(400).json({ error: "El pago no puede superar el saldo pendiente." });
    const now = new Date();
    const paymentDate = cleanText(req.body?.paymentDate) || now.toISOString().slice(0, 10);
    const reference = cleanText(req.body?.reference);
    const nextBalance = Math.max(0, state.balance - paymentAmount);
    const result = await prisma.$transaction(async (tx) => {
      const payment = await tx.industryRecord.create({
        data: {
          tenantId: req.tenantId,
          recordType: "finance_payable_payment",
          title: `Pago ${payable.title}`.slice(0, 220),
          status: "REGISTERED",
          data: { payableId: payable.id, amount: paymentAmount, paymentDate, reference, registeredById: req.user?.id || null }
        }
      });
      const data = financeRecordData(payable);
      const history = Array.isArray(data.history) ? data.history.slice(-49) : [];
      const updated = await tx.industryRecord.update({
        where: { id: payable.id },
        data: {
          status: nextBalance === 0 ? "PAID" : "PARTIAL",
          data: {
            ...data,
            balance: nextBalance,
            paidAmount: safeAmount(data.paidAmount) + paymentAmount,
            status: nextBalance === 0 ? "PAID" : "PARTIAL",
            paidAt: nextBalance === 0 ? now.toISOString() : data.paidAt || null,
            history: [...history, { at: now.toISOString(), type: "PAYMENT_REGISTERED", amount: paymentAmount, reference, paymentId: payment.id }]
          }
        }
      });
      return { payment, payable: updated };
    });
    await recordAuditLog(req, "FINANCE_PAYABLE_PAYMENT_REGISTERED", "finance_payable", payable.id, { paymentId: result.payment.id, amount: paymentAmount, paymentDate });
    res.status(201).json({ ...result, remainingBalance: nextBalance });
  } catch (error) {
    console.error("Register finance payable payment error:", error);
    res.status(500).json({ error: "No se pudo registrar el pago a proveedor." });
  }
});

financeRouter.post("/finance/migrations/preview", requireRole(ROLE_GROUPS.MANAGERS), async (req, res) => {
  try {
    if (!(await requireFinanceModule(req, res, MODULES.FINANCE_MIGRATION))) return;
    const rows = normalizeHistoricalFinanceRows(req.body?.rows, { limit: MAX_MIGRATION_ROWS });
    if (!rows.length) return res.status(400).json({ error: "No se detectaron filas para revisar." });
    res.json({
      maxRows: MAX_MIGRATION_ROWS,
      summary: summarizeHistoricalFinanceRows(rows),
      rows: rows.slice(0, 100),
      sourceRows: req.body.rows.slice(0, MAX_MIGRATION_ROWS)
    });
  } catch (error) {
    console.error("Preview historical finance migration error:", error);
    res.status(500).json({ error: "No se pudo preparar la vista previa de la migración." });
  }
});

financeRouter.post("/finance/migrations/preview-file", requireRole(ROLE_GROUPS.MANAGERS), historicalMigrationUpload.single("file"), async (req, res) => {
  try {
    if (!(await requireFinanceModule(req, res, MODULES.FINANCE_MIGRATION))) return;
    const sourceRows = await readHistoricalFinanceFile(req.file);
    const rows = normalizeHistoricalFinanceRows(sourceRows, { limit: MAX_MIGRATION_ROWS });
    if (!rows.length) return res.status(400).json({ error: "No se detectaron filas con datos para revisar." });
    res.json({
      maxRows: MAX_MIGRATION_ROWS,
      sourceFile: cleanText(req.file?.originalname, "migracion-historica"),
      summary: summarizeHistoricalFinanceRows(rows),
      rows: rows.slice(0, 100),
      sourceRows: sourceRows.slice(0, MAX_MIGRATION_ROWS)
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo leer el archivo de migración.";
    res.status(400).json({ error: message });
  }
});

financeRouter.post("/finance/migrations/import", requireRole(ROLE_GROUPS.MANAGERS), async (req, res) => {
  try {
    if (!(await requireFinanceModule(req, res, MODULES.FINANCE_MIGRATION))) return;
    const sourceFile = (cleanText(req.body?.sourceFile) || "migracion-historica.csv").slice(0, 180);
    const rows = normalizeHistoricalFinanceRows(req.body?.rows, { limit: MAX_MIGRATION_ROWS });
    if (!rows.length) return res.status(400).json({ error: "No se detectaron filas para importar." });
    const summary = summarizeHistoricalFinanceRows(rows);
    const importedAt = new Date().toISOString();
    const batch = await prisma.$transaction(async (tx) => {
      const batchRecord = await tx.industryRecord.create({
        data: {
          tenantId: req.tenantId,
          recordType: "finance_migration_batch",
          title: `Migración histórica · ${sourceFile}`.slice(0, 220),
          status: "COMPLETED",
          data: { sourceFile, totalRows: rows.length, reviewRows: summary.reviewRows, summary, importedAt, importedById: req.user?.id || null }
        }
      });
      const records = [];
      for (const row of rows) {
        const historicalData = {
          documentSide: row.documentSide,
          direction: row.kind === "PAYABLE" ? "PURCHASE" : "SALE",
          documentNumber: row.documentNumber,
          invoiceNumber: row.kind === "RECEIVABLE" ? row.documentNumber : undefined,
          customerName: row.kind === "RECEIVABLE" ? row.partyName : undefined,
          supplierName: row.kind === "PAYABLE" ? row.partyName : undefined,
          clientRut: row.kind === "RECEIVABLE" ? row.rut : undefined,
          supplierRut: row.kind === "PAYABLE" ? row.rut : undefined,
          category: row.category,
          amount: row.amount,
          balance: row.balance,
          paidAmount: row.paidAmount,
          issueDate: row.issueDate,
          dueDate: row.dueDate,
          status: row.status,
          source: "historical_migration",
          sourceFile,
          migrationBatchId: batchRecord.id,
          migrationRow: row.rowNumber,
          isHistorical: true,
          needsReview: row.needsReview,
          reviewReasons: row.reviewReasons,
          sourceStatus: row.sourceStatus,
          sourceRow: row.source
        };
        records.push(await tx.industryRecord.create({
          data: {
            tenantId: req.tenantId,
            recordType: row.needsReview ? "finance_exception" : row.recordType,
            title: row.needsReview
              ? `Revisar migración fila ${row.rowNumber} · ${row.partyName || "sin contraparte"}`.slice(0, 220)
              : `${row.kind === "PAYABLE" ? "Cuenta por pagar" : "Factura"} ${row.documentNumber} · ${row.partyName}`.slice(0, 220),
            status: row.needsReview ? "OPEN" : row.status,
            data: row.needsReview
              ? { type: "MIGRATION_REVIEW", detail: `Faltan: ${row.reviewReasons.join(", ")}`, priority: "MEDIUM", ...historicalData }
              : historicalData
          }
        }));
      }
      await tx.industryRecord.update({ where: { id: batchRecord.id }, data: { data: { ...financeRecordData(batchRecord), importedRows: records.length, exceptionRows: summary.reviewRows } } });
      return { batch: batchRecord, records };
    });
    await recordAuditLog(req, "FINANCE_HISTORICAL_MIGRATION_IMPORTED", "finance_migration_batch", batch.batch.id, { sourceFile, totalRows: rows.length, summary });
    res.status(201).json({ batch: batch.batch, summary, imported: batch.records.length, requiresReview: summary.reviewRows });
  } catch (error) {
    console.error("Import historical finance migration error:", error);
    res.status(500).json({ error: "No se pudo importar la migración histórica." });
  }
});

financeRouter.get("/finance/plan", async (req, res) => {
  try {
    if (!(await requireFinanceModule(req, res, MODULES.FINANCE_ANALYTICS))) return;
    const [tenant, documentCount] = await Promise.all([
      prisma.tenant.findUnique({ where: { id: req.tenantId }, select: { plan: true, billingLimits: true } }),
      prisma.industryRecord.count({ where: { tenantId: req.tenantId, recordType: { in: ["finance_invoice", "bank_statement", "bank_movement"] } } })
    ]);
    const limits = tenant?.billingLimits && typeof tenant.billingLimits === "object" ? tenant.billingLimits : {};
    const documentLimit = Math.max(0, Number(limits.financeDocuments || limits.documents || 0));
    res.json({ plan: tenant?.plan || "STARTER", usage: { processedDocuments: documentCount, limit: documentLimit || null, percentage: documentLimit ? Math.min(100, Math.round((documentCount / documentLimit) * 100)) : null } });
  } catch (error) {
    console.error("Finance plan error:", error);
    res.status(500).json({ error: "No se pudo obtener el uso del plan financiero" });
  }
});

financeRouter.get("/finance/integrations", async (req, res) => {
  try {
    if (!(await requireFinanceModule(req, res, MODULES.FINANCE_ANALYTICS))) return;
    const channels = await prisma.tenantChannelConfig.findMany({ where: { tenantId: req.tenantId }, select: { channel: true, label: true, metadata: true, isActive: true, updatedAt: true } });
    const byChannel = new Map(channels.map((item) => [String(item.channel).toLowerCase(), item]));
    const status = (keys) => keys.some((key) => byChannel.get(key)?.isActive) ? "connected" : "not_connected";
    const bankConfig = byChannel.get("finance_bank_statements");
    const bankAccounts = Array.isArray(bankConfig?.metadata?.bankAccounts) ? bankConfig.metadata.bankAccounts : [];
    const bankCount = bankConfig?.isActive ? bankAccounts.length : 0;
    // Nunca se devuelven tokens, IDs externos ni secretos técnicos al navegador.
    res.json({ integrations: [
      { key: "bank", label: "Cartolas bancarias", status: "manual_ready", detail: bankCount ? `${bankCount} ${bankCount === 1 ? "banco configurado" : "bancos configurados"}; carga CSV disponible para conciliación.` : "Carga CSV disponible; agrega uno o más bancos desde Centro de Conexiones." },
      { key: "erp", label: "ERP / contabilidad", status: status(["finance_nubox", "finance_defontana", "finance_softland"]), detail: byChannel.get("finance_nubox")?.isActive ? `Nubox conectado. ${String(byChannel.get("finance_nubox")?.metadata?.lastSyncMessage || "Pendiente de primera sincronización.")}` : "Conecta Nubox, Defontana, Softland u otro ERP autorizado." },
      { key: "email", label: "Correo", status: status(["email", "gmail", "smtp"]), detail: "Canal usado para recordatorios aprobados." },
      { key: "whatsapp", label: "WhatsApp Business", status: status(["whatsapp", "whatsapp_business"]), detail: "Canal usado solo con consentimiento y plantilla aprobada." }
    ] });
  } catch (error) {
    console.error("Finance integrations error:", error);
    res.status(500).json({ error: "No se pudo obtener el estado de integraciones" });
  }
});

financeRouter.get("/finance/sync-history", async (req, res) => {
  try {
    if (!(await requireFinanceModule(req, res, MODULES.FINANCE_ANALYTICS))) return;
    res.json(await financeSyncHistory({ tenantId: req.tenantId, limit: req.query?.limit }));
  } catch (error) {
    console.error("Finance sync history error:", error);
    res.status(500).json({ error: "No se pudo cargar el historial de sincronización." });
  }
});

financeRouter.post("/finance/sync/nubox", requireRole(ROLE_GROUPS.MANAGERS), async (req, res) => {
  try {
    if (!(await requireFinanceModule(req, res, MODULES.FINANCE_INVOICES))) return;
    const period = cleanText(req.body?.period) || new Date().toISOString().slice(0, 7);
    const result = await syncNuboxForTenant({ tenantId: req.tenantId, period, limit: req.body?.limit, source: "finance_workspace" });
    if (result?.skipped === "already_running") return res.status(202).json({ ok: false, pending: true, message: "Ya hay una sincronización de Nubox en curso para esta cuenta." });
    res.json(result);
  } catch (error) {
    console.error("Finance Nubox sync error:", error);
    const message = error instanceof Error ? error.message : "No se pudo sincronizar Nubox.";
    const configurationError = /faltan|configurad|per[ií]odo|url https/i.test(message);
    res.status(configurationError ? 400 : 502).json({ error: message });
  }
});

financeRouter.get("/finance/reconciliation-suggestions", async (req, res) => {
  try {
    if (!(await requireFinanceModule(req, res, MODULES.FINANCE_RECONCILIATION))) return;
    const movementId = cleanText(req.query?.movementId) || null;
    res.json({ suggestions: await getFinanceReconciliationSuggestions({ tenantId: req.tenantId, movementId }) });
  } catch (error) {
    console.error("Finance suggestions error:", error);
    res.status(500).json({ error: "No se pudieron calcular sugerencias de conciliacion" });
  }
});

financeRouter.get("/finance/agents", async (req, res) => {
  try {
    if (!(await requireFinanceModule(req, res, MODULES.FINANCE_ANALYTICS))) return;
    res.json(await getFinanceAgentWorkspace({ tenantId: req.tenantId }));
  } catch (error) {
    console.error("Finance agents workspace error:", error);
    res.status(500).json({ error: "No se pudo cargar el equipo de agentes financieros" });
  }
});

financeRouter.patch("/finance/agents/policy", requireRole(ROLE_GROUPS.MANAGERS), async (req, res) => {
  try {
    if (!(await requireFinanceModule(req, res, MODULES.FINANCE_ANALYTICS))) return;
    const policy = await updateFinanceAgentPolicy({ tenantId: req.tenantId, patch: req.body || {} });
    await recordAuditLog(req, "FINANCE_AGENT_POLICY_UPDATED", "tenant_finance_agents", req.tenantId, { policy });
    res.json({ policy });
  } catch (error) {
    console.error("Finance agent policy error:", error);
    res.status(500).json({ error: "No se pudo actualizar la politica de agentes financieros" });
  }
});

financeRouter.post("/finance/agents/analyze", requireRole(ROLE_GROUPS.STAFF), async (req, res) => {
  try {
    if (!(await requireFinanceModule(req, res, MODULES.FINANCE_ANALYTICS))) return;
    const exceptionResult = await prepareFinanceAgentExceptions({ tenantId: req.tenantId });
    const workspace = await getFinanceAgentWorkspace({ tenantId: req.tenantId });
    await recordAuditLog(req, "FINANCE_AGENTS_ANALYZED", "tenant_finance_agents", req.tenantId, {
      exceptionsPrepared: exceptionResult.created.length,
      skipped: exceptionResult.skipped
    });
    res.json({ workspace, exceptionsPrepared: exceptionResult.created.length, exceptionsSkipped: exceptionResult.skipped });
  } catch (error) {
    console.error("Finance agents analysis error:", error);
    res.status(500).json({ error: "No se pudo ejecutar el analisis de agentes financieros" });
  }
});

financeRouter.post("/finance/reconciliations/:movementId/approve", requireRole(ROLE_GROUPS.STAFF), async (req, res) => {
  try {
    if (!(await requireFinanceModule(req, res, MODULES.FINANCE_RECONCILIATION))) return;
    const invoiceId = cleanText(req.body?.invoiceId);
    if (!invoiceId) return res.status(400).json({ error: "invoiceId es requerido" });

    const [movement, invoice] = await Promise.all([
      prisma.industryRecord.findFirst({ where: { id: req.params.movementId, tenantId: req.tenantId, recordType: "bank_movement" } }),
      prisma.industryRecord.findFirst({ where: { id: invoiceId, tenantId: req.tenantId, recordType: "finance_invoice" } })
    ]);
    if (!movement || !invoice) return res.status(404).json({ error: "Movimiento o factura no encontrados" });
    if (String(movement.status || "").toUpperCase() === "MATCHED") return res.status(409).json({ error: "Este movimiento ya fue conciliado" });

    const suggestion = scoreFinanceReconciliation(invoice, movement);
    const movementAmount = Math.abs(Number(financeRecordData(movement).amount || 0));
    const invoiceState = getInvoiceFinancialState(invoice);
    const remainingBalance = Math.max(0, invoiceState.balance - movementAmount);
    const now = new Date();

    const reconciliation = await prisma.$transaction(async (tx) => {
      const created = await tx.industryRecord.create({
        data: {
          tenantId: req.tenantId,
          recordType: "finance_reconciliation",
          title: `${invoice.title} - ${movement.title}`.slice(0, 220),
          status: "APPROVED",
          data: {
            invoiceId: invoice.id,
            movementId: movement.id,
            confidence: suggestion.confidence,
            matchReasons: suggestion.reasons,
            difference: suggestion.difference,
            approvedAt: now.toISOString(),
            approvedById: req.user?.id || null
          }
        }
      });
      await tx.industryRecord.update({
        where: { id: movement.id },
        data: { status: "MATCHED", data: { ...financeRecordData(movement), status: "MATCHED", reconciliationId: created.id, reconciledAt: now.toISOString() } }
      });
      await tx.industryRecord.update({
        where: { id: invoice.id },
        data: {
          status: remainingBalance === 0 ? "PAID" : "PARTIAL",
          data: {
            ...financeRecordData(invoice),
            balance: remainingBalance,
            status: remainingBalance === 0 ? "PAID" : "PARTIAL",
            paidAt: remainingBalance === 0 ? now.toISOString() : financeRecordData(invoice).paidAt || null,
            lastReconciliationId: created.id
          }
        }
      });
      return created;
    });

    await recordAuditLog(req, "FINANCE_RECONCILIATION_APPROVED", "finance_reconciliation", reconciliation.id, { invoiceId, movementId: movement.id, confidence: suggestion.confidence });
    res.status(201).json({ reconciliation, remainingBalance, confidence: suggestion.confidence, reasons: suggestion.reasons });
  } catch (error) {
    console.error("Approve finance reconciliation error:", error);
    res.status(500).json({ error: "No se pudo aprobar la conciliacion" });
  }
});

financeRouter.post("/finance/reconciliations/:movementId/reject", requireRole(ROLE_GROUPS.STAFF), async (req, res) => {
  try {
    if (!(await requireFinanceModule(req, res, MODULES.FINANCE_RECONCILIATION))) return;
    const movement = await prisma.industryRecord.findFirst({ where: { id: req.params.movementId, tenantId: req.tenantId, recordType: "bank_movement" } });
    if (!movement) return res.status(404).json({ error: "Movimiento no encontrado" });
    if (String(movement.status || "").toUpperCase() === "MATCHED") return res.status(409).json({ error: "Un movimiento conciliado no puede rechazarse" });
    const detail = cleanText(req.body?.detail, "Sugerencia rechazada; requiere revisión humana.");
    const data = financeRecordData(movement);
    const result = await prisma.$transaction(async (tx) => {
      const updatedMovement = await tx.industryRecord.update({ where: { id: movement.id }, data: { status: "REVIEW", data: { ...data, status: "REVIEW", reviewReason: detail, reviewedAt: new Date().toISOString() } } });
      const exception = await tx.industryRecord.create({ data: { tenantId: req.tenantId, recordType: "finance_exception", title: `Revisión de movimiento ${movement.title}`.slice(0, 220), status: "OPEN", data: { type: "UNMATCHED_MOVEMENT", movementId: movement.id, detail, priority: "MEDIUM", suggestedBy: "finance_reconciliation" } } });
      return { updatedMovement, exception };
    });
    await recordAuditLog(req, "FINANCE_RECONCILIATION_REJECTED", "bank_movement", movement.id, { detail, exceptionId: result.exception.id });
    res.status(201).json(result);
  } catch (error) {
    console.error("Reject finance reconciliation error:", error);
    res.status(500).json({ error: "No se pudo rechazar la conciliación" });
  }
});

financeRouter.post("/finance/collection-cases/generate", requireRole(ROLE_GROUPS.STAFF), async (req, res) => {
  try {
    if (!(await requireFinanceModule(req, res, MODULES.FINANCE_COLLECTIONS))) return;
    const now = new Date();
    const invoices = await prisma.industryRecord.findMany({ where: { tenantId: req.tenantId, recordType: "finance_invoice" } });
    const existingCases = await prisma.industryRecord.findMany({ where: { tenantId: req.tenantId, recordType: "finance_collection_case", status: { notIn: ["PAID", "CLOSED"] } } });
    const existingInvoiceIds = new Set(existingCases.map((record) => String(financeRecordData(record).invoiceId || "")));
    const created = [];

    for (const invoice of invoices) {
      const state = getInvoiceFinancialState(invoice, now);
      if (state.status !== "OVERDUE" || existingInvoiceIds.has(invoice.id)) continue;
      const data = financeRecordData(invoice);
      const daysPastDue = Math.max(0, Math.floor((now.getTime() - state.dueDate.getTime()) / (24 * 60 * 60 * 1000)));
      const record = await prisma.industryRecord.create({
        data: {
          tenantId: req.tenantId,
          recordType: "finance_collection_case",
          title: `Cobranza ${data.invoiceNumber || invoice.title}`.slice(0, 220),
          status: "PENDING",
          data: {
            invoiceId: invoice.id,
            invoiceNumber: data.invoiceNumber || invoice.title,
            customerName: data.customerName || data.customer || "Cliente sin nombre",
            balance: state.balance,
            agingBucket: daysPastDue <= 30 ? "1-30 dias" : daysPastDue <= 60 ? "31-60 dias" : daysPastDue <= 90 ? "61-90 dias" : "+90 dias",
            channel: "manual",
            nextActionAt: now.toISOString(),
            history: [{ at: now.toISOString(), type: "CASE_CREATED", detail: "Caso preparado para revision y contacto." }]
          }
        }
      });
      created.push(record);
    }
    await recordAuditLog(req, "FINANCE_COLLECTION_CASES_GENERATED", "finance_collection_case", req.tenantId, { count: created.length });
    res.status(201).json({ created, count: created.length });
  } catch (error) {
    console.error("Generate finance collections error:", error);
    res.status(500).json({ error: "No se pudieron preparar los casos de cobranza" });
  }
});

financeRouter.patch("/finance/collection-cases/:id", requireRole(ROLE_GROUPS.STAFF), async (req, res) => {
  try {
    if (!(await requireFinanceModule(req, res, MODULES.FINANCE_COLLECTIONS))) return;
    const record = await prisma.industryRecord.findFirst({ where: { id: req.params.id, tenantId: req.tenantId, recordType: "finance_collection_case" } });
    if (!record) return res.status(404).json({ error: "Caso de cobranza no encontrado" });
    const patch = financeCaseUpdate(req.body || {});
    const status = patch.status || String(record.status || "PENDING").toUpperCase();
    const now = new Date().toISOString();
    const note = cleanText(req.body?.note);
    const history = [...financeHistory(financeRecordData(record)), { at: now, type: "CASE_UPDATED", status, detail: note || "Caso actualizado manualmente.", userId: req.user?.id || null }];
    const updated = await prisma.industryRecord.update({ where: { id: record.id }, data: { status, data: { ...financeRecordData(record), ...patch, status, history, updatedAt: now } } });
    await recordAuditLog(req, "FINANCE_COLLECTION_CASE_UPDATED", "finance_collection_case", record.id, { status, note: note || null });
    res.json({ case: updated });
  } catch (error) {
    console.error("Update finance collection case error:", error);
    res.status(500).json({ error: "No se pudo actualizar el caso de cobranza" });
  }
});

financeRouter.patch("/finance/exceptions/:id", requireRole(ROLE_GROUPS.STAFF), async (req, res) => {
  try {
    if (!(await requireFinanceModule(req, res, MODULES.FINANCE_EXCEPTIONS))) return;
    const record = await prisma.industryRecord.findFirst({ where: { id: req.params.id, tenantId: req.tenantId, recordType: "finance_exception" } });
    if (!record) return res.status(404).json({ error: "Excepción financiera no encontrada" });
    const requestedStatus = cleanText(req.body?.status).toUpperCase();
    const status = ["OPEN", "IN_REVIEW", "RESOLVED", "CLOSED"].includes(requestedStatus) ? requestedStatus : String(record.status || "OPEN").toUpperCase();
    const resolution = cleanText(req.body?.resolution);
    const now = new Date().toISOString();
    const updated = await prisma.industryRecord.update({ where: { id: record.id }, data: { status, data: { ...financeRecordData(record), status, ...(resolution ? { resolution } : {}), ...(status === "RESOLVED" || status === "CLOSED" ? { resolvedAt: now, resolvedById: req.user?.id || null } : {}) } } });
    await recordAuditLog(req, "FINANCE_EXCEPTION_UPDATED", "finance_exception", record.id, { status, resolution: resolution || null });
    res.json({ exception: updated });
  } catch (error) {
    console.error("Update finance exception error:", error);
    res.status(500).json({ error: "No se pudo actualizar la excepción financiera" });
  }
});
