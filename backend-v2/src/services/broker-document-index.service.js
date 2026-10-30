/** Archivo: Construye el índice documental de Broker OS desde registros existentes, sin duplicarlos. */

export const BROKER_DOCUMENT_INDEX_VERSION = "BROKER_DOCUMENT_INDEX_V1";

const SOURCE_DEFINITIONS = Object.freeze({
  property_appraisal: { area: "commercial", label: "Tasación", category: "Captación", type: () => "Tasación de propiedad", evidence: ["evidenceReference", "appraisalReference", "documentReference"], expiry: ["validUntil", "expiresAt"], people: ["ownerName", "appraiserName"] },
  property_document: { area: "documents", label: "Documento de propiedad", category: "Documento de propiedad", type: (data) => text(data.documentType, "Documento de propiedad"), evidence: ["evidenceReference", "fileName", "fileUrl", "storageKey", "documentUrl"], expiry: ["expiresAt", "expirationDate", "validUntil"], people: ["ownerName", "subjectName"] },
  legal_document: { area: "documents", label: "Documento legal", category: "Documento legal", type: (data) => text(data.documentType, "Documento legal"), evidence: ["evidenceReference", "fileName", "fileUrl", "storageKey", "documentUrl"], expiry: ["expiresAt", "expirationDate", "validUntil"], people: ["ownerName", "subjectName", "buyerName"] },
  digital_signature: { area: "documents", label: "Firma registrada", category: "Firma", type: (data) => text(data.documentType, "Firma registrada"), evidence: ["evidenceReference", "signedDocumentReference", "fileName", "fileUrl", "storageKey"], expiry: ["expiresAt", "expirationDate"], people: ["signerName", "subjectName", "ownerName", "buyerName", "tenantName"], signature: true },
  data_processing_consent: { area: "documents", label: "Consentimiento de datos", category: "Consentimiento", type: () => "Consentimiento de tratamiento de datos", evidence: ["evidenceReference"], expiry: ["expiresAt", "expirationDate"], people: ["subjectName"] },
  communication_consent: { area: "documents", label: "Consentimiento de comunicaciones", category: "Consentimiento", type: () => "Consentimiento de comunicaciones", evidence: ["evidenceReference"], expiry: ["expiresAt", "expirationDate"], people: ["subjectName"] },
  external_authorization: { area: "documents", label: "Autorización externa", category: "Consentimiento", type: () => "Autorización de integración externa", evidence: ["evidenceReference"], expiry: ["expiresAt", "expirationDate"], people: ["subjectName"] },
  property_mandate: { area: "commercial", label: "Mandato", category: "Captación", type: () => "Mandato de corretaje", evidence: ["evidenceReference", "signedDocumentReference", "documentReference"], expiry: ["endDate", "expiresAt"], people: ["ownerName"] },
  property_offer: { area: "commercial", label: "Oferta", category: "Negocio", type: () => "Oferta de compra", evidence: ["evidenceReference", "offerReference", "documentReference"], expiry: ["expiresAt", "validUntil"], people: ["buyerName"] },
  property_promise: { area: "commercial", label: "Promesa", category: "Negocio", type: () => "Promesa de compraventa", evidence: ["evidenceReference", "signedDocumentReference", "documentReference"], expiry: ["expiresAt", "signingDeadline"], people: ["buyerName", "ownerName"], signature: true },
  rental_application: { area: "rentals", label: "Postulación", category: "Arriendo", type: () => "Postulación de arriendo", evidence: ["evidenceReference", "applicationReference", "documentReference"], expiry: ["expiresAt", "validUntil"], people: ["tenantName", "guarantorName"] },
  rental_contract: { area: "rentals", label: "Contrato", category: "Arriendo", type: () => "Contrato de arriendo", evidence: ["evidenceReference", "signedDocumentReference", "contractReference", "documentReference"], expiry: ["contractEndAt", "endDate", "expiresAt"], people: ["tenantName", "ownerName"], signature: true },
  administration_profile: { area: "rentals", label: "Encargo de administración", category: "Administración", type: () => "Encargo de administración", evidence: ["evidenceReference", "documentReference", "managementAgreementReference"], expiry: ["endDate", "expiresAt"], people: ["ownerName", "tenantName"] },
  administration_liquidation: { area: "rentals", label: "Liquidación", category: "Administración", type: () => "Liquidación de administración", evidence: ["evidenceReference", "documentReference", "liquidationReference"], expiry: [], people: ["ownerName", "tenantName"] },
  broker_capture_prospect: { area: "commercial", label: "Captación", category: "Captación", captureDocuments: true }
});

export const BROKER_DOCUMENT_SOURCE_TYPES = Object.freeze(Object.keys(SOURCE_DEFINITIONS));

export function brokerDocumentSourceArea(recordType) {
  return SOURCE_DEFINITIONS[String(recordType || "")]?.area || null;
}

function text(value, fallback = "") {
  const result = String(value ?? "").trim();
  return result || fallback;
}

function dataOf(record) {
  return record?.data && typeof record.data === "object" && !Array.isArray(record.data) ? record.data : {};
}

function objectOf(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function dateValue(value) {
  const raw = text(value);
  if (!raw) return null;
  const date = new Date(raw.length === 10 ? `${raw}T12:00:00.000Z` : raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

function firstValue(data, keys) {
  for (const key of keys) {
    const value = text(data?.[key]);
    if (value) return value;
  }
  return "";
}

function uniqueTexts(values) {
  return [...new Set(values.map((value) => text(value)).filter(Boolean))];
}

function expiryFor(value, now) {
  const date = dateValue(value);
  if (!date) return { expiresAt: null, state: "NO_EXPIRY", daysUntil: null };
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const due = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  const daysUntil = Math.round((due - today) / 86_400_000);
  return { expiresAt: date.toISOString().slice(0, 10), state: daysUntil < 0 ? "OVERDUE" : daysUntil <= 60 ? "EXPIRING_60" : "CURRENT", daysUntil };
}

const CAPTURE_DOCUMENT_LABELS = Object.freeze({
  FOTOGRAFIA: "Fotografía",
  PLANO: "Plano o medición",
  TITULO: "Antecedente de título",
  MANDATO: "Mandato adjunto",
  OTRO: "Otro antecedente"
});

function captureDocumentItems(record, propertiesById, now) {
  const data = dataOf(record);
  const conversion = objectOf(data.conversion);
  const propertyId = text(data.propertyId) || text(conversion.propertyId) || null;
  const property = propertyId ? propertiesById.get(propertyId) : null;
  const propertyTitle = property
    ? text(property.title, "Propiedad asociada")
    : text(conversion.propertyTitle, text(record.title, "Captación sin propiedad convertida"));
  const parties = uniqueTexts([data.ownerName, data.ownerEmail, data.ownerRut]);
  const documents = Array.isArray(data.captureDocuments) ? data.captureDocuments : [];
  return documents.map((rawDocument, position) => {
    const document = objectOf(rawDocument);
    const id = text(document.id, `captacion-${position + 1}`);
    const role = text(document.role, "OTRO").toUpperCase();
    const expiresAt = firstValue(document, ["expiresAt", "expirationDate", "validUntil"]);
    return {
      id: `capture-document:${record.id}:${id}`,
      sourceRecordId: record.id,
      title: text(document.originalName, text(document.title, "Antecedente de captación")),
      category: "Captación",
      documentType: CAPTURE_DOCUMENT_LABELS[role] || "Antecedente de captación",
      documentStatus: "LINKED",
      propertyId,
      propertyTitle,
      parties,
      evidence: {
        status: "REGISTERED",
        reference: id,
        note: "Archivo privado vinculado desde la captación; se conserva en su expediente de origen."
      },
      expiry: expiryFor(expiresAt, now),
      signature: { status: "NOT_APPLICABLE", externalIntegration: false, note: "El archivo adjunto no representa una firma electrónica externa." },
      source: { recordType: record.recordType, sourceArea: "commercial", label: "Captación", href: `/realty?view=operations&prospectId=${encodeURIComponent(record.id)}` },
      updatedAt: record.updatedAt?.toISOString?.() || text(record.updatedAt) || null
    };
  });
}

function documentItem(record, propertiesById, now) {
  const definition = SOURCE_DEFINITIONS[record.recordType];
  if (!definition) return null;
  const data = dataOf(record);
  const propertyId = text(data.propertyId) || null;
  const property = propertyId ? propertiesById.get(propertyId) : null;
  const evidenceReference = firstValue(data, definition.evidence);
  const expiry = expiryFor(firstValue(data, definition.expiry), now);
  const parties = uniqueTexts(definition.people.map((key) => data[key]));
  const status = text(record.status, "PENDING").toUpperCase();
  // El estado de la operación no sustituye su evidencia: un mandato firmado,
  // contrato activo o consentimiento otorgado debe conservar una referencia
  // verificable. Solo los documentos de repositorio disponibles/aprobados se
  // consideran respaldados cuando el legado aún no expone la referencia física.
  const repositoryDocument = ["property_document", "legal_document"].includes(record.recordType);
  const evidenceMissing = !evidenceReference && !(repositoryDocument && ["AVAILABLE", "APPROVED"].includes(status));
  const href = `/realty?view=broker_os&tab=${encodeURIComponent(definition.area)}&recordId=${encodeURIComponent(record.id)}`;
  return {
    id: `document:${record.id}`,
    sourceRecordId: record.id,
    title: text(record.title, definition.label),
    category: definition.category,
    documentType: definition.type(data),
    documentStatus: status,
    propertyId,
    propertyTitle: property ? text(property.title, "Propiedad asociada") : "Propiedad no disponible dentro del alcance",
    parties,
    evidence: {
      status: evidenceMissing ? "MISSING" : "REGISTERED",
      reference: evidenceReference || null,
      note: evidenceMissing ? "No existe una referencia de evidencia registrada en este antecedente." : "La evidencia se conserva en el registro de origen."
    },
    expiry,
    signature: definition.signature
      ? { status: "REGISTERED_INTERNAL", externalIntegration: false, note: "Broker OS registra el estado y la referencia. No ejecuta una firma electrónica externa." }
      : { status: "NOT_APPLICABLE", externalIntegration: false, note: "No corresponde a una firma electrónica." },
    source: { recordType: record.recordType, sourceArea: definition.area, label: definition.label, href },
    updatedAt: record.updatedAt?.toISOString?.() || text(record.updatedAt) || null
  };
}

function documentItems(record, propertiesById, now) {
  const definition = SOURCE_DEFINITIONS[record.recordType];
  if (definition?.captureDocuments) return captureDocumentItems(record, propertiesById, now);
  const item = documentItem(record, propertiesById, now);
  return item ? [item] : [];
}

function matches(item, filters) {
  const propertyId = text(filters.propertyId);
  const person = text(filters.person).toLocaleLowerCase("es-CL");
  const type = text(filters.type).toLocaleLowerCase("es-CL");
  const status = text(filters.status).toUpperCase();
  const expiry = text(filters.expiry).toUpperCase();
  if (propertyId && item.propertyId !== propertyId) return false;
  if (person && ![item.title, item.propertyTitle, ...item.parties].join(" ").toLocaleLowerCase("es-CL").includes(person)) return false;
  if (type && type !== "ALL" && ![item.documentType, item.category, item.source.recordType].join(" ").toLocaleLowerCase("es-CL").includes(type)) return false;
  if (status && status !== "ALL" && item.documentStatus !== status) return false;
  if (expiry && expiry !== "ALL" && item.expiry.state !== expiry) return false;
  return true;
}

export function buildBrokerDocumentIndex({ properties = [], records = [], filters = {}, now = new Date() } = {}) {
  const propertiesById = new Map(properties.map((property) => [property.id, property]));
  const allItems = records.flatMap((record) => documentItems(record, propertiesById, now));
  const items = allItems.filter((item) => matches(item, filters)).sort((a, b) => {
    const aRank = a.expiry.state === "OVERDUE" ? 0 : a.expiry.state === "EXPIRING_60" ? 1 : a.evidence.status === "MISSING" ? 2 : 3;
    const bRank = b.expiry.state === "OVERDUE" ? 0 : b.expiry.state === "EXPIRING_60" ? 1 : b.evidence.status === "MISSING" ? 2 : 3;
    return aRank - bRank || String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")) || a.title.localeCompare(b.title, "es");
  });
  return {
    version: BROKER_DOCUMENT_INDEX_VERSION,
    generatedAt: now.toISOString(),
    filters: { propertyId: text(filters.propertyId), person: text(filters.person), type: text(filters.type, "ALL"), status: text(filters.status, "ALL").toUpperCase(), expiry: text(filters.expiry, "ALL").toUpperCase() },
    summary: {
      total: allItems.length,
      visible: items.length,
      expiringIn60Days: allItems.filter((item) => item.expiry.state === "EXPIRING_60").length,
      overdue: allItems.filter((item) => item.expiry.state === "OVERDUE").length,
      evidenceIncomplete: allItems.filter((item) => item.evidence.status === "MISSING").length,
      signaturesRegistered: allItems.filter((item) => item.signature.status === "REGISTERED_INTERNAL").length
    },
    facets: {
      properties: [...new Map(allItems.filter((item) => item.propertyId).map((item) => [item.propertyId, { id: item.propertyId, title: item.propertyTitle }])).values()].sort((a, b) => a.title.localeCompare(b.title, "es")),
      types: [...new Set(allItems.map((item) => item.documentType))].sort((a, b) => a.localeCompare(b, "es")),
      statuses: [...new Set(allItems.map((item) => item.documentStatus))].sort(),
      people: [...new Set(allItems.flatMap((item) => item.parties))].sort((a, b) => a.localeCompare(b, "es"))
    },
    notice: "Índice derivado de los registros de origen. Consultarlo no modifica estados, archivos ni operaciones. Las firmas externas siguen siendo una integración futura.",
    items
  };
}

