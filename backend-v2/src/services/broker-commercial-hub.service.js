/**
 * Archivo: Construye la lectura comercial de Broker OS a partir de Marketing,
 * Agenda e Inbox, preservando la fuente de cada dato y la aprobación humana.
 */

export const BROKER_AGENDA_KINDS = Object.freeze(["VISIT", "CALL"]);
export const BROKER_AGENDA_ACTIONS = Object.freeze(["CONFIRM", "PREPARE_REMINDER", "ESCALATE", "COMPLETE", "CANCEL", "RESCHEDULE"]);
export const BROKER_CHAT_TARGET_TYPES = Object.freeze(["PROPERTY", "BUYER", "CAPTURE", "VISIT"]);

const CLOSED_AGENDA_STATUSES = new Set(["COMPLETED", "CANCELLED"]);
const ACTIVE_PUBLICATION_STATUSES = new Set(["PUBLISHED", "APPROVED", "PENDING_REVIEW", "PROVIDER_PENDING"]);

function text(value, fallback = "") {
  const result = String(value ?? "").trim();
  return result || fallback;
}

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function dateText(value) {
  const valueText = text(value);
  if (!valueText || Number.isNaN(Date.parse(valueText))) return "";
  return new Date(valueText).toISOString();
}

function monthOf(value) {
  const normalized = dateText(value);
  return normalized ? normalized.slice(0, 7) : "";
}

function sourceHref(tab, id) {
  return `/realty?view=broker_os&tab=${encodeURIComponent(tab)}&recordId=${encodeURIComponent(id)}`;
}

function parseTemplate(campaign) {
  if (campaign?.template && typeof campaign.template === "object") return campaign.template;
  try {
    return campaign?.template ? JSON.parse(campaign.template) : {};
  } catch {
    return {};
  }
}

function agendaTimeline(data) {
  return Array.isArray(data?.brokerAgenda?.timeline) ? data.brokerAgenda.timeline : [];
}

export function validateBrokerAgendaInput(input = {}) {
  const kind = text(input.kind, "VISIT").toUpperCase();
  const client = text(input.client);
  const scheduledAt = dateText(input.scheduledAt);
  const title = text(input.title);
  if (!BROKER_AGENDA_KINDS.includes(kind)) throw Object.assign(new Error("Tipo de actividad Broker no válido."), { status: 422 });
  if (!client || client.length > 180) throw Object.assign(new Error("Indica la persona vinculada a la visita o llamada."), { status: 422 });
  if (!scheduledAt) throw Object.assign(new Error("Indica una fecha y hora válidas para la actividad."), { status: 422 });
  if (title.length > 240) throw Object.assign(new Error("El título de la actividad supera el largo permitido."), { status: 422 });
  return {
    kind,
    client,
    title: title || `${kind === "CALL" ? "Llamada" : "Visita"} · ${client}`,
    scheduledAt,
    address: text(input.address).slice(0, 500),
    notes: text(input.notes).slice(0, 4000),
    propertyId: text(input.propertyId) || null,
    assignedToId: text(input.assignedToId) || null,
  };
}

export function createBrokerAgendaData(input = {}, actor = {}) {
  const normalized = validateBrokerAgendaInput(input);
  const now = new Date().toISOString();
  return {
    client: normalized.client,
    propertyId: normalized.propertyId,
    scheduledAt: normalized.scheduledAt,
    address: normalized.address,
    result: "",
    brokerAgenda: {
      kind: normalized.kind,
      confirmationState: "PENDING",
      reminder: null,
      escalation: null,
      notes: normalized.notes,
      createdAt: now,
      createdBy: text(actor.id),
      timeline: [{ at: now, action: "CREATED", by: text(actor.id), note: "Actividad creada desde Broker OS." }],
    }
  };
}

export function applyBrokerAgendaAction(record, input = {}, actor = {}) {
  const action = text(input.action).toUpperCase();
  if (!BROKER_AGENDA_ACTIONS.includes(action)) throw Object.assign(new Error("Acción de agenda Broker no válida."), { status: 422 });
  const prior = object(record?.data);
  const agenda = object(prior.brokerAgenda);
  const currentStatus = text(record?.status, "SCHEDULED").toUpperCase();
  if (CLOSED_AGENDA_STATUSES.has(currentStatus)) throw Object.assign(new Error("La actividad ya está finalizada y no admite más cambios."), { status: 409 });
  const now = new Date().toISOString();
  const note = text(input.note).slice(0, 4000);
  let status = currentStatus;
  let confirmationState = text(agenda.confirmationState, "PENDING").toUpperCase();
  let scheduledAt = dateText(prior.scheduledAt || agenda.scheduledAt);
  const nextAgenda = { ...agenda };
  let notice = "Actividad actualizada.";

  if (action === "CONFIRM") {
    confirmationState = "CONFIRMED";
    notice = "Confirmación registrada internamente. No se envió ningún mensaje externo.";
  }
  if (action === "PREPARE_REMINDER") {
    nextAgenda.reminder = { preparedAt: now, preparedBy: text(actor.id), note };
    notice = "Recordatorio preparado para revisión interna. No se envió ninguna comunicación.";
  }
  if (action === "ESCALATE") {
    if (!note) throw Object.assign(new Error("Explica el motivo antes de escalar la actividad."), { status: 422 });
    nextAgenda.escalation = { escalatedAt: now, escalatedBy: text(actor.id), note, status: "PENDING_REVIEW" };
    status = "PENDING_REVIEW";
    notice = "Actividad derivada a revisión interna. No se contactó a ninguna persona.";
  }
  if (action === "COMPLETE") {
    status = "COMPLETED";
    confirmationState = confirmationState === "PENDING" ? "NOT_REQUIRED" : confirmationState;
    nextAgenda.completedAt = now;
    nextAgenda.completedBy = text(actor.id);
    if (note) nextAgenda.resultNote = note;
    notice = "Actividad marcada como realizada y registrada en su trazabilidad.";
  }
  if (action === "CANCEL") {
    if (!note) throw Object.assign(new Error("Indica el motivo de cancelación."), { status: 422 });
    status = "CANCELLED";
    confirmationState = "CANCELLED";
    nextAgenda.cancelledAt = now;
    nextAgenda.cancelledBy = text(actor.id);
    nextAgenda.cancelReason = note;
    notice = "Actividad cancelada. No se emitió ninguna comunicación externa.";
  }
  if (action === "RESCHEDULE") {
    scheduledAt = dateText(input.scheduledAt);
    if (!scheduledAt) throw Object.assign(new Error("Indica la nueva fecha y hora de la actividad."), { status: 422 });
    confirmationState = "PENDING";
    nextAgenda.rescheduledAt = now;
    nextAgenda.rescheduledBy = text(actor.id);
    nextAgenda.reminder = null;
    notice = "Actividad reprogramada. Requiere una nueva confirmación interna.";
  }

  nextAgenda.confirmationState = confirmationState;
  nextAgenda.timeline = [...agendaTimeline(prior), { at: now, action, by: text(actor.id), note, scheduledAt: action === "RESCHEDULE" ? scheduledAt : undefined }];
  return {
    status,
    data: { ...prior, scheduledAt, brokerAgenda: nextAgenda },
    auditAction: `BROKER_AGENDA_${action}`,
    notice,
  };
}

export function brokerCampaignContext(campaign, propertiesById = new Map()) {
  const template = parseTemplate(campaign);
  const context = object(template.brokerContext);
  const propertyId = text(context.propertyId || template.propertyId);
  const property = propertiesById.get(propertyId);
  const investment = Math.max(0, number(context.investment ?? template.investment));
  // Los borradores de Campaña IA registran `expectedLeads`; se acepta además
  // `leads` para campañas creadas antes de este flujo.
  const leads = Math.max(0, number(context.expectedLeads ?? context.leads ?? template.expectedLeads ?? template.leads));
  const expectedRevenue = Math.max(0, number(context.expectedRevenue ?? template.expectedRevenue));
  const cpl = leads > 0 ? investment / leads : null;
  const potentialRoi = investment > 0 ? ((expectedRevenue - investment) / investment) * 100 : null;
  return {
    id: campaign.id,
    name: text(campaign.name, "Campaña sin nombre"),
    status: text(campaign.status, "DRAFT").toUpperCase(),
    propertyId: propertyId || null,
    propertyTitle: property?.title || text(context.propertyTitle || template.propertyTitle, "Propiedad sin vínculo"),
    investment,
    leads,
    cpl,
    expectedRevenue,
    potentialRoi,
    source: text(context.source || template.source, "CAMPAÑA_INTERNA"),
    requiresHumanApproval: true,
    scheduledAt: campaign.scheduledAt?.toISOString?.() || campaign.scheduledAt || null,
    updatedAt: campaign.updatedAt?.toISOString?.() || campaign.updatedAt || null,
    sourceHref: "/campaigns",
  };
}

export function publicBrokerAgenda(record, propertiesById = new Map()) {
  const data = object(record?.data);
  const agenda = object(data.brokerAgenda);
  const propertyId = text(data.propertyId);
  const scheduledAt = dateText(data.scheduledAt || agenda.scheduledAt);
  const status = text(record?.status, "SCHEDULED").toUpperCase();
  const kind = text(agenda.kind, "VISIT").toUpperCase() === "CALL" ? "CALL" : "VISIT";
  return {
    id: record.id,
    title: text(record.title, `${kind === "CALL" ? "Llamada" : "Visita"} sin título`),
    kind,
    status,
    client: text(data.client, "Persona por confirmar"),
    propertyId: propertyId || null,
    propertyTitle: propertiesById.get(propertyId)?.title || text(data.propertyTitle, "Sin propiedad vinculada"),
    scheduledAt: scheduledAt || null,
    address: text(data.address),
    confirmationState: text(agenda.confirmationState, "PENDING").toUpperCase(),
    reminderPreparedAt: agenda.reminder?.preparedAt || null,
    escalation: agenda.escalation || null,
    notes: text(agenda.notes),
    result: text(agenda.resultNote || data.result),
    sourceHref: sourceHref("commercial_hub", record.id),
  };
}

export function publicBrokerChat({ conversation, link, propertiesById = new Map() }) {
  const contact = object(conversation?.contact);
  const lead = object(conversation?.lead);
  const linkData = object(link?.data);
  const propertyId = text(linkData.propertyId);
  return {
    id: conversation.id,
    contactName: text(contact.name || lead.name || contact.externalId, "Contacto sin nombre"),
    channel: text(contact.channel, "CANAL_DESCONOCIDO").toUpperCase(),
    status: text(conversation.status, "OPEN").toUpperCase(),
    mode: text(conversation.mode, "HUMAN").toUpperCase(),
    assignedToId: conversation.assignedToId || null,
    lastMessageAt: conversation.lastMessageAt?.toISOString?.() || conversation.lastMessageAt || null,
    leadStatus: text(lead.status),
    link: link ? {
      id: link.id,
      targetType: text(linkData.targetType),
      targetId: text(linkData.targetId),
      propertyId: propertyId || null,
      propertyTitle: propertiesById.get(propertyId)?.title || text(linkData.propertyTitle),
      createdAt: link.createdAt?.toISOString?.() || link.createdAt || null,
    } : null,
    inboxHref: `/inbox?conversationId=${encodeURIComponent(conversation.id)}`,
  };
}

export function buildBrokerCommercialHub({ properties = [], campaigns = [], publications = [], agendaRecords = [], conversations = [], chatLinks = [], month = "" } = {}) {
  const normalizedMonth = /^\d{4}-\d{2}$/.test(text(month)) ? text(month) : new Date().toISOString().slice(0, 7);
  const propertiesById = new Map(properties.map((property) => [property.id, property]));
  const visiblePropertyIds = new Set(propertiesById.keys());
  const marketing = campaigns
    .map((campaign) => brokerCampaignContext(campaign, propertiesById))
    .filter((campaign) => campaign.propertyId && visiblePropertyIds.has(campaign.propertyId));
  const agenda = agendaRecords
    .map((record) => publicBrokerAgenda(record, propertiesById))
    .filter((item) => item.scheduledAt && monthOf(item.scheduledAt) === normalizedMonth)
    .sort((a, b) => String(a.scheduledAt).localeCompare(String(b.scheduledAt)));
  const linksByConversation = new Map(chatLinks.map((link) => [text(object(link.data).conversationId), link]));
  const chats = conversations
    .map((conversation) => publicBrokerChat({ conversation, link: linksByConversation.get(String(conversation.id)), propertiesById }))
    .sort((a, b) => String(b.lastMessageAt || "").localeCompare(String(a.lastMessageAt || "")));
  const publicationRows = publications.filter((record) => visiblePropertyIds.has(text(object(record.data).propertyId)));
  const pendingAgenda = agenda.filter((item) => !CLOSED_AGENDA_STATUSES.has(item.status));
  const now = Date.now();
  const needsEscalation = pendingAgenda.filter((item) => item.escalation?.status === "PENDING_REVIEW" || (item.scheduledAt && new Date(item.scheduledAt).getTime() < now && item.confirmationState !== "CONFIRMED"));
  const linkedChats = chats.filter((chat) => chat.link);
  const totalInvestment = marketing.reduce((sum, item) => sum + item.investment, 0);
  const totalLeads = marketing.reduce((sum, item) => sum + item.leads, 0);
  const totalExpectedRevenue = marketing.reduce((sum, item) => sum + item.expectedRevenue, 0);

  return {
    month: normalizedMonth,
    summary: {
      campaigns: marketing.length,
      activePublications: publicationRows.filter((record) => ACTIVE_PUBLICATION_STATUSES.has(text(object(record.data).publicationStatus, record.status).toUpperCase())).length,
      investment: totalInvestment,
      leads: totalLeads,
      cpl: totalLeads > 0 ? totalInvestment / totalLeads : null,
      potentialRoi: totalInvestment > 0 ? ((totalExpectedRevenue - totalInvestment) / totalInvestment) * 100 : null,
      agendaPending: pendingAgenda.length,
      confirmationsPending: pendingAgenda.filter((item) => item.confirmationState === "PENDING").length,
      escalationsPending: needsEscalation.length,
      linkedChats: linkedChats.length,
      unlinkedChats: chats.length - linkedChats.length,
    },
    marketing,
    agenda,
    chats,
    notes: {
      marketing: "La inversión, leads, CPL y ROI potencial son indicadores operativos registrados; no acreditan pauta ni resultados externos.",
      agenda: "Confirmaciones, recordatorios y escalaciones son acciones internas. Broker OS no envía mensajes ni agenda por cuenta propia.",
      chats: "La conversación conserva su canal y origen. Vincularla a Broker OS no altera ni envía mensajes al contacto.",
    }
  };
}

