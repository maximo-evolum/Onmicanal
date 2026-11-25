/** Archivo: Verifica mediante pruebas automatizadas el comportamiento de realty intelligence.test. */
import test from "node:test";
import assert from "node:assert/strict";
import { buildBrokerInventoryAlerts, scoreRealtyLeadMatch } from "../src/services/realty-intelligence.service.js";

test("El umbral cambia la recomendación, pero no el puntaje ni la incompatibilidad de operación", () => {
  const property={status:"ACTIVE",data:{price:100,operation:"venta"}};
  const lead={interest:"comprar",budget:100};
  const result=scoreRealtyLeadMatch(lead,property);
  assert.ok(result.score>0 && result.score<100);
  assert.equal(scoreRealtyLeadMatch(lead,property,result.score).compatibility.status,"RECOMMENDED");
  assert.equal(scoreRealtyLeadMatch(lead,property,result.score+1).compatibility.status,"REVIEW");
  assert.equal(scoreRealtyLeadMatch({...lead,interest:"arriendo"},property,0).compatibility.status,"OPERATION_INCOMPATIBLE");
});

test("La antigüedad de borradores y el plazo de fichas incompletas se aplican independientemente", () => {
  const properties=[{id:"qa",title:"Casa",status:"DRAFT",data:{},updatedAt:new Date("2026-01-05T12:00:00Z")}];
  const codes=(draftDays,incompleteDays)=>buildBrokerInventoryAlerts({properties,draftDays,incompleteDays,now:new Date("2026-01-15T12:00:00Z")}).map(a=>a.code);
  assert.ok(codes(9,11).includes("DRAFT_STALE"));assert.ok(!codes(9,11).includes("INCOMPLETE_PROFILE"));
  assert.ok(!codes(11,10).includes("DRAFT_STALE"));assert.ok(codes(11,10).includes("INCOMPLETE_PROFILE"));
});

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
