import { prisma } from "../lib/db.js";
import { findAllFinanceRecords } from "./finance-integrity.service.js";
import { prepareFinanceExceptionCases } from "./finance-agent-actions.service.js";
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
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  return fallback;
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

export async function getFinanceAgentPolicy(tenantId, db = prisma) {
  const tenant = await db.tenant.findUnique({ where: { id: tenantId }, select: { aiSettings: true } });
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
export async function prepareFinanceAgentExceptions({ tenantId, userId, db = prisma }) {
  return prepareFinanceExceptionCases(db, { tenantId, userId, readPolicy: (tx) => getFinanceAgentPolicy(tenantId, tx) });
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
    const matchedIds = new Set(suggestions.map((s) => s.movement.id));
    const unmatched = movements.filter((m) => !matchedIds.has(m.id) && !["MATCHED", "CLOSED", "REVIEW", "REJECTED"].includes(m.status) && ["CREDIT", "ABONO"].includes(String(m.data?.direction || m.data?.movementType).toUpperCase()) && !["COMMISSION_OR_FEE", "INTERNAL_TRANSFER"].includes(m.data?.movementKind)).length;
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
    getFinanceReconciliationSuggestions({ tenantId, limit: null }),
    findAllFinanceRecords(prisma, { where: { tenantId, recordType: "bank_movement" }, orderBy: { updatedAt: "desc" } }),
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
