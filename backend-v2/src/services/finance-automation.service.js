import { prisma } from "../lib/db.js";
import { createTenantNotification } from "../lib/notifications.js";
import { getFinanceAgentWorkspace, prepareFinanceAgentExceptions } from "./finance-agents.service.js";

/**
 * Revisa los datos financieros recién ingresados sin confirmar pagos, tocar
 * el ERP ni contactar a nadie. El resultado queda en la bitácora y, si hay
 * excepciones nuevas, se crea una notificación para revisión humana.
 */
export async function runFinancePostIngestionAnalysis({ tenantId, source = "manual" } = {}) {
  if (!tenantId) return { analyzed: false, reason: "missing_tenant" };

  const [exceptions, workspace] = await Promise.all([
    prepareFinanceAgentExceptions({ tenantId }),
    getFinanceAgentWorkspace({ tenantId })
  ]);

  const priorities = workspace.priority || [];
  const details = {
    source,
    exceptionsPrepared: exceptions.created.length,
    exceptionsSkipped: exceptions.skipped,
    priorityCount: priorities.length,
    priorities: priorities.slice(0, 5).map((item) => item.agent),
    analyzedAt: new Date().toISOString()
  };

  await prisma.tenantAuditLog.create({
    data: {
      tenantId,
      action: "FINANCE_POST_INGESTION_ANALYZED",
      entity: "finance_automation",
      metadata: details
    }
  }).catch(() => null);

  // Evitamos avisos repetitivos: solo se avisa cuando apareció algo nuevo que
  // una persona debe revisar. Las demás recomendaciones viven en Equipo IA.
  if (exceptions.created.length) {
    await createTenantNotification({
      tenantId,
      title: "Finanzas detectó excepciones para revisar",
      body: `${exceptions.created.length} ${exceptions.created.length === 1 ? "caso fue preparado" : "casos fueron preparados"}. Ningún pago ni registro contable fue modificado.`,
      severity: "warning",
      targetUrl: "/finance?tab=excepciones",
      metadata: { notificationType: "finance", screen: "finance", source, exceptionCount: exceptions.created.length }
    }).catch(() => null);
  }

  return { analyzed: true, ...details };
}
