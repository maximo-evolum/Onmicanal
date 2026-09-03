import { Router } from "express";
import multer from "multer";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { prisma } from "../lib/db.js";
import { env } from "../lib/env.js";
import { MODULES } from "../lib/modules.js";
import { requireRole, ROLE_GROUPS } from "../middleware/tenant-access.js";
import { ensureTenantModuleEligibility } from "../services/tenant-modules.service.js";
import {
  financeRecordData,
  financeAgingSegment,
  getFinanceOverview,
  getFinanceReconciliationSuggestions,
  getInvoiceFinancialState,
  scoreFinanceReconciliation
} from "../services/finance.service.js";
import { getFinanceAgentWorkspace, prepareFinanceAgentExceptions, updateFinanceAgentPolicy } from "../services/finance-agents.service.js";
import { recordAuditLog } from "../lib/audit.js";
import { createTenantNotification } from "../lib/notifications.js";
import {
  downloadNuboxSaleFile,
  financeSyncHistory,
  getNuboxSale,
  getNuboxSaleDetails,
  getNuboxSaleReferences,
  issueNuboxSales,
  syncNuboxForTenant
} from "../services/finance-sync.service.js";
import { MAX_MIGRATION_FILE_BYTES, MAX_MIGRATION_ROWS, historicalFinanceFingerprint, normalizeHistoricalFinanceRows, readHistoricalFinanceFile, summarizeHistoricalFinanceRows } from "../services/finance-migration.service.js";
import {
  MAX_BANK_STATEMENT_FILE_BYTES,
  MAX_BANK_STATEMENT_ROWS,
  bankMovementFingerprint,
  normalizeBankStatementRows,
  readBankStatementFile,
  summarizeBankStatementRows,
  withBankStatementNet
} from "../services/finance-bank-statements.service.js";
import { CHILEAN_FINANCIAL_INSTITUTIONS } from "../lib/finance-integrations.js";
import {
  MAX_SII_DTE_FILE_BYTES,
  MAX_SII_DTE_FILES,
  parseSiiDteFiles,
  sanitizeSiiDteDocuments,
  siiDteFingerprint,
  summarizeSiiDteDocuments
} from "../services/finance-sii-dte.service.js";
import { createFloidConsentCase, normalizeFloidTransactions } from "../services/finance-floid.service.js";
import { getFinanceMonthlyClosePreview, validFinancePeriod } from "../services/finance-monthly-close.service.js";
import { getFinancePlanning, validPlanningPeriod } from "../services/finance-planning.service.js";
import { canPerformFinanceAction, FINANCE_ACTIONS, financeRoleCapabilities } from "../services/finance-security.service.js";

export const financeRouter = Router();
export const financePublicRouter = Router();
const historicalMigrationUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_MIGRATION_FILE_BYTES, files: 1 }
});
const bankStatementUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BANK_STATEMENT_FILE_BYTES, files: 1 }
});
const siiDteUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_SII_DTE_FILE_BYTES, files: MAX_SII_DTE_FILES }
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

function requireFinancePermission(action) {
  return (req, res, next) => {
    if (canPerformFinanceAction(req.user?.role, action)) return next();
    console.warn("[FINANCE_PERMISSION_FORBIDDEN]", { userId: req.user?.id, tenantId: req.tenantId, role: req.user?.role, action });
    return res.status(403).json({ error: "Tu rol no tiene permiso para esta acción financiera.", action });
  };
}

function connectionMetadata(config) {
  return config?.metadata && typeof config.metadata === "object" && !Array.isArray(config.metadata) ? config.metadata : {};
}

function normalizedRut(value) {
  return cleanText(value).replace(/[.\s]/g, "").toUpperCase();
}

async function siiConfigForTenant(tenantId) {
  const config = await prisma.tenantChannelConfig.findUnique({ where: { tenantId_channel: { tenantId, channel: "finance_sii" } }, select: { id: true, isActive: true, metadata: true, updatedAt: true } });
  const metadata = connectionMetadata(config);
  return {
    config,
    companyRut: normalizedRut(metadata.companyRut),
    environment: cleanText(metadata.environment, "certification").toLowerCase() === "production" ? "production" : "certification",
    certificateReference: cleanText(metadata.certificateReference)
  };
}

function financePublicBaseUrl(req) {
  const host = req.get("host");
  const protocol = req.get("x-forwarded-proto") || req.protocol || "https";
  return String(env.publicBaseUrl || (host ? `${protocol}://${host}` : "")).replace(/\/+$/, "");
}

function providerReadyForFloid() {
  return Boolean(env.floidApiBaseUrl && env.floidClientId && env.floidClientSecret && env.floidWebhookSecret);
}

function secureWebhookSecretMatches(received) {
  const expected = String(env.floidWebhookSecret || "");
  const candidate = String(received || "");
  if (!expected || !candidate || expected.length !== candidate.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(candidate));
}

async function findFloidConsent(caseId) {
  const candidates = await prisma.industryRecord.findMany({
    where: { recordType: "finance_open_banking_consent", status: { in: ["PENDING", "PROCESSING"] } },
    orderBy: { updatedAt: "desc" }, take: 1000
  });
  return candidates.find((record) => cleanText(financeRecordData(record).caseId) === cleanText(caseId)) || null;
}

async function importFloidMovements({ tenantId, consent, payload }) {
  const consentData = financeRecordData(consent);
  const normalized = normalizeFloidTransactions(payload, consentData.account || {});
  if (!normalized.movements.length) throw new Error("Flöid no entregó movimientos para esta autorización.");
  const existing = await prisma.industryRecord.findMany({ where: { tenantId, recordType: "bank_movement" }, select: { data: true }, take: 10000, orderBy: { createdAt: "desc" } });
  const known = new Set(existing.map((record) => cleanText(financeRecordData(record).fingerprint) || bankMovementFingerprint(financeRecordData(record))).filter(Boolean));
  const unique = [];
  const review = [];
  const seen = new Set();
  let duplicates = 0;
  for (const movement of normalized.movements) {
    if (movement.needsReview) { review.push(movement); continue; }
    if (known.has(movement.fingerprint) || seen.has(movement.fingerprint)) { duplicates += 1; continue; }
    seen.add(movement.fingerprint);
    unique.push(movement);
  }
  const importedAt = new Date().toISOString();
  const result = await prisma.$transaction(async (tx) => {
    const batch = await tx.industryRecord.create({ data: { tenantId, recordType: "bank_statement", title: `Banca abierta · ${normalized.caseId || consentData.caseId}`.slice(0, 220), status: "IMPORTED", data: { source: "floid_open_banking", consentId: consent.id, caseId: normalized.caseId || consentData.caseId, account: consentData.account, summary: normalized.summary, importedAt, importedRows: unique.length, duplicateRows: duplicates, reviewRows: review.length } } });
    if (unique.length) await tx.industryRecord.createMany({ data: unique.map((movement) => ({ tenantId, recordType: "bank_movement", title: `${movement.transactionDate} · ${movement.description}`.slice(0, 220), status: "PENDING", data: { ...movement, source: "floid_open_banking", sourceBatchId: batch.id, consentId: consent.id, caseId: normalized.caseId || consentData.caseId, importedAt } })) });
    if (review.length) await tx.industryRecord.createMany({ data: review.map((movement) => ({ tenantId, recordType: "finance_exception", title: `Revisar movimiento de banca abierta · ${movement.description}`.slice(0, 220), status: "OPEN", data: { type: "OPEN_BANKING_IMPORT_REVIEW", priority: "MEDIUM", detail: `Faltan: ${movement.reviewReasons.join(", ")}`, movement, consentId: consent.id, caseId: normalized.caseId || consentData.caseId } })) });
    const updatedConsent = await tx.industryRecord.update({ where: { id: consent.id }, data: { status: "SYNCED", data: { ...consentData, lastSyncAt: importedAt, lastSyncSummary: { imported: unique.length, duplicates, requiresReview: review.length }, lastProviderStatus: normalized.status } } });
    return { batch, consent: updatedConsent, imported: unique.length, duplicates, requiresReview: review.length };
  });
  return { ...result, summary: normalized.summary };
}

function financeHistory(data) {
  return Array.isArray(data?.history) ? data.history.slice(-99) : [];
}

function financeCaseUpdate(input = {}) {
  const status = cleanText(input.status).toUpperCase();
  const allowedStatuses = new Set(["MONITORING", "PENDING", "CONTACTED", "PROMISE", "PAID", "ESCALATED", "CLOSED"]);
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
        reminderStatus: "Sin recordatorio preparado",
        agingSegments: { POR_VENCER: 0, "1_7": 0, "8_30": 0, "31_60": 0, "61_90": 0, MAS_90: 0 },
        recommendedAction: "Monitoreo preventivo"
      };
      row.documents += 1;
      if (state.status !== "PAID") {
        row.openDocuments += 1;
        row.totalDebt += state.balance;
        if (state.status === "OVERDUE") {
          row.overdueDocuments += 1;
          row.overdueAmount += state.balance;
        }
        const segment = financeAgingSegment(state.dueDate, now);
        row.agingSegments[segment.code] = (row.agingSegments[segment.code] || 0) + state.balance;
        const actionPriority = { "Monitoreo preventivo": 0, "Cobranza preventiva": 1, "Cobranza activa": 2, "Cobranza intensiva": 3, "Cobranza crítica": 4, "Gestión especial": 5 };
        if ((actionPriority[segment.action] || 0) >= (actionPriority[row.recommendedAction] || 0)) row.recommendedAction = segment.action;
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
financeRouter.post("/finance/invoices/:id/receipts", requireRole(ROLE_GROUPS.MANAGERS), requireFinancePermission(FINANCE_ACTIONS.REGISTER), async (req, res) => {
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
      const segment = financeAgingSegment(state.dueDate, new Date());
      const event = { at: now, type: "REMINDER_DRAFT_PREPARED", detail: `Borrador preparado para cartera ${segment.label}. No se envió ningún mensaje.`, userId: req.user?.id || null };
      if (existing) {
        const updated = await prisma.industryRecord.update({ where: { id: existing.id }, data: { data: { ...financeRecordData(existing), balance: state.balance, agingBucket: segment.label, agingCode: segment.code, daysPastDue: segment.daysPastDue, recommendedAction: segment.action, reminderStatus: "Recordatorio preparado", lastReminderAt: now, history: [...financeHistory(financeRecordData(existing)), event] } } });
        prepared.push(updated);
      } else {
        const created = await prisma.industryRecord.create({ data: { tenantId: req.tenantId, recordType: "finance_collection_case", title: `Cobranza ${data.invoiceNumber || invoice.title}`.slice(0, 220), status: segment.code === "POR_VENCER" ? "MONITORING" : "PENDING", data: { invoiceId: invoice.id, invoiceNumber: data.invoiceNumber || invoice.title, customerName: party.name, clientRut: party.rut, balance: state.balance, agingBucket: segment.label, agingCode: segment.code, daysPastDue: segment.daysPastDue, recommendedAction: segment.action, channel: "manual", reminderStatus: "Recordatorio preparado", lastReminderAt: now, nextActionAt: now, history: [{ at: now, type: "CASE_CREATED", detail: `${segment.action}. Caso preparado para revisión humana.` }, event] } } });
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

financeRouter.post("/finance/payables/:id/payments", requireRole(ROLE_GROUPS.MANAGERS), requireFinancePermission(FINANCE_ACTIONS.REGISTER), async (req, res) => {
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

financeRouter.post("/finance/migrations/import", requireRole(ROLE_GROUPS.MANAGERS), requireFinancePermission(FINANCE_ACTIONS.IMPORT_HISTORY), async (req, res) => {
  try {
    if (!(await requireFinanceModule(req, res, MODULES.FINANCE_MIGRATION))) return;
    const sourceFile = (cleanText(req.body?.sourceFile) || "migracion-historica.csv").slice(0, 180);
    const rows = normalizeHistoricalFinanceRows(req.body?.rows, { limit: MAX_MIGRATION_ROWS });
    if (!rows.length) return res.status(400).json({ error: "No se detectaron filas para importar." });
    const summary = summarizeHistoricalFinanceRows(rows);
    const importedAt = new Date().toISOString();
    const existingDocuments = await prisma.industryRecord.findMany({
      where: { tenantId: req.tenantId, recordType: { in: ["finance_invoice", "finance_payable"] } },
      select: { data: true }, take: 10000, orderBy: { updatedAt: "desc" }
    });
    const knownFingerprints = new Set(existingDocuments.map((record) => {
      const data = financeRecordData(record);
      return cleanText(data.migrationFingerprint) || historicalFinanceFingerprint({
        kind: data.documentSide === "SUPPLIER" ? "PAYABLE" : "RECEIVABLE", documentNumber: data.documentNumber || data.invoiceNumber,
        rut: data.clientRut || data.customerRut || data.supplierRut || data.rut, amount: data.amount, issueDate: data.issueDate, partyName: data.customerName || data.clientName || data.supplierName
      });
    }).filter(Boolean));
    const seenFingerprints = new Set();
    const importableRows = [];
    let duplicateRows = 0;
    for (const row of rows) {
      if (!row.needsReview && (knownFingerprints.has(row.fingerprint) || seenFingerprints.has(row.fingerprint))) { duplicateRows += 1; continue; }
      seenFingerprints.add(row.fingerprint);
      importableRows.push(row);
    }
    const batch = await prisma.$transaction(async (tx) => {
      const batchRecord = await tx.industryRecord.create({
        data: {
          tenantId: req.tenantId,
          recordType: "finance_migration_batch",
          title: `Migración histórica · ${sourceFile}`.slice(0, 220),
          status: "COMPLETED",
          data: { sourceFile, totalRows: rows.length, reviewRows: summary.reviewRows, duplicateRows, summary, importedAt, importedById: req.user?.id || null }
        }
      });
      const records = [];
      for (const row of importableRows) {
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
          migrationFingerprint: row.fingerprint,
          sourceRow: row.source
        };
        const created = await tx.industryRecord.create({
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
        });
        records.push(created);
        // Un saldo histórico puede ser parcialmente o totalmente pagado. Se
        // conserva un comprobante interno para que el saldo inicial sea
        // auditable sin inventar una cartola bancaria ni un medio de pago.
        if (!row.needsReview && row.paidAmount > 0) {
          await tx.industryRecord.create({ data: {
            tenantId: req.tenantId,
            recordType: row.kind === "PAYABLE" ? "finance_payable_payment" : "finance_invoice_receipt",
            title: `${row.kind === "PAYABLE" ? "Pago histórico" : "Cobro histórico"} ${row.documentNumber}`.slice(0, 220),
            status: "MIGRATED",
            data: { [row.kind === "PAYABLE" ? "payableId" : "invoiceId"]: created.id, amount: row.paidAmount, paymentDate: row.issueDate || importedAt.slice(0, 10), source: "historical_migration", migrationBatchId: batchRecord.id, migrationRow: row.rowNumber, note: "Saldo inicial importado; requiere respaldo externo si se necesita comprobante bancario." }
          } });
        }
      }
      await tx.industryRecord.update({ where: { id: batchRecord.id }, data: { data: { ...financeRecordData(batchRecord), importedRows: records.length, exceptionRows: summary.reviewRows } } });
      return { batch: batchRecord, records };
    });
    await recordAuditLog(req, "FINANCE_HISTORICAL_MIGRATION_IMPORTED", "finance_migration_batch", batch.batch.id, { sourceFile, totalRows: rows.length, imported: batch.records.length, duplicateRows, summary });
    res.status(201).json({ batch: batch.batch, summary, imported: batch.records.length, duplicateRows, requiresReview: summary.reviewRows });
  } catch (error) {
    console.error("Import historical finance migration error:", error);
    res.status(500).json({ error: "No se pudo importar la migración histórica." });
  }
});

// Catálogo único para toda la plataforma. Las cuentas se importan desde el
// archivo del banco; una API bancaria directa sigue requiriendo autorización
// individual de cada banco y del titular de la cuenta.
financeRouter.get("/finance/banks/catalog", async (req, res) => {
  try {
    if (!(await requireFinanceModule(req, res, MODULES.FINANCE_BANK_SYNC))) return;
    res.json({
      banks: CHILEAN_FINANCIAL_INSTITUTIONS,
      supportedFormats: ["CSV", "XLSX"],
      maxRows: MAX_BANK_STATEMENT_ROWS,
      note: "Puedes importar cartolas exportadas por cualquier banco del catálogo CMF. La conexión automática por API depende de la autorización de cada banco."
    });
  } catch (error) {
    console.error("Finance bank catalog error:", error);
    res.status(500).json({ error: "No se pudo obtener el catálogo bancario." });
  }
});

financeRouter.post("/finance/bank-statements/preview-file", requireRole(ROLE_GROUPS.MANAGERS), bankStatementUpload.single("file"), async (req, res) => {
  try {
    if (!(await requireFinanceModule(req, res, MODULES.FINANCE_BANK_SYNC))) return;
    const sourceRows = await readBankStatementFile(req.file);
    const rows = normalizeBankStatementRows(sourceRows, req.body || {}, { limit: MAX_BANK_STATEMENT_ROWS });
    if (!rows.length) return res.status(400).json({ error: "No se detectaron movimientos en la cartola." });
    const summary = withBankStatementNet(summarizeBankStatementRows(rows));
    res.json({
      sourceFile: cleanText(req.file?.originalname, "cartola-bancaria"),
      maxRows: MAX_BANK_STATEMENT_ROWS,
      account: { bank: rows[0].bank, bankKey: rows[0].bankKey, cmfCode: rows[0].cmfCode, accountAlias: rows[0].accountAlias, accountType: rows[0].accountType, accountLast4: rows[0].accountLast4 },
      summary,
      rows: rows.slice(0, 100),
      sourceRows: sourceRows.slice(0, MAX_BANK_STATEMENT_ROWS)
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo leer la cartola bancaria.";
    res.status(400).json({ error: message });
  }
});

financeRouter.post("/finance/bank-statements/import", requireRole(ROLE_GROUPS.MANAGERS), requireFinancePermission(FINANCE_ACTIONS.IMPORT_HISTORY), async (req, res) => {
  try {
    if (!(await requireFinanceModule(req, res, MODULES.FINANCE_BANK_SYNC))) return;
    const sourceRows = Array.isArray(req.body?.rows) ? req.body.rows : [];
    const rows = normalizeBankStatementRows(sourceRows, req.body || {}, { limit: MAX_BANK_STATEMENT_ROWS });
    if (!rows.length) return res.status(400).json({ error: "No se detectaron movimientos para importar." });
    const sourceFile = cleanText(req.body?.sourceFile, "cartola-bancaria").slice(0, 180);
    const summary = withBankStatementNet(summarizeBankStatementRows(rows));
    const existingMovements = await prisma.industryRecord.findMany({
      where: { tenantId: req.tenantId, recordType: "bank_movement" },
      select: { data: true },
      take: 10000,
      orderBy: { createdAt: "desc" }
    });
    const knownFingerprints = new Set(existingMovements.map((record) => {
      const data = financeRecordData(record);
      return cleanText(data.fingerprint) || bankMovementFingerprint(data);
    }).filter(Boolean));
    const seenInFile = new Set();
    const validRows = [];
    const reviewRows = [];
    let duplicateRows = 0;
    for (const row of rows) {
      if (row.needsReview) {
        reviewRows.push(row);
        continue;
      }
      if (knownFingerprints.has(row.fingerprint) || seenInFile.has(row.fingerprint)) {
        duplicateRows += 1;
        continue;
      }
      seenInFile.add(row.fingerprint);
      validRows.push(row);
    }
    const importedAt = new Date().toISOString();
    const result = await prisma.$transaction(async (tx) => {
      const batch = await tx.industryRecord.create({
        data: {
          tenantId: req.tenantId,
          recordType: "bank_statement",
          title: `Cartola ${rows[0].bank} · ${rows[0].accountAlias} · ${sourceFile}`.slice(0, 220),
          status: "IMPORTED",
          data: {
            sourceFile,
            importedAt,
            importedById: req.user?.id || null,
            account: { bank: rows[0].bank, bankKey: rows[0].bankKey, cmfCode: rows[0].cmfCode, accountAlias: rows[0].accountAlias, accountType: rows[0].accountType, accountLast4: rows[0].accountLast4 },
            summary,
            importedRows: validRows.length,
            duplicateRows,
            reviewRows: reviewRows.length
          }
        }
      });
      if (validRows.length) {
        await tx.industryRecord.createMany({
          data: validRows.map((row) => ({
            tenantId: req.tenantId,
            recordType: "bank_movement",
            title: `${row.transactionDate} · ${row.description}`.slice(0, 220),
            status: "PENDING",
            data: {
              ...row,
              sourceRow: row.source,
              source: "bank_statement_import",
              sourceFile,
              importBatchId: batch.id,
              importRow: row.rowNumber,
              importedAt
            }
          }))
        });
      }
      if (reviewRows.length) {
        await tx.industryRecord.createMany({
          data: reviewRows.map((row) => ({
            tenantId: req.tenantId,
            recordType: "finance_exception",
            title: `Revisar cartola fila ${row.rowNumber} · ${row.description}`.slice(0, 220),
            status: "OPEN",
            data: {
              type: "BANK_STATEMENT_IMPORT_REVIEW",
              priority: "MEDIUM",
              detail: `Faltan: ${row.reviewReasons.join(", ")}`,
              source: "bank_statement_import",
              sourceFile,
              importBatchId: batch.id,
              movement: row
            }
          }))
        });
      }
      return { batch, imported: validRows.length, requiresReview: reviewRows.length };
    });
    await recordAuditLog(req, "FINANCE_BANK_STATEMENT_IMPORTED", "bank_statement", result.batch.id, {
      sourceFile,
      bankKey: rows[0].bankKey,
      cmfCode: rows[0].cmfCode,
      imported: result.imported,
      duplicateRows,
      requiresReview: result.requiresReview
    });
    res.status(201).json({ ...result, duplicateRows, summary });
  } catch (error) {
    console.error("Import bank statement error:", error);
    res.status(500).json({ error: error instanceof Error ? error.message : "No se pudo importar la cartola bancaria." });
  }
});

// Banca abierta no solicita ni almacena la clave bancaria del usuario. La
// cuenta se vincula en el proveedor autorizado y este devuelve movimientos al
// callback asociado al caseId de EVOLUM.
financeRouter.get("/finance/open-banking/status", async (req, res) => {
  try {
    if (!(await requireFinanceModule(req, res, MODULES.FINANCE_BANK_SYNC))) return;
    const consents = await prisma.industryRecord.findMany({ where: { tenantId: req.tenantId, recordType: "finance_open_banking_consent" }, orderBy: { updatedAt: "desc" }, take: 20 });
    res.json({
      provider: "Floid",
      providerReady: providerReadyForFloid(),
      callbackConfigured: Boolean(env.publicBaseUrl && env.floidWebhookSecret),
      consents: consents.map((record) => {
        const data = financeRecordData(record);
        return { id: record.id, status: record.status, createdAt: record.createdAt, updatedAt: record.updatedAt, bank: data.account?.bankKey || null, alias: data.account?.accountAlias || "Cuenta sin nombre", accountLast4: data.account?.accountLast4 || null, lastSyncAt: data.lastSyncAt || null, lastSyncSummary: data.lastSyncSummary || null };
      }),
      message: providerReadyForFloid()
        ? "EVOLUM está listo para recibir consentimientos y movimientos desde Floid. Configura en Floid el callback entregado para cada caseId."
        : "Falta habilitar las credenciales y el secreto de webhook de Floid en Railway. La importación manual por cartola sigue disponible."
    });
  } catch (error) {
    console.error("Open banking status error:", error);
    res.status(500).json({ error: "No se pudo revisar la banca abierta." });
  }
});

financeRouter.post("/finance/open-banking/consents", requireRole(ROLE_GROUPS.MANAGERS), async (req, res) => {
  try {
    if (!(await requireFinanceModule(req, res, MODULES.FINANCE_BANK_SYNC))) return;
    const consent = createFloidConsentCase(req.body || {});
    if (!consent.account.bankKey) return res.status(400).json({ error: "Selecciona el banco que el titular autorizará." });
    const callbackUrl = `${financePublicBaseUrl(req)}/api/finance/floid/webhook`;
    if (!financePublicBaseUrl(req)) return res.status(400).json({ error: "PUBLIC_BASE_URL es necesaria para preparar el callback de banca abierta." });
    const created = await prisma.industryRecord.create({ data: { tenantId: req.tenantId, recordType: "finance_open_banking_consent", title: `Consentimiento banca abierta · ${consent.account.accountAlias}`.slice(0, 220), status: "PENDING", data: { ...consent, provider: "floid", callbackUrl, createdById: req.user?.id || null, createdAt: new Date().toISOString(), consentRequired: true, credentialsHandledByProvider: true } } });
    await recordAuditLog(req, "FINANCE_OPEN_BANKING_CONSENT_PREPARED", "finance_open_banking_consent", created.id, { bankKey: consent.account.bankKey, accountLast4: consent.account.accountLast4, providerReady: providerReadyForFloid() });
    res.status(201).json({ consent: { id: created.id, caseId: consent.caseId, status: created.status, account: consent.account }, callbackUrl, providerReady: providerReadyForFloid(), message: providerReadyForFloid() ? "Consentimiento preparado. Usa este caseId al iniciar el flujo de Flöid para que los movimientos regresen a EVOLUM." : "Consentimiento preparado. Falta activar Floid en Railway antes de iniciar el flujo externo." });
  } catch (error) {
    console.error("Open banking consent error:", error);
    res.status(400).json({ error: error instanceof Error ? error.message : "No se pudo preparar el consentimiento." });
  }
});

financePublicRouter.post("/finance/floid/webhook", async (req, res) => {
  try {
    if (!env.floidWebhookSecret) return res.status(503).json({ error: "Webhook de Floid no configurado." });
    const receivedSecret = req.get("x-evolum-floid-secret") || req.get("x-floid-webhook-secret") || String(req.get("authorization") || "").replace(/^Bearer\s+/i, "");
    if (!secureWebhookSecretMatches(receivedSecret)) return res.status(401).json({ error: "Webhook no autorizado." });
    const caseId = cleanText(req.body?.caseId || req.body?.caseid || req.body?.data?.caseId);
    if (!caseId) return res.status(400).json({ error: "caseId es requerido." });
    const consent = await findFloidConsent(caseId);
    if (!consent) return res.status(404).json({ error: "Consentimiento no encontrado o ya procesado." });
    const result = await importFloidMovements({ tenantId: consent.tenantId, consent, payload: req.body || {} });
    await prisma.tenantAuditLog.create({ data: { tenantId: consent.tenantId, action: "FINANCE_FLOID_WEBHOOK_IMPORTED", entity: "finance_open_banking_consent", entityId: consent.id, metadata: { caseId, imported: result.imported, duplicates: result.duplicates, requiresReview: result.requiresReview } } });
    if (result.imported || result.requiresReview) await createTenantNotification({ tenantId: consent.tenantId, type: "OPEN_BANKING_SYNC_READY", title: "Movimientos bancarios disponibles", body: `${result.imported} movimiento(s) de banca abierta quedaron listos para conciliación${result.requiresReview ? ` y ${result.requiresReview} requieren revisión` : ""}.`, href: "/finance?tab=cartolas" });
    res.status(202).json({ ok: true, imported: result.imported, duplicates: result.duplicates, requiresReview: result.requiresReview });
  } catch (error) {
    console.error("Floid webhook error:", error);
    res.status(400).json({ error: error instanceof Error ? error.message : "No se pudo procesar la respuesta de banca abierta." });
  }
});

// El SII exige certificado digital y autorización del contribuyente para sus
// web services. Mientras esa autorización externa se completa, EVOLUM puede
// incorporar DTE XML reales de manera trazable, sin alterar ni emitir DTE.
financeRouter.get("/finance/sii/status", async (req, res) => {
  try {
    if (!(await requireFinanceModule(req, res, MODULES.FINANCE_INVOICES))) return;
    const sii = await siiConfigForTenant(req.tenantId);
    const configured = Boolean(sii.config?.isActive && sii.companyRut && sii.certificateReference);
    res.json({
      configured,
      companyRut: sii.companyRut || null,
      environment: sii.environment,
      certificateReference: sii.certificateReference || null,
      manualDteImportReady: Boolean(sii.companyRut),
      automationReady: false,
      message: configured
        ? "Configuración base lista. La automatización queda pendiente de la autorización y validación externa del SII."
        : "Configura RUT, ambiente y referencia del certificado desde Centro de Conexiones para trabajar DTE XML."
    });
  } catch (error) {
    console.error("Finance SII status error:", error);
    res.status(500).json({ error: "No se pudo revisar la configuración SII." });
  }
});

financeRouter.post("/finance/sii/dte/preview-files", requireRole(ROLE_GROUPS.MANAGERS), siiDteUpload.array("files", MAX_SII_DTE_FILES), async (req, res) => {
  try {
    if (!(await requireFinanceModule(req, res, MODULES.FINANCE_INVOICES))) return;
    const sii = await siiConfigForTenant(req.tenantId);
    const documents = parseSiiDteFiles(req.files, { companyRut: sii.companyRut });
    if (!documents.length) return res.status(400).json({ error: "Selecciona al menos un DTE XML para revisar." });
    res.json({ companyRut: sii.companyRut, environment: sii.environment, maxFiles: MAX_SII_DTE_FILES, summary: summarizeSiiDteDocuments(documents), documents });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudieron leer los DTE XML.";
    res.status(400).json({ error: message });
  }
});

financeRouter.post("/finance/sii/dte/import", requireRole(ROLE_GROUPS.MANAGERS), async (req, res) => {
  try {
    if (!(await requireFinanceModule(req, res, MODULES.FINANCE_INVOICES))) return;
    const sii = await siiConfigForTenant(req.tenantId);
    const documents = sanitizeSiiDteDocuments(req.body?.documents, { companyRut: sii.companyRut });
    if (!documents.length) return res.status(400).json({ error: "No se detectaron DTE para importar." });
    const summary = summarizeSiiDteDocuments(documents);
    const existing = await prisma.industryRecord.findMany({
      where: { tenantId: req.tenantId, recordType: { in: ["finance_invoice", "finance_payable"] } },
      select: { data: true }, take: 10000, orderBy: { createdAt: "desc" }
    });
    const known = new Set(existing.map((record) => {
      const data = financeRecordData(record);
      return cleanText(data.siiDteFingerprint) || (data.emitterRut && data.receiverRut ? siiDteFingerprint(data) : "");
    }).filter(Boolean));
    const seen = new Set();
    const valid = [];
    const review = [];
    let duplicates = 0;
    for (const document of documents) {
      if (document.needsReview) { review.push(document); continue; }
      if (known.has(document.fingerprint) || seen.has(document.fingerprint)) { duplicates += 1; continue; }
      seen.add(document.fingerprint);
      valid.push(document);
    }
    const importedAt = new Date().toISOString();
    const result = await prisma.$transaction(async (tx) => {
      const batch = await tx.industryRecord.create({
        data: { tenantId: req.tenantId, recordType: "finance_sii_import_batch", title: `Importación DTE SII · ${importedAt.slice(0, 10)}`, status: "COMPLETED", data: { companyRut: sii.companyRut, environment: sii.environment, importedAt, summary, importedRows: valid.length, duplicateRows: duplicates, reviewRows: review.length } }
      });
      if (valid.length) await tx.industryRecord.createMany({ data: valid.map((document) => {
        const isSupplier = document.side === "SUPPLIER";
        const isAdjustment = ["56", "61"].includes(String(document.documentTypeCode));
        return {
          tenantId: req.tenantId,
          recordType: isAdjustment ? "finance_document_adjustment" : (isSupplier ? "finance_payable" : "finance_invoice"),
          title: `${document.documentTypeName} ${document.documentNumber} · ${document.partyName}`.slice(0, 220),
          status: isAdjustment ? "PENDING_LINK" : "OPEN",
          data: {
            source: "sii_dte_xml", siiDteFingerprint: document.fingerprint, siiImportBatchId: batch.id, sourceFile: document.sourceFile,
            documentSide: document.side, direction: isAdjustment ? (document.documentTypeCode === "61" ? "CREDIT_NOTE" : "DEBIT_NOTE") : (isSupplier ? "PURCHASE" : "SALE"), documentNumber: document.documentNumber,
            adjustmentType: isAdjustment ? (document.documentTypeCode === "61" ? "CREDIT_NOTE" : "DEBIT_NOTE") : undefined,
            referenceDocumentType: document.referenceDocumentType, referenceDocumentNumber: document.referenceDocumentNumber, referenceDocumentDate: document.referenceDocumentDate,
            invoiceNumber: isSupplier ? undefined : document.documentNumber, documentTypeCode: document.documentTypeCode, documentTypeName: document.documentTypeName,
            emitterRut: document.emitterRut, emitterName: document.emitterName, receiverRut: document.receiverRut, receiverName: document.receiverName,
            customerName: isSupplier ? undefined : document.partyName, customerRut: isSupplier ? undefined : document.partyRut,
            clientName: isSupplier ? undefined : document.partyName, clientRut: isSupplier ? undefined : document.partyRut,
            supplierName: isSupplier ? document.partyName : undefined, supplierRut: isSupplier ? document.partyRut : undefined,
            rut: document.partyRut, issueDate: document.issueDate, amount: document.amount, balance: isAdjustment ? 0 : document.amount, paidAmount: 0, currency: "CLP", importedAt
          }
        };
      }) });
      const customerAdjustments = valid.filter((document) => document.side === "CUSTOMER" && ["56", "61"].includes(String(document.documentTypeCode)) && document.referenceDocumentNumber);
      if (customerAdjustments.length) {
        const invoices = await tx.industryRecord.findMany({ where: { tenantId: req.tenantId, recordType: "finance_invoice" }, take: 1000, orderBy: { updatedAt: "desc" } });
        const adjustments = (await tx.industryRecord.findMany({ where: { tenantId: req.tenantId, recordType: "finance_document_adjustment" }, take: 1000, orderBy: { updatedAt: "desc" } }))
          .filter((record) => financeRecordData(record).siiImportBatchId === batch.id);
        for (const adjustment of adjustments) {
          const adjustmentData = financeRecordData(adjustment);
          const target = invoices.find((invoice) => String(financeRecordData(invoice).invoiceNumber || financeRecordData(invoice).documentNumber || "") === String(adjustmentData.referenceDocumentNumber || ""));
          if (!target) continue;
          const targetData = financeRecordData(target);
          const isCredit = adjustmentData.adjustmentType === "CREDIT_NOTE";
          const adjustmentAmount = safeAmount(adjustmentData.amount);
          const current = getInvoiceFinancialState(target);
          const nextBalance = isCredit ? Math.max(0, current.balance - adjustmentAmount) : current.balance + adjustmentAmount;
          await tx.industryRecord.update({ where: { id: target.id }, data: { status: nextBalance === 0 ? "PAID" : target.status, data: { ...targetData, balance: nextBalance, creditNotesTotal: safeAmount(targetData.creditNotesTotal) + (isCredit ? adjustmentAmount : 0), debitNotesTotal: safeAmount(targetData.debitNotesTotal) + (isCredit ? 0 : adjustmentAmount), lastAdjustmentId: adjustment.id } } });
          await tx.industryRecord.update({ where: { id: adjustment.id }, data: { status: "APPLIED", data: { ...adjustmentData, invoiceId: target.id, appliedAt: importedAt } } });
        }
      }
      if (review.length) await tx.industryRecord.createMany({ data: review.map((document) => ({
        tenantId: req.tenantId, recordType: "finance_exception", title: `Revisar DTE ${document.documentNumber || "sin folio"} · ${document.sourceFile}`.slice(0, 220), status: "OPEN",
        data: { type: "SII_DTE_IMPORT_REVIEW", priority: "MEDIUM", detail: `Faltan: ${document.reviewReasons.join(", ")}`, source: "sii_dte_xml", siiImportBatchId: batch.id, document }
      })) });
      return { batch, imported: valid.length, requiresReview: review.length };
    });
    await recordAuditLog(req, "FINANCE_SII_DTE_IMPORTED", "finance_sii_import_batch", result.batch.id, { imported: result.imported, duplicates, requiresReview: result.requiresReview, companyRut: sii.companyRut, environment: sii.environment });
    res.status(201).json({ ...result, duplicates, summary });
  } catch (error) {
    console.error("Finance SII DTE import error:", error);
    res.status(500).json({ error: error instanceof Error ? error.message : "No se pudieron importar los DTE." });
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

// El cierre mensual es una fotografía controlada para administración y
// contabilidad. No genera asientos, no presenta declaraciones y no modifica
// facturas: exige que los movimientos y excepciones del período estén revisados.
financeRouter.get("/finance/monthly-close/preview", async (req, res) => {
  try {
    if (!(await requireFinanceModule(req, res, MODULES.FINANCE_ANALYTICS))) return;
    const period = cleanText(req.query?.period) || new Date().toISOString().slice(0, 7);
    if (!validFinancePeriod(period)) return res.status(400).json({ error: "El período debe tener el formato AAAA-MM." });
    res.json(await getFinanceMonthlyClosePreview({ tenantId: req.tenantId, period }));
  } catch (error) {
    console.error("Finance monthly close preview error:", error);
    res.status(500).json({ error: error instanceof Error ? error.message : "No se pudo preparar el cierre mensual." });
  }
});

financeRouter.post("/finance/monthly-close", requireRole(ROLE_GROUPS.MANAGERS), requireFinancePermission(FINANCE_ACTIONS.CLOSE_PERIOD), async (req, res) => {
  try {
    if (!(await requireFinanceModule(req, res, MODULES.FINANCE_ANALYTICS))) return;
    const period = cleanText(req.body?.period) || new Date().toISOString().slice(0, 7);
    if (req.body?.confirmation !== "CERRAR") return res.status(400).json({ error: "Confirma el cierre con la palabra CERRAR." });
    const preview = await getFinanceMonthlyClosePreview({ tenantId: req.tenantId, period });
    if (preview.status !== "READY_TO_CLOSE") return res.status(409).json({ error: "El período tiene movimientos sin conciliar o excepciones abiertas. Resuélvelos antes de cerrarlo.", preview });
    const existing = await prisma.industryRecord.findMany({ where: { tenantId: req.tenantId, recordType: "finance_monthly_close" }, select: { id: true, data: true }, take: 500, orderBy: { createdAt: "desc" } });
    if (existing.some((record) => cleanText(financeRecordData(record).period) === period)) return res.status(409).json({ error: "Este período ya tiene un cierre registrado." });
    const closedAt = new Date().toISOString();
    const close = await prisma.industryRecord.create({ data: { tenantId: req.tenantId, recordType: "finance_monthly_close", title: `Cierre financiero ${period}`, status: "CLOSED", data: { ...preview, period, closedAt, closedById: req.user?.id || null, note: cleanText(req.body?.note) } } });
    await recordAuditLog(req, "FINANCE_MONTHLY_CLOSE_REGISTERED", "finance_monthly_close", close.id, { period, metrics: preview.metrics });
    await createTenantNotification({ tenantId: req.tenantId, type: "FINANCE_MONTHLY_CLOSE_READY", title: `Cierre financiero ${period} registrado`, body: "La fotografía del período quedó disponible para revisión administrativa y contable.", href: "/finance?tab=cierre" });
    res.status(201).json({ close, preview });
  } catch (error) {
    console.error("Finance monthly close error:", error);
    res.status(500).json({ error: error instanceof Error ? error.message : "No se pudo registrar el cierre mensual." });
  }
});

// Presupuesto y flujo proyectado: usa únicamente datos registrados en la
// cuenta. Las proyecciones son apoyo administrativo, no una orden de pago ni
// una predicción garantizada.
financeRouter.get("/finance/planning", async (req, res) => {
  try {
    if (!(await requireFinanceModule(req, res, MODULES.FINANCE_ANALYTICS))) return;
    const period = cleanText(req.query?.period) || new Date().toISOString().slice(0, 7);
    if (!validPlanningPeriod(period)) return res.status(400).json({ error: "El período debe tener el formato AAAA-MM." });
    res.json(await getFinancePlanning({ tenantId: req.tenantId, period }));
  } catch (error) {
    console.error("Finance planning error:", error);
    res.status(500).json({ error: error instanceof Error ? error.message : "No se pudo preparar la planificación financiera." });
  }
});

financeRouter.post("/finance/budgets", requireRole(ROLE_GROUPS.MANAGERS), async (req, res) => {
  try {
    if (!(await requireFinanceModule(req, res, MODULES.FINANCE_ANALYTICS))) return;
    const period = cleanText(req.body?.period);
    const category = cleanText(req.body?.category).slice(0, 120);
    if (!validPlanningPeriod(period) || !category) return res.status(400).json({ error: "Indica un período válido y una categoría." });
    const data = { period, category, plannedIncome: safeAmount(req.body?.plannedIncome), plannedExpense: safeAmount(req.body?.plannedExpense), note: cleanText(req.body?.note).slice(0, 500), updatedAt: new Date().toISOString(), updatedById: req.user?.id || null };
    const candidates = await prisma.industryRecord.findMany({ where: { tenantId: req.tenantId, recordType: "finance_budget" }, orderBy: { updatedAt: "desc" }, take: 1000 });
    const existing = candidates.find((record) => cleanText(financeRecordData(record).period) === period && cleanText(financeRecordData(record).category).toLocaleLowerCase("es") === category.toLocaleLowerCase("es"));
    const budget = existing
      ? await prisma.industryRecord.update({ where: { id: existing.id }, data: { title: `Presupuesto ${period} · ${category}`.slice(0, 220), status: "ACTIVE", data: { ...financeRecordData(existing), ...data } } })
      : await prisma.industryRecord.create({ data: { tenantId: req.tenantId, recordType: "finance_budget", title: `Presupuesto ${period} · ${category}`.slice(0, 220), status: "ACTIVE", data } });
    await recordAuditLog(req, existing ? "FINANCE_BUDGET_UPDATED" : "FINANCE_BUDGET_CREATED", "finance_budget", budget.id, { period, category, plannedIncome: data.plannedIncome, plannedExpense: data.plannedExpense });
    res.status(existing ? 200 : 201).json({ budget, planning: await getFinancePlanning({ tenantId: req.tenantId, period }) });
  } catch (error) {
    console.error("Finance budget save error:", error);
    res.status(500).json({ error: error instanceof Error ? error.message : "No se pudo guardar el presupuesto." });
  }
});

financeRouter.delete("/finance/budgets/:id", requireRole(ROLE_GROUPS.MANAGERS), async (req, res) => {
  try {
    if (!(await requireFinanceModule(req, res, MODULES.FINANCE_ANALYTICS))) return;
    const budget = await prisma.industryRecord.findFirst({ where: { id: req.params.id, tenantId: req.tenantId, recordType: "finance_budget" } });
    if (!budget) return res.status(404).json({ error: "Presupuesto no encontrado." });
    await prisma.industryRecord.delete({ where: { id: budget.id } });
    await recordAuditLog(req, "FINANCE_BUDGET_DELETED", "finance_budget", budget.id, { period: financeRecordData(budget).period, category: financeRecordData(budget).category });
    res.json({ ok: true });
  } catch (error) {
    console.error("Finance budget delete error:", error);
    res.status(500).json({ error: "No se pudo eliminar el presupuesto." });
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

// Devuelve únicamente capacidades de negocio, nunca secretos ni reglas
// internas. Sirve para que el frontend o soporte expliquen por qué una acción
// aparece deshabilitada sin inferir permisos desde la interfaz.
financeRouter.get("/finance/security/access", async (req, res) => {
  try {
    if (!(await requireFinanceModule(req, res, MODULES.FINANCE_ANALYTICS))) return;
    res.json({ role: req.user?.role || "VIEWER", capabilities: financeRoleCapabilities(req.user?.role) });
  } catch (error) {
    console.error("Finance security access error:", error);
    res.status(500).json({ error: "No se pudieron consultar los permisos financieros." });
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

financeRouter.patch("/finance/agents/policy", requireRole(ROLE_GROUPS.MANAGERS), requireFinancePermission(FINANCE_ACTIONS.CONFIGURE), async (req, res) => {
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

financeRouter.post("/finance/reconciliations/:movementId/approve", requireRole(ROLE_GROUPS.STAFF), requireFinancePermission(FINANCE_ACTIONS.APPROVE_RECONCILIATION), async (req, res) => {
  try {
    if (!(await requireFinanceModule(req, res, MODULES.FINANCE_RECONCILIATION))) return;
    const requestedInvoiceIds = [...new Set([
      cleanText(req.body?.invoiceId),
      ...(Array.isArray(req.body?.invoiceIds) ? req.body.invoiceIds.map((id) => cleanText(id)) : [])
    ].filter(Boolean))].slice(0, 3);
    if (!requestedInvoiceIds.length) return res.status(400).json({ error: "Selecciona al menos una factura para conciliar." });

    const [movement, invoices] = await Promise.all([
      prisma.industryRecord.findFirst({ where: { id: req.params.movementId, tenantId: req.tenantId, recordType: "bank_movement" } }),
      prisma.industryRecord.findMany({ where: { id: { in: requestedInvoiceIds }, tenantId: req.tenantId, recordType: "finance_invoice" } })
    ]);
    if (!movement || invoices.length !== requestedInvoiceIds.length) return res.status(404).json({ error: "Movimiento o factura no encontrados" });
    if (String(movement.status || "").toUpperCase() === "MATCHED") return res.status(409).json({ error: "Este movimiento ya fue conciliado" });

    const movementData = financeRecordData(movement);
    const movementKind = String(movementData.movementKind || "").toUpperCase();
    if (String(movementData.direction || "").toUpperCase() === "DEBIT" || ["COMMISSION_OR_FEE", "INTERNAL_TRANSFER"].includes(movementKind)) {
      return res.status(400).json({ error: "Este movimiento no es un abono externo conciliable contra cuentas por cobrar." });
    }
    const movementAmount = Math.abs(Number(financeRecordData(movement).amount || 0));
    if (!movementAmount) return res.status(400).json({ error: "El movimiento no tiene un monto conciliable." });
    const invoiceStates = invoices.map((invoice) => ({ invoice, state: getInvoiceFinancialState(invoice) }));
    const totalBalance = invoiceStates.reduce((sum, item) => sum + item.state.balance, 0);
    if (movementAmount > totalBalance + 1) {
      return res.status(400).json({ error: "El abono supera el saldo de los documentos seleccionados. Registra la diferencia como excepción antes de conciliar." });
    }
    if (invoices.length > 1 && Math.abs(totalBalance - movementAmount) > 1) {
      return res.status(400).json({ error: "Una conciliación agrupada debe cuadrar exactamente. Para pagos parciales confirma una sola factura o revisa la excepción." });
    }
    const suggestions = invoices.map((invoice) => scoreFinanceReconciliation(invoice, movement));
    const now = new Date();

    const result = await prisma.$transaction(async (tx) => {
      const created = await tx.industryRecord.create({
        data: {
          tenantId: req.tenantId,
          recordType: "finance_reconciliation",
          title: `${invoices.length > 1 ? `${invoices.length} documentos` : invoices[0].title} - ${movement.title}`.slice(0, 220),
          status: "APPROVED",
          data: {
            invoiceId: invoices.length === 1 ? invoices[0].id : null,
            invoiceIds: invoices.map((invoice) => invoice.id),
            movementId: movement.id,
            confidence: Math.min(...suggestions.map((suggestion) => suggestion.confidence)),
            matchReasons: suggestions.flatMap((suggestion) => suggestion.reasons),
            difference: Math.abs(totalBalance - movementAmount),
            reconciliationType: invoices.length > 1 ? "GROUPED_PAYMENT" : (movementAmount < totalBalance ? "PARTIAL_PAYMENT" : "EXACT_PAYMENT"),
            approvedAt: now.toISOString(),
            approvedById: req.user?.id || null
          }
        }
      });
      await tx.industryRecord.update({
        where: { id: movement.id },
        data: { status: "MATCHED", data: { ...movementData, status: "MATCHED", reconciliationId: created.id, reconciledAt: now.toISOString(), reconciledById: req.user?.id || null } }
      });
      const updatedInvoices = [];
      let remainingToApply = movementAmount;
      for (const { invoice, state } of invoiceStates) {
        const appliedAmount = Math.min(state.balance, remainingToApply);
        remainingToApply = Math.max(0, remainingToApply - appliedAmount);
        const remainingBalance = Math.max(0, state.balance - appliedAmount);
        const invoiceData = financeRecordData(invoice);
        const receipt = await tx.industryRecord.create({ data: {
          tenantId: req.tenantId, recordType: "finance_invoice_receipt",
          title: `Cobro conciliado ${invoiceData.invoiceNumber || invoice.title}`.slice(0, 220), status: "RECONCILED",
          data: { invoiceId: invoice.id, amount: appliedAmount, paymentDate: movementData.transactionDate || now.toISOString().slice(0, 10), reference: movementData.reference || null, movementId: movement.id, reconciliationId: created.id, source: "bank_reconciliation", registeredById: req.user?.id || null }
        } });
        const updated = await tx.industryRecord.update({
          where: { id: invoice.id },
          data: {
            status: remainingBalance === 0 ? "PAID" : "PARTIAL",
            data: {
              ...invoiceData,
              balance: remainingBalance,
              paidAmount: safeAmount(invoiceData.paidAmount) + appliedAmount,
              status: remainingBalance === 0 ? "PAID" : "PARTIAL",
              paidAt: remainingBalance === 0 ? now.toISOString() : invoiceData.paidAt || null,
              lastReconciliationId: created.id,
              history: [...financeHistory(invoiceData), { at: now.toISOString(), type: "BANK_RECONCILIATION_APPLIED", amount: appliedAmount, movementId: movement.id, reconciliationId: created.id, receiptId: receipt.id }]
            }
          }
        });
        updatedInvoices.push(updated);
      }
      return { reconciliation: created, invoices: updatedInvoices };
    });

    await recordAuditLog(req, "FINANCE_RECONCILIATION_APPROVED", "finance_reconciliation", result.reconciliation.id, { invoiceIds: invoices.map((invoice) => invoice.id), movementId: movement.id, grouped: invoices.length > 1 });
    res.status(201).json({ reconciliation: result.reconciliation, invoices: result.invoices, remainingBalance: Math.max(0, totalBalance - movementAmount), confidence: Math.min(...suggestions.map((suggestion) => suggestion.confidence)), reasons: suggestions.flatMap((suggestion) => suggestion.reasons) });
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
      if (state.status === "PAID" || existingInvoiceIds.has(invoice.id)) continue;
      const data = financeRecordData(invoice);
      const segment = financeAgingSegment(state.dueDate, now);
      const record = await prisma.industryRecord.create({
        data: {
          tenantId: req.tenantId,
          recordType: "finance_collection_case",
          title: `Cobranza ${data.invoiceNumber || invoice.title}`.slice(0, 220),
          status: segment.code === "POR_VENCER" ? "MONITORING" : "PENDING",
          data: {
            invoiceId: invoice.id,
            invoiceNumber: data.invoiceNumber || invoice.title,
            customerName: data.customerName || data.clientName || data.customer || "Cliente sin nombre",
            clientRut: data.clientRut || data.customerRut || data.rut || null,
            balance: state.balance,
            agingBucket: segment.label,
            agingCode: segment.code,
            daysPastDue: segment.daysPastDue,
            recommendedAction: segment.action,
            channel: "manual",
            nextActionAt: now.toISOString(),
            history: [{ at: now.toISOString(), type: "CASE_CREATED", detail: `${segment.action}. Caso preparado para revisión humana.` }]
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
