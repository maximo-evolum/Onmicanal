import { bankPeriodImpact, bankPeriodRestrictions, assertBankPeriodsOpen, deleteBankStatementInOpenPeriods } from "../services/finance-bank-periods.service.js";
import { closeFinancePeriod, reopenFinancePeriod, getFinancePeriodWorkspace } from "../services/finance-period-control.service.js";
import { applyFinanceAllocation, reverseFinanceAllocation, sendFinanceMovementToReview } from "../services/finance-allocation.service.js";
import { BANK_REVIEW_FIELDS, bankReviewColumns, normalizeBankReviewRows, bankReviewPage, validateBankReviewConfig, exportBankReviewCsv } from "../services/finance-bank-review.service.js";
import { ACTIVE_IMPORT_STATUSES, importJobView, createBankImportJob, analyzeBankImportJob, readBankImportPreview, getBankImportJob, cancelBankImportJob, bankImportConfirmation } from "../services/finance-import-jobs.service.js";
import { Router } from "express";
import { readMovementLedger, movementLedgerCsv } from "../services/finance-movement-ledger.service.js";
import { reviewMovementBatch } from "../services/finance-movement-bulk.service.js";
import { movementLedgerExcel } from "../services/finance-movement-excel.service.js";
import { readMovementTrace } from "../services/finance-movement-trace.service.js";
import { assignMovementOwner, listMovementOwners } from "../services/finance-movement-owner.service.js";
import { overviewMetricsCsv } from "../services/finance-overview-metrics.service.js";
import { financeDocumentSide, financeParty, financeDocumentDate, financeDocumentAmounts } from "../services/finance-document-values.service.js";
import multer from "multer";
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
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
  getInvoiceFinancialState
} from "../services/finance.service.js";
import { getFinanceAgentWorkspace, prepareFinanceAgentExceptions, updateFinanceAgentPolicy } from "../services/finance-agents.service.js";
import { generateFinanceCollectionCases } from "../services/finance-agent-actions.service.js";
import { updateCollectionCase, updateFinanceExceptionCase, prepareCollectionReminders, createAdministrativeException, collectionPartyKey, isCollectionCustomerInvoice } from "../services/finance-case-actions.service.js";
import { recordAuditLog } from "../lib/audit.js";
import { createTenantNotification } from "../lib/notifications.js";
import {
  downloadNuboxSaleFile,
  financeSyncHistory,
  getNuboxSale,
  getNuboxSaleDetails,
  getNuboxSaleReferences,
  issueNuboxSales,
  syncNuboxHistoryForTenant,
  syncNuboxForTenant
} from "../services/finance-sync.service.js";
import { MAX_MIGRATION_FILE_BYTES, MAX_MIGRATION_ROWS, historicalFinanceFingerprint, normalizeHistoricalFinanceRows, readHistoricalFinanceFile, summarizeHistoricalFinanceRows } from "../services/finance-migration.service.js";
import {
  MAX_BANK_STATEMENT_FILE_BYTES,
  MAX_BANK_STATEMENT_ROWS,
  bankMovementFingerprint,
  detectBankStatementInstitution,
  detectBankStatementFileFormat,
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
import { createFloidConsentCase } from "../services/finance-floid.service.js";
import { importFloidBankMovements } from "../services/finance-external-imports.service.js";
import { getFinancePlanning, validPlanningPeriod } from "../services/finance-planning.service.js";
import { canPerformFinanceAction, FINANCE_ACTIONS, financeRoleCapabilities } from "../services/finance-security.service.js";

import { FinanceOperationError, withFinanceWrite, findAllFinanceRecords } from "../services/finance-integrity.service.js";

import { parseFinanceContext, buildFinanceContextCoverage, loadFinanceContextRecords, filterFinanceContext, restrictFinanceCoverage } from "../services/finance-context.service.js";

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

function bankStatementFileFingerprint(buffer) {
  return buffer?.length ? createHash("sha256").update(buffer).digest("hex") : "";
}

function isReprocessableEmptyBankStatement(existingBatch) {
  if (!existingBatch) return false;
  const data = financeRecordData(existingBatch);
  return Number(data.importedRows || 0) === 0 && Number(data.reviewRows || 0) > 0;
}

function bankStatementDuplicatePayload({ sourceFile, totalRows, validRows, duplicateRows, existingBatch = null, reprocessable = false }) {
  const data = existingBatch ? financeRecordData(existingBatch) : {};
  const existingSourceFile = cleanText(data.sourceFile || existingBatch?.title, "una cartola anterior");
  const importedAt = cleanText(data.importedAt || existingBatch?.createdAt);
  const byFile = Boolean(existingBatch);
  return {
    blocked: !reprocessable && (byFile || (validRows > 0 && duplicateRows >= validRows)),
    reason: reprocessable ? "REPROCESSABLE_EMPTY_IMPORT" : byFile ? "FILE_ALREADY_IMPORTED" : "MOVEMENTS_ALREADY_IMPORTED",
    sourceFile,
    existingSourceFile,
    importedAt: importedAt || null,
    totalRows,
    validRows,
    duplicateRows,
    message: reprocessable
      ? `La cartola ${sourceFile} tuvo una carga anterior sin movimientos válidos. Puedes reprocesarla con el lector actualizado.`
      : byFile
      ? `La cartola ${sourceFile} ya fue incorporada anteriormente como ${existingSourceFile}.`
      : `Todos los movimientos válidos de ${sourceFile} ya existen en Finance OS.`
  };
}
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
    where: { recordType: "finance_open_banking_consent", data: { path: ["caseId"], equals: caseId } },
    take: 2
  });
  if (candidates.length > 1) throw new FinanceOperationError(409, "Consentimiento ambiguo; requiere revisión.");
  return candidates[0] || null;
}

async function importFloidMovements({ tenantId, consent, payload }) {
  return importFloidBankMovements(prisma, { tenantId, consentId: consent.id, payload });
}

function financeHistory(data) {
  return Array.isArray(data?.history) ? data.history : [];
}



function safeAmount(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

function payableState(record, now = new Date()) {
  return getInvoiceFinancialState(record, now);
}

function financeDocumentCoverage(documents) {
  const bySide = { CUSTOMER: [], SUPPLIER: [] };
  for (const document of documents) {
    if (bySide[document.side]) bySide[document.side].push(document);
  }
  const summarize = (items) => {
    const dates = items
      .map((item) => new Date(item.issueDate || item.createdAt))
      .filter((date) => !Number.isNaN(date.getTime()))
      .sort((a, b) => a.getTime() - b.getTime());
    const bySource = {};
    for (const item of items) {
      const source = cleanText(item.source, "registro manual");
      bySource[source] = (bySource[source] || 0) + 1;
    }
    return {
      total: items.length,
      oldestIssueDate: dates[0]?.toISOString() || null,
      newestIssueDate: dates.at(-1)?.toISOString() || null,
      sources: bySource
    };
  };
  return { customers: summarize(bySide.CUSTOMER), suppliers: summarize(bySide.SUPPLIER) };
}

function financePartyKey({ name, rut }) {
  return collectionPartyKey({ name, rut });
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


financeRouter.get("/finance/workspace-context", async (req, res) => {
  try {
    if (!(await requireFinanceModule(req, res, MODULES.FINANCE_ANALYTICS))) return;
    const context = parseFinanceContext(req.query);
    const [movements, customers, suppliers] = await Promise.all([MODULES.FINANCE_BANK_SYNC, MODULES.FINANCE_INVOICES, MODULES.FINANCE_PAYABLES].map((module) => req.user?.role === "SUPER_ADMIN" ? true : ensureTenantModuleEligibility({ tenantId: req.tenantId, module, tenant: req.tenant })));
    if (context.accountKey && !movements) return res.status(403).json({ error: "No tienes acceso a cuentas bancarias en esta empresa." });
    const records = await loadFinanceContextRecords(prisma, req.tenantId);
    res.json({ ...restrictFinanceCoverage(buildFinanceContextCoverage(records, context), { movements, customers, suppliers }), company: { id: req.tenantId, name: req.tenant?.name || "Empresa actual" } });
  } catch (error) {
    res.status(error instanceof FinanceOperationError ? error.status : 500).json({ error: error instanceof FinanceOperationError ? error.message : "No se pudo verificar la cobertura de datos." });
  }
});

financeRouter.get("/finance/workspace-records", requireRole(ROLE_GROUPS.STAFF), async (req, res) => {
  try {
    const type = cleanText(req.query.type);
    if (!["bank_movement", "finance_exception", "finance_collection_case"].includes(type)) return res.status(400).json({ error: "Tipo de consulta no permitido." });
    const module = type === "bank_movement" ? MODULES.FINANCE_BANK_SYNC : type === "finance_collection_case" ? MODULES.FINANCE_COLLECTIONS : MODULES.FINANCE_EXCEPTIONS;
    if (!(await requireFinanceModule(req, res, module))) return;
    const context = parseFinanceContext(req.query);
    const records = await loadFinanceContextRecords(prisma, req.tenantId);
    res.json({ records: filterFinanceContext(records, context).filter((record) => record.recordType === type) });
  } catch (error) {
    res.status(error instanceof FinanceOperationError ? error.status : 500).json({ error: error instanceof FinanceOperationError ? error.message : "No se pudieron cargar los registros del período." });
  }
});

financeRouter.get("/finance/overview", async (req, res) => {
  try {
    if (!(await requireFinanceModule(req, res, MODULES.FINANCE_ANALYTICS))) return;
    const overview = await getFinanceOverview({ tenantId: req.tenantId, context: parseFinanceContext(req.query) });
    if (req.query.export === "csv") return res.set({ "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="indicadores-financieros.csv"', "Cache-Control": "no-store" }).send(overviewMetricsCsv(overview, req.tenantId));
    res.set("Cache-Control", "no-store").json(overview);
  } catch (error) {
    if (error instanceof FinanceOperationError) return res.status(error.status).json({ error: error.message });
    console.error("Finance overview error:", error);
    res.status(500).json({ error: "No se pudo cargar el dashboard financiero" });
  }
});

financeRouter.get("/finance/movement-ledger", requireRole(ROLE_GROUPS.STAFF), async (req, res) => {
  try {
    if (!(await requireFinanceModule(req, res, MODULES.FINANCE_BANK_SYNC))) return;
    const exporting = ["csv", "xlsx"].includes(req.query.export);
    const reconciliationAccess = req.user?.role === "SUPER_ADMIN" || await ensureTenantModuleEligibility({ tenantId: req.tenantId, module: MODULES.FINANCE_RECONCILIATION, tenant: req.tenant });
    const result = await readMovementLedger(prisma, req.tenantId, req.query, { all: exporting, reconciliationAccess });
    if (req.query.export === "xlsx") return res.set({ "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": 'attachment; filename="movimientos-financieros.xlsx"', "Cache-Control": "no-store" }).send(await movementLedgerExcel(result, req.query));
    if (exporting) return res.set({ "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="movimientos-financieros.csv"', "Cache-Control": "no-store" }).send(movementLedgerCsv(result));
    res.set("Cache-Control", "no-store").json(result);
  } catch (error) {
    if (error instanceof FinanceOperationError) return res.status(error.status).json({ error: error.message });
    console.error("Finance movement ledger error", error);
    res.status(500).json({ error: "No se pudieron consultar los movimientos completos." });
  }
});

financeRouter.post("/finance/movement-ledger/review", requireRole(ROLE_GROUPS.MANAGERS), requireFinancePermission(FINANCE_ACTIONS.APPROVE_RECONCILIATION), async (req, res) => {
  try {
    if (!(await requireFinanceModule(req, res, MODULES.FINANCE_BANK_SYNC)) || !(await requireFinanceModule(req, res, MODULES.FINANCE_RECONCILIATION))) return;
    res.json(await reviewMovementBatch(prisma, { ...req.body, tenantId: req.tenantId, userId: req.user?.id }));
  } catch (error) {
    if (error instanceof FinanceOperationError) return res.status(error.status).json({ error: error.message });
    res.status(500).json({ error: "No se pudo procesar el lote de revisión." });
  }
});

financeRouter.get("/finance/movement-owners", requireRole(ROLE_GROUPS.STAFF), async (req, res) => {
  try {
    if (!(await requireFinanceModule(req, res, MODULES.FINANCE_BANK_SYNC))) return;
    res.set("Cache-Control", "no-store").json({ users: await listMovementOwners(prisma, req.tenantId) });
  } catch { res.status(500).json({ error: "No se pudo consultar el personal de la empresa." }); }
});

financeRouter.post("/finance/movement-ledger/:id/owner", requireRole(ROLE_GROUPS.MANAGERS), requireFinancePermission(FINANCE_ACTIONS.CONFIGURE), async (req, res) => {
  try {
    if (!(await requireFinanceModule(req, res, MODULES.FINANCE_BANK_SYNC))) return;
    res.set("Cache-Control", "no-store").json(await assignMovementOwner(prisma, { tenantId: req.tenantId, userId: req.user.id, role: req.user.role, movementId: req.params.id, assignedToId: req.body?.assignedToId, expectedVersion: req.body?.expectedVersion, reason: req.body?.reason, operationKey: req.body?.operationKey }));
  } catch (error) {
    if (error instanceof FinanceOperationError) return res.status(error.status).json({ error: error.message });
    res.status(500).json({ error: "No se pudo confirmar la asignación. Reintenta sin cambiar los datos." });
  }
});

financeRouter.get("/finance/movement-ledger/:id/history", requireRole(ROLE_GROUPS.STAFF), async (req, res) => {
  try {
    if (!(await requireFinanceModule(req, res, MODULES.FINANCE_BANK_SYNC))) return;
    const allowed = async (module) => req.user?.role === "SUPER_ADMIN" || await ensureTenantModuleEligibility({ tenantId: req.tenantId, module, tenant: req.tenant });
    const access = { invoices: await allowed(MODULES.FINANCE_INVOICES), reconciliation: await allowed(MODULES.FINANCE_RECONCILIATION), exceptions: await allowed(MODULES.FINANCE_EXCEPTIONS) };
    res.set("Cache-Control", "no-store").json(await readMovementTrace(prisma, { tenantId: req.tenantId, movementId: req.params.id, access, cursor: req.query.cursor ? String(req.query.cursor) : undefined }));
  } catch (error) {
    if (error instanceof FinanceOperationError) return res.status(error.status).json({ error: error.message });
    console.error("Movement history error", error);
    res.status(500).json({ error: "No se pudo consultar el historial del movimiento." });
  }
});

financeRouter.get("/finance/customers", async (req, res) => {
  try {
    if (!(await requireFinanceModule(req, res, MODULES.FINANCE_INVOICES))) return;
    const invoices = await findAllFinanceRecords(prisma, { where: { tenantId: req.tenantId, recordType: "finance_invoice" }, orderBy: { updatedAt: "desc" } });
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
    const records = await findAllFinanceRecords(prisma, {
      where: { tenantId: req.tenantId, recordType: { in: recordTypes } },
      orderBy: { createdAt: "desc" },
      take: 1000
    });
    const context = parseFinanceContext(req.query);
    const allDocuments = filterFinanceContext(records, context).filter((r) => includePayables || financeDocumentSide(r) !== "SUPPLIER").map((record) => {
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
        issueDate: financeDocumentDate(record) || null,
        dueDate: data.dueDate || null,
        documentType: cleanText(data.documentType || data.documentTypeName, party.side === "SUPPLIER" ? "Documento de proveedor" : "Factura de cliente"),
        documentTypeCode: cleanText(data.documentTypeCode) || null,
        netAmount: safeAmount(data.netAmount),
        vatAmount: safeAmount(data.vatAmount),
        totalAmount: state.originalAmount,
        currency: cleanText(data.currency, "CLP"),
        paymentMethod: cleanText(data.paymentMethod) || null,
        paymentIntermediary: cleanText(data.paymentIntermediary) || null,
        commissionAmount: safeAmount(data.commissionAmount),
        settlementReference: cleanText(data.settlementReference) || null,
        creditNotesTotal: state.creditNotes,
        debitNotesTotal: state.debitNotes,
        referenceDocumentType: cleanText(data.referenceDocumentType) || null,
        referenceDocumentNumber: cleanText(data.referenceDocumentNumber) || null,
        referenceDocumentDate: data.referenceDocumentDate || null,
        amount: state.amount,
        balance: state.balance,
        paidAmount: state.paidAmount,
        includedInTotals: state.included,
        qualityIssues: state.qualityIssues,
        ...financeDocumentAmounts(record, now),
        nuboxDocument: cleanText(data.source).toLowerCase() === "nubox" && Boolean(cleanText(data.nuboxDocumentId)),
        source: cleanText(data.source, "registro manual"),
        createdAt: record.createdAt,
        updatedAt: record.updatedAt
      };
    });
    const coverage = financeDocumentCoverage(allDocuments);
    const documents = allDocuments
      .filter((document) => requestedType === "all" || (requestedType === "customers" ? document.side === "CUSTOMER" : document.side === "SUPPLIER"))
      .sort((left, right) => new Date(right.issueDate).getTime() - new Date(left.issueDate).getTime());
    res.json({ documents, coverage });
  } catch (error) {
    if (error instanceof FinanceOperationError) return res.status(error.status).json({ error: error.message });
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
      findAllFinanceRecords(prisma, { where: { tenantId: req.tenantId, recordType: "finance_invoice" }, orderBy: { updatedAt: "desc" } }),
      findAllFinanceRecords(prisma, { where: { tenantId: req.tenantId, recordType: "finance_collection_case" }, orderBy: { updatedAt: "desc" } })
    ]);
    const now = new Date();
    const rows = new Map();
    for (const invoice of invoices) {
      if (!isCollectionCustomerInvoice(invoice)) continue;
      const data = financeRecordData(invoice);
      const party = financeParty(invoice);
      const key = financePartyKey(party);
      const state = invoiceState(invoice, now);
      if (!state.included) continue;
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
      const party = { name: cleanText(data.customerName || data.customer || data.clientName, "Cliente sin nombre"), rut: cleanText(data.clientRut || data.customerRut || data.rut) || null };
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
    const result = await registerManualSettlement(prisma, { tenantId: req.tenantId, userId: req.user?.id, documentId: req.params.id, kind: "RECEIPT",
      amount: req.body?.amount, paymentDate: req.body?.paymentDate, reference: req.body?.reference, idempotencyKey: req.body?.idempotencyKey });
    res.status(result.replayed ? 200 : 201).json(result);
  } catch (error) {
    if (error instanceof FinanceOperationError) return res.status(error.status).json({ error: error.message });
    console.error("Register manual receipt error:", error);
    res.status(500).json({ error: "No se pudo registrar el cobro. Puedes reintentar la misma operación sin duplicarla." });
  }
});

// Prepara un borrador interno de recordatorio. El envío siempre queda fuera de
// esta ruta y requiere canal, consentimiento y aprobación posterior.
financeRouter.post("/finance/collections/portfolio/:partyKey/reminders", requireRole(ROLE_GROUPS.STAFF), requireFinancePermission(FINANCE_ACTIONS.PREPARE), async (req, res) => {
  try {
    if (!(await requireFinanceModule(req, res, MODULES.FINANCE_COLLECTIONS))) return;
    const result = await prepareCollectionReminders(prisma, { tenantId: req.tenantId, userId: req.user?.id, partyKey: cleanText(req.params.partyKey) });
    res.status(result.replayed ? 200 : 201).json(result);
  } catch (error) {
    if (error instanceof FinanceOperationError) return res.status(error.status).json({ error: error.message });
    console.error("Prepare finance collection reminders error:", error);
    res.status(500).json({ error: "No se pudieron preparar los recordatorios." });
  }
});

financeRouter.get("/finance/payables/summary", async (req, res) => {
  try {
    if (!(await requireFinanceModule(req, res, MODULES.FINANCE_PAYABLES))) return;
    const payables = await findAllFinanceRecords(prisma, {
      where: { tenantId: req.tenantId, recordType: "finance_payable" },
      orderBy: { updatedAt: "desc" }
    });
    const now = new Date();
    const summary = payables.reduce((total, record) => {
      const state = payableState(record, now);
      if (!state.included) return total;
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
    const result = await registerManualSettlement(prisma, { tenantId: req.tenantId, userId: req.user?.id, documentId: req.params.id, kind: "PAYMENT",
      amount: req.body?.amount, paymentDate: req.body?.paymentDate, reference: req.body?.reference, idempotencyKey: req.body?.idempotencyKey });
    res.status(result.replayed ? 200 : 201).json(result);
  } catch (error) {
    if (error instanceof FinanceOperationError) return res.status(error.status).json({ error: error.message });
    console.error("Register manual payment error:", error);
    res.status(500).json({ error: "No se pudo registrar el pago. Puedes reintentar la misma operación sin duplicarla." });
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
      sourceRows: req.body.rows,
      periodProtection: await documentImportRestrictions(prisma, req.tenantId, rows)
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
      sourceRows,
      periodProtection: await documentImportRestrictions(prisma, req.tenantId, rows)
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo leer el archivo de migración.";
    res.status(400).json({ error: message });
  }
});

financeRouter.post("/finance/migrations/import", requireRole(ROLE_GROUPS.MANAGERS), requireFinancePermission(FINANCE_ACTIONS.IMPORT_HISTORY), async (req, res) => {
  try {
    if (!(await requireFinanceModule(req, res, MODULES.FINANCE_MIGRATION))) return;
    res.status(201).json(await importHistoricalDocuments(prisma, { tenantId: req.tenantId, userId: req.user?.id, sourceFile: req.body?.sourceFile, rows: req.body?.rows }));
  } catch (error) {
    if (error instanceof FinanceOperationError || error?.status) return res.status(error.status).json({ error: error.message, ...error.details });
    console.error("Financial document import error:", error);
    res.status(500).json({ error: "No se pudo incorporar el lote. No se confirmaron cambios parciales." });
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
      supportedFormats: ["CSV", "TXT delimitado", "XLSX/XLSM", "Excel XML/HTML", "PDF con texto"],
      maxRows: MAX_BANK_STATEMENT_ROWS,
      note: "Puedes importar cartolas exportadas por cualquier banco del catálogo CMF. Los PDF deben contener texto seleccionable; una cartola escaneada se deriva a revisión humana. La conexión automática por API depende de la autorización de cada banco."
    });
  } catch (error) {
    console.error("Finance bank catalog error:", error);
    res.status(500).json({ error: "No se pudo obtener el catálogo bancario." });
  }
});

async function analyzeStoredBankStatement({ file, account, reviewConfig = {}, tenantId }) {
    const format = detectBankStatementFileFormat(file);
    const sourceRows = await readBankStatementFile(file);
    const bankDetection = await detectBankStatementInstitution(file, sourceRows);
    const allRows = normalizeBankReviewRows(sourceRows, {
      ...(account || {}),
      bankKey: bankDetection.institution?.key || cleanText(account?.bankKey)
    }, reviewConfig);
    const rows = allRows.filter((row) => !row.excluded);
    if (!rows.length) throw new FinanceOperationError(400, "No hay movimientos incluidos. Cancela la carga si deseas excluir toda la cartola.");
    const sourceFile = cleanText(file?.originalname, "cartola-bancaria");
    const fileFingerprint = bankStatementFileFingerprint(file?.buffer);
    const [existingBatches, existingMovements] = await Promise.all([
      findAllFinanceRecords(prisma, { where: { tenantId: tenantId, recordType: "bank_statement" }, select: { id: true, title: true, createdAt: true, data: true }, orderBy: { createdAt: "desc" }, take: 2000 }),
      findAllFinanceRecords(prisma, { where: { tenantId: tenantId, recordType: "bank_movement" }, select: { id: true, data: true }, orderBy: { createdAt: "desc" }, take: 10000 })
    ]);
    const existingBatch = existingBatches.find((record) => cleanText(financeRecordData(record).fileFingerprint) === fileFingerprint) || null;
    const knownFingerprints = new Set(existingMovements.map((record) => {
      const data = financeRecordData(record);
      return cleanText(data.fingerprint) || bankMovementFingerprint(data);
    }).filter(Boolean));
    const seen = new Set();
    for (const row of allRows) {
      row.duplicate = !row.excluded && !row.needsReview && (knownFingerprints.has(row.fingerprint) || seen.has(row.fingerprint));
      if (!row.excluded && !row.needsReview) seen.add(row.fingerprint);
    }
    const validRows = rows.filter((row) => !row.needsReview);
    const duplicateRows = validRows.filter((row) => knownFingerprints.has(row.fingerprint)).length;
    const reprocessable = isReprocessableEmptyBankStatement(existingBatch);
    const duplicate = (existingBatch || (validRows.length && duplicateRows >= validRows.length))
      ? bankStatementDuplicatePayload({ sourceFile, totalRows: rows.length, validRows: validRows.length, duplicateRows, existingBatch, reprocessable })
      : null;
    const summary = withBankStatementNet(summarizeBankStatementRows(rows));
    return {
      sourceFile,
      detectedFormat: format.label,
      conversion: format.conversion,
      bankDetection: {
        detected: Boolean(bankDetection.institution),
        method: bankDetection.method,
        message: bankDetection.institution
          ? `Banco identificado automáticamente: ${bankDetection.institution.name}.`
          : "No se pudo identificar el banco desde el archivo. Selecciónalo sólo para esta cartola antes de incorporarla."
      },
      fileFingerprint,
      maxRows: MAX_BANK_STATEMENT_ROWS,
      account: { bank: rows[0].bank, bankKey: rows[0].bankKey, cmfCode: rows[0].cmfCode, accountAlias: rows[0].accountAlias, accountType: rows[0].accountType, accountLast4: rows[0].accountLast4 },
      summary,
      reviewConfig: validateBankReviewConfig(reviewConfig, bankReviewColumns(sourceRows), sourceRows.length),
      columns: bankReviewColumns(sourceRows),
      fields: BANK_REVIEW_FIELDS.map(({ key, label }) => ({ key, label })),
      totalSourceRows: sourceRows.length,
      excludedRows: allRows.length - rows.length,
      normalizedRows: allRows,
      periodRange: { from: rows.map((row) => row.transactionDate).filter(Boolean).sort()[0] || null, to: rows.map((row) => row.transactionDate).filter(Boolean).sort().at(-1) || null },
      duplicate,
      rows: rows.slice(0, 100),
      sourceRows: sourceRows.slice(0, MAX_BANK_STATEMENT_ROWS)
    };
}

function bankImportError(res, error) {
  const status = error instanceof FinanceOperationError ? error.status : 500;
  if (status === 500) console.error("Bank import job error:", error);
  return res.status(status).json({ error: status === 500 ? "No se pudo acceder a la importación guardada. Comprueba la migración y vuelve a intentarlo." : error.message, ...(error.details || {}) });
}

async function bankPreviewForClient(preview, tenantId) {
  if (!preview) return null;
  const { normalizedRows: _normalized, sourceRows: _source, ...summary } = preview;
  // Raw rows stay on the server. The UI queries the immutable revision in pages.
  const rows = (preview.normalizedRows || normalizeBankReviewRows(preview.sourceRows, preview.account, preview.reviewConfig || {})).filter((row) => !row.excluded);
  return { ...summary, sourceRows: [], periodProtection: await bankPeriodRestrictions(prisma, tenantId, rows) };
}

financeRouter.post("/finance/bank-statements/preview-file", requireRole(ROLE_GROUPS.MANAGERS), requireFinancePermission(FINANCE_ACTIONS.IMPORT_HISTORY), bankStatementUpload.single("file"), async (req, res) => {
  try {
    if (!(await requireFinanceModule(req, res, MODULES.FINANCE_BANK_SYNC))) return;
    const job = await createBankImportJob(prisma, { tenantId: req.tenantId, userId: req.user?.id, file: req.file, account: req.body });
    if (job.status === "READY") return res.json(await bankPreviewForClient((await readBankImportPreview(prisma, req.tenantId, job.id)).preview, req.tenantId));
    res.json(await bankPreviewForClient(await analyzeBankImportJob(prisma, { tenantId: req.tenantId, id: job.id, analyze: analyzeStoredBankStatement }), req.tenantId));
  } catch (error) { bankImportError(res, error); }
});

financeRouter.get("/finance/bank-import-jobs", requireRole(ROLE_GROUPS.STAFF), async (req, res) => {
  try {
    if (!(await requireFinanceModule(req, res, MODULES.FINANCE_BANK_SYNC))) return;
    if (!req.tenantId) throw new FinanceOperationError(403, "No se pudo determinar la empresa de la sesión.");
    const cursor = cleanText(req.query.cursor);
    if (cursor) await getBankImportJob(prisma, req.tenantId, cursor);
    const jobs = await prisma.financeBankImportJob.findMany({
      where: { tenantId: req.tenantId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 21, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {})
    });
    res.json({ jobs: jobs.slice(0, 20).map((job) => importJobView(job)), nextCursor: jobs.length > 20 ? jobs[19].id : null });
  } catch (error) { bankImportError(res, error); }
});

financeRouter.get("/finance/bank-import-jobs/:id", requireRole(ROLE_GROUPS.MANAGERS), async (req, res) => {
  try {
    if (!(await requireFinanceModule(req, res, MODULES.FINANCE_BANK_SYNC))) return;
    const result = await readBankImportPreview(prisma, req.tenantId, req.params.id);
    res.json({ ...result, preview: await bankPreviewForClient(result.preview, req.tenantId) });
  } catch (error) { bankImportError(res, error); }
});

financeRouter.get("/finance/bank-import-jobs/:id/rows", requireRole(ROLE_GROUPS.MANAGERS), async (req, res) => {
  try {
    if (!(await requireFinanceModule(req, res, MODULES.FINANCE_BANK_SYNC))) return;
    const { preview, job } = await readBankImportPreview(prisma, req.tenantId, req.params.id);
    if (!preview || !["READY", "IMPORTED"].includes(job.status)) throw new FinanceOperationError(409, "La importación no tiene una revisión disponible.");
    res.json(bankReviewPage(preview, req.query));
  } catch (error) { bankImportError(res, error); }
});

financeRouter.get("/finance/bank-import-jobs/:id/export", requireRole(ROLE_GROUPS.MANAGERS), async (req, res) => {
  try {
    if (!(await requireFinanceModule(req, res, MODULES.FINANCE_BANK_SYNC))) return;
    const { preview, job } = await readBankImportPreview(prisma, req.tenantId, req.params.id);
    if (!preview || !["READY", "IMPORTED"].includes(job.status)) throw new FinanceOperationError(409, "No hay una revisión disponible.");
    res.setHeader("Cache-Control", "private, no-store");
    res.attachment(`revision-cartola-${job.revision}.csv`);
    res.type("text/csv").send(exportBankReviewCsv(preview, req.query));
  } catch (error) { bankImportError(res, error); }
});

financeRouter.get("/finance/bank-mapping-templates", requireRole(ROLE_GROUPS.MANAGERS), async (req, res) => {
  try {
    if (!(await requireFinanceModule(req, res, MODULES.FINANCE_BANK_SYNC))) return;
    if (!req.tenantId) throw new FinanceOperationError(403, "Falta empresa en la sesión.");
    const templates = await prisma.financeBankMappingTemplate.findMany({ where: { tenantId: req.tenantId }, orderBy: [{ bankKey: "asc" }, { name: "asc" }] });
    res.json({ templates });
  } catch (error) { bankImportError(res, error); }
});

financeRouter.post("/finance/bank-mapping-templates", requireRole(ROLE_GROUPS.MANAGERS), requireFinancePermission(FINANCE_ACTIONS.IMPORT_HISTORY), async (req, res) => {
  try {
    if (!(await requireFinanceModule(req, res, MODULES.FINANCE_BANK_SYNC))) return;
    const name = cleanText(req.body?.name).slice(0, 100);
    if (name.length < 3) throw new FinanceOperationError(400, "Pon un nombre de al menos tres caracteres a la plantilla.");
    const template = await withFinanceWrite(prisma, async (tx) => {
      const { job, preview } = await bankImportConfirmation(tx, req.tenantId, req.body?.jobId, req.body?.revision);
      if (!preview || job.status !== "READY") throw new FinanceOperationError(409, "Guarda la plantilla antes de incorporar la cartola.");
      if (!preview.account?.bankKey || !Object.keys(preview.reviewConfig?.mapping || {}).length) throw new FinanceOperationError(400, "Confirma el banco y asigna al menos una columna antes de guardar la plantilla.");
      if (await tx.financeBankMappingTemplate.count({ where: { tenantId: req.tenantId } }) >= 100) throw new FinanceOperationError(409, "Se alcanzó el máximo de 100 plantillas. Elimina alguna que ya no uses.");
      return tx.financeBankMappingTemplate.create({ data: { tenantId: req.tenantId, name, bankKey: preview.account.bankKey, mapping: preview.reviewConfig.mapping, columns: preview.columns, createdById: req.user?.id || null } });
    });
    res.status(201).json({ template });
  } catch (error) {
    if (error?.code === "P2002") return res.status(409).json({ error: "Ya existe una plantilla con ese nombre para este banco. Usa otro nombre." });
    bankImportError(res, error);
  }
});

financeRouter.delete("/finance/bank-mapping-templates/:id", requireRole(ROLE_GROUPS.MANAGERS), requireFinancePermission(FINANCE_ACTIONS.IMPORT_HISTORY), async (req, res) => {
  try {
    if (!(await requireFinanceModule(req, res, MODULES.FINANCE_BANK_SYNC))) return;
    if (!req.tenantId) throw new FinanceOperationError(403, "Falta empresa en la sesión.");
    const deleted = await prisma.financeBankMappingTemplate.deleteMany({ where: { id: req.params.id, tenantId: req.tenantId } });
    if (!deleted.count) throw new FinanceOperationError(404, "No se encontró la plantilla.");
    res.json({ ok: true });
  } catch (error) { bankImportError(res, error); }
});

financeRouter.post("/finance/bank-import-jobs/:id/reanalyze", requireRole(ROLE_GROUPS.MANAGERS), requireFinancePermission(FINANCE_ACTIONS.IMPORT_HISTORY), async (req, res) => {
  try {
    if (!(await requireFinanceModule(req, res, MODULES.FINANCE_BANK_SYNC))) return;
    res.json(await bankPreviewForClient(await analyzeBankImportJob(prisma, { tenantId: req.tenantId, id: req.params.id, account: req.body?.account, reviewConfig: req.body?.reviewConfig, expectedRevision: req.body?.revision, analyze: analyzeStoredBankStatement }), req.tenantId));
  } catch (error) { bankImportError(res, error); }
});

financeRouter.post("/finance/bank-import-jobs/:id/cancel", requireRole(ROLE_GROUPS.MANAGERS), requireFinancePermission(FINANCE_ACTIONS.IMPORT_HISTORY), async (req, res) => {
  try {
    if (!(await requireFinanceModule(req, res, MODULES.FINANCE_BANK_SYNC))) return;
    const job = await cancelBankImportJob(prisma, req.tenantId, req.params.id);
    await recordAuditLog(req, "FINANCE_BANK_IMPORT_CANCELLED", "bank_import_job", job.id, {});
    res.json({ job: importJobView(job) });
  } catch (error) { bankImportError(res, error); }
});

financeRouter.get("/finance/bank-import-jobs/:id/original", requireRole(ROLE_GROUPS.STAFF), async (req, res) => {
  try {
    if (!(await requireFinanceModule(req, res, MODULES.FINANCE_BANK_SYNC))) return;
    const job = await getBankImportJob(prisma, req.tenantId, req.params.id, { original: true });
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.attachment(job.sourceFile);
    res.type("application/octet-stream");
    res.send(Buffer.from(job.original.content));
  } catch (error) { bankImportError(res, error); }
});

financeRouter.post("/finance/bank-statements/import", requireRole(ROLE_GROUPS.MANAGERS), requireFinancePermission(FINANCE_ACTIONS.IMPORT_HISTORY), async (req, res) => {
  try {
    if (!(await requireFinanceModule(req, res, MODULES.FINANCE_BANK_SYNC))) return;
    const { result, duplicateRows, summary } = await withFinanceWrite(prisma, async (tx) => {
    const confirmation = await bankImportConfirmation(tx, req.tenantId, req.body?.jobId, req.body?.revision);
    const job = confirmation.job;
    if (confirmation.batch) {
      const batch = confirmation.batch;
      const data = financeRecordData(batch);
      return { result: { batch, imported: Number(data.importedRows || 0), requiresReview: Number(data.reviewRows || 0) }, duplicateRows: Number(data.duplicateRows || 0), summary: data.summary };
    }
    const preview = confirmation.preview;
    if (!cleanText(preview.account?.bankKey)) throw new FinanceOperationError(400, "Selecciona el banco en la revisión antes de incorporar la cartola.");
    const rows = normalizeBankReviewRows(preview.sourceRows, preview.account, preview.reviewConfig || {}).filter((row) => !row.excluded);
    if (!rows.length) throw new FinanceOperationError(400, "No se detectaron movimientos para importar.");
    const sourceFile = job.sourceFile;
    const fileFingerprint = preview.fileFingerprint;
    const summary = withBankStatementNet(summarizeBankStatementRows(rows));
    const [existingMovements, existingBatches] = await Promise.all([
      findAllFinanceRecords(tx, { where: { tenantId: req.tenantId, recordType: "bank_movement" }, select: { id: true, data: true }, take: 10000, orderBy: { createdAt: "desc" } }),
      fileFingerprint ? findAllFinanceRecords(tx, { where: { tenantId: req.tenantId, recordType: "bank_statement" }, select: { id: true, title: true, createdAt: true, data: true }, take: 2000, orderBy: { createdAt: "desc" } }) : Promise.resolve([])
    ]);
    const existingBatch = fileFingerprint ? existingBatches.find((record) => cleanText(financeRecordData(record).fileFingerprint) === fileFingerprint) || null : null;
    const reprocessable = isReprocessableEmptyBankStatement(existingBatch);
    if (existingBatch && !reprocessable) {
      { const failure = { error: `La cartola ${sourceFile} ya fue importada anteriormente.`, duplicateCartola: bankStatementDuplicatePayload({ sourceFile, totalRows: rows.length, validRows: rows.filter((row) => !row.needsReview).length, duplicateRows: 0, existingBatch }) }; throw new FinanceOperationError(409, failure.error, failure); }
    }
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
    const sourceValidRows = rows.filter((row) => !row.needsReview).length;
    if (sourceValidRows && duplicateRows >= sourceValidRows) {
      { const failure = { error: `La cartola ${sourceFile} está repetida: todos sus movimientos válidos ya existen en Finance OS.`, duplicateCartola: bankStatementDuplicatePayload({ sourceFile, totalRows: rows.length, validRows: sourceValidRows, duplicateRows }) }; throw new FinanceOperationError(409, failure.error, failure); }
    }
    const importedAt = new Date().toISOString();
    const previousExceptions = reprocessable
      ? await findAllFinanceRecords(tx, { where: { tenantId: req.tenantId, recordType: "finance_exception" }, select: { id: true, data: true }, take: 5000 })
      : [];
    const exceptionIdsToResolve = previousExceptions
      .filter((record) => cleanText(financeRecordData(record).importBatchId) === existingBatch?.id)
      .map((record) => record.id);
    // Lock old and revised months together in chronological order before any write.
    await assertBankPeriodsOpen(tx, req.tenantId, [...rows, ...previousExceptions.filter((record) => exceptionIdsToResolve.includes(record.id))], job.sourceFile);
    const result = await (async () => {
      const batch = await tx.industryRecord.create({
        data: {
          tenantId: req.tenantId,
          recordType: "bank_statement",
          title: `Cartola ${rows[0].bank} · ${rows[0].accountAlias} · ${sourceFile}`.slice(0, 220),
          status: "IMPORTED",
          data: {
            sourceFile,
            importJobId: job.id,
            importRevision: job.revision,
            excludedSourceRows: preview.reviewConfig?.excludedRows || [],
            columnMapping: preview.reviewConfig?.mapping || {},
            originalId: job.originalId,
            fileFingerprint: fileFingerprint || null,
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
      if (reprocessable && existingBatch) {
        await tx.industryRecord.update({
          where: { id: existingBatch.id },
          data: { status: "REPROCESSED", data: { ...financeRecordData(existingBatch), reprocessedAt: importedAt, reprocessedByBatchId: batch.id } }
        });
        if (exceptionIdsToResolve.length) {
          await tx.industryRecord.updateMany({
            where: { id: { in: exceptionIdsToResolve } },
            data: { status: "RESOLVED" }
          });
        }
      }
      return { batch, imported: validRows.length, requiresReview: reviewRows.length };
    })();
      await tx.financeBankImportJob.update({ where: { id: job.id }, data: { status: "IMPORTED", batchId: result.batch.id, runToken: null } });
      await tx.tenantAuditLog.create({ data: { tenantId: req.tenantId, actorUserId: req.user?.id || null, action: "FINANCE_BANK_STATEMENT_IMPORTED", entity: "bank_statement", entityId: result.batch.id,
        metadata: { sourceFile: job.sourceFile, bankKey: preview.account.bankKey, imported: result.imported, duplicateRows, requiresReview: result.requiresReview, periods: bankPeriodImpact(rows).periods, reprocessedBatchId: reprocessable ? existingBatch?.id : null } } });
      return { result, duplicateRows, summary };
    });
    res.status(201).json({ ...result, duplicateRows, summary });
  } catch (error) {
    if (error instanceof FinanceOperationError) return res.status(error.status).json({ error: error.message, ...error.details });
    if (error?.status === 400) return res.status(400).json({ error: error.message });
    console.error("Import bank statement error:", error);
    res.status(500).json({ error: error instanceof Error ? error.message : "No se pudo importar la cartola bancaria." });
  }
});

// Una cartola importada puede revertirse solamente antes de que alguno de sus
// movimientos haya sido conciliado. Así se corrige una carga errónea sin
// borrar evidencia contable ya aplicada a documentos de clientes.
financeRouter.get("/finance/bank-statements", requireRole(ROLE_GROUPS.STAFF), async (req, res) => {
  try {
    if (!(await requireFinanceModule(req, res, MODULES.FINANCE_BANK_SYNC))) return;
    const [batches, movements, exceptions, closedControls, reconciliationHistory] = await Promise.all([
      findAllFinanceRecords(prisma, { where: { tenantId: req.tenantId, recordType: "bank_statement" }, orderBy: { createdAt: "desc" }, take: 500 }),
      findAllFinanceRecords(prisma, { where: { tenantId: req.tenantId, recordType: "bank_movement" }, select: { id: true, status: true, data: true }, take: 10000 }),
      findAllFinanceRecords(prisma, { where: { tenantId: req.tenantId, recordType: "finance_exception" }, select: { id: true, status: true, data: true } }),
      prisma.financePeriodControl.findMany({ where: { tenantId: req.tenantId, status: "CLOSED" }, select: { period: true } }),
      findAllFinanceRecords(prisma, { where: { tenantId: req.tenantId, recordType: "finance_reconciliation" }, select: { id: true, data: true } })
    ]);

    const closedPeriods = new Set(closedControls.map((control) => control.period));
    const historicalMovements = new Set(reconciliationHistory.map((record) => financeRecordData(record).movementId));
    const scopedBatchIds = new Set(filterFinanceContext([...batches, ...movements, ...exceptions], parseFinanceContext(req.query)).map((record) => record.id));
    const statements = batches.filter((batch) => scopedBatchIds.has(batch.id))
      .map((batch) => {
        const data = financeRecordData(batch);
        const sourceFile = cleanText(data.sourceFile);
        if (!sourceFile) return null;
        const relatedMovements = movements.filter((movement) => cleanText(financeRecordData(movement).importBatchId) === batch.id);
        const relatedExceptions = exceptions.filter((exception) => cleanText(financeRecordData(exception).importBatchId) === batch.id);
        const reconciledMovements = relatedMovements.filter((movement) => {
          const movementData = financeRecordData(movement);
          return String(movement.status || "").toUpperCase() === "MATCHED" || Boolean(movementData.reconciliationId || movementData.reconciledAt);
        });
        const status = String(batch.status || "").toUpperCase();
        const impact = bankPeriodImpact([...relatedMovements, ...relatedExceptions]);
        const closed = impact.periods.filter((period) => closedPeriods.has(period));
        const hasHistory = relatedMovements.some((movement) => historicalMovements.has(movement.id));
        const canDelete = !closed.length && !impact.undatedRows.length && !hasHistory && !reconciledMovements.length && !["DELETED", "REPROCESSED"].includes(status);
        return {
          id: batch.id,
          sourceFile,
          importJobId: data.importJobId || null,
          title: batch.title,
          status: batch.status,
          createdAt: batch.createdAt,
          importedAt: cleanText(data.importedAt || batch.createdAt),
          account: data.account || null,
          summary: data.summary || null,
          importedRows: Number(data.importedRows || relatedMovements.length || 0),
          duplicateRows: Number(data.duplicateRows || 0),
          reviewRows: Number(data.reviewRows || relatedExceptions.length || 0),
          movements: relatedMovements.length,
          exceptions: relatedExceptions.length,
          reconciledMovements: reconciledMovements.length,
          canDelete,
          deleteBlockReason: canDelete ? null : closed.length ? `Períodos cerrados: ${closed.join(", ")}. Solicita una reapertura autorizada.`
            : impact.undatedRows.length ? "Hay filas sin fecha válida. Requieren revisión antes de modificar esta cartola."
            : hasHistory ? "Existe historial de conciliaciones. La cartola debe conservarse como evidencia."
            : reconciledMovements.length
            ? "Esta cartola tiene movimientos conciliados y no puede eliminarse para proteger la trazabilidad contable."
            : "Esta cartola fue reemplazada o ya no está disponible para eliminar."
        };
      })
      .filter(Boolean);
    res.json({ statements });
  } catch (error) {
    if (error instanceof FinanceOperationError) return res.status(error.status).json({ error: error.message });
    console.error("List bank statements error:", error);
    res.status(500).json({ error: "No se pudieron cargar las cartolas importadas." });
  }
});

financeRouter.delete("/finance/bank-statements/:id", requireRole(ROLE_GROUPS.MANAGERS), requireFinancePermission(FINANCE_ACTIONS.IMPORT_HISTORY), async (req, res) => {
  try {
    if (!(await requireFinanceModule(req, res, MODULES.FINANCE_BANK_SYNC))) return;
    res.json(await deleteBankStatementInOpenPeriods(prisma, { tenantId: req.tenantId, userId: req.user?.id, batchId: req.params.id }));
  } catch (error) {
    if (error instanceof FinanceOperationError) return res.status(error.status).json({ error: error.message, ...error.details });
    console.error("Delete bank statement error:", error);
    res.status(500).json({ error: "No se pudo eliminar la cartola." });
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
    if (!result.replay && (result.imported || result.requiresReview)) await createTenantNotification({ tenantId: consent.tenantId, type: "OPEN_BANKING_SYNC_READY", title: "Movimientos bancarios disponibles", body: `${result.imported} movimiento(s) de banca abierta quedaron listos para conciliación${result.requiresReview ? ` y ${result.requiresReview} requieren revisión` : ""}.`, href: "/finance?tab=cartolas" }).catch(() => null);
    res.status(202).json({ ok: true, imported: result.imported, duplicates: result.duplicates, requiresReview: result.requiresReview });
  } catch (error) {
    console.error("Floid webhook error:", error);
    if (error instanceof FinanceOperationError) return res.status(error.status).json({ error: error.message, details: error.details });
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
    res.json({ companyRut: sii.companyRut, environment: sii.environment, maxFiles: MAX_SII_DTE_FILES, summary: summarizeSiiDteDocuments(documents), documents, periodProtection: await documentImportRestrictions(prisma, req.tenantId, documents, "DTE") });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudieron leer los DTE XML.";
    res.status(400).json({ error: message });
  }
});

financeRouter.post("/finance/sii/dte/import", requireRole(ROLE_GROUPS.MANAGERS), async (req, res) => {
  try {
    if (!(await requireFinanceModule(req, res, MODULES.FINANCE_INVOICES))) return;
    const sii = await siiConfigForTenant(req.tenantId);
    res.status(201).json(await importSiiDocuments(prisma, { tenantId: req.tenantId, userId: req.user?.id, sii, documents: req.body?.documents }));
  } catch (error) {
    if (error instanceof FinanceOperationError || error?.status) return res.status(error.status).json({ error: error.message, ...error.details });
    console.error("Financial document import error:", error);
    res.status(500).json({ error: "No se pudo incorporar el lote. No se confirmaron cambios parciales." });
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
    res.json(await getFinancePeriodWorkspace(prisma, { tenantId: req.tenantId, period, snapshotId: cleanText(req.query?.snapshotId) || undefined }));
  } catch (error) {
    if (error instanceof FinanceOperationError) return res.status(error.status).json({ error: error.message });
    console.error("Finance monthly close preview error:", error);
    res.status(500).json({ error: "No se pudo consultar el cierre mensual." });
  }
});

financeRouter.post("/finance/monthly-close", requireRole(ROLE_GROUPS.MANAGERS), requireFinancePermission(FINANCE_ACTIONS.CLOSE_PERIOD), async (req, res) => {
  try {
    if (!(await requireFinanceModule(req, res, MODULES.FINANCE_ANALYTICS))) return;
    const result = await closeFinancePeriod(prisma, { tenantId: req.tenantId, userId: req.user?.id, period: req.body?.period, confirmation: req.body?.confirmation, expectedVersion: req.body?.expectedVersion, note: req.body?.note || "" });
    res.status(201).json(result);
  } catch (error) {
    if (error instanceof FinanceOperationError) return res.status(error.status).json({ error: error.message, ...error.details });
    console.error("Finance monthly close error:", error);
    res.status(500).json({ error: "No se pudo registrar el cierre mensual." });
  }
});

financeRouter.post("/finance/monthly-close/:period/reopen", requireRole(ROLE_GROUPS.MANAGERS), requireFinancePermission(FINANCE_ACTIONS.REOPEN_PERIOD), async (req, res) => {
  try {
    if (!(await requireFinanceModule(req, res, MODULES.FINANCE_ANALYTICS))) return;
    res.json(await reopenFinancePeriod(prisma, { tenantId: req.tenantId, userId: req.user?.id, period: req.params.period, closeId: req.body?.closeId, confirmation: req.body?.confirmation, expectedVersion: req.body?.expectedVersion, reason: req.body?.reason }));
  } catch (error) {
    if (error instanceof FinanceOperationError) return res.status(error.status).json({ error: error.message });
    console.error("Finance period reopening error:", error);
    res.status(500).json({ error: "No se pudo reabrir el período." });
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
    if (error instanceof FinanceOperationError) return res.status(error.status).json({ error: error.message, details: error.details });
    const message = error instanceof Error ? error.message : "No se pudo sincronizar Nubox.";
    const configurationError = /faltan|configurad|per[ií]odo|url https/i.test(message);
    res.status(configurationError ? 400 : 502).json({ error: message });
  }
});

financeRouter.get("/finance/reconciliation-suggestions", async (req, res) => {
  try {
    if (!(await requireFinanceModule(req, res, MODULES.FINANCE_RECONCILIATION))) return;
    const movementId = cleanText(req.query?.movementId) || null;
    res.json({ suggestions: await getFinanceReconciliationSuggestions({ tenantId: req.tenantId, movementId, context: parseFinanceContext(req.query) }) });
  } catch (error) {
    if (error instanceof FinanceOperationError) return res.status(error.status).json({ error: error.message });
    console.error("Finance suggestions error:", error);
    res.status(500).json({ error: "No se pudieron calcular sugerencias de conciliacion" });
  }
});

financeRouter.post("/finance/sync/nubox/history", requireRole(ROLE_GROUPS.MANAGERS), async (req, res) => {
  try {
    if (!(await requireFinanceModule(req, res, MODULES.FINANCE_INVOICES))) return;
    const result = await syncNuboxHistoryForTenant({
      tenantId: req.tenantId,
      startPeriod: cleanText(req.body?.startPeriod),
      endPeriod: cleanText(req.body?.endPeriod),
      limit: req.body?.limit,
      source: "finance_workspace_history"
    });
    res.status(result.failed ? 207 : 200).json(result);
  } catch (error) {
    console.error("Finance Nubox historical sync error:", error);
    const message = error instanceof Error ? error.message : "No se pudo sincronizar el historial de Nubox.";
    res.status(/per[ií]odo|meses|faltan|configurad/i.test(message) ? 400 : 502).json({ error: message });
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

financeRouter.post("/finance/agents/analyze", requireRole(ROLE_GROUPS.STAFF), requireFinancePermission(FINANCE_ACTIONS.PREPARE), async (req, res) => {
  try {
    if (!(await requireFinanceModule(req, res, MODULES.FINANCE_ANALYTICS))) return;
    const exceptionResult = await prepareFinanceAgentExceptions({ tenantId: req.tenantId, userId: req.user?.id });
    const workspace = await getFinanceAgentWorkspace({ tenantId: req.tenantId }).catch(() => null);
    await recordAuditLog(req, "FINANCE_AGENTS_ANALYZED", "tenant_finance_agents", req.tenantId, {
      exceptionsPrepared: exceptionResult.created.length,
      skipped: exceptionResult.skipped, deferredCount: exceptionResult.deferred.length
    }).catch(() => null);
    res.json({ workspace, ...(!workspace ? { warning: "El resultado se guardó; no se pudo actualizar el resumen de agentes. Recarga la vista." } : {}), exceptionsPrepared: exceptionResult.created.length, exceptionsSkipped: exceptionResult.skipped, deferred: exceptionResult.deferred, analyzedMovements: exceptionResult.analyzedMovements });
  } catch (error) {
    console.error("Finance agents analysis error:", error);
    if (error instanceof FinanceOperationError) return res.status(error.status).json({ error: error.message });
    res.status(500).json({ error: "No se pudo ejecutar el analisis de agentes financieros" });
  }
});

financeRouter.get("/finance/reconciliation-workspace", async (req, res) => {
  try {
    if (!(await requireFinanceModule(req, res, MODULES.FINANCE_RECONCILIATION))) return;
    const context = parseFinanceContext(req.query);
    const kind = String(req.query.kind || "movements");
    if (!["movements", "invoices", "history"].includes(kind)) throw new FinanceOperationError(400, "Vista no válida.");
    const source = await loadFinanceContextRecords(prisma, req.tenantId);
    const scoped = filterFinanceContext(source, context, { documentMode: "outstanding" });
    let records = scoped.filter((row) => kind === "history" ? row.recordType === "finance_reconciliation" : kind === "invoices"
      ? row.recordType === "finance_invoice" && getInvoiceFinancialState(row).balance > 0 && getInvoiceFinancialState(row).status !== "PAID"
      : row.recordType === "bank_movement" && !["MATCHED", "DELETED", "REVIEW", "REJECTED"].includes(row.status));
    const normalize = (value) => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    const search = normalize(String(req.query.search || "").slice(0, 200));
    if (search) records = records.filter((row) => { const d = financeRecordData(row); return normalize([row.title, d.description, d.reference, d.clientRut, d.customerRut, d.rut, d.clientName, d.customerName, d.invoiceNumber].join(" ")).includes(search); });
    records.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)) || a.id.localeCompare(b.id));
    const page = Math.max(1, Math.min(100000, Math.trunc(Number(req.query.page) || 1)));
    res.json({ page, pages: Math.max(1, Math.ceil(records.length / 25)), total: records.length, records: records.slice((page - 1) * 25, page * 25).map((row) => row.recordType === "finance_invoice" ? { ...row, financial: getInvoiceFinancialState(row) } : row) });
  } catch (error) {
    if (error instanceof FinanceOperationError) return res.status(error.status).json({ error: error.message });
    console.error("Finance reconciliation workspace:", error);
    res.status(500).json({ error: "No se pudo cargar la mesa de conciliación." });
  }
});

financeRouter.post("/finance/reconciliations/:movementId/approve", requireRole(ROLE_GROUPS.STAFF), requireFinancePermission(FINANCE_ACTIONS.APPROVE_RECONCILIATION), async (req, res) => {
  try {
    if (!(await requireFinanceModule(req, res, MODULES.FINANCE_RECONCILIATION))) return;
    const invoiceIds = [...new Set([cleanText(req.body?.invoiceId), ...(Array.isArray(req.body?.invoiceIds) ? req.body.invoiceIds.map((id) => cleanText(id)) : [])].filter(Boolean))];
    const result = await applyFinanceAllocation(prisma, { tenantId: req.tenantId, userId: req.user?.id, movementId: req.params.movementId, invoiceIds });
    res.status(201).json(result);
  } catch (error) {
    if (error instanceof FinanceOperationError) return res.status(error.status).json({ error: error.message, ...error.details });
    console.error("Approve finance reconciliation error:", error);
    res.status(500).json({ error: "No se pudo aprobar la conciliación." });
  }
});

financeRouter.post("/finance/reconciliations/:movementId/allocate", requireRole(ROLE_GROUPS.MANAGERS), requireFinancePermission(FINANCE_ACTIONS.APPROVE_RECONCILIATION), async (req, res) => {
  try {
    if (!(await requireFinanceModule(req, res, MODULES.FINANCE_RECONCILIATION))) return;
    res.status(201).json(await applyFinanceAllocation(prisma, { tenantId: req.tenantId, userId: req.user?.id, movementId: req.params.movementId, allocations: req.body?.allocations, reason: req.body?.reason, manual: true }));
  } catch (error) {
    if (error instanceof FinanceOperationError) return res.status(error.status).json({ error: error.message });
    console.error("Manual finance allocation:", error);
    res.status(500).json({ error: "No se pudo aplicar la distribución." });
  }
});

financeRouter.post("/finance/reconciliations/:id/reverse", requireRole(ROLE_GROUPS.MANAGERS), requireFinancePermission(FINANCE_ACTIONS.APPROVE_RECONCILIATION), async (req, res) => {
  try {
    if (!(await requireFinanceModule(req, res, MODULES.FINANCE_RECONCILIATION))) return;
    res.json(await reverseFinanceAllocation(prisma, { tenantId: req.tenantId, userId: req.user?.id, reconciliationId: req.params.id, reason: req.body?.reason }));
  } catch (error) {
    if (error instanceof FinanceOperationError) return res.status(error.status).json({ error: error.message });
    console.error("Reverse finance allocation:", error);
    res.status(500).json({ error: "No se pudo revertir la conciliación." });
  }
});

financeRouter.post("/finance/reconciliations/:movementId/reject", requireRole(ROLE_GROUPS.STAFF), requireFinancePermission(FINANCE_ACTIONS.PREPARE), async (req, res) => {
  try {
    if (!(await requireFinanceModule(req, res, MODULES.FINANCE_RECONCILIATION))) return;
    const detail = cleanText(req.body?.detail, "Sugerencia rechazada; requiere revisión humana.").slice(0, 1000);
    res.status(201).json(await sendFinanceMovementToReview(prisma, { tenantId: req.tenantId, userId: req.user?.id, movementId: req.params.movementId, detail }));
  } catch (error) {
    if (error instanceof FinanceOperationError) return res.status(error.status).json({ error: error.message });
    console.error("Reject finance reconciliation error:", error);
    res.status(500).json({ error: "No se pudo enviar el movimiento a revisión." });
  }
});

financeRouter.post("/finance/collection-cases/generate", requireRole(ROLE_GROUPS.STAFF), requireFinancePermission(FINANCE_ACTIONS.PREPARE), async (req, res) => {
  try {
    if (!(await requireFinanceModule(req, res, MODULES.FINANCE_COLLECTIONS))) return;
    res.status(201).json(await generateFinanceCollectionCases(prisma, { tenantId: req.tenantId, userId: req.user?.id }));
  } catch (error) {
    if (error instanceof FinanceOperationError) return res.status(error.status).json({ error: error.message, details: error.details });
    console.error("Generate finance collections error:", error);
    res.status(500).json({ error: "No se pudieron preparar los casos de cobranza" });
  }
});

financeRouter.patch("/finance/collection-cases/:id", requireRole(ROLE_GROUPS.STAFF), requireFinancePermission(FINANCE_ACTIONS.PREPARE), async (req, res) => {
  try {
    if (!(await requireFinanceModule(req, res, MODULES.FINANCE_COLLECTIONS))) return;
    res.json(await updateCollectionCase(prisma, { tenantId: req.tenantId, userId: req.user?.id, id: req.params.id, input: req.body || {}, canReopen: ["OWNER", "ADMIN", "SUPER_ADMIN"].includes(req.user?.role) }));
  } catch (error) {
    if (error instanceof FinanceOperationError) return res.status(error.status).json({ error: error.message });
    console.error("Update finance collection case error:", error);
    res.status(500).json({ error: "No se pudo actualizar el caso de cobranza." });
  }
});

financeRouter.patch("/finance/exceptions/:id", requireRole(ROLE_GROUPS.STAFF), requireFinancePermission(FINANCE_ACTIONS.PREPARE), async (req, res) => {
  try {
    if (!(await requireFinanceModule(req, res, MODULES.FINANCE_EXCEPTIONS))) return;
    res.json(await updateFinanceExceptionCase(prisma, { tenantId: req.tenantId, userId: req.user?.id, id: req.params.id, input: req.body || {}, canReopen: ["OWNER", "ADMIN", "SUPER_ADMIN"].includes(req.user?.role) }));
  } catch (error) {
    if (error instanceof FinanceOperationError) return res.status(error.status).json({ error: error.message });
    console.error("Update finance exception error:", error);
    res.status(500).json({ error: "No se pudo actualizar la excepción financiera." });
  }
});

financeRouter.post("/finance/exceptions", requireRole(ROLE_GROUPS.STAFF), requireFinancePermission(FINANCE_ACTIONS.PREPARE), async (req, res) => {
  try {
    if (!(await requireFinanceModule(req, res, MODULES.FINANCE_EXCEPTIONS))) return;
    const result = await createAdministrativeException(prisma, { tenantId: req.tenantId, userId: req.user?.id, input: req.body || {} });
    res.status(result.replayed ? 200 : 201).json(result);
  } catch (error) {
    if (error instanceof FinanceOperationError) return res.status(error.status).json({ error: error.message });
    console.error("Create finance exception error:", error);
    res.status(500).json({ error: "No se pudo crear la excepción." });
  }
});
import { registerManualSettlement } from "../services/finance-manual-writes.service.js";
import { importHistoricalDocuments, importSiiDocuments } from "../services/finance-document-imports.service.js";
import { documentImportRestrictions } from "../services/finance-document-periods.service.js";
