import test from "node:test";
import assert from "node:assert/strict";
import { brokerRelationalCoverage, normalizeLegacyBrokerProperty } from "../src/services/broker-relational-data.service.js";

test("normaliza una propiedad histórica al núcleo relacional Broker", () => {
  const result = normalizeLegacyBrokerProperty({
    title: "Departamento demo",
    status: "ACTIVE",
    assignedToId: "broker-1",
    data: { ownerName: "Ana Pérez", address: "Av. Siempre Viva 123", comuna: "Providencia", propertyType: "Departamento", price: 125000000, meters: 68, bedrooms: 2, bathrooms: 2, gallery: ["https://example.com/propiedad.jpg"] },
  });
  assert.deepEqual(result.errors, []);
  assert.equal(result.owner.name, "Ana Pérez");
  assert.equal(result.property.propertyType, "DEPARTAMENTO");
  assert.equal(result.property.askingPrice, 125000000);
  assert.equal(result.property.assignedBrokerId, "broker-1");
});

test("rechaza una propiedad histórica con metros inconsistentes", () => {
  const result = normalizeLegacyBrokerProperty({ data: { ownerName: "Ana", address: "Uno", comuna: "Santiago", totalSquareMeters: 40, usableSquareMeters: 45 } });
  assert.ok(result.errors.some((error) => error.includes("metros útiles")));
});

test("calcula la cobertura de migración sin confundir datos antiguos", () => {
  assert.deepEqual(brokerRelationalCoverage({ legacyProperties: 12, strictProperties: 9, owners: 7 }), { legacyProperties: 12, strictProperties: 9, owners: 7, pendingProperties: 3, completionPercent: 75 });
});
