import { RENTAL_STAGES } from "./broker-workflows.service.js";

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

export const BROKER_RENTAL_OPTIONS = Object.freeze({
  applicantStatuses: ["PENDIENTE", "EN_REVISION", "APROBADA", "RECHAZADA"],
  guarantorStatuses: ["PENDIENTE", "NO_REQUIERE", "EN_REVISION", "APROBADO", "RECHAZADO"],
  reservationStatuses: ["PENDIENTE", "SOLICITADA", "CONFIRMADA", "VENCIDA", "CANCELADA"],
  contractStatuses: ["PENDIENTE", "EN_PREPARACION", "PENDIENTE_FIRMA", "FIRMADO", "OBSERVADO"],
  initialPaymentStatuses: ["PENDIENTE", "INFORMADO", "VERIFICADO", "PARCIAL", "VENCIDO"],
  handoverStatuses: ["PENDIENTE", "AGENDADA", "COMPLETADA", "OBSERVADA"],
});

export function normalizeBrokerRentalCase(input = {}) {
  const values = BROKER_RENTAL_OPTIONS;
  const checkpoints = input.checkpoints && typeof input.checkpoints === "object" && !Array.isArray(input.checkpoints) ? input.checkpoints : {};
  const paymentDayValue = decimal(input.paymentDay);
  return {
    leaseTenantId: text(input.leaseTenantId) || null,
    tenantName: text(input.tenantName || input.clientName) || null,
    status: allowed(input.status, ["ACTIVA", "PAUSADA", "CANCELADA", "CERRADA"], "ACTIVA"),
    applicantTaxStatus: allowed(input.applicantTaxStatus, values.applicantStatuses, "PENDIENTE"),
    applicantCommercialStatus: allowed(input.applicantCommercialStatus, values.applicantStatuses, "PENDIENTE"),
    declaredIncome: decimal(input.declaredIncome),
    guarantorName: text(input.guarantorName) || null,
    guarantorEvaluationStatus: allowed(input.guarantorEvaluationStatus, values.guarantorStatuses, "PENDIENTE"),
    applicationReceivedAt: date(input.applicationReceivedAt),
    applicationReviewedAt: date(input.applicationReviewedAt),
    reservationStatus: allowed(input.reservationStatus, values.reservationStatuses, "PENDIENTE"),
    reservationAmount: decimal(input.reservationAmount),
    reservationExpiresAt: date(input.reservationExpiresAt),
    contractStatus: allowed(input.contractStatus, values.contractStatuses, "PENDIENTE"),
    monthlyRent: decimal(input.monthlyRent),
    currency: UPPER(input.currency, "CLP"),
    contractStartAt: date(input.contractStartAt),
    contractEndAt: date(input.contractEndAt),
    paymentDay: paymentDayValue !== null && paymentDayValue >= 1 && paymentDayValue <= 31 ? Math.trunc(paymentDayValue) : null,
    depositAmount: decimal(input.depositAmount),
    contractSignedAt: date(input.contractSignedAt),
    initialPaymentStatus: allowed(input.initialPaymentStatus, values.initialPaymentStatuses, "PENDIENTE"),
    initialPaymentAmount: decimal(input.initialPaymentAmount),
    initialPaymentReceivedAt: date(input.initialPaymentReceivedAt),
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
function confirmed(rentalCase, key) {
  const value = rentalCase?.checkpoints && typeof rentalCase.checkpoints === "object" ? rentalCase.checkpoints[key] : null;
  return Boolean(value && (value.confirmedAt || value === true));
}

export function brokerRentalStageRequirements({ targetStage, rentalCase, capture, relatedRecords = [] }) {
  const target = UPPER(targetStage);
  const data = rentalCase || {};
  const requirements = [];
  const add = (key, label, ready) => requirements.push({ key, label, ready: Boolean(ready) });
  if (!RENTAL_STAGES.includes(target)) return requirements;

  if (target === "DEFINICION_DE_PRECIO") add("renta_referencial", "Renta objetivo o tasación comercial registrada", Boolean(capture?.suggestedPrice || capture?.preliminaryAppraisal));
  if (target === "EXCLUSIVIDAD") add("mandato", "Mandato de arriendo firmado o captación confirmada", UPPER(capture?.status) === "MANDATO_FIRMADO" || hasRecord(relatedRecords, "property_mandate", ["SIGNED"]));
  if (target === "PREPARACION_INMUEBLE") add("precio", "Precio y condiciones comerciales definidos", Boolean(capture?.suggestedPrice || data.monthlyRent));
  if (target === "PUBLICACION") add("ficha", "Ficha preparada con antecedentes visuales", ["LISTA_PARA_PUBLICAR", "EN_PREPARACION"].includes(UPPER(capture?.publicationReadiness)) || Boolean(capture?.photoUrls));
  if (target === "GENERACION_DE_LEADS") add("publicacion", "Publicación revisada o registrada", hasRecord(relatedRecords, "marketing_publication", ["PUBLISHED", "PENDING_REVIEW"]));
  if (target === "EVALUACION_ARRENDATARIO") add("postulante", "Postulante identificado y postulación recibida", Boolean(text(data.tenantName)) && (Boolean(data.applicationReceivedAt) || hasRecord(relatedRecords, "rental_application", ["RECEIVED", "UNDER_REVIEW", "APPROVED"])));
  if (target === "VISITAS") {
    add("evaluacion_tributaria", "Evaluación tributaria aprobada", UPPER(data.applicantTaxStatus) === "APROBADA");
    add("evaluacion_comercial", "Evaluación comercial aprobada", UPPER(data.applicantCommercialStatus) === "APROBADA");
    add("aval", "Aval aprobado o no requerido", ["APROBADO", "NO_REQUIERE"].includes(UPPER(data.guarantorEvaluationStatus)));
    add("revision", "Evaluación revisada por una persona autorizada", Boolean(data.applicationReviewedAt) && confirmed(data, "evaluacion"));
  }
  if (target === "RESERVA") {
    add("visita", "Al menos una visita realizada", hasCompletedVisit(relatedRecords));
    add("postulante", "Postulante evaluado y aprobado", UPPER(data.applicantTaxStatus) === "APROBADA" && UPPER(data.applicantCommercialStatus) === "APROBADA");
  }
  if (target === "CONTRATO") {
    add("reserva", "Reserva confirmada con monto y vencimiento", UPPER(data.reservationStatus) === "CONFIRMADA" && decimal(data.reservationAmount) !== null && Boolean(data.reservationExpiresAt));
    add("revision_reserva", "Reserva confirmada por una persona autorizada", confirmed(data, "reserva"));
  }
  if (target === "PAGO_INICIAL") {
    add("contrato", "Contrato firmado con renta, fechas, garantía y día de pago", UPPER(data.contractStatus) === "FIRMADO" && Boolean(data.contractSignedAt) && decimal(data.monthlyRent) !== null && Boolean(data.contractStartAt) && decimal(data.depositAmount) !== null && Number(data.paymentDay) >= 1);
    add("revision_contrato", "Contrato confirmado por una persona autorizada", confirmed(data, "contrato"));
  }
  if (target === "ENTREGA_LLAVES") {
    add("pago_inicial", "Pago inicial verificado con monto y fecha", UPPER(data.initialPaymentStatus) === "VERIFICADO" && decimal(data.initialPaymentAmount) !== null && Boolean(data.initialPaymentReceivedAt));
    add("revision_pago", "Pago inicial confirmado por una persona autorizada", confirmed(data, "pago_inicial"));
    add("entrega", "Entrega de llaves completada con responsable", UPPER(data.handoverStatus) === "COMPLETADA" && Boolean(data.handoverAt) && Boolean(text(data.handoverRecipient)) && confirmed(data, "entrega"));
  }
  return requirements;
}

export function brokerRentalReadiness(input) {
  const requirements = brokerRentalStageRequirements(input);
  return { requirements, ready: requirements.every((item) => item.ready), missing: requirements.filter((item) => !item.ready).map((item) => item.label) };
}
