import test from "node:test";
import assert from "node:assert/strict";
import { scoreRealtyLeadMatch } from "../src/services/realty-intelligence.service.js";

test("el matching inmobiliario prioriza presupuesto, comuna, tipo y operación compatibles", () => {
  const lead = {
    budget: 200000000,
    interest: "Busco comprar un departamento en Providencia",
    customFields: {}
  };
  const property = {
    status: "ACTIVE",
    data: {
      price: 210000000,
      commune: "Providencia",
      propertyType: "departamento",
      operation: "venta"
    }
  };

  const result = scoreRealtyLeadMatch(lead, property);
  assert.equal(result.score, 100);
  assert.ok(result.reasons.some((reason) => reason.includes("presupuesto")));
  assert.ok(result.reasons.some((reason) => reason.includes("Providencia")));
});
