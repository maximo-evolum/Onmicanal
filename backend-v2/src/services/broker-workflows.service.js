/**
 * Flujos canónicos de Broker OS.
 *
 * No se guardan "etapas libres": una operación tiene una ruta conocida y
 * cada cambio queda trazable. La interfaz puede traducir estas etiquetas, pero
 * la API siempre valida este contrato antes de modificar una oportunidad.
 */
export const BROKER_OPERATION_TYPES = Object.freeze({
  SALE: "SALE",
  RENTAL: "RENTAL",
  ADMINISTRATION: "ADMINISTRATION"
});

// Flujo canónico de Venta acordado para Broker OS. Las etapas antiguas se
// normalizan mediante LEGACY_STAGE_MAP para no perder operaciones demo o
// históricas que fueron creadas antes de esta versión.
export const SALE_STAGES = Object.freeze([
  "EVALUACION_COMERCIAL",
  "MANDATO_Y_PUBLICACION",
  "CALIFICACION_Y_VISITAS",
  "OFERTA_Y_NEGOCIACION",
  "PROMESA",
  "ESTUDIO_DE_TITULO",
  "ESCRITURA",
  "INSCRIPCION_CBR",
  "ENTREGA_Y_POSTVENTA"
]);

export const RENTAL_STAGES = Object.freeze([
  "CAPTACION",
  "EVALUACION_COMERCIAL",
  "DEFINICION_DE_PRECIO",
  "EXCLUSIVIDAD",
  "PREPARACION_INMUEBLE",
  "PUBLICACION",
  "GENERACION_DE_LEADS",
  "EVALUACION_ARRENDATARIO",
  "VISITAS",
  "RESERVA",
  "CONTRATO",
  "PAGO_INICIAL",
  "ENTREGA_LLAVES"
]);

export const ADMINISTRATION_STAGES = Object.freeze([
  "INCORPORACION",
  "CONTRATO",
  "REVISION_MENSUAL",
  "COBRO_Y_CONCILIACION",
  "LIQUIDACION_Y_TRANSFERENCIA",
  "MANTENCIONES_Y_SERVICIOS",
  "RENOVACION",
  "CIERRE"
]);

export const TERMINAL_STAGES = new Set(["CERRADA", "CANCELADA", "PERDIDA", "CIERRE", "ENTREGA_Y_POSTVENTA", "ENTREGA_LLAVES"]);

export const LEGACY_STAGE_MAP = Object.freeze({
  SALE: {
    CAPTACION: "EVALUACION_COMERCIAL",
    TASACION: "EVALUACION_COMERCIAL",
    MANDATO: "MANDATO_Y_PUBLICACION",
    PUBLICACION: "MANDATO_Y_PUBLICACION",
    CALIFICACION: "CALIFICACION_Y_VISITAS",
    VISITA: "CALIFICACION_Y_VISITAS",
    OFERTA: "OFERTA_Y_NEGOCIACION",
    NEGOCIACION: "OFERTA_Y_NEGOCIACION",
    PROMESA: "PROMESA",
    ESCRITURA: "ESCRITURA",
    CIERRE: "INSCRIPCION_CBR",
    POSTVENTA: "ENTREGA_Y_POSTVENTA"
  },
  RENTAL: {
    TASACION: "EVALUACION_COMERCIAL",
    MANDATO: "EXCLUSIVIDAD",
    CALIFICACION: "EVALUACION_ARRENDATARIO",
    VISITA: "VISITAS",
    POSTULACION: "EVALUACION_ARRENDATARIO",
    EVALUACION: "EVALUACION_ARRENDATARIO",
    APROBACION: "RESERVA",
    ENTREGA: "ENTREGA_LLAVES",
    ARRENDADO: "ENTREGA_LLAVES",
    RENOVACION: "ENTREGA_LLAVES"
  },
  ADMINISTRATION: {
    COBRO: "COBRO_Y_CONCILIACION",
    LIQUIDACION: "LIQUIDACION_Y_TRANSFERENCIA",
    MANTENIMIENTO: "MANTENCIONES_Y_SERVICIOS"
  }
});

export const BROKER_RECORD_AREAS = Object.freeze({
  commercial: ["property_appraisal", "property_mandate", "property_offer", "property_promise", "commission_policy", "commission_settlement"],
  rentals: ["rental_application", "rental_contract", "rental_payment", "administration_profile", "utility_monitoring", "administration_liquidation"],
  maintenance: ["maintenance_ticket", "service_provider", "provider_quote", "material_purchase"],
  projects: ["remodeling_project", "project_budget", "project_milestone", "marketing_publication"],
  post_sale: ["property_inspection", "property_handover", "post_sale_case", "warranty_case"],
  documents: ["property_document", "legal_document", "digital_signature"],
  financing: ["operation_financing", "operation_financing_expense"]
});

export const BROKER_RECORD_TYPES = Object.freeze(Object.values(BROKER_RECORD_AREAS).flat());

// Catálogo único de registros. La API lo expone a la interfaz para que el
// formulario, la ficha y la lista describan exactamente los mismos datos.
// Así evitamos el problema de un formulario que pide algo distinto de lo que
// luego muestra el expediente.
export const BROKER_RECORD_DEFINITIONS = Object.freeze({
  property_appraisal: { label: "Tasación", area: "commercial", required: ["propertyId", "estimatedValue", "currency", "appraisalDate"], statuses: ["DRAFT", "REVIEW", "APPROVED"] },
  property_mandate: { label: "Mandato", area: "commercial", required: ["propertyId", "ownerName", "startDate", "endDate", "exclusivityMonths", "commissionRatePct"], statuses: ["DRAFT", "PENDING_SIGNATURE", "SIGNED", "EXPIRED"] },
  property_offer: { label: "Oferta de compra", area: "commercial", required: ["propertyId", "buyerName", "amount", "currency", "offerDate", "financingType"], statuses: ["DRAFT", "SUBMITTED", "ACCEPTED", "REJECTED", "WITHDRAWN"] },
  property_promise: { label: "Promesa de compraventa", area: "commercial", required: ["propertyId", "buyerName", "signingDate", "agreedAmount", "penaltyRatePct"], statuses: ["DRAFT", "PENDING_SIGNATURE", "SIGNED", "CANCELLED"] },
  commission_policy: { label: "Regla de comisión", area: "commercial", required: ["propertyId", "baseAmount", "commissionRatePct", "brokerSplitPct", "companySplitPct"], statuses: ["DRAFT", "ACTIVE", "REPLACED"] },
  commission_settlement: { label: "Liquidación de comisión", area: "commercial", required: ["propertyId", "amount", "brokerAmount", "companyAmount", "settlementDate"], statuses: ["DRAFT", "PENDING", "PAID"] },
  rental_application: { label: "Postulación de arriendo", area: "rentals", required: ["propertyId", "tenantName", "taxEvaluation", "commercialEvaluation"], statuses: ["RECEIVED", "UNDER_REVIEW", "APPROVED", "REJECTED"] },
  rental_contract: { label: "Contrato de arriendo", area: "rentals", required: ["propertyId", "tenantName", "startDate", "monthlyRent", "paymentDay", "depositAmount"], statuses: ["DRAFT", "PENDING_SIGNATURE", "ACTIVE", "ENDING", "ENDED"] },
  rental_payment: { label: "Cobro de arriendo", area: "rentals", required: ["propertyId", "amount", "dueDate", "period"], statuses: ["PENDING", "PAID", "OVERDUE", "WAIVED"] },
  administration_profile: { label: "Ficha de administración", area: "rentals", required: ["propertyId", "ownerName", "tenantName", "managementRatePct", "ownerPaymentDay", "ownerBankAccount"], statuses: ["DRAFT", "ACTIVE", "SUSPENDED", "CLOSED"] },
  utility_monitoring: { label: "Servicio básico o gasto común", area: "rentals", required: ["propertyId", "utilityType", "accountNumber", "dueDate", "amount"], statuses: ["PENDING", "PAID", "OVERDUE", "UNDER_REVIEW"] },
  administration_liquidation: { label: "Liquidación de administración", area: "rentals", required: ["propertyId", "period", "amount", "managementFee", "ownerTransferAmount", "transferDate"], statuses: ["DRAFT", "PENDING_APPROVAL", "ISSUED", "PAID"] },
  maintenance_ticket: { label: "Solicitud de mantención", area: "maintenance", required: ["propertyId", "category", "description"], statuses: ["REPORTED", "QUOTING", "APPROVED", "IN_PROGRESS", "COMPLETED", "CANCELLED"] },
  service_provider: { label: "Proveedor", area: "maintenance", required: ["providerName", "specialty"], statuses: ["ACTIVE", "SUSPENDED", "ARCHIVED"] },
  provider_quote: { label: "Cotización de proveedor", area: "maintenance", required: ["propertyId", "providerName", "amount"], statuses: ["DRAFT", "RECEIVED", "APPROVED", "REJECTED", "EXPIRED"] },
  material_purchase: { label: "Compra de materiales", area: "maintenance", required: ["propertyId", "supplierName", "amount"], statuses: ["REQUESTED", "APPROVED", "ORDERED", "RECEIVED", "CANCELLED"] },
  remodeling_project: { label: "Proyecto de remodelación", area: "projects", required: ["propertyId", "projectType", "budget"], statuses: ["PLANNED", "APPROVED", "IN_PROGRESS", "ON_HOLD", "COMPLETED", "CANCELLED"] },
  project_budget: { label: "Presupuesto de proyecto", area: "projects", required: ["propertyId", "amount"], statuses: ["DRAFT", "PENDING_APPROVAL", "APPROVED", "REJECTED"] },
  project_milestone: { label: "Hito de proyecto", area: "projects", required: ["propertyId", "milestoneDate", "description"], statuses: ["PENDING", "IN_PROGRESS", "COMPLETED", "BLOCKED"] },
  marketing_publication: { label: "Publicación inmobiliaria", area: "projects", required: ["propertyId", "channel", "publicationStatus"], statuses: ["DRAFT", "PENDING_REVIEW", "PUBLISHED", "PAUSED", "ARCHIVED"] },
  property_inspection: { label: "Inspección", area: "post_sale", required: ["propertyId", "inspectionDate", "checklist"], statuses: ["SCHEDULED", "IN_PROGRESS", "COMPLETED", "REQUIRES_ACTION"] },
  property_handover: { label: "Entrega o recepción", area: "post_sale", required: ["propertyId", "handoverDate", "recipientName"], statuses: ["SCHEDULED", "PENDING_SIGNATURE", "COMPLETED", "OBSERVED"] },
  post_sale_case: { label: "Caso de postventa", area: "post_sale", required: ["propertyId", "description"], statuses: ["OPEN", "IN_PROGRESS", "WAITING_PROVIDER", "RESOLVED", "CLOSED"] },
  warranty_case: { label: "Garantía", area: "post_sale", required: ["propertyId", "description", "warrantyUntil"], statuses: ["OPEN", "UNDER_REVIEW", "APPROVED", "REJECTED", "RESOLVED"] },
  property_document: { label: "Documento de propiedad", area: "documents", required: ["propertyId", "documentType"], statuses: ["PENDING", "AVAILABLE", "EXPIRED", "REPLACED"] },
  legal_document: { label: "Documento legal", area: "documents", required: ["propertyId", "documentType"], statuses: ["PENDING", "UNDER_REVIEW", "APPROVED", "OBSERVED", "EXPIRED"] },
  digital_signature: { label: "Firma electrónica", area: "documents", required: ["propertyId", "documentType", "signerName"], statuses: ["DRAFT", "SENT", "SIGNED", "REJECTED", "EXPIRED"] },
  operation_financing: { label: "Financiamiento operativo", area: "financing", required: ["propertyId", "purpose", "requestedAmount"], statuses: ["DIAGNOSIS", "LEGAL_CHECK", "ESTIMATING", "REQUESTED", "UNDER_REVIEW", "APPROVED", "DISBURSED", "SETTLED", "REJECTED"] },
  operation_financing_expense: { label: "Gasto financiado", area: "financing", required: ["financingId", "concept", "amount"], statuses: ["PLANNED", "APPROVED", "PAID", "RECONCILED", "REJECTED"] }
});

export const BROKER_AGENT_CATALOG = Object.freeze([
  { key: "commercial", label: "Agente Comercial", status: "AVAILABLE", scope: "Califica interesados, propone siguiente acción y deriva a un corredor." },
  { key: "marketing", label: "Agente de Marketing", status: "AVAILABLE", scope: "Prepara copys y variantes de publicación. La publicación final se aprueba por una persona." },
  { key: "analytics", label: "Agente de Analítica", status: "AVAILABLE", scope: "Resume cartera, tasaciones y señales de demanda sin modificar registros." },
  { key: "legal", label: "Agente Legal", status: "PLANNED", scope: "Asistirá en checklist documental; no reemplaza revisión jurídica profesional." },
  { key: "documental", label: "Agente Documental", status: "PLANNED", scope: "Clasificará y verificará integridad del expediente antes de una firma." },
  { key: "maintenance", label: "Agente de Mantenciones", status: "PLANNED", scope: "Priorizará casos y sugerirá proveedores según categoría, historial y aprobación." },
  { key: "finance", label: "Agente Financiero", status: "PLANNED", scope: "Preparará proyecciones de gastos y financiamiento; no paga ni aprueba recursos." },
  { key: "collections", label: "Agente de Cobranza", status: "PLANNED", scope: "Preparará recordatorios de arriendo sujetos a canal, consentimiento y aprobación humana." },
  { key: "inspection", label: "Agente Inspector", status: "PLANNED", scope: "Ayudará a estructurar checklists y evidencias de inspección." },
  { key: "administration", label: "Agente de Administración", status: "PLANNED", scope: "Ayudará en contratos, liquidaciones y renovaciones con revisión humana." },
  { key: "architect", label: "Agente Arquitecto", status: "PLANNED", scope: "Apoyará la lectura de planos, recintos y requerimientos de remodelación." },
  { key: "crm", label: "Agente CRM", status: "PLANNED", scope: "Consolidará señales comerciales sin contactar personas de forma autónoma." },
  { key: "customer_care", label: "Agente de Atención al Cliente", status: "PLANNED", scope: "Propondrá agenda y seguimiento; los envíos dependen del canal y aprobación." }
]);

// Escenarios reproducibles para validar y mejorar los asistentes sin usar
// datos de clientes reales. Cada recomendación debe terminar en una decisión
// humana y un resultado que el equipo pueda revisar después.
export const BROKER_AGENT_SCENARIOS = Object.freeze([
  { key: "comprador-providencia", agentKey: "commercial", area: "commercial", title: "Compradora con presupuesto y comuna definidos", trigger: "Carolina busca un departamento en Providencia con tres dormitorios.", expectedRecommendation: "Sugerir propiedades compatibles, proponer visita y pedir confirmación de financiamiento.", requiresHumanApproval: true },
  { key: "oferta-bajo-rango", agentKey: "commercial", area: "commercial", title: "Oferta bajo el valor publicado", trigger: "La oferta recibida está bajo la referencia de tasación.", expectedRecommendation: "Preparar comparación de oferta, tasación y condiciones; no aceptar ni rechazar automáticamente.", requiresHumanApproval: true },
  { key: "publicacion-pendiente", agentKey: "marketing", area: "projects", title: "Ficha preparada para publicación", trigger: "La propiedad tiene fotos, precio y dirección validados.", expectedRecommendation: "Preparar borrador de publicación por canal y pedir aprobación antes de publicar.", requiresHumanApproval: true },
  { key: "documento-por-vencer", agentKey: "analytics", area: "documents", title: "Documento legal próximo a vencer", trigger: "Un certificado de dominio vence antes de la fecha estimada de cierre.", expectedRecommendation: "Priorizar renovación documental y asignarla al responsable de la operación.", requiresHumanApproval: false },
  { key: "visita-sin-seguimiento", agentKey: "commercial", area: "commercial", title: "Visita realizada sin siguiente paso", trigger: "Una visita terminó y no tiene seguimiento registrado.", expectedRecommendation: "Crear una tarea de seguimiento y proponer preguntas de calificación para el corredor.", requiresHumanApproval: true },
  { key: "arriendo-vencimiento", agentKey: "analytics", area: "rentals", title: "Cobro de arriendo próximo a vencer", trigger: "El arriendo tiene saldo pendiente y fecha de vencimiento cercana.", expectedRecommendation: "Preparar recordatorio interno y solicitar aprobación antes de cualquier comunicación externa.", requiresHumanApproval: true },
  { key: "mantencion-presupuesto", agentKey: "analytics", area: "maintenance", title: "Mantención con cotización recibida", trigger: "Existe una cotización de proveedor para una incidencia abierta.", expectedRecommendation: "Resumir alcance, monto y evidencia para aprobación; no generar orden de compra.", requiresHumanApproval: true },
  { key: "postventa-garantia", agentKey: "analytics", area: "post_sale", title: "Garantía con revisión pendiente", trigger: "Un caso de postventa tiene garantía vigente y evidencia incompleta.", expectedRecommendation: "Solicitar evidencia faltante y proponer responsable y fecha de seguimiento.", requiresHumanApproval: false },
  { key: "financiamiento-en-revision", agentKey: "analytics", area: "financing", title: "Financiamiento en revisión", trigger: "Una solicitud hipotecaria requiere nuevos antecedentes.", expectedRecommendation: "Listar antecedentes faltantes y riesgos; no aprobar, desembolsar ni modificar la solicitud.", requiresHumanApproval: true },
  { key: "cartera-sin-responsable", agentKey: "analytics", area: "commercial", title: "Propiedad sin corredor asignado", trigger: "Una propiedad activa no tiene responsable comercial.", expectedRecommendation: "Proponer reparto por carga actual y dejar la asignación para confirmación humana.", requiresHumanApproval: true }
]);

export const BROKER_AUTOMATION_RULES = Object.freeze([
  { key: "ficha_incompleta", title: "Control de ficha incompleta", trigger: "Una propiedad no tiene precio, ubicación o imagen principal.", action: "Crear prioridad interna para completar antecedentes.", approval: "No requiere aprobación para crear la tarea; no publica la propiedad." },
  { key: "documento_vencimiento", title: "Alerta documental", trigger: "Un documento legal vence dentro de 30 días.", action: "Crear alerta y proponer responsable de renovación.", approval: "La renovación y el envío se revisan por una persona." },
  { key: "visita_sin_seguimiento", title: "Seguimiento de visita", trigger: "Una visita termina sin próxima acción registrada.", action: "Crear borrador de tarea comercial.", approval: "El corredor confirma la acción y cualquier mensaje externo." },
  { key: "cobro_arriendo", title: "Cobro de arriendo", trigger: "Un cobro se acerca a su fecha de vencimiento.", action: "Preparar recordatorio y ordenarlo por prioridad.", approval: "Nunca envía correo, WhatsApp o SMS sin canal, consentimiento y aprobación." },
  { key: "mantencion_cotizada", title: "Revisión de mantención", trigger: "Se recibe una cotización para una incidencia abierta.", action: "Consolidar monto, proveedor y alcance en una solicitud de revisión.", approval: "No crea órdenes de compra ni confirma trabajos." }
]);

// Guías operativas visibles para el equipo. Son instrucciones internas y no
// sustituyen asesoría legal, bancaria ni la revisión de un corredor responsable.
export const BROKER_OPERATION_CHECKLISTS = Object.freeze({
  SALE: Object.freeze({
    EVALUACION_COMERCIAL: ["Confirmar datos mínimos del inmueble y propietario.", "Registrar precio de referencia y objetivo de la operación."],
    MANDATO_Y_PUBLICACION: ["Revisar vigencia del mandato.", "Validar ficha, fotografías y textos antes de publicar."],
    CALIFICACION_Y_VISITAS: ["Registrar contraparte, presupuesto y fecha de visita.", "Dejar próximo paso después de cada visita."],
    OFERTA_Y_NEGOCIACION: ["Comparar oferta, tasación y condiciones.", "Solicitar confirmación humana antes de aceptar, rechazar o comunicar."],
    PROMESA: ["Reunir antecedentes y condiciones acordadas.", "Derivar a revisión jurídica antes de firmar."],
    ESTUDIO_DE_TITULO: ["Registrar documentos recibidos y observaciones.", "No declarar el estudio aprobado sin responsable jurídico."],
    ESCRITURA: ["Confirmar borrador, comparecientes y fecha.", "Registrar hitos sin ejecutar firma externa desde EVOLUM."],
    INSCRIPCION_CBR: ["Registrar ingreso y estado informado por el Conservador.", "Mantener evidencia en el expediente."],
    ENTREGA_Y_POSTVENTA: ["Completar acta de entrega e inventario.", "Abrir caso de postventa o garantía si corresponde."]
  }),
  RENTAL: Object.freeze({
    CAPTACION: ["Registrar inmueble, propietario y disponibilidad."],
    EVALUACION_COMERCIAL: ["Revisar precio, competencia y condición comercial."],
    DEFINICION_DE_PRECIO: ["Registrar renta objetivo y condiciones."],
    EXCLUSIVIDAD: ["Confirmar mandato y vigencia."],
    PREPARACION_INMUEBLE: ["Completar fotografías, inventario y reparaciones previas."],
    PUBLICACION: ["Revisar piezas antes de publicar."],
    GENERACION_DE_LEADS: ["Calificar consultas y registrar origen."],
    EVALUACION_ARRENDATARIO: ["Reunir antecedentes con consentimiento y revisión humana."],
    VISITAS: ["Registrar visita, resultado y siguiente acción."],
    RESERVA: ["Registrar condiciones acordadas antes de comprometer el inmueble."],
    CONTRATO: ["Preparar antecedente para revisión y firma externa."],
    PAGO_INICIAL: ["Registrar comprobante y validación humana."],
    ENTREGA_LLAVES: ["Completar acta, inventario y fecha de próxima revisión."]
  }),
  ADMINISTRATION: Object.freeze({
    INCORPORACION: ["Validar propiedad, propietario y contrato vigente."],
    CONTRATO: ["Registrar partes, renta, día de pago y garantías."],
    REVISION_MENSUAL: ["Revisar cobros, gastos comunes y servicios básicos."],
    COBRO_Y_CONCILIACION: ["Comparar pago informado con el registro; no realizar cobros automáticos."],
    LIQUIDACION_Y_TRANSFERENCIA: ["Preparar liquidación y dejarla pendiente de aprobación."],
    MANTENCIONES_Y_SERVICIOS: ["Registrar incidencia, cotización y autorización."],
    RENOVACION: ["Revisar vigencia y condiciones antes de proponer renovación."],
    CIERRE: ["Guardar liquidación final, entrega y cierre de servicios."]
  })
});

export function brokerAgentScenario(key) {
  return BROKER_AGENT_SCENARIOS.find((scenario) => scenario.key === String(key || "").trim()) || null;
}

export function normalizeBrokerOperationType(value) {
  const normalized = String(value || "SALE").trim().toUpperCase();
  return Object.values(BROKER_OPERATION_TYPES).includes(normalized) ? normalized : null;
}

export function normalizeBrokerStage(operationType, value) {
  const type = normalizeBrokerOperationType(operationType) || BROKER_OPERATION_TYPES.SALE;
  const raw = String(value || "").trim().toUpperCase();
  const stages = stagesForBrokerOperation(type);
  if (stages.includes(raw)) return raw;
  return LEGACY_STAGE_MAP[type]?.[raw] || stages[0] || raw;
}

export function brokerStageChecklist(operationType, stage) {
  const type = normalizeBrokerOperationType(operationType) || BROKER_OPERATION_TYPES.SALE;
  const normalizedStage = normalizeBrokerStage(type, stage);
  return BROKER_OPERATION_CHECKLISTS[type]?.[normalizedStage] || [];
}

function numberValue(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function calculateBrokerCommission({ baseAmount, commissionRatePct, brokerSplitPct = 50, companySplitPct = 50 } = {}) {
  const base = Math.max(0, numberValue(baseAmount));
  const rate = Math.max(0, numberValue(commissionRatePct));
  const brokerSplit = Math.max(0, numberValue(brokerSplitPct));
  const companySplit = Math.max(0, numberValue(companySplitPct));
  if (Math.round((brokerSplit + companySplit) * 100) !== 10000) {
    return { ok: false, error: "La distribución entre corredor y empresa debe sumar 100%." };
  }
  const total = Math.round(base * (rate / 100));
  const brokerAmount = Math.round(total * (brokerSplit / 100));
  return {
    ok: true,
    baseAmount: base,
    commissionRatePct: rate,
    totalCommission: total,
    brokerSplitPct: brokerSplit,
    companySplitPct: companySplit,
    brokerAmount,
    companyAmount: total - brokerAmount
  };
}

export function propertyHealthSnapshot(property, relatedRecords = []) {
  const data = property?.data && typeof property.data === "object" && !Array.isArray(property.data) ? property.data : {};
  const has = (value) => value !== undefined && value !== null && String(value).trim() !== "";
  const checks = [
    ["Ubicación", has(data.address) && has(data.comuna || data.commune)],
    ["Precio", has(data.price)],
    ["Ficha técnica", has(data.propertyType || data.type) && has(data.meters || data.m2_totales || data.m2Total)],
    ["Fotografía principal", has(data.photoUrl) || (Array.isArray(data.gallery) && data.gallery.length > 0)],
    ["Propietario", has(data.ownerName) || relatedRecords.some((record) => record.recordType === "property_mandate")],
    ["Mandato", relatedRecords.some((record) => record.recordType === "property_mandate" && record.status === "SIGNED")],
    ["Documentación", relatedRecords.some((record) => ["property_document", "legal_document"].includes(record.recordType) && ["AVAILABLE", "APPROVED"].includes(record.status))],
    ["Seguimiento", relatedRecords.some((record) => ["visit", "broker_operation", "property_offer"].includes(record.recordType))]
  ];
  const complete = checks.filter(([, ok]) => ok).length;
  const score = Math.round((complete / checks.length) * 100);
  return {
    score,
    status: score >= 85 ? "LISTA_PARA_OPERAR" : score >= 60 ? "EN_PREPARACION" : "INCOMPLETA",
    completed: checks.filter(([, ok]) => ok).map(([label]) => label),
    missing: checks.filter(([, ok]) => !ok).map(([label]) => label)
  };
}

export function stagesForBrokerOperation(operationType) {
  switch (normalizeBrokerOperationType(operationType)) {
    case BROKER_OPERATION_TYPES.RENTAL:
      return RENTAL_STAGES;
    case BROKER_OPERATION_TYPES.ADMINISTRATION:
      return ADMINISTRATION_STAGES;
    case BROKER_OPERATION_TYPES.SALE:
      return SALE_STAGES;
    default:
      return [];
  }
}

export function validateBrokerStageTransition({ operationType, currentStage, nextStage }) {
  const stages = stagesForBrokerOperation(operationType);
  if (!String(nextStage || "").trim()) return { ok: false, error: "La etapa destino es requerida." };
  const current = normalizeBrokerStage(operationType, currentStage || stages[0]);
  const next = normalizeBrokerStage(operationType, nextStage);
  if (!stages.includes(next) && !["CANCELADA", "PERDIDA"].includes(next)) {
    return { ok: false, error: "La etapa indicada no pertenece al flujo de esta operación." };
  }
  if (next === "CANCELADA" || next === "PERDIDA") return { ok: true, current, next, terminal: true };
  const currentIndex = stages.indexOf(current);
  const nextIndex = stages.indexOf(next);
  if (currentIndex === -1) return { ok: false, error: "La operación tiene una etapa actual inválida." };
  if (nextIndex > currentIndex + 1) {
    return { ok: false, error: "No se puede saltar etapas. Avanza una etapa a la vez o registra el evento faltante." };
  }
  if (TERMINAL_STAGES.has(current) && current !== next) {
    return { ok: false, error: "La operación ya está cerrada. Crea una nueva operación si debe reiniciarse." };
  }
  return { ok: true, current, next, terminal: TERMINAL_STAGES.has(next) };
}

export function isBrokerRecordArea(area) {
  return Object.prototype.hasOwnProperty.call(BROKER_RECORD_AREAS, String(area || ""));
}

export function brokerRecordDefinition(recordType) {
  return BROKER_RECORD_DEFINITIONS[String(recordType || "").trim().toLowerCase()] || null;
}

export function validateBrokerRecord({ recordType, data, status }) {
  const definition = brokerRecordDefinition(recordType);
  if (!definition) return { ok: false, error: "Tipo de registro Broker no válido." };
  const payload = data && typeof data === "object" && !Array.isArray(data) ? data : {};
  const missing = definition.required.filter((key) => {
    const value = payload[key];
    return value === undefined || value === null || String(value).trim() === "";
  });
  if (missing.length) return { ok: false, error: `Faltan datos requeridos: ${missing.join(", ")}.` };
  const normalizedStatus = String(status || definition.statuses[0]).trim().toUpperCase();
  if (!definition.statuses.includes(normalizedStatus)) {
    return { ok: false, error: `El estado ${normalizedStatus} no corresponde a ${definition.label}.` };
  }
  return { ok: true, status: normalizedStatus, definition };
}
