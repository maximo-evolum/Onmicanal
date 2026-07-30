import { Router } from "express";
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

export const financeRouter = Router();

async function requireFinanceModule(req, res, module) {
  if (req.user?.role === "SUPER_ADMIN") return true;
  const enabled = await ensureTenantModuleEligibility({ tenantId: req.tenantId, module, tenant: req.tenant });
  if (!enabled) {
    res.status(403).json({ error: "Este modulo de Finance OS no esta habilitado para la cuenta." });
    return false;
  }
  return true;
}

function cleanText(value) {
  return String(value || "").trim();
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
      { key: "erp", label: "ERP / contabilidad", status: "not_connected", detail: "Conecta Nubox, Defontana, Softland u otro ERP autorizado." },
      { key: "email", label: "Correo", status: status(["email", "gmail", "smtp"]), detail: "Canal usado para recordatorios aprobados." },
      { key: "whatsapp", label: "WhatsApp Business", status: status(["whatsapp", "whatsapp_business"]), detail: "Canal usado solo con consentimiento y plantilla aprobada." }
    ] });
  } catch (error) {
    console.error("Finance integrations error:", error);
    res.status(500).json({ error: "No se pudo obtener el estado de integraciones" });
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
