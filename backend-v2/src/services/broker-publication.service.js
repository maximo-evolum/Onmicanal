/**
 * Archivo: Define el contrato interno de publicación multicanal de Broker OS.
 *
 * La preparación comercial vive dentro de EVOLUM; publicar en un portal real
 * requiere un conector autorizado, contrato y credenciales vigentes. Por eso
 * este servicio nunca realiza solicitudes a TocToc, Yapo, Portal Inmobiliario
 * u otro tercero: conserva el borrador, sus validaciones y su aprobación.
 */

export const BROKER_PUBLICATION_CHANNELS = Object.freeze([
  { key: "EVOLUM_CATALOGO", label: "Catálogo EVOLUM", providerState: "INTERNAL" },
  { key: "PORTAL_INMOBILIARIO", label: "Portal Inmobiliario", providerState: "PENDING_PROVIDER" },
  { key: "TOCTOC", label: "TocToc", providerState: "PENDING_PROVIDER" },
  { key: "YAPO", label: "Yapo", providerState: "PENDING_PROVIDER" },
  { key: "META", label: "Meta (Facebook e Instagram)", providerState: "PENDING_PROVIDER" },
  { key: "SITIO_PROPIO", label: "Sitio web propio", providerState: "PENDING_PROVIDER" },
]);

export const BROKER_PUBLICATION_STATUSES = Object.freeze([
  "DRAFT",
  "PENDING_REVIEW",
  "APPROVED",
  "PROVIDER_PENDING",
  "PUBLISHED",
  "PAUSED",
  "ARCHIVED",
  "REJECTED",
]);

function text(value, fallback = "") {
  const result = String(value ?? "").trim();
  return result || fallback;
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function array(value) {
  return Array.isArray(value) ? value.filter((item) => text(item)) : [];
}

function propertyData(property) {
  return property?.data && typeof property.data === "object" && !Array.isArray(property.data) ? property.data : {};
}

function channelDefinition(value) {
  return BROKER_PUBLICATION_CHANNELS.find((item) => item.key === text(value).toUpperCase()) || null;
}

function operationLabel(value) {
  const key = text(value).toUpperCase();
  return ({ SALE: "Venta", VENTA: "Venta", RENTAL: "Arriendo", ARRIENDO: "Arriendo", ADMINISTRATION: "Administración", ADMINISTRACION: "Administración" })[key] || "Operación";
}

function compactLocation(data) {
  return [text(data.comuna || data.commune), text(data.region)].filter(Boolean).join(", ");
}

function imageUrls(data) {
  return [...new Set([
    text(data.photoUrl),
    ...array(data.gallery),
    ...array(data.photoUrls),
  ].filter(Boolean))];
}

/** Calcula qué evidencia falta sin inventar mandatarios, firmas ni permisos. */
export function brokerPublicationReadiness({ property, capture = null, mandate = null }) {
  const data = propertyData(property);
  const source = { ...data, ...(capture || {}) };
  const hasMandate = Boolean(mandate && String(mandate.status || "").toUpperCase() === "SIGNED");
  const checks = [
    { key: "title", label: "Título de la propiedad", ready: Boolean(text(property?.title)) },
    { key: "propertyType", label: "Tipo de propiedad", ready: Boolean(text(source.propertyType)) },
    { key: "operation", label: "Tipo de operación", ready: Boolean(text(source.operation || source.intendedService)) },
    { key: "price", label: "Precio de publicación", ready: number(source.price ?? source.suggestedPrice) !== null && number(source.price ?? source.suggestedPrice) > 0 },
    { key: "currency", label: "Moneda", ready: Boolean(text(source.currency, "CLP")) },
    { key: "address", label: "Dirección", ready: Boolean(text(source.address)) },
    { key: "comuna", label: "Comuna", ready: Boolean(text(source.comuna || source.commune)) },
    { key: "images", label: "Imagen principal o galería", ready: imageUrls(source).length > 0 },
    { key: "mandate", label: "Mandato vigente registrado", ready: hasMandate },
    { key: "publicationReadiness", label: "Ficha marcada lista para publicar", ready: text(source.publicationReadiness).toUpperCase() === "LISTA_PARA_PUBLICAR" },
  ];
  const missing = checks.filter((item) => !item.ready).map((item) => item.label);
  const completed = checks.length - missing.length;
  return {
    checks,
    missing,
    completed,
    total: checks.length,
    score: Math.round((completed / checks.length) * 100),
    readyForReview: missing.length === 0,
    // Ningún borrador equivale a una publicación externa. Incluso una ficha
    // completa queda pendiente del proveedor hasta integrar el canal real.
    readyForExternalDelivery: false,
  };
}

export function brokerPublicationCopy({ property, channel, input = {} }) {
  const data = propertyData(property);
  const price = number(data.price ?? data.suggestedPrice);
  const currency = text(data.currency, "CLP").toUpperCase();
  const operation = operationLabel(data.operation || data.intendedService);
  const location = compactLocation(data);
  const attributes = [
    number(data.bedrooms) !== null ? `${number(data.bedrooms)} dormitorio${number(data.bedrooms) === 1 ? "" : "s"}` : "",
    number(data.bathrooms) !== null ? `${number(data.bathrooms)} baño${number(data.bathrooms) === 1 ? "" : "s"}` : "",
    number(data.usableSquareMeters ?? data.builtM2 ?? data.meters) !== null ? `${number(data.usableSquareMeters ?? data.builtM2 ?? data.meters)} m²` : "",
  ].filter(Boolean);
  const definition = channelDefinition(channel);
  const generatedTitle = `${operation} · ${text(property?.title, "Propiedad sin título")}`;
  const generatedBody = [
    `${operation} de ${text(data.propertyType, "propiedad").toLowerCase()}${location ? ` en ${location}` : ""}.`,
    attributes.length ? `Características informadas: ${attributes.join(", ")}.` : "",
    price ? `Precio informado: ${currency} ${new Intl.NumberFormat("es-CL", { maximumFractionDigits: currency === "CLP" ? 0 : 2 }).format(price)}.` : "",
    text(data.observations),
  ].filter(Boolean).join(" ");
  return {
    channel: definition?.key || text(channel).toUpperCase(),
    channelLabel: definition?.label || "Canal sin configurar",
    title: text(input.title, generatedTitle).slice(0, 180),
    body: text(input.body, generatedBody).slice(0, 6000),
    price,
    currency,
    operation,
    propertyType: text(data.propertyType),
    address: text(data.address),
    comuna: text(data.comuna || data.commune),
    region: text(data.region),
    images: imageUrls(data),
  };
}

export function createBrokerPublicationData({ property, channel, input = {}, readiness, actor }) {
  const definition = channelDefinition(channel);
  if (!definition) throw new Error("Selecciona un canal de publicación disponible.");
  const now = new Date().toISOString();
  const copy = brokerPublicationCopy({ property, channel: definition.key, input });
  return {
    propertyId: property.id,
    channel: definition.key,
    channelLabel: definition.label,
    publicationStatus: "DRAFT",
    provider: {
      state: definition.providerState,
      integrationEnabled: false,
      externalPublicationId: null,
      lastAttemptAt: null,
      lastError: definition.providerState === "PENDING_PROVIDER" ? "Este canal aún no tiene un conector autorizado configurado." : null,
    },
    copy,
    readiness,
    approval: {
      status: "DRAFT",
      requestedAt: null,
      requestedBy: null,
      approvedAt: null,
      approvedBy: null,
      note: "",
    },
    lifecycle: [{ at: now, action: "BORRADOR_CREADO", by: actor, note: "Borrador interno creado; no se envió información a terceros." }],
    version: 1,
  };
}

export function transitionBrokerPublication(data, action, { actor, note = "" } = {}) {
  const current = data && typeof data === "object" && !Array.isArray(data) ? data : {};
  const publicationStatus = text(current.publicationStatus, "DRAFT").toUpperCase();
  const approval = { status: "DRAFT", requestedAt: null, requestedBy: null, approvedAt: null, approvedBy: null, note: "", ...(current.approval || {}) };
  const lifecycle = Array.isArray(current.lifecycle) ? current.lifecycle : [];
  const readiness = current.readiness || { readyForReview: false, missing: [] };
  const now = new Date().toISOString();
  const normalizedAction = text(action).toUpperCase();
  let nextStatus = publicationStatus;
  let event = "";

  if (normalizedAction === "REQUEST_REVIEW") {
    if (!readiness.readyForReview) throw new Error(`No se puede solicitar aprobación: falta ${array(readiness.missing).join(", ") || "completar la ficha"}.`);
    if (!["DRAFT", "REJECTED"].includes(publicationStatus)) throw new Error("Solo un borrador o una publicación rechazada puede enviarse a revisión.");
    nextStatus = "PENDING_REVIEW";
    approval.status = "PENDING_REVIEW";
    approval.requestedAt = now;
    approval.requestedBy = actor || "Usuario autorizado";
    approval.note = text(note);
    event = "REVISION_SOLICITADA";
  } else if (normalizedAction === "APPROVE") {
    if (publicationStatus !== "PENDING_REVIEW") throw new Error("Solo una publicación pendiente de revisión puede aprobarse.");
    nextStatus = "APPROVED";
    approval.status = "APPROVED";
    approval.approvedAt = now;
    approval.approvedBy = actor || "Usuario autorizado";
    approval.note = text(note);
    event = "APROBADA";
  } else if (normalizedAction === "PREPARE_PROVIDER") {
    if (publicationStatus !== "APPROVED") throw new Error("La publicación debe estar aprobada antes de prepararla para un proveedor.");
    nextStatus = "PROVIDER_PENDING";
    event = "PROVEEDOR_PENDIENTE";
  } else if (normalizedAction === "PAUSE") {
    if (!["APPROVED", "PROVIDER_PENDING", "PUBLISHED"].includes(publicationStatus)) throw new Error("Solo una publicación aprobada o publicada puede pausarse.");
    nextStatus = "PAUSED";
    event = "PAUSADA";
  } else if (normalizedAction === "ARCHIVE") {
    nextStatus = "ARCHIVED";
    event = "ARCHIVADA";
  } else {
    throw new Error("Acción de publicación no reconocida.");
  }

  return {
    ...current,
    publicationStatus: nextStatus,
    approval,
    lifecycle: [...lifecycle, { at: now, action: event, by: actor || "Usuario autorizado", note: text(note) }],
    version: Number(current.version || 1) + 1,
  };
}

export function publicBrokerPublication(record) {
  const data = propertyData(record);
  return {
    id: record.id,
    title: record.title,
    status: record.status,
    assignedToId: record.assignedToId || null,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    data,
  };
}
