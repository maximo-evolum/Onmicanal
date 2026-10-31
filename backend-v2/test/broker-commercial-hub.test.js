/** Archivo: Valida Marketing, Agenda e Inbox conectados de Broker OS sin automatizar acciones externas. */
import test from "node:test";
import assert from "node:assert/strict";
import {
  applyBrokerAgendaAction,
  buildBrokerCommercialHub,
  createBrokerAgendaData,
  validateBrokerAgendaInput,
} from "../src/services/broker-commercial-hub.service.js";

const property = { id: "prop-1", title: "Departamento en Providencia" };

test("El centro comercial conserva propiedad, indicadores de campaña y canal de Inbox", () => {
  const hub = buildBrokerCommercialHub({
    month: "2026-10",
    properties: [property],
    campaigns: [{
      id: "campaign-1",
      name: "Campaña captación Providencia",
      status: "DRAFT",
      template: JSON.stringify({
        brokerContext: {
          propertyId: "prop-1",
          source: "CAMPAIGN_IA_DRAFT",
          investment: 120000,
          expectedLeads: 12,
          expectedRevenue: 600000,
        }
      })
    }],
    publications: [{ id: "publication-1", status: "PUBLISHED", data: { propertyId: "prop-1", publicationStatus: "PUBLISHED" } }],
    agendaRecords: [{
      id: "visit-1",
      title: "Visita de Camila Rojas",
      status: "SCHEDULED",
      data: {
        client: "Camila Rojas",
        propertyId: "prop-1",
        scheduledAt: "2026-10-21T15:00:00.000Z",
        brokerAgenda: { kind: "VISIT", confirmationState: "CONFIRMED", timeline: [] }
      }
    }],
    conversations: [{
      id: "chat-1",
      status: "OPEN",
      mode: "HUMAN",
      lastMessageAt: "2026-10-20T16:00:00.000Z",
      contact: { name: "Camila Rojas", channel: "WHATSAPP" },
      lead: null,
    }],
    chatLinks: [{
      id: "link-1",
      createdAt: "2026-10-20T16:10:00.000Z",
      data: { conversationId: "chat-1", targetType: "BUYER", targetId: "buyer-1", propertyId: "prop-1" }
    }]
  });

  assert.equal(hub.marketing.length, 1);
  assert.equal(hub.marketing[0].leads, 12);
  assert.equal(hub.marketing[0].cpl, 10000);
  assert.equal(hub.marketing[0].potentialRoi, 400);
  assert.equal(hub.summary.activePublications, 1);
  assert.equal(hub.agenda[0].propertyTitle, "Departamento en Providencia");
  assert.equal(hub.chats[0].channel, "WHATSAPP");
  assert.equal(hub.chats[0].link.targetType, "BUYER");
  assert.equal(hub.summary.linkedChats, 1);
  assert.match(hub.notes.chats, /no altera ni envía mensajes/i);
});

test("La agenda prepara recordatorios y confirmaciones internas sin enviar comunicaciones", () => {
  const data = createBrokerAgendaData({
    kind: "VISIT",
    client: "Matías Soto",
    scheduledAt: "2026-10-22T11:30:00-03:00",
    propertyId: "prop-1",
  }, { id: "user-1" });
  const source = { id: "visit-1", status: "SCHEDULED", data };
  const reminder = applyBrokerAgendaAction(source, { action: "PREPARE_REMINDER", note: "Confirmar antes de las 10:00." }, { id: "user-1" });
  const confirmation = applyBrokerAgendaAction({ ...source, data: reminder.data }, { action: "CONFIRM" }, { id: "user-1" });

  assert.equal(reminder.status, "SCHEDULED");
  assert.equal(reminder.data.brokerAgenda.reminder.note, "Confirmar antes de las 10:00.");
  assert.match(reminder.notice, /no se envió/i);
  assert.equal(confirmation.data.brokerAgenda.confirmationState, "CONFIRMED");
  assert.equal(confirmation.data.brokerAgenda.timeline.length, 3);
});

test("La agenda exige campos válidos y una razón al escalar o cancelar", () => {
  assert.throws(() => validateBrokerAgendaInput({ kind: "VISIT", client: "", scheduledAt: "2026-10-22" }), /persona vinculada/i);
  const source = {
    status: "SCHEDULED",
    data: createBrokerAgendaData({ client: "Paula Vega", scheduledAt: "2026-10-22T12:00:00.000Z" }, { id: "user-1" })
  };
  assert.throws(() => applyBrokerAgendaAction(source, { action: "ESCALATE" }, { id: "user-1" }), /motivo/i);
  assert.throws(() => applyBrokerAgendaAction(source, { action: "CANCEL" }, { id: "user-1" }), /motivo/i);
});
