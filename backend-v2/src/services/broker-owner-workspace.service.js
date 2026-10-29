/** Archivo: Construye la cartera y el historial operativo de propietarios de Broker OS. */
import { TERMINAL_STAGES } from "./broker-workflows.service.js";

function text(value, fallback = "") {
  const result = String(value ?? "").trim();
  return result || fallback;
}

function dataOf(record) {
  return record?.data && typeof record.data === "object" && !Array.isArray(record.data) ? record.data : {};
}

function amount(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function dateOf(value) {
  const raw = text(value);
  // Las fechas de vigencia sin hora son fechas de calendario, no instantes UTC.
  // Usar mediodía evita que un navegador de Chile las muestre el día anterior.
  const parsed = raw ? new Date(/^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T12:00:00.000Z` : raw) : null;
  return parsed && !Number.isNaN(parsed.getTime()) ? parsed : null;
}

function calendarDate(value) {
  const parsed = dateOf(value);
  return parsed ? parsed.toISOString() : null;
}

function propertyStatus(property) {
  return text(property?.operationalStatus || property?.status, "CAPTACION").toUpperCase();
}

function isHistoricalProperty(property) {
  return property?.isActive === false || ["ARCHIVED", "CERRADA", "CANCELADA", "VENDIDA", "ARRENDADA_FINALIZADA"].includes(propertyStatus(property));
}

function isOpenRecord(record) {
  return !["CLOSED", "RESOLVED", "PAID", "CANCELLED", "CANCELADA", "ENDED", "REPLACED", "ARCHIVED", "COMPLETED"].includes(text(record?.status).toUpperCase());
}

function isOpenOperation(operation) {
  const stage = text(dataOf(operation).stage).toUpperCase();
  return !TERMINAL_STAGES.has(stage) && !["CLOSED", "RESOLVED", "CANCELLED", "COMPLETED"].includes(text(operation?.status).toUpperCase());
}

function propertyTitle(property, legacyById) {
  return text(legacyById.get(property.legacyRecordId)?.title) || text(property.address, "Propiedad sin dirección");
}

function propertyLegacyId(property) {
  return text(property?.legacyRecordId) || null;
}

function actionChannel(owner) {
  if (text(owner.phone)) return { key: "WHATSAPP_O_LLAMADA", label: "WhatsApp o llamada", available: true };
  if (text(owner.email)) return { key: "CORREO", label: "Correo electrónico", available: true };
  return { key: "ACTUALIZAR_CONTACTO", label: "Actualizar datos de contacto", available: false };
}

function valueByCurrency(properties) {
  const totals = new Map();
  for (const property of properties) {
    const currency = text(property.currency, "CLP").toUpperCase();
    totals.set(currency, (totals.get(currency) || 0) + amount(property.askingPrice));
  }
  return [...totals.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([currency, value]) => ({ currency, value }));
}

function dueItems({ contracts, records, today, soon }) {
  const items = [];
  for (const contract of contracts) {
    const dueAt = dateOf(contract.endDate);
    if (!dueAt || ["CLOSED", "ENDED", "CANCELLED"].includes(text(contract.status).toUpperCase())) continue;
    if (dueAt > soon) continue;
    items.push({
      id: `contract-${contract.id}`,
      source: "CONTRATO",
      label: text(contract.type, "Contrato"),
      dueAt: dueAt.toISOString(),
      overdue: dueAt < today,
      propertyId: contract.propertyId || null,
      detail: `${text(contract.type, "Contrato")} ${dueAt < today ? "vencido" : "próximo a vencer"}.`
    });
  }
  for (const record of records) {
    const data = dataOf(record);
    const rawDueAt = data.endDate || data.dueDate || data.expiresAt || data.warrantyUntil;
    const dueAt = dateOf(rawDueAt);
    if (!dueAt || !isOpenRecord(record) || dueAt > soon) continue;
    items.push({
      id: `record-${record.id}`,
      source: record.recordType,
      label: text(record.title, "Antecedente"),
      dueAt: dueAt.toISOString(),
      overdue: dueAt < today,
      propertyId: text(data.propertyId) || null,
      detail: `${text(record.title, "Antecedente")} ${dueAt < today ? "venció" : "vence pronto"}.`
    });
  }
  return items
    .sort((left, right) => Number(right.overdue) - Number(left.overdue) || String(left.dueAt).localeCompare(String(right.dueAt)))
    .slice(0, 25);
}

function managementHistory(actions = []) {
  return actions
    .map((action) => {
      const data = dataOf(action);
      return {
        id: action.id,
        type: text(data.type, "SEGUIMIENTO"),
        title: text(action.title, "Gestión de propietario"),
        note: text(data.note),
        suggestedChannel: text(data.suggestedChannel),
        nextActionAt: calendarDate(data.nextActionAt),
        propertyId: text(data.propertyId) || null,
        createdAt: calendarDate(action.createdAt || data.createdAt),
        updatedAt: calendarDate(action.updatedAt),
        responsibleUserId: action.assignedToId || null
      };
    })
    .sort((left, right) => String(right.createdAt || "").localeCompare(String(left.createdAt || "")));
}

/**
 * Proyecta una ficha de propietario sin alterar datos ni inferir identidad por
 * nombre. Las colecciones ya deben venir filtradas por tenant y alcance.
 */
export function buildBrokerOwnerWorkspace({
  owner,
  properties = [],
  legacyProperties = [],
  operations = [],
  records = [],
  contracts = [],
  managementActions = [],
  now = new Date()
} = {}) {
  if (!owner?.id) throw new Error("Se requiere un propietario Broker identificado.");
  const legacyById = new Map(legacyProperties.map((property) => [property.id, property]));
  const propertyIds = new Set(properties.map(propertyLegacyId).filter(Boolean));
  const strictPropertyIds = new Set(properties.map((property) => property.id));
  const ownerRecords = records.filter((record) => {
    const data = dataOf(record);
    return String(data.ownerId || "") === String(owner.id) || propertyIds.has(String(data.propertyId || ""));
  });
  const ownerOperations = operations.filter((operation) => {
    const data = dataOf(operation);
    return String(data.ownerId || "") === String(owner.id) || propertyIds.has(String(data.propertyId || ""));
  });
  const ownerContracts = contracts.filter((contract) => String(contract.ownerId || "") === String(owner.id) || strictPropertyIds.has(String(contract.propertyId || "")));
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const soon = new Date(today);
  soon.setDate(soon.getDate() + 60);
  const activeProperties = properties.filter((property) => !isHistoricalProperty(property));
  const historicalProperties = properties.filter(isHistoricalProperty);
  const administrationPropertyIds = new Set(ownerContracts
    .filter((contract) => ["ADMINISTRATION", "ARRIENDO", "RENTAL"].includes(text(contract.type).toUpperCase()) && isOpenRecord(contract))
    .map((contract) => String(contract.propertyId)));
  const activeOperations = ownerOperations.filter(isOpenOperation);
  const openAlerts = ownerRecords.filter((record) => record.recordType === "realty_alert" && isOpenRecord(record));
  const expirations = dueItems({ contracts: ownerContracts, records: ownerRecords, today, soon });
  const channel = actionChannel(owner);
  const management = managementHistory(managementActions);
  const missingContact = !text(owner.phone) && !text(owner.email);
  const unassigned = activeProperties.filter((property) => !property.assignedBrokerId);
  const opportunities = [];
  if (missingContact) opportunities.push({ key: "CONTACTO", priority: "HIGH", title: "Completar datos de contacto", detail: "No existe teléfono ni correo para preparar un seguimiento informado.", action: "Actualizar contacto", requiresApproval: false });
  if (expirations.some((item) => item.overdue)) opportunities.push({ key: "VENCIDO", priority: "HIGH", title: "Revisar antecedentes vencidos", detail: `${expirations.filter((item) => item.overdue).length} antecedente(s) requieren decisión o actualización.`, action: "Abrir vencimientos", requiresApproval: true });
  else if (expirations.length) opportunities.push({ key: "PROXIMO_VENCIMIENTO", priority: "MEDIUM", title: "Preparar renovación o seguimiento", detail: `${expirations.length} antecedente(s) vence(n) dentro de 60 días.`, action: "Planificar seguimiento", requiresApproval: true });
  if (unassigned.length) opportunities.push({ key: "ASIGNACION", priority: "MEDIUM", title: "Asignar responsable comercial", detail: `${unassigned.length} propiedad(es) activa(s) no tienen corredor responsable.`, action: "Revisar asignación", requiresApproval: true });
  if (activeProperties.length && !activeOperations.length) opportunities.push({ key: "CARTERA_SIN_NEGOCIO", priority: "MEDIUM", title: "Revisar oportunidad comercial", detail: "La cartera activa no tiene un negocio abierto dentro de tu alcance.", action: "Abrir cartera", requiresApproval: false });
  if (!opportunities.length) opportunities.push({ key: "SEGUIMIENTO", priority: "LOW", title: "Mantener seguimiento de cartera", detail: "No se detectaron brechas urgentes; registra la próxima gestión cuando corresponda.", action: "Registrar gestión", requiresApproval: false });

  const propertyRows = properties.map((property) => ({
    id: property.id,
    legacyRecordId: propertyLegacyId(property),
    title: propertyTitle(property, legacyById),
    address: text(property.address),
    comuna: text(property.comuna),
    propertyType: text(property.propertyType, "OTRA"),
    operationalStatus: propertyStatus(property),
    isHistorical: isHistoricalProperty(property),
    isAdministration: administrationPropertyIds.has(String(property.id)),
    assignedBrokerId: property.assignedBrokerId || null,
    assignedBrokerName: property.assignedBroker?.name || null,
    askingPrice: amount(property.askingPrice),
    currency: text(property.currency, "CLP").toUpperCase(),
    updatedAt: calendarDate(property.updatedAt),
    related: {
      // Estos conteos solo habilitan navegación a los módulos Broker ya
      // autorizados. No duplican contratos, operaciones ni expedientes.
      captureAvailable: Boolean(property.capture),
      operations: ownerOperations.filter((operation) => String(dataOf(operation).propertyId || "") === String(property.legacyRecordId || "")).length,
      contracts: ownerContracts.filter((contract) => String(contract.propertyId || "") === String(property.id)).length,
      administration: ownerRecords.filter((record) => String(dataOf(record).propertyId || "") === String(property.legacyRecordId || "") && ["administration_profile", "administration_liquidation", "rental_contract"].includes(String(record.recordType))).length
    }
  }));

  return {
    version: "BROKER_OWNER_WORKSPACE_V1",
    generatedAt: new Date(now).toISOString(),
    owner: {
      id: owner.id,
      name: text(owner.name, "Propietario sin nombre"),
      rut: text(owner.rut) || null,
      legalType: text(owner.legalType, "PERSONA_NATURAL"),
      phone: text(owner.phone) || null,
      email: text(owner.email) || null,
      contactAddress: text(owner.contactAddress) || null,
      isActive: owner.isActive !== false,
      identityStatus: text(owner.rut) ? "IDENTIDAD_ESTRICTA" : "IDENTIDAD_SIN_RUT",
      contactSuggestion: channel
    },
    portfolio: {
      properties: propertyRows,
      active: propertyRows.filter((property) => !property.isHistorical),
      administration: propertyRows.filter((property) => property.isAdministration),
      historical: propertyRows.filter((property) => property.isHistorical),
      managedValueByCurrency: valueByCurrency(activeProperties),
      activeOperations: activeOperations.map((operation) => ({ id: operation.id, title: text(operation.title), propertyId: text(dataOf(operation).propertyId) || null, stage: text(dataOf(operation).stage, "SIN_ETAPA"), operationType: text(dataOf(operation).operationType, "SALE"), updatedAt: calendarDate(operation.updatedAt) })),
      openAlerts: openAlerts.map((alert) => ({ id: alert.id, title: text(alert.title), status: text(alert.status), propertyId: text(dataOf(alert).propertyId) || null, updatedAt: calendarDate(alert.updatedAt) }))
    },
    metrics: {
      activeProperties: activeProperties.length,
      administrationProperties: administrationPropertyIds.size,
      historicalProperties: historicalProperties.length,
      activeOperations: activeOperations.length,
      expiringItems: expirations.length,
      overdueItems: expirations.filter((item) => item.overdue).length,
      openAlerts: openAlerts.length,
      managementActions: management.length
    },
    expirations,
    opportunities,
    management,
    notices: [
      "Las sugerencias no envían mensajes ni modifican contratos automáticamente.",
      "La identidad se resuelve por ID relacional y RUT cuando está disponible; un nombre coincidente no fusiona propietarios."
    ]
  };
}

export function filterBrokerOwnerWorkspaces(workspaces = [], { search = "", portfolio = "ALL" } = {}) {
  const needle = text(search).toLocaleLowerCase("es-CL");
  const filter = text(portfolio, "ALL").toUpperCase();
  return workspaces.filter((workspace) => {
    const searchable = [workspace.owner.name, workspace.owner.rut, workspace.owner.email, workspace.owner.phone, ...workspace.portfolio.properties.map((property) => `${property.title} ${property.comuna}`)].join(" ").toLocaleLowerCase("es-CL");
    if (needle && !searchable.includes(needle)) return false;
    if (filter === "ACTIVE") return workspace.metrics.activeProperties > 0;
    if (filter === "ADMINISTRATION") return workspace.metrics.administrationProperties > 0;
    if (filter === "HISTORICAL") return workspace.metrics.historicalProperties > 0;
    if (filter === "ATTENTION") return workspace.metrics.overdueItems > 0 || workspace.metrics.openAlerts > 0 || workspace.opportunities.some((item) => item.priority === "HIGH");
    return true;
  }).sort((left, right) => {
    const leftWeight = left.metrics.overdueItems * 10 + left.metrics.openAlerts * 3 + left.metrics.activeProperties;
    const rightWeight = right.metrics.overdueItems * 10 + right.metrics.openAlerts * 3 + right.metrics.activeProperties;
    return rightWeight - leftWeight || left.owner.name.localeCompare(right.owner.name, "es-CL");
  });
}
