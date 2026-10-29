/** Archivo: Verifica el matching explicable, las alertas de inventario y las salvaguardas de acciones internas. */
import test from "node:test";
import assert from "node:assert/strict";
import { buildBrokerInventoryAlerts, scoreRealtyLeadMatch } from "../src/services/realty-intelligence.service.js";
import { buildBrokerMatchActionData, validateBrokerMatchAction } from "../src/services/broker-match-actions.service.js";

test("una operación incompatible se explica y no permite solicitar una visita", () => {
  const lead = { id: "lead-1", interest: "Quiero arrendar una casa", budget: 90000000, customFields: {} };
  const property = { id: "property-1", title: "Casa para venta", status: "ACTIVE", data: { operation: "VENTA", price: 85000000, commune: "Macul", propertyType: "CASA" } };
  const match = scoreRealtyLeadMatch(lead, property);

  assert.equal(match.compatibility.operationCompatible, false);
  assert.equal(match.compatibility.canRequestVisit, false);
  assert.match(match.warnings.join(" "), /Operación incompatible/);
  const validation = validateBrokerMatchAction({ leadId: lead.id, propertyId: property.id, action: "REQUEST_VISIT" }, match);
  assert.equal(validation.ok, false);
});

test("el descarte exige motivo y las decisiones no representan contacto o visita real", () => {
  const invalid = validateBrokerMatchAction({ leadId: "lead-1", propertyId: "property-1", action: "DISCARD_MATCH", reason: "No" }, {});
  assert.equal(invalid.ok, false);

  const valid = validateBrokerMatchAction({ leadId: "lead-1", propertyId: "property-1", action: "DISCARD_MATCH", reason: "El comprador confirmó que buscará una comuna distinta." }, {});
  assert.equal(valid.ok, true);
  const data = buildBrokerMatchActionData({ leadId: "lead-1", propertyId: "property-1", validation: valid, match: { score: 72, reasons: ["precio cercano"], cautions: [], warnings: [] }, userId: "user-1" });
  assert.equal(data.externalContactExecuted, false);
  assert.equal(data.visitConfirmed, false);
});

test("las alertas de inventario muestran borrador envejecido, ficha incompleta, responsable y mandato vencido", () => {
  const alerts = buildBrokerInventoryAlerts({
    now: new Date("2026-10-29T12:00:00.000Z"),
    properties: [{
      id: "property-1", title: "Casa de prueba", status: "DRAFT", updatedAt: new Date("2026-10-10T12:00:00.000Z"), assignedToId: null,
      data: { operation: "VENTA", price: 0, commune: "", photoUrl: "", meters: 0, ownerName: "" }
    }],
    mandates: [{ id: "mandate-1", status: "SIGNED", data: { propertyId: "property-1", endDate: "2026-10-01" } }]
  });
  assert.deepEqual(new Set(alerts.map((alert) => alert.code)), new Set(["EXPIRED_MANDATE", "UNASSIGNED_PROPERTY", "INCOMPLETE_PROFILE", "DRAFT_STALE"]));
  assert.equal(alerts[0].priority, "HIGH");
});
