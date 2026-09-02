const UPPER = (value, fallback = "") => String(value ?? "").trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/\s+/g, "_") || fallback;
const text = (value, fallback = "") => String(value ?? "").trim() || fallback;
const decimal = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(String(value).replace(/[^0-9,.-]/g, "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
};
const date = (value) => {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};
const allowed = (value, options, fallback) => {
  const normalized = UPPER(value, fallback);
  return options.includes(normalized) ? normalized : fallback;
};

export const BROKER_MAINTENANCE_OPTIONS = Object.freeze({
  stages: ["REPORTE", "DIAGNOSTICO", "COTIZACION", "APROBACION", "PROGRAMACION", "EJECUCION", "RECEPCION", "CERRADA"],
  priorities: ["BAJA", "MEDIA", "ALTA", "CRITICA"],
  approvalStatuses: ["PENDIENTE", "APROBADA", "RECHAZADA"],
  quoteStatuses: ["BORRADOR", "RECIBIDA", "SELECCIONADA", "RECHAZADA", "VENCIDA"],
  projectStatuses: ["PLANIFICACION", "PRESUPUESTO", "APROBACION", "EJECUCION", "HITOS", "RECEPCION", "CERRADO", "CANCELADO"],
});

export function normalizeBrokerMaintenance(input = {}) {
  const checkpoints = input.checkpoints && typeof input.checkpoints === "object" && !Array.isArray(input.checkpoints) ? input.checkpoints : {};
  return {
    category: text(input.category),
    specificType: text(input.specificType) || null,
    description: text(input.description),
    priority: allowed(input.priority, BROKER_MAINTENANCE_OPTIONS.priorities, "MEDIA"),
    workflowStage: allowed(input.workflowStage, BROKER_MAINTENANCE_OPTIONS.stages, "REPORTE"),
    diagnosis: text(input.diagnosis) || null,
    approvalStatus: allowed(input.approvalStatus, BROKER_MAINTENANCE_OPTIONS.approvalStatuses, "PENDIENTE"),
    approvedAt: date(input.approvedAt),
    scheduledAt: date(input.scheduledAt),
    estimatedCost: decimal(input.estimatedCost),
    actualCost: decimal(input.actualCost),
    completionEvidence: text(input.completionEvidence) || null,
    resolvedAt: date(input.resolvedAt),
    acceptedAt: date(input.acceptedAt),
    checkpoints,
  };
}

export function normalizeBrokerMaintenanceQuote(input = {}) {
  return {
    providerId: text(input.providerId) || null,
    providerName: text(input.providerName) || null,
    reference: text(input.reference),
    scope: text(input.scope) || null,
    amount: decimal(input.amount),
    currency: UPPER(input.currency, "CLP"),
    validUntil: date(input.validUntil),
    status: allowed(input.status, BROKER_MAINTENANCE_OPTIONS.quoteStatuses, "RECIBIDA"),
  };
}

export function normalizeBrokerProject(input = {}) {
  const checkpoints = input.checkpoints && typeof input.checkpoints === "object" && !Array.isArray(input.checkpoints) ? input.checkpoints : {};
  return {
    name: text(input.name),
    projectType: text(input.projectType),
    status: allowed(input.status, BROKER_MAINTENANCE_OPTIONS.projectStatuses, "PLANIFICACION"),
    budget: decimal(input.budget),
    approvedBudget: decimal(input.approvedBudget),
    currency: UPPER(input.currency, "CLP"),
    startAt: date(input.startAt),
    targetAt: date(input.targetAt),
    completedAt: date(input.completedAt),
    scope: text(input.scope) || null,
    acceptanceNotes: text(input.acceptanceNotes) || null,
    checkpoints,
  };
}

function confirmed(item, key) {
  const value = item?.checkpoints && typeof item.checkpoints === "object" ? item.checkpoints[key] : null;
  return Boolean(value && (value.confirmedAt || value === true));
}

export function brokerMaintenanceReadiness({ targetStage, maintenance, quotes = [] }) {
  const target = UPPER(targetStage);
  const item = maintenance || {};
  const requirements = [];
  const add = (key, label, ready) => requirements.push({ key, label, ready: Boolean(ready) });
  if (!BROKER_MAINTENANCE_OPTIONS.stages.includes(target)) return { requirements, ready: true, missing: [] };
  const selectedQuote = quotes.find((quote) => UPPER(quote.status) === "SELECCIONADA");
  if (target === "DIAGNOSTICO") add("reporte", "Categoría y descripción de la incidencia", Boolean(text(item.category)) && Boolean(text(item.description)));
  if (target === "COTIZACION") {
    add("diagnostico", "Diagnóstico técnico registrado", Boolean(text(item.diagnosis)));
    add("revision_diagnostico", "Diagnóstico revisado por una persona autorizada", confirmed(item, "diagnostico"));
  }
  if (target === "APROBACION") add("cotizacion", "Al menos una cotización recibida con proveedor y monto", quotes.some((quote) => UPPER(quote.status) === "RECIBIDA" && Number(quote.amount) > 0 && Boolean(quote.providerId || quote.providerName)));
  if (target === "PROGRAMACION") {
    add("seleccion", "Cotización seleccionada", Boolean(selectedQuote));
    add("aprobacion", "Aprobación humana registrada", UPPER(item.approvalStatus) === "APROBADA" && Boolean(item.approvedAt) && confirmed(item, "aprobacion"));
  }
  if (target === "EJECUCION") add("agenda", "Proveedor y fecha de ejecución programados", Boolean(item.providerId) && Boolean(item.scheduledAt));
  if (target === "RECEPCION") {
    add("ejecucion", "Trabajo marcado como terminado", Boolean(item.resolvedAt));
    add("evidencia", "Evidencia o referencia de cierre registrada", Boolean(text(item.completionEvidence)));
  }
  if (target === "CERRADA") {
    add("recepcion", "Recepción conforme registrada", Boolean(item.acceptedAt) && confirmed(item, "recepcion"));
    add("costo_real", "Costo real informado", decimal(item.actualCost) !== null);
  }
  return { requirements, ready: requirements.every((item) => item.ready), missing: requirements.filter((item) => !item.ready).map((item) => item.label) };
}

export function brokerProjectReadiness({ targetStage, project }) {
  const target = UPPER(targetStage);
  const item = project || {};
  const requirements = [];
  const add = (key, label, ready) => requirements.push({ key, label, ready: Boolean(ready) });
  if (!BROKER_MAINTENANCE_OPTIONS.projectStatuses.includes(target)) return { requirements, ready: true, missing: [] };
  if (target === "PRESUPUESTO") add("alcance", "Nombre, tipo y alcance del proyecto", Boolean(text(item.name)) && Boolean(text(item.projectType)) && Boolean(text(item.scope)));
  if (target === "APROBACION") add("presupuesto", "Presupuesto estimado informado", decimal(item.budget) !== null);
  if (target === "EJECUCION") {
    add("aprobacion", "Presupuesto aprobado con revisión humana", decimal(item.approvedBudget) !== null && confirmed(item, "aprobacion"));
    add("agenda", "Fecha de inicio programada", Boolean(item.startAt));
  }
  if (target === "HITOS") add("ejecucion", "Proyecto iniciado y responsable confirmado", Boolean(item.startAt) && confirmed(item, "ejecucion"));
  if (target === "RECEPCION") add("termino", "Proyecto terminado con fecha de cierre", Boolean(item.completedAt));
  if (target === "CERRADO") add("recepcion", "Recepción conforme documentada", Boolean(text(item.acceptanceNotes)) && confirmed(item, "recepcion"));
  return { requirements, ready: requirements.every((item) => item.ready), missing: requirements.filter((item) => !item.ready).map((item) => item.label) };
}
