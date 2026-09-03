import { prisma } from "../lib/db.js";
import {
  financeRecordData,
  getFinanceOverview,
  getFinanceReconciliationSuggestions,
  getInvoiceFinancialState
} from "./finance.service.js";

export const DEFAULT_FINANCE_AGENT_POLICY = Object.freeze({
  minimumConfidenceForSuggestion: 80,
  autoCreateExceptions: false,
  collectionsRequireApproval: true,
  updateErpRequiresApproval: true,
  enabledChannels: []
});

const AGENT_DEFINITIONS = Object.freeze([
  {
    code: "BANK_SYNC",
    name: "Agente Bank Sync",
    purpose: "Lee, normaliza y prepara los movimientos de cartolas para su revision.",
    humanControl: "No confirma pagos ni modifica el ERP."
  },
  {
    code: "RECONCILIATOR",
    name: "Agente Conciliador IA",
    purpose: "Explica coincidencias entre facturas y movimientos usando monto, fecha, RUT, referencia y razon social.",
    humanControl: "Toda conciliacion requiere confirmacion de una persona autorizada."
  },
  {
    code: "EXCEPTIONS",
    name: "Agente de Excepciones",
    purpose: "Detecta pagos parciales, duplicados, diferencias y movimientos sin factura asociada.",
    humanControl: "Propone casos; no cierra ni descarta diferencias automaticamente."
  },
  {
    code: "COLLECTIONS",
    name: "Agente de Cobranza IA",
    purpose: "Segmenta cartera vencida, propone prioridad y deja lista la siguiente accion de cobranza.",
    humanControl: "Nunca envia WhatsApp, correo o SMS sin canal, consentimiento y aprobacion configurados."
  },
  {
    code: "ANALYTICS",
    name: "Agente de Analitica",
    purpose: "Resume caja esperada, morosidad, DSO, cartera y alertas para la toma de decisiones.",
    humanControl: "Entrega recomendaciones; no altera registros financieros."
  }
]);

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function asBoolean(value, fallback) {
  return value === undefined ? fallback : Boolean(value);
}

function boundedNumber(value, fallback, min, max) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, Math.round(number))) : fallback;
}

function normalizeChannels(value) {
  const allowed = new Set(["whatsapp", "email", "sms"]);
  return Array.isArray(value) ? [...new Set(value.map((item) => String(item).toLowerCase()).filter((item) => allowed.has(item)))] : [];
}

export function normalizeFinanceAgentPolicy(value = {}) {
  const input = asObject(value);
  return {
    minimumConfidenceForSuggestion: boundedNumber(input.minimumConfidenceForSuggestion, DEFAULT_FINANCE_AGENT_POLICY.minimumConfidenceForSuggestion, 50, 99),
    // A diferencia de una regla operativa, la creacion automatica sigue
    // desactivada por defecto: las excepciones pueden tener impacto contable.
    autoCreateExceptions: asBoolean(input.autoCreateExceptions, DEFAULT_FINANCE_AGENT_POLICY.autoCreateExceptions),
    collectionsRequireApproval: asBoolean(input.collectionsRequireApproval, DEFAULT_FINANCE_AGENT_POLICY.collectionsRequireApproval),
    updateErpRequiresApproval: asBoolean(input.updateErpRequiresApproval, DEFAULT_FINANCE_AGENT_POLICY.updateErpRequiresApproval),
    enabledChannels: normalizeChannels(input.enabledChannels)
  };
}

export async function getFinanceAgentPolicy(tenantId) {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { aiSettings: true } });
  return normalizeFinanceAgentPolicy(tenant?.aiSettings?.financeAgents);
}

export async function updateFinanceAgentPolicy({ tenantId, patch = {} }) {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { aiSettings: true } });
  const current = normalizeFinanceAgentPolicy(tenant?.aiSettings?.financeAgents);
  const policy = normalizeFinanceAgentPolicy({ ...current, ...asObject(patch) });
  await prisma.tenant.update({
    where: { id: tenantId },
    data: { aiSettings: { ...asObject(tenant?.aiSettings), financeAgents: policy } }
  });
  return policy;
}

/**
 * Crea solo casos de revision. Nunca altera una factura, un pago ni un ERP.
 * Se ejecuta a solicitud del usuario desde el equipo de agentes y solo si el
 * tenant autorizo que el agente prepare excepciones automaticamente.
 */
export async function prepareFinanceAgentExceptions({ tenantId }) {
  const policy = await getFinanceAgentPolicy(tenantId);
  if (!policy.autoCreateExceptions) return { created: [], skipped: "POLICY_DISABLED" };

  const [suggestions, existing, movements] = await Promise.all([
    getFinanceReconciliationSuggestions({ tenantId, limit: 100 }),
    prisma.industryRecord.findMany({
      where: { tenantId, recordType: "finance_exception", status: { notIn: ["RESOLVED", "CLOSED"] } },
      take: 500
    }),
    prisma.industryRecord.findMany({ where: { tenantId, recordType: "bank_movement", status: { not: "MATCHED" } }, orderBy: { updatedAt: "desc" }, take: 500 })
  ]);
  const existingKeys = new Set(existing.map((item) => {
    const data = financeRecordData(item);
    return `${data.invoiceId || ""}:${data.movementId || ""}:${data.type || ""}`;
  }));
  const candidates = suggestions.filter((suggestion) => suggestion.partial || suggestion.overpayment || suggestion.difference > 1);
  const created = [];

  for (const suggestion of candidates) {
    const type = suggestion.partial ? "PARTIAL_PAYMENT" : "AMOUNT_DIFFERENCE";
    const key = `${suggestion.invoice.id}:${suggestion.movement.id}:${type}`;
    if (existingKeys.has(key)) continue;
    const record = await prisma.industryRecord.create({
      data: {
        tenantId,
        recordType: "finance_exception",
        title: `${suggestion.partial ? "Pago parcial" : "Diferencia de monto"} · ${suggestion.invoice.title}`.slice(0, 220),
        status: "OPEN",
        data: {
          type,
          invoiceId: suggestion.invoice.id,
          movementId: suggestion.movement.id,
          confidence: suggestion.confidence,
          difference: suggestion.difference,
          suggestedBy: "finance_exceptions_agent",
          reasons: suggestion.reasons,
          createdAt: new Date().toISOString()
        }
      }
    });
    existingKeys.add(key);
    created.push(record);
  }

  // Un abono que no tiene ningún documento candidato no se descarta ni se
  // imputa a pérdida: queda en una bandeja explícita para identificarlo.
  const suggestedMovementIds = new Set(suggestions.map((suggestion) => suggestion.movement?.id).filter(Boolean));
  for (const movement of movements) {
    const data = financeRecordData(movement);
    const direction = String(data.direction || "").toUpperCase();
    const kind = String(data.movementKind || "").toUpperCase();
    if (suggestedMovementIds.has(movement.id) || direction === "DEBIT" || ["COMMISSION_OR_FEE", "INTERNAL_TRANSFER"].includes(kind)) continue;
    const key = `:${movement.id}:UNIDENTIFIED_INCOME`;
    if (existingKeys.has(key)) continue;
    const record = await prisma.industryRecord.create({
      data: {
        tenantId, recordType: "finance_exception", title: `Ingreso sin documento identificado · ${movement.title}`.slice(0, 220), status: "OPEN",
        data: {
          type: "UNIDENTIFIED_INCOME", movementId: movement.id, priority: "HIGH", amount: data.amount || 0,
          detail: "El abono no tiene una factura candidata. Revisa referencia, RUT, contraparte o medio de pago antes de conciliar.",
          suggestedBy: "finance_exceptions_agent", createdAt: new Date().toISOString()
        }
      }
    });
    existingKeys.add(key);
    created.push(record);
  }
  return { created, skipped: null };
}

function agentState(code, state) {
  const { overview, suggestions, movements, policy } = state;
  if (code === "BANK_SYNC") {
    const pending = overview.reconciliation.pendingMovements;
    return {
      status: pending ? "WORKING" : "WAITING_FOR_DATA",
      metrics: [{ label: "Movimientos pendientes", value: pending }, { label: "Carga disponible", value: "CSV / manual" }],
      nextAction: pending ? "Normalizar y enviar movimientos a conciliacion." : "Carga una cartola CSV o registra movimientos para comenzar."
    };
  }
  if (code === "RECONCILIATOR") {
    const ready = suggestions.filter((item) => item.confidence >= policy.minimumConfidenceForSuggestion);
    return {
      status: ready.length ? "READY_FOR_REVIEW" : movements.length ? "NEEDS_REVIEW" : "WAITING_FOR_DATA",
      metrics: [{ label: "Sugerencias", value: suggestions.length }, { label: `Desde ${policy.minimumConfidenceForSuggestion}%`, value: ready.length }],
      nextAction: ready.length ? "Revisa y confirma las coincidencias sugeridas." : "Aun no hay suficientes datos para proponer una coincidencia confiable."
    };
  }
  if (code === "EXCEPTIONS") {
    const partials = suggestions.filter((item) => item.partial).length;
    const unmatched = Math.max(0, overview.reconciliation.pendingMovements - suggestions.length);
    return {
      status: partials || unmatched || overview.exceptions.open ? "NEEDS_REVIEW" : "CLEAR",
      metrics: [{ label: "Pagos parciales", value: partials }, { label: "Sin coincidencia", value: unmatched }, { label: "Casos abiertos", value: overview.exceptions.open }],
      nextAction: partials || unmatched ? "Crea o revisa excepciones antes de actualizar el ERP." : "No se detectaron diferencias prioritarias."
    };
  }
  if (code === "COLLECTIONS") {
    return {
      status: overview.invoices.overdue ? "READY_FOR_REVIEW" : "CLEAR",
      metrics: [{ label: "Facturas vencidas", value: overview.invoices.overdue }, { label: "Monto vencido", value: overview.invoices.overdueAmount }, { label: "Casos abiertos", value: overview.collections.open }],
      nextAction: overview.invoices.overdue ? "Prepara los casos de cobranza y aprueba el canal y mensaje antes del envio." : "La cartera no tiene facturas vencidas."
    };
  }
  return {
    status: "READY",
    metrics: [{ label: "Por cobrar", value: overview.invoices.pendingAmount }, { label: "DSO", value: `${overview.collection.dsoDays} dias` }, { label: "Cobranza esperada 30 dias", value: overview.collection.expectedNext30Days }],
    nextAction: overview.invoices.overdue ? "Prioriza la cartera vencida y revisa su impacto en caja." : "Monitorea las facturas proximas a vencer y el flujo esperado."
  };
}

/**
 * Obtiene una foto operacional de los cinco agentes. Es deterministicamente
 * explicable: las sugerencias financieras se calculan sobre registros del
 * tenant, sin enviar documentos ni datos financieros a un tercero.
 */
export async function getFinanceAgentWorkspace({ tenantId }) {
  const [overview, suggestions, movements, policy] = await Promise.all([
    getFinanceOverview({ tenantId }),
    getFinanceReconciliationSuggestions({ tenantId, limit: 100 }),
    prisma.industryRecord.findMany({ where: { tenantId, recordType: "bank_movement" }, orderBy: { updatedAt: "desc" }, take: 500 }),
    getFinanceAgentPolicy(tenantId)
  ]);
  const state = { overview, suggestions, movements, policy };
  const agents = AGENT_DEFINITIONS.map((definition) => ({ ...definition, ...agentState(definition.code, state) }));
  const priority = agents
    .filter((agent) => ["READY_FOR_REVIEW", "NEEDS_REVIEW"].includes(agent.status))
    .map((agent) => ({ agent: agent.name, action: agent.nextAction }));

  return {
    generatedAt: new Date().toISOString(),
    policy,
    agents,
    priority,
    matchingPolicy: {
      high: "95% o mas: coincidencia fuerte, siempre pendiente de confirmacion.",
      medium: "80% a 94%: recomendacion para revision humana.",
      low: "Menos de 80%: no se propone como coincidencia automatica."
    },
    safeguards: [
      "Ningun agente confirma pagos, modifica el ERP ni envia mensajes por si solo.",
      "Los cambios financieros y los canales de cobranza requieren aprobacion segun la politica del tenant.",
      "Los datos se mantienen separados por tenant y rubro."
    ]
  };
}

export function financeAgentDefinitions() {
  return AGENT_DEFINITIONS;
}
