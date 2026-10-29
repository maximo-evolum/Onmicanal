/** Archivo: Verifica cartera de propietarios, identidad estricta y sugerencias sin contacto externo. */
import test from "node:test";
import assert from "node:assert/strict";
import { buildBrokerOwnerWorkspace, filterBrokerOwnerWorkspaces } from "../src/services/broker-owner-workspace.service.js";

const now = new Date("2026-10-28T12:00:00.000Z");

test("la ficha de propietario consolida solo su cartera relacional visible", () => {
  const workspace = buildBrokerOwnerWorkspace({
    now,
    owner: { id: "owner-a", name: "María Pérez", rut: "12.345.678-5", phone: "+56912345678", isActive: true },
    legacyProperties: [
      { id: "legacy-a", title: "Departamento en Providencia" },
      { id: "legacy-b", title: "Casa histórica en Ñuñoa" },
      { id: "legacy-other", title: "Propiedad de otra cartera" }
    ],
    properties: [
      { id: "strict-a", ownerId: "owner-a", legacyRecordId: "legacy-a", address: "Av. Providencia 100", comuna: "Providencia", propertyType: "DEPARTAMENTO", askingPrice: 120000000, currency: "CLP", operationalStatus: "PUBLICACION", isActive: true, assignedBrokerId: "broker-1" },
      { id: "strict-b", ownerId: "owner-a", legacyRecordId: "legacy-b", address: "Av. Irarrázaval 200", comuna: "Ñuñoa", propertyType: "CASA", askingPrice: 90000, currency: "USD", operationalStatus: "VENDIDA", isActive: false }
    ],
    operations: [
      { id: "operation-a", title: "Venta Providencia", status: "ACTIVE", data: { ownerId: "owner-a", propertyId: "legacy-a", operationType: "SALE", stage: "PUBLICACION" } },
      { id: "operation-other", title: "Operación ajena", status: "ACTIVE", data: { ownerId: "owner-other", propertyId: "legacy-other", operationType: "SALE", stage: "PUBLICACION" } }
    ],
    contracts: [{ id: "contract-a", ownerId: "owner-a", propertyId: "strict-a", type: "ADMINISTRATION", status: "ACTIVE", endDate: "2026-11-10T00:00:00.000Z" }],
    records: [{ id: "mandate-a", recordType: "property_mandate", title: "Mandato Providencia", status: "SIGNED", data: { propertyId: "legacy-a", endDate: "2026-10-30T00:00:00.000Z" } }],
    managementActions: [{ id: "action-a", title: "Gestión propietario · María Pérez", status: "RECORDED", assignedToId: "broker-1", createdAt: "2026-10-27T12:00:00.000Z", data: { brokerOwnerId: "owner-a", type: "SEGUIMIENTO", note: "Solicitar certificado actualizado.", suggestedChannel: "WHATSAPP_O_LLAMADA" } }]
  });

  assert.equal(workspace.owner.identityStatus, "IDENTIDAD_ESTRICTA");
  assert.equal(workspace.portfolio.properties.length, 2);
  assert.deepEqual(workspace.portfolio.managedValueByCurrency, [{ currency: "CLP", value: 120000000 }]);
  assert.equal(workspace.metrics.administrationProperties, 1);
  assert.equal(workspace.portfolio.activeOperations.length, 1);
  assert.deepEqual(workspace.portfolio.properties.find((item) => item.id === "strict-a")?.related, {
    captureAvailable: false,
    operations: 1,
    contracts: 1,
    administration: 0
  });
  assert.equal(workspace.management[0].note, "Solicitar certificado actualizado.");
  assert.equal(workspace.owner.contactSuggestion.key, "WHATSAPP_O_LLAMADA");
  assert.equal(workspace.notices.some((item) => /no envían mensajes/i.test(item)), true);
  assert.equal(workspace.expirations.some((item) => item.id === "record-mandate-a"), true);
});

test("propietarios con el mismo nombre no se fusionan y los filtros no dependen del nombre", () => {
  const first = buildBrokerOwnerWorkspace({ now, owner: { id: "owner-1", name: "Alex Soto", rut: "11.111.111-1" }, properties: [{ id: "property-1", ownerId: "owner-1", legacyRecordId: "legacy-1", address: "Uno", comuna: "Santiago", propertyType: "CASA", askingPrice: 1, currency: "CLP", isActive: true }] });
  const second = buildBrokerOwnerWorkspace({ now, owner: { id: "owner-2", name: "Alex Soto", rut: "22.222.222-2" }, properties: [{ id: "property-2", ownerId: "owner-2", legacyRecordId: "legacy-2", address: "Dos", comuna: "La Florida", propertyType: "CASA", askingPrice: 2, currency: "CLP", isActive: true }] });
  const results = filterBrokerOwnerWorkspaces([first, second], { search: "22.222.222-2", portfolio: "ACTIVE" });
  assert.equal(results.length, 1);
  assert.equal(results[0].owner.id, "owner-2");
});

test("el filtro de atención prioriza vencimientos y no crea contactos externos", () => {
  const attention = buildBrokerOwnerWorkspace({
    now,
    owner: { id: "owner-attention", name: "Sin Contacto", isActive: true },
    properties: [{ id: "property-attention", ownerId: "owner-attention", legacyRecordId: "legacy-attention", address: "Tres", comuna: "Macul", propertyType: "CASA", askingPrice: 3, currency: "CLP", isActive: true }],
    records: [{ id: "alert-attention", recordType: "realty_alert", title: "Documento vencido", status: "ACTIVE", data: { propertyId: "legacy-attention", dueDate: "2026-10-10" } }]
  });
  const results = filterBrokerOwnerWorkspaces([attention], { portfolio: "ATTENTION" });
  assert.equal(results.length, 1);
  assert.equal(attention.owner.contactSuggestion.available, false);
  assert.equal(attention.opportunities[0].key, "CONTACTO");
});
