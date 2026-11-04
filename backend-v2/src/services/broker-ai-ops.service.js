/** Archivo: Convierte la lectura operacional de Broker en prioridades IA explicables y de solo consulta. */

function text(value, fallback = "") {
  const result = String(value ?? "").trim();
  return result || fallback;
}

function priorityLabel(priority) {
  return ({ HIGH: "Alta", MEDIUM: "Media", LOW: "Baja" })[text(priority).toUpperCase()] || "Informativa";
}

function priorityAction(priority) {
  const actions = {
    PROPERTY_COMPLETENESS: "Completar los antecedentes faltantes de la ficha.",
    OPERATION_NEXT_STAGE: "Revisar el hito y confirmar el avance de la operación.",
    OPERATION_HEALTH: "Revisar el estancamiento, responsable y próximo seguimiento.",
    OPERATION_DOCUMENT_READINESS: "Validar los antecedentes documentales antes de avanzar.",
    MAINTENANCE_OPEN: "Revisar el caso, proveedor y condición de cierre.",
    POST_SALE_OPEN: "Revisar el caso de postventa y acordar su siguiente gestión.",
    FINANCING_OPEN: "Revisar los antecedentes y el estado del financiamiento.",
    DUE_DATE_CONTROL: "Revisar el vencimiento y confirmar la acción correspondiente.",
    COLLECTION_CONTROL: "Revisar la evidencia de cobro antes de contactar o registrar cambios.",
    AI_EVALUATION_PENDING: "Revisar la recomendación IA y dejar una decisión humana.",
  };
  return actions[text(priority.source)] || "Revisar el antecedente y confirmar el siguiente paso.";
}

function priorityReason(priority) {
  return text(priority.detail, "No hay un motivo adicional registrado para esta prioridad.");
}

function priorityHref(priority) {
  if (priority.operationId) return `/realty?view=broker_os&tab=operations&operationId=${encodeURIComponent(priority.operationId)}`;
  if (priority.propertyId) return `/realty?view=broker_os&tab=operations&propertyId=${encodeURIComponent(priority.propertyId)}`;
  const area = text(priority.area, "operations");
  const tab = area === "overview" ? "operations" : area;
  return `/realty?view=broker_os&tab=${encodeURIComponent(tab)}`;
}

function dueLabel(value) {
  if (!value) return "Sin plazo automático";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Sin plazo automático";
  return `Hasta el ${date.toLocaleDateString("es-CL")}`;
}

function triggeredAlertPayload(record) {
  const data = record?.data && typeof record.data === "object" && !Array.isArray(record.data) ? record.data : {};
  const operationId = data.operationId || null;
  const propertyId = data.propertyId || null;
  const area = text(data.area, "operations");
  const tab = area === "overview" ? "operations" : area;
  return {
    id: record.id,
    title: text(record.title, "Alerta interna"),
    detail: text(data.detail, "Alerta interna pendiente de revisión."),
    priority: text(data.priority, "MEDIUM").toUpperCase(),
    requiresApproval: Boolean(data.requiresHumanApproval),
    source: text(data.source, "broker_automation_scan"),
    updatedAt: record.updatedAt || record.createdAt || null,
    href: operationId
      ? `/realty?view=broker_os&tab=operations&operationId=${encodeURIComponent(operationId)}`
      : propertyId
        ? `/realty?view=broker_os&tab=operations&propertyId=${encodeURIComponent(propertyId)}`
        : `/realty?view=broker_os&tab=${encodeURIComponent(tab)}`,
  };
}

/**
 * AI Ops no recalcula ni ejecuta procesos. Recibe el contrato operacional que
 * ya usan Resumen, Dashboard y Tracker y lo expone con lenguaje accionable.
 */
export function buildBrokerAiOpsSnapshot({ readModel, teamMembers = [], triggeredAlerts = [] } = {}) {
  if (!readModel || typeof readModel !== "object") throw new Error("Se requiere la lectura operacional de Broker para preparar AI Ops.");
  const teamById = new Map((teamMembers || []).map((member) => [String(member.id), member]));
  const priorities = (readModel.priorities || []).map((priority) => {
    const member = priority.responsibleUserId ? teamById.get(String(priority.responsibleUserId)) : null;
    return {
      id: priority.id,
      priority: text(priority.priority, "LOW").toUpperCase(),
      priorityLabel: priorityLabel(priority.priority),
      title: text(priority.title, "Prioridad sin título"),
      action: priorityAction(priority),
      reason: priorityReason(priority),
      impact: text(priority.impact, "CONTROL_OPERATIVO").replaceAll("_", " ").toLowerCase(),
      responsible: member ? text(member.name || member.email, "Responsable autorizado") : "Sin responsable asignado",
      dueAt: priority.dueAt || null,
      dueLabel: dueLabel(priority.dueAt),
      source: text(priority.source, "BROKER_RULE"),
      requiresApproval: Boolean(priority.requiresApproval),
      operationId: priority.operationId || null,
      propertyId: priority.propertyId || null,
      href: priorityHref(priority),
      evidence: `Regla ${text(priority.source, "BROKER_RULE")} sobre registros visibles en tu alcance.`,
    };
  });

  const visibleOperations = Number(readModel.pipeline?.total || 0);
  const activeOperations = Number(readModel.pipeline?.active || 0);
  const recentActivity = Number(readModel.activity?.updatedLast30Days || 0);
  const patternContext = {
    sampleSize: visibleOperations,
    period: "Últimos 30 días de actividad visible",
    activity: recentActivity,
  };
  const patterns = [];
  if (visibleOperations < 3) {
    patterns.push({
      key: "insufficient-data",
      status: "INSUFFICIENT_DATA",
      title: "Datos insuficientes para detectar patrones",
      detail: "Se requieren al menos 3 operaciones visibles antes de mostrar una tendencia. AI Ops no inventa conclusiones ni toma acciones por sí mismo.",
      evidence: patternContext,
    });
  } else {
    const bottleneck = [...(readModel.pipeline?.bottlenecks || [])]
      .sort((left, right) => Number(right.risk || 0) - Number(left.risk || 0) || Number(right.attention || 0) - Number(left.attention || 0))[0];
    if (bottleneck) patterns.push({
      key: "pipeline-bottleneck",
      status: "INFORMATIONAL",
      title: `Atención en ${text(bottleneck.label, "una etapa del pipeline")}`,
      detail: `${Number(bottleneck.count || 0)} operación(es) visibles están en esta etapa; ${Number(bottleneck.risk || 0)} con riesgo y ${Number(bottleneck.attention || 0)} con seguimiento requerido.`,
      evidence: { ...patternContext, averageStageAgeDays: Number(bottleneck.averageStageAgeDays || 0) },
    });
    if (Number(readModel.operationalCenter?.documentsPending || 0) > 0) patterns.push({
      key: "document-readiness",
      status: "INFORMATIONAL",
      title: "Antecedentes documentales pendientes",
      detail: `${Number(readModel.operationalCenter.documentsPending)} documento(s) visible(s) requieren revisión o disponibilidad antes de los avances asociados.`,
      evidence: patternContext,
    });
    if (Number(readModel.operationalCenter?.aiApprovalsPending || 0) > 0) patterns.push({
      key: "ai-human-review",
      status: "INFORMATIONAL",
      title: "Recomendaciones IA pendientes de revisión humana",
      detail: `${Number(readModel.operationalCenter.aiApprovalsPending)} evaluación(es) esperan una decisión. No se ejecutará ningún cambio hasta que una persona autorizada lo registre.`,
      evidence: patternContext,
    });
    if (!patterns.length) patterns.push({
      key: "stable-portfolio",
      status: "INFORMATIONAL",
      title: "Sin patrón crítico en la muestra visible",
      detail: `Las ${activeOperations} operación(es) activa(s) no muestran un cuello de botella priorizado con la información actualmente disponible.`,
      evidence: patternContext,
    });
  }

  return {
    version: "BROKER_AI_OPS_V1",
    generatedAt: readModel.generatedAt || new Date().toISOString(),
    scope: readModel.scope || { level: "AUTHORIZED", description: "Registros dentro de tu alcance autorizado." },
    notice: "AI Ops explica prioridades y patrones. No cambia estados, publica, contacta personas ni ejecuta acciones externas.",
    summary: {
      totalPriorities: priorities.length,
      highPriorities: priorities.filter((item) => item.priority === "HIGH").length,
      operationsVisible: visibleOperations,
      pendingHumanReview: Number(readModel.operationalCenter?.aiApprovalsPending || 0),
      triggeredAlerts: (triggeredAlerts || []).filter((alert) => String(alert?.status || "OPEN").toUpperCase() !== "RESOLVED").length,
    },
    priorities,
    patterns,
    // Estas alertas proceden del mismo registro interno que usa el Centro
    // Operacional y Gobierno. AI Ops no las genera ni las resuelve.
    triggeredAlerts: (triggeredAlerts || []).filter((alert) => String(alert?.status || "OPEN").toUpperCase() !== "RESOLVED").slice(0, 12).map(triggeredAlertPayload),
  };
}
