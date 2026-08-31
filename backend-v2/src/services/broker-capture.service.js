const CAPTURE_STATUSES = new Set([
  "PROSPECTO",
  "VISITA_AGENDADA",
  "EVALUACION_COMERCIAL",
  "PENDIENTE_DECISION_PROPIETARIO",
  "LISTA_PARA_MANDATO",
  "MANDATO_FIRMADO",
  "DESCARTADA"
]);

const SERVICES = new Set(["VENTA", "ARRIENDO", "ADMINISTRACION"]);
const TITLE_STATUSES = new Set(["PENDIENTE", "EN_REVISION", "REVISADO_SIN_OBSERVACIONES", "REVISADO_CON_OBSERVACIONES"]);
const REGULARIZATION_STATUSES = new Set(["POR_REVISAR", "REGULARIZADA", "CON_OBSERVACIONES", "NO_REGULARIZADA"]);
const OWNERSHIP_STATUSES = new Set(["POR_CONFIRMAR", "DOMINIO_VIGENTE", "POSESION_EFECTIVA_PENDIENTE", "OTRO"]);
const READINESS_STATUSES = new Set(["PENDIENTE", "EN_PREPARACION", "LISTA_PARA_PUBLICAR", "BLOQUEADA"]);

function text(value, fallback = "") {
  const result = String(value ?? "").trim();
  return result || fallback;
}

function upper(value, fallback = "") {
  return text(value, fallback).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
}

function decimal(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(String(value).replace(/[^0-9,.-]/g, "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

function integer(value) {
  const parsed = decimal(value);
  return parsed === null ? null : Math.max(0, Math.trunc(parsed));
}

function date(value) {
  if (!value) return null;
  const result = new Date(value);
  return Number.isNaN(result.getTime()) ? null : result;
}

function stringList(value) {
  if (Array.isArray(value)) return [...new Set(value.map((item) => text(item)).filter(Boolean))];
  return text(value).split(/[\n,]+/).map((item) => item.trim()).filter(Boolean);
}

function normalized(value, allowed, fallback) {
  const result = upper(value, fallback);
  return allowed.has(result) ? result : fallback;
}

export function captureChecklist(input = {}) {
  const isApartment = upper(input.propertyType) === "DEPARTAMENTO";
  const photoUrls = stringList(input.photoUrls || input.gallery || input.galleryUrls || input.photoUrl);
  const checks = [
    { key: "propietario", label: "Propietario identificado", ready: Boolean(text(input.ownerName)) },
    { key: "direccion", label: "Dirección y comuna", ready: Boolean(text(input.address) && text(input.comuna || input.commune)) },
    { key: "visita", label: "Visita presencial registrada", ready: Boolean(input.siteVisitAt) },
    { key: "superficie", label: "Superficie útil y total", ready: decimal(input.usableSquareMeters ?? input.builtM2 ?? input.meters) !== null && decimal(input.totalSquareMeters ?? input.landM2 ?? input.meters) !== null },
    { key: "tasacion", label: "Tasación y precio sugerido", ready: decimal(input.preliminaryAppraisal) !== null && decimal(input.suggestedPrice) !== null },
    { key: "titulo", label: "Preestudio de título", ready: ["REVISADO_SIN_OBSERVACIONES", "REVISADO_CON_OBSERVACIONES"].includes(upper(input.preliminaryTitleStatus)) },
    { key: "regularizacion", label: "Regularización revisada", ready: ["REGULARIZADA", "CON_OBSERVACIONES", "NO_REGULARIZADA"].includes(upper(input.regularizationStatus)) },
    { key: "material", label: "Fotos o material visual", ready: photoUrls.length > 0 },
    { key: "plano", label: "Plano o medición", ready: Boolean(text(input.floorPlanUrl)) },
    { key: "aceptacion", label: "Precio aceptado por propietario", ready: Boolean(input.ownerAcceptedEvaluationAt) },
  ];
  if (isApartment) checks.push({ key: "edificio", label: "Datos de edificio", ready: integer(input.buildingFloors) !== null && integer(input.unitsPerFloor) !== null && integer(input.elevators) !== null });
  return checks;
}

export function captureReadiness(input = {}) {
  const checks = captureChecklist(input);
  const completed = checks.filter((check) => check.ready);
  const missing = checks.filter((check) => !check.ready).map((check) => check.label);
  return { checks, completed: completed.length, total: checks.length, score: checks.length ? Math.round((completed.length / checks.length) * 100) : 0, missing };
}

export function normalizeBrokerCapture(input = {}) {
  const ownerExpectedPrice = decimal(input.ownerExpectedPrice);
  const suggestedPrice = decimal(input.suggestedPrice);
  const preliminaryAppraisal = decimal(input.preliminaryAppraisal);
  const base = {
    captureOrigin: text(input.captureOrigin) || null,
    intendedService: normalized(input.intendedService || input.operation, SERVICES, "VENTA"),
    status: normalized(input.status || input.captureStatus, CAPTURE_STATUSES, "PROSPECTO"),
    captureBrokerId: text(input.captureBrokerId || input.assignedToId) || null,
    firstContactAt: date(input.firstContactAt || input.captureDate),
    siteVisitAt: date(input.siteVisitAt),
    ownerExpectedPrice,
    suggestedPrice,
    preliminaryAppraisal,
    currency: upper(input.currency, "CLP"),
    marketAnalysisAt: date(input.marketAnalysisAt),
    comparableSummary: text(input.comparableSummary) || null,
    priceGapPct: ownerExpectedPrice && suggestedPrice ? Number((((ownerExpectedPrice - suggestedPrice) / suggestedPrice) * 100).toFixed(3)) : decimal(input.priceGapPct),
    ownerAcceptedEvaluationAt: date(input.ownerAcceptedEvaluationAt),
    preliminaryTitleStatus: normalized(input.preliminaryTitleStatus, TITLE_STATUSES, "PENDIENTE"),
    titleReviewNotes: text(input.titleReviewNotes) || null,
    regularizationStatus: normalized(input.regularizationStatus, REGULARIZATION_STATUSES, "POR_REVISAR"),
    irregularConstructionNote: text(input.irregularConstructionNote) || null,
    ownershipStatus: normalized(input.ownershipStatus, OWNERSHIP_STATUSES, "POR_CONFIRMAR"),
    propertyConditionAtHandover: text(input.propertyConditionAtHandover) || null,
    kitchenType: text(input.kitchenType) || null,
    heatingSystem: text(input.heatingSystem) || null,
    gasSystem: text(input.gasSystem) || null,
    buildingFloors: integer(input.buildingFloors),
    unitsPerFloor: integer(input.unitsPerFloor),
    elevators: integer(input.elevators),
    commonExpenses: decimal(input.commonExpenses),
    commonAreas: stringList(input.commonAreas),
    photoUrls: stringList(input.photoUrls || input.gallery || input.galleryUrls || input.photoUrl),
    videoUrls: stringList(input.videoUrls || input.videoUrl),
    floorPlanUrl: text(input.floorPlanUrl) || null,
    documentChecklist: Array.isArray(input.documentChecklist) ? input.documentChecklist : [],
    publicationReadiness: normalized(input.publicationReadiness, READINESS_STATUSES, "PENDIENTE"),
    rejectionReason: text(input.rejectionReason) || null,
    metadata: input.metadata && typeof input.metadata === "object" && !Array.isArray(input.metadata) ? input.metadata : {},
  };
  return base;
}

export function validateBrokerCapture(input = {}) {
  const normalized = normalizeBrokerCapture(input);
  const errors = [];
  if (normalized.status === "DESCARTADA" && !normalized.rejectionReason) errors.push("Indica por qué se descartó la captación.");
  if (["LISTA_PARA_MANDATO", "MANDATO_FIRMADO"].includes(normalized.status)) {
    const readiness = captureReadiness({ ...input, ...normalized });
    if (readiness.missing.length) errors.push(`Para avanzar falta: ${readiness.missing.join(", ")}.`);
  }
  if (normalized.preliminaryTitleStatus === "REVISADO_CON_OBSERVACIONES" && !normalized.titleReviewNotes) errors.push("Describe las observaciones detectadas en el preestudio de título.");
  if (["CON_OBSERVACIONES", "NO_REGULARIZADA"].includes(normalized.regularizationStatus) && !normalized.irregularConstructionNote) errors.push("Describe la observación o construcción no regularizada.");
  if (normalized.intendedService === "ADMINISTRACION" && !normalized.propertyConditionAtHandover) errors.push("Para administración registra la condición de entrega de la propiedad.");
  return { ok: errors.length === 0, errors, normalized, readiness: captureReadiness({ ...input, ...normalized }) };
}

export const BROKER_CAPTURE_OPTIONS = Object.freeze({
  statuses: [...CAPTURE_STATUSES],
  services: [...SERVICES],
  titleStatuses: [...TITLE_STATUSES],
  regularizationStatuses: [...REGULARIZATION_STATUSES],
  ownershipStatuses: [...OWNERSHIP_STATUSES],
  readinessStatuses: [...READINESS_STATUSES]
});
