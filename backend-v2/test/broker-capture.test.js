import test from "node:test";
import assert from "node:assert/strict";
import { captureReadiness, normalizeBrokerCapture, validateBrokerCapture } from "../src/services/broker-capture.service.js";

const completeCapture = {
  ownerName: "María Pérez",
  address: "Av. Providencia 1234",
  comuna: "Providencia",
  propertyType: "Departamento",
  siteVisitAt: "2026-08-20",
  usableSquareMeters: 82,
  totalSquareMeters: 92,
  ownerExpectedPrice: 240000000,
  suggestedPrice: 232000000,
  preliminaryAppraisal: 232000000,
  preliminaryTitleStatus: "REVISADO_SIN_OBSERVACIONES",
  regularizationStatus: "REGULARIZADA",
  photoUrls: ["https://example.com/foto.jpg"],
  floorPlanUrl: "https://example.com/plano.pdf",
  ownerAcceptedEvaluationAt: "2026-08-21",
  buildingFloors: 18,
  unitsPerFloor: 6,
  elevators: 3,
  status: "LISTA_PARA_MANDATO",
};

test("la ficha de captación calcula brecha de precio y controles completos", () => {
  const normalized = normalizeBrokerCapture(completeCapture);
  assert.equal(normalized.priceGapPct, 3.448);
  const readiness = captureReadiness({ ...completeCapture, ...normalized });
  assert.equal(readiness.score, 100);
  assert.equal(readiness.missing.length, 0);
});

test("no permite avanzar al mandato si faltan antecedentes de captación", () => {
  const result = validateBrokerCapture({
    ownerName: "María Pérez",
    address: "Av. Providencia 1234",
    comuna: "Providencia",
    propertyType: "Departamento",
    status: "LISTA_PARA_MANDATO",
  });
  assert.equal(result.ok, false);
  assert.match(result.errors[0], /Para avanzar falta/);
});

test("exige una explicación cuando se detecta una observación legal o de regularización", () => {
  const result = validateBrokerCapture({
    ...completeCapture,
    preliminaryTitleStatus: "REVISADO_CON_OBSERVACIONES",
    regularizationStatus: "NO_REGULARIZADA",
  });
  assert.equal(result.ok, false);
  assert.equal(result.errors.length, 2);
});

test("una captación descartada conserva trazabilidad y exige motivo", () => {
  const withoutReason = validateBrokerCapture({ status: "DESCARTADA" });
  assert.equal(withoutReason.ok, false);
  const withReason = validateBrokerCapture({ status: "DESCARTADA", rejectionReason: "Expectativa de precio fuera de mercado." });
  assert.equal(withReason.ok, true);
});
