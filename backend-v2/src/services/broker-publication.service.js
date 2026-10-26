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

export const BROKER_PUBLICATION_PROVIDER_STATUSES = Object.freeze([
  // Catálogo propio: no es una integración ni permite publicar hacia terceros.
  "INTERNAL",
  "PENDING_PROVIDER",
  "CONTACTED",
  "CONTRACTED",
  "TECHNICAL_REVIEW",
  "READY_FOR_TEST",
  "ACTIVE",
  "PAUSED",
  "UNAVAILABLE",
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
      publishedUrl: "",
      deliveryMode: "NOT_SENT",
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

export function transitionBrokerPublication(data, action, { actor, note = "", delivery = {} } = {}) {
  const current = data && typeof data === "object" && !Array.isArray(data) ? data : {};
  const publicationStatus = text(current.publicationStatus, "DRAFT").toUpperCase();
  const approval = { status: "DRAFT", requestedAt: null, requestedBy: null, approvedAt: null, approvedBy: null, note: "", ...(current.approval || {}) };
  const provider = {
    state: "PENDING_PROVIDER",
    integrationEnabled: false,
    externalPublicationId: null,
    publishedUrl: "",
    deliveryMode: "NOT_SENT",
    lastAttemptAt: null,
    lastError: null,
    ...(current.provider || {}),
  };
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
  } else if (normalizedAction === "REJECT") {
    if (publicationStatus !== "PENDING_REVIEW") throw new Error("Solo una publicación pendiente de revisión puede rechazarse.");
    if (!text(note)) throw new Error("Indica el motivo del rechazo para que el corredor pueda corregir la ficha.");
    nextStatus = "REJECTED";
    approval.status = "REJECTED";
    approval.note = text(note);
    event = "RECHAZADA";
  } else if (normalizedAction === "PREPARE_PROVIDER") {
    if (publicationStatus !== "APPROVED") throw new Error("La publicación debe estar aprobada antes de prepararla para un proveedor.");
    nextStatus = "PROVIDER_PENDING";
    event = "PROVEEDOR_PENDIENTE";
  } else if (normalizedAction === "CONFIRM_EXTERNAL_PUBLICATION") {
    if (!["APPROVED", "PROVIDER_PENDING"].includes(publicationStatus)) throw new Error("La publicación debe estar aprobada antes de registrar una salida externa manual.");
    const externalReference = text(delivery.externalReference || provider.externalPublicationId);
    const publishedUrl = text(delivery.publishedUrl || provider.publishedUrl);
    if (!externalReference && !publishedUrl) throw new Error("Registra la URL publicada o el comprobante entregado por el portal antes de confirmar la publicación.");
    if (publishedUrl && !/^https:\/\//i.test(publishedUrl)) throw new Error("La URL publicada debe comenzar con https://.");
    nextStatus = "PUBLISHED";
    provider.externalPublicationId = externalReference || null;
    provider.publishedUrl = publishedUrl;
    provider.deliveryMode = "MANUAL_CONFIRMED";
    provider.lastAttemptAt = now;
    provider.lastError = null;
    event = "PUBLICACION_EXTERNA_CONFIRMADA_MANUALMENTE";
  } else if (normalizedAction === "REPORT_PROVIDER_FAILURE") {
    if (!["APPROVED", "PROVIDER_PENDING"].includes(publicationStatus)) throw new Error("Solo una publicación aprobada o pendiente de proveedor puede registrar una incidencia externa.");
    const reason = text(delivery.error || note);
    if (!reason) throw new Error("Describe el error o rechazo informado por el proveedor.");
    nextStatus = "PROVIDER_PENDING";
    provider.deliveryMode = "MANUAL_ERROR_REPORTED";
    provider.lastAttemptAt = now;
    provider.lastError = reason;
    event = "INCIDENCIA_DE_PROVEEDOR_REGISTRADA";
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
    provider,
    lifecycle: [...lifecycle, { at: now, action: event, by: actor || "Usuario autorizado", note: text(note || delivery.error || delivery.externalReference || delivery.publishedUrl) }],
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

/**
 * Configuración de negocio sin secretos. Las credenciales reales no se
 * persisten aquí: cuando exista una integración aprobada deben quedar en el
 * Centro de Conexiones cifradas, no en un registro operativo ni en el cliente.
 */
export function normalizeBrokerPublicationProvider(channel, input = {}, previous = {}) {
  const definition = channelDefinition(channel);
  if (!definition) throw new Error("El proveedor indicado no pertenece a los canales de publicación disponibles.");
  const requested = text(input.providerStatus || previous.providerStatus || definition.providerState).toUpperCase();
  const providerStatus = BROKER_PUBLICATION_PROVIDER_STATUSES.includes(requested) ? requested : definition.providerState;
  return {
    channel: definition.key,
    channelLabel: definition.label,
    providerStatus,
    contractReference: text(input.contractReference ?? previous.contractReference).slice(0, 300),
    accountReference: text(input.accountReference ?? previous.accountReference).slice(0, 300),
    technicalContact: text(input.technicalContact ?? previous.technicalContact).slice(0, 300),
    notes: text(input.notes ?? previous.notes).slice(0, 3000),
    credentialStorage: "CENTRO_DE_CONEXIONES_CIFRADO",
    externalPublishingEnabled: false,
  };
}

export function publicBrokerPublicationProvider(record, channel) {
  const data = propertyData(record);
  const normalized = normalizeBrokerPublicationProvider(channel || data.channel, data);
  return {
    id: record?.id || null,
    ...normalized,
    updatedAt: record?.updatedAt || null,
  };
}

export function normalizeBrokerPublicationMetrics(input = {}, previous = {}) {
  const safeInteger = (value, fallback = 0) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed) : fallback;
  };
  const reportDate = text(input.reportDate || previous.reportDate, new Date().toISOString().slice(0, 10));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(reportDate)) throw new Error("Indica una fecha válida para el reporte de rendimiento.");
  return {
    reportDate,
    views: safeInteger(input.views, safeInteger(previous.views)),
    contacts: safeInteger(input.contacts, safeInteger(previous.contacts)),
    favorites: safeInteger(input.favorites, safeInteger(previous.favorites)),
    publishedUrl: text(input.publishedUrl ?? previous.publishedUrl).slice(0, 1500),
    source: "REPORTE_MANUAL_O_PROVEEDOR",
    updatedAt: new Date().toISOString(),
  };
}

export function brokerPublicationAnalytics(records = []) {
  const rows = records.map((record) => propertyData(record));
  const total = rows.length;
  const published = rows.filter((item) => text(item.publicationStatus).toUpperCase() === "PUBLISHED").length;
  const approved = rows.filter((item) => text(item.publicationStatus).toUpperCase() === "APPROVED").length;
  const pendingProvider = rows.filter((item) => text(item.publicationStatus).toUpperCase() === "PROVIDER_PENDING").length;
  const pendingReview = rows.filter((item) => text(item.publicationStatus).toUpperCase() === "PENDING_REVIEW").length;
  const metrics = rows.map((item) => item.metrics && typeof item.metrics === "object" ? item.metrics : {});
  const views = metrics.reduce((sum, item) => sum + Number(item.views || 0), 0);
  const contacts = metrics.reduce((sum, item) => sum + Number(item.contacts || 0), 0);
  const favorites = metrics.reduce((sum, item) => sum + Number(item.favorites || 0), 0);
  const byChannel = BROKER_PUBLICATION_CHANNELS.map((channel) => {
    const channelRows = rows.filter((item) => text(item.channel).toUpperCase() === channel.key);
    const channelMetrics = channelRows.map((item) => item.metrics && typeof item.metrics === "object" ? item.metrics : {});
    const channelViews = channelMetrics.reduce((sum, item) => sum + Number(item.views || 0), 0);
    const channelContacts = channelMetrics.reduce((sum, item) => sum + Number(item.contacts || 0), 0);
    return {
      channel: channel.key,
      label: channel.label,
      total: channelRows.length,
      published: channelRows.filter((item) => text(item.publicationStatus).toUpperCase() === "PUBLISHED").length,
      views: channelViews,
      contacts: channelContacts,
      contactRatePct: channelViews > 0 ? Number(((channelContacts / channelViews) * 100).toFixed(2)) : null,
    };
  }).filter((item) => item.total > 0);
  return {
    total,
    published,
    approved,
    pendingProvider,
    pendingReview,
    views,
    contacts,
    favorites,
    contactRatePct: views > 0 ? Number(((contacts / views) * 100).toFixed(2)) : null,
    byChannel,
  };
}

/** Genera un contrato de salida auditable, sin ejecutar ninguna publicación. */
export function brokerPublicationExport({ publication, property, provider = null }) {
  const data = propertyData(publication);
  const source = propertyData(property);
  return {
    schema: "EVOLUM_BROKER_PUBLICATION_V2",
    generatedAt: new Date().toISOString(),
    externalDelivery: false,
    message: "Este archivo es una previsualización técnica. No acredita ni ejecuta una publicación en un portal externo.",
    provider: provider ? publicBrokerPublicationProvider(provider, data.channel) : normalizeBrokerPublicationProvider(data.channel),
    publication: {
      id: publication.id,
      status: data.publicationStatus,
      channel: data.channel,
      title: data.copy?.title || publication.title,
      description: data.copy?.body || "",
      price: data.copy?.price ?? null,
      currency: data.copy?.currency || text(source.currency, "CLP").toUpperCase(),
      images: array(data.copy?.images),
      readiness: data.readiness || null,
    },
    property: {
      id: property.id,
      title: property.title,
      type: text(source.propertyType),
      operation: text(source.operation || source.intendedService),
      address: text(source.address),
      comuna: text(source.comuna || source.commune),
      region: text(source.region),
      bedrooms: number(source.bedrooms),
      bathrooms: number(source.bathrooms),
      usableSquareMeters: number(source.usableSquareMeters ?? source.builtM2 ?? source.meters),
      totalSquareMeters: number(source.totalSquareMeters ?? source.landM2),
      parking: number(source.parking),
    },
  };
}
