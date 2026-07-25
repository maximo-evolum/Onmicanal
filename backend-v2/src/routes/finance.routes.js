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

financeRouter.get("/finance/overview", async (req, res) => {
  try {
    if (!(await requireFinanceModule(req, res, MODULES.FINANCE_ANALYTICS))) return;
    res.json(await getFinanceOverview({ tenantId: req.tenantId }));
  } catch (error) {
    console.error("Finance overview error:", error);
    res.status(500).json({ error: "No se pudo cargar el dashboard financiero" });
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
