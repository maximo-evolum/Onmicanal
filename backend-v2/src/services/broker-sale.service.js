import { SALE_STAGES } from "./broker-workflows.service.js";

const UPPER = (value, fallback = "") => {
  const result = String(value ?? "").trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/\s+/g, "_");
  return result || fallback;
};

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

export const BROKER_SALE_OPTIONS = Object.freeze({
  qualificationStatuses: ["PENDIENTE", "CALIFICADO", "PREAPROBADO", "NO_CALIFICA"],
  offerStatuses: ["PENDIENTE", "RECIBIDA", "EN_NEGOCIACION", "ACEPTADA", "RECHAZADA", "RETIRADA"],
  promiseStatuses: ["PENDIENTE", "EN_REVISION", "PENDIENTE_FIRMA", "FIRMADA", "CAIDA"],
  titleStudyStatuses: ["PENDIENTE", "EN_REVISION", "OBSERVADO", "APROBADO"],
  financingStatuses: ["PENDIENTE", "NO_REQUIERE", "EN_EVALUACION", "PREAPROBADO", "APROBADO", "RECHAZADO"],
  bankAppraisalStatuses: ["PENDIENTE", "NO_REQUIERE", "SOLICITADA", "APROBADA", "OBSERVADA", "RECHAZADA"],
  deedStatuses: ["PENDIENTE", "EN_PREPARACION", "AGENDADA", "FIRMADA", "OBSERVADA"],
  cbrStatuses: ["PENDIENTE", "INGRESADA", "OBSERVADA", "INSCRITA"],
  handoverStatuses: ["PENDIENTE", "AGENDADA", "COMPLETADA", "OBSERVADA"],
});

export function normalizeBrokerSaleCase(input = {}) {
  const values = BROKER_SALE_OPTIONS;
  const checkpoints = input.checkpoints && typeof input.checkpoints === "object" && !Array.isArray(input.checkpoints) ? input.checkpoints : {};
  return {
    buyerId: text(input.buyerId) || null,
    buyerName: text(input.buyerName || input.clientName) || null,
    status: allowed(input.status, ["ACTIVA", "PAUSADA", "CANCELADA", "CERRADA"], "ACTIVA"),
    buyerQualificationStatus: allowed(input.buyerQualificationStatus, values.qualificationStatuses, "PENDIENTE"),
    preapprovalBank: text(input.preapprovalBank) || null,
    preapprovalAmount: decimal(input.preapprovalAmount),
    preapprovalExpiresAt: date(input.preapprovalExpiresAt),
    offerAmount: decimal(input.offerAmount),
    currency: UPPER(input.currency, "CLP"),
    offerStatus: allowed(input.offerStatus, values.offerStatuses, "PENDIENTE"),
    offerReceivedAt: date(input.offerReceivedAt),
    offerRespondedAt: date(input.offerRespondedAt),
    offerConditions: text(input.offerConditions) || null,
    promiseStatus: allowed(input.promiseStatus, values.promiseStatuses, "PENDIENTE"),
    promiseSignedAt: date(input.promiseSignedAt),
    promiseAmount: decimal(input.promiseAmount),
    promisePenaltyPct: decimal(input.promisePenaltyPct),
    titleStudyStatus: allowed(input.titleStudyStatus, values.titleStudyStatuses, "PENDIENTE"),
    titleStudyNotes: text(input.titleStudyNotes) || null,
    bankAppraisalStatus: allowed(input.bankAppraisalStatus, values.bankAppraisalStatuses, "PENDIENTE"),
    financingStatus: allowed(input.financingStatus, values.financingStatuses, "PENDIENTE"),
    deedStatus: allowed(input.deedStatus, values.deedStatuses, "PENDIENTE"),
    deedScheduledAt: date(input.deedScheduledAt),
    deedSignedAt: date(input.deedSignedAt),
    cbrStatus: allowed(input.cbrStatus, values.cbrStatuses, "PENDIENTE"),
    cbrEntryNumber: text(input.cbrEntryNumber) || null,
    cbrRegisteredAt: date(input.cbrRegisteredAt),
    handoverStatus: allowed(input.handoverStatus, values.handoverStatuses, "PENDIENTE"),
    handoverAt: date(input.handoverAt),
    handoverRecipient: text(input.handoverRecipient) || null,
    checkpoints,
  };
}

function recordData(record) {
  return record?.data && typeof record.data === "object" && !Array.isArray(record.data) ? record.data : {};
}

function hasRecord(records, recordType, statuses = []) {
  return records.some((record) => record.recordType === recordType && (!statuses.length || statuses.includes(UPPER(record.status))));
}

function hasCompletedVisit(records) {
  return records.some((record) => record.recordType === "visit" && ["COMPLETADA", "COMPLETED", "REALIZADA", "ACTIVE"].includes(UPPER(record.status)));
}

function isReviewConfirmed(saleCase, key) {
  const value = saleCase?.checkpoints && typeof saleCase.checkpoints === "object" ? saleCase.checkpoints[key] : null;
  return Boolean(value && (value.confirmedAt || value === true));
}

export function brokerSaleStageRequirements({ targetStage, saleCase, capture, relatedRecords = [] }) {
  const target = UPPER(targetStage);
  const caseData = saleCase || {};
  const requirements = [];
  const add = (key, label, ready) => requirements.push({ key, label, ready: Boolean(ready) });

  if (!SALE_STAGES.includes(target)) return requirements;
  if (target === "MANDATO_Y_PUBLICACION") {
    add("captacion", "Captación lista para mandato o mandato firmado", ["LISTA_PARA_MANDATO", "MANDATO_FIRMADO"].includes(UPPER(capture?.status)) || hasRecord(relatedRecords, "property_mandate", ["SIGNED"]));
    add("tasacion", "Tasación o precio referencial validado", Boolean(capture?.preliminaryAppraisal || capture?.suggestedPrice) || hasRecord(relatedRecords, "property_appraisal", ["APPROVED"]));
  }
  if (target === "CALIFICACION_Y_VISITAS") {
    add("mandato", "Mandato firmado y vigente", hasRecord(relatedRecords, "property_mandate", ["SIGNED"]) || UPPER(capture?.status) === "MANDATO_FIRMADO");
    add("publicacion", "Ficha preparada o publicación registrada", ["LISTA_PARA_PUBLICAR", "EN_PREPARACION"].includes(UPPER(capture?.publicationReadiness)) || hasRecord(relatedRecords, "marketing_publication", ["PUBLISHED", "PENDING_REVIEW"]));
  }
  if (target === "OFERTA_Y_NEGOCIACION") {
    const qualifies = ["CALIFICADO", "PREAPROBADO"].includes(UPPER(caseData.buyerQualificationStatus));
    const cash = UPPER(caseData.financingStatus) === "NO_REQUIERE";
    add("comprador", "Comprador calificado", Boolean(text(caseData.buyerName)) && qualifies);
    add("financiamiento", "Preaprobación vigente o compra sin financiamiento", cash || (Boolean(text(caseData.preapprovalBank)) && decimal(caseData.preapprovalAmount) !== null));
    add("visita", "Al menos una visita realizada", hasCompletedVisit(relatedRecords));
  }
  if (target === "PROMESA") {
    add("oferta", "Oferta aceptada con monto y fecha", UPPER(caseData.offerStatus) === "ACEPTADA" && decimal(caseData.offerAmount) !== null && Boolean(caseData.offerReceivedAt));
    add("revision_oferta", "Respuesta de oferta confirmada por responsable", Boolean(caseData.offerRespondedAt) && isReviewConfirmed(caseData, "oferta"));
  }
  if (target === "ESTUDIO_DE_TITULO") {
    add("promesa", "Promesa firmada", UPPER(caseData.promiseStatus) === "FIRMADA" && Boolean(caseData.promiseSignedAt) && decimal(caseData.promiseAmount) !== null);
    add("multa", "Cláusula de incumplimiento revisada", decimal(caseData.promisePenaltyPct) !== null && isReviewConfirmed(caseData, "promesa"));
  }
  if (target === "ESCRITURA") {
    add("titulos", "Estudio de títulos aprobado por revisión humana", UPPER(caseData.titleStudyStatus) === "APROBADO" && Boolean(caseData.titleStudyReviewedAt) && isReviewConfirmed(caseData, "titulos"));
    add("financiamiento_final", "Financiamiento aprobado o no requerido", ["APROBADO", "NO_REQUIERE"].includes(UPPER(caseData.financingStatus)));
    add("tasacion_banco", "Tasación bancaria aprobada o no requerida", ["APROBADA", "NO_REQUIERE"].includes(UPPER(caseData.bankAppraisalStatus)));
  }
  if (target === "INSCRIPCION_CBR") {
    add("escritura", "Escritura firmada y revisada", UPPER(caseData.deedStatus) === "FIRMADA" && Boolean(caseData.deedSignedAt) && isReviewConfirmed(caseData, "escritura"));
  }
  if (target === "ENTREGA_Y_POSTVENTA") {
    add("inscripcion", "Inscripción CBR confirmada", UPPER(caseData.cbrStatus) === "INSCRITA" && Boolean(caseData.cbrRegisteredAt) && Boolean(text(caseData.cbrEntryNumber)) && isReviewConfirmed(caseData, "inscripcion"));
    add("entrega", "Entrega completada y recibida", UPPER(caseData.handoverStatus) === "COMPLETADA" && Boolean(caseData.handoverAt) && Boolean(text(caseData.handoverRecipient)) && isReviewConfirmed(caseData, "entrega"));
  }
  return requirements;
}

export function brokerSaleReadiness(input) {
  const requirements = brokerSaleStageRequirements(input);
  return { requirements, ready: requirements.every((item) => item.ready), missing: requirements.filter((item) => !item.ready).map((item) => item.label) };
}

export function saleCheckpointKeyForStage(stage) {
  return ({ PROMESA: "oferta", ESTUDIO_DE_TITULO: "promesa", ESCRITURA: "titulos", INSCRIPCION_CBR: "escritura", ENTREGA_Y_POSTVENTA: "inscripcion" })[UPPER(stage)] || null;
}
