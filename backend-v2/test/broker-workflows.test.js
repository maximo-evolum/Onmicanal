import test from "node:test";
import assert from "node:assert/strict";
import {
  BROKER_AGENT_CATALOG,
  BROKER_EXTERNAL_READINESS,
  BROKER_AGENT_SCENARIOS,
  BROKER_AUTOMATION_RULES,
  BROKER_RECORD_AREAS,
  BROKER_RECORD_TYPES,
  FINANCING_STAGES,
  RENTAL_STAGES,
  SALE_STAGES,
  calculateBrokerCommission,
  calculateBrokerAdministrationLiquidation,
  brokerFinancingChecklist,
  brokerStageChecklist,
  brokerAdministrationRate,
  normalizeBrokerOperatingPolicy,
  normalizeBrokerStage,
  propertyHealthSnapshot,
  brokerRecordDefinition,
  isBrokerRecordArea,
  stagesForBrokerOperation,
  validateBrokerRecord,
  brokerAgentScenario,
  validateBrokerStageTransition
  ,validateBrokerFinancingTransition
} from "../src/services/broker-workflows.service.js";

test("Broker OS expone los flujos oficiales de venta y arriendo", () => {
  assert.equal(SALE_STAGES.length, 9);
  assert.equal(SALE_STAGES[0], "EVALUACION_COMERCIAL");
  assert.equal(SALE_STAGES.at(-1), "ENTREGA_Y_POSTVENTA");
  assert.equal(RENTAL_STAGES.includes("CONTRATO"), true);
  assert.equal(stagesForBrokerOperation("RENTAL")[0], "CAPTACION");
});

test("Broker OS no permite saltar etapas de una operacion", () => {
  const rejected = validateBrokerStageTransition({ operationType: "SALE", currentStage: "EVALUACION_COMERCIAL", nextStage: "OFERTA_Y_NEGOCIACION" });
  const accepted = validateBrokerStageTransition({ operationType: "SALE", currentStage: "EVALUACION_COMERCIAL", nextStage: "MANDATO_Y_PUBLICACION" });
  assert.equal(rejected.ok, false);
  assert.equal(accepted.ok, true);
});

test("Broker OS normaliza operaciones antiguas al flujo canónico", () => {
  assert.equal(normalizeBrokerStage("SALE", "PUBLICACION"), "MANDATO_Y_PUBLICACION");
  assert.equal(normalizeBrokerStage("RENTAL", "POSTULACION"), "EVALUACION_ARRENDATARIO");
  assert.equal(brokerStageChecklist("SALE", "PUBLICACION").length > 0, true);
});

test("Broker OS calcula comisión sin modificar pagos ni liquidaciones", () => {
  const preview = calculateBrokerCommission({ baseAmount: 100000000, commissionRatePct: 2, brokerSplitPct: 50, companySplitPct: 50 });
  assert.equal(preview.ok, true);
  assert.equal(preview.totalCommission, 2000000);
  assert.equal(preview.brokerAmount, 1000000);
  assert.equal(preview.companyAmount, 1000000);
  assert.equal(calculateBrokerCommission({ baseAmount: 1, commissionRatePct: 1, brokerSplitPct: 60, companySplitPct: 30 }).ok, false);
});

test("Broker OS parametriza honorarios y SLA sin habilitar desembolsos automáticos", () => {
  const policy = normalizeBrokerOperatingPolicy({
    sales: { sellerCommissionPct: 2, buyerCommissionPct: 2, brokerSplitPct: 50, companySplitPct: 50 },
    administration: { tiers: [{ fromProperties: 1, ratePct: 10 }, { fromProperties: 2, ratePct: 7 }, { fromProperties: 3, ratePct: 5 }] },
    financing: { interestRatePct: 1.5, riskThreshold: 65, automaticDisbursement: true }
  });
  assert.equal(brokerAdministrationRate(policy, 3), 5);
  assert.equal(policy.financing.automaticDisbursement, false);
  assert.equal(policy.financing.requiresHumanApproval, true);
});

test("Broker OS calcula salud de la propiedad desde ficha y expediente", () => {
  const snapshot = propertyHealthSnapshot(
    { data: { address: "Av. Providencia 100", comuna: "Providencia", price: 100000000, propertyType: "Departamento", meters: 80, photoUrl: "foto.jpg", ownerName: "Ana" } },
    [
      { recordType: "property_mandate", status: "SIGNED" },
      { recordType: "legal_document", status: "APPROVED" },
      { recordType: "visit", status: "SCHEDULED" }
    ]
  );
  assert.equal(snapshot.score, 100);
  assert.equal(snapshot.status, "LISTA_PARA_OPERAR");
});

test("Broker OS conoce las areas de expediente operativas", () => {
  assert.equal(isBrokerRecordArea("rentals"), true);
  assert.equal(isBrokerRecordArea("financing"), true);
  assert.equal(isBrokerRecordArea("maintenance"), true);
  assert.equal(isBrokerRecordArea("anything_else"), false);
  assert.equal(BROKER_RECORD_AREAS.documents.includes("property_document"), true);
  assert.equal(BROKER_RECORD_AREAS.financing.includes("operation_financing"), true);
  assert.equal(BROKER_RECORD_AREAS.documents.includes("data_processing_consent"), true);
});

test("Broker OS separa consentimiento interno de la habilitación de terceros", () => {
  assert.equal(BROKER_EXTERNAL_READINESS.some((item) => item.key === "electronic_signature" && item.status === "PENDING_PROVIDER"), true);
  const consent = validateBrokerRecord({
    recordType: "data_processing_consent",
    status: "GRANTED",
    data: { propertyId: "property-1", subjectName: "Carolina Fuentes", subjectRole: "Compradora", consentPurpose: "Evaluación comercial", acceptedAt: "2026-08-28", evidenceReference: "Consentimiento demo 001" }
  });
  assert.equal(consent.ok, true);
});

test("Broker OS mantiene completo y sin duplicados su catálogo técnico", () => {
  const typesByArea = Object.values(BROKER_RECORD_AREAS).flat();
  assert.equal(new Set(typesByArea).size, typesByArea.length);
  assert.deepEqual([...BROKER_RECORD_TYPES].sort(), [...typesByArea].sort());

  for (const recordType of BROKER_RECORD_TYPES) {
    const definition = brokerRecordDefinition(recordType);
    assert.ok(definition, `Falta definición para ${recordType}`);
    assert.equal(Array.isArray(definition.required), true);
    assert.equal(definition.required.length > 0, true);
  }
});

test("Broker OS valida las fichas segun el proceso que representan", () => {
  const missing = validateBrokerRecord({ recordType: "property_mandate", data: { propertyId: "property-1" }, status: "DRAFT" });
  const complete = validateBrokerRecord({
    recordType: "property_mandate",
    data: { propertyId: "property-1", ownerName: "Maria Perez", startDate: "2026-08-14", endDate: "2027-08-14", exclusivityMonths: 12, commissionRatePct: 2 },
    status: "PENDING_SIGNATURE"
  });
  assert.equal(missing.ok, false);
  assert.equal(complete.ok, true);
  assert.equal(complete.status, "PENDING_SIGNATURE");
});

test("Broker OS expone agentes con estado real de disponibilidad", () => {
  assert.equal(BROKER_AGENT_CATALOG.length, 13);
  assert.equal(BROKER_AGENT_CATALOG.some((agent) => agent.key === "commercial" && agent.status === "AVAILABLE"), true);
  assert.equal(BROKER_AGENT_CATALOG.some((agent) => agent.key === "legal" && agent.status === "PLANNED"), true);
});

test("Broker OS mantiene escenarios evaluables y automatizaciones con control humano", () => {
  assert.equal(BROKER_AGENT_SCENARIOS.length >= 10, true);
  assert.equal(brokerAgentScenario("comprador-providencia")?.agentKey, "commercial");
  assert.equal(BROKER_AUTOMATION_RULES.every((rule) => typeof rule.approval === "string" && rule.approval.length > 0), true);
  assert.equal(BROKER_AUTOMATION_RULES.some((rule) => rule.key === "visita_sin_seguimiento"), true);
});

test("Broker OS prepara una liquidación mensual sin transferir dinero", () => {
  const preview = calculateBrokerAdministrationLiquidation({ monthlyRent: 850000, paidAmount: 850000, commonExpenses: 120000, utilities: 30000, maintenanceCost: 20000, managementRatePct: 10 });
  assert.equal(preview.managementFee, 85000);
  assert.equal(preview.ownerTransferAmount, 595000);
  assert.equal(preview.requiresHumanApproval, true);
  assert.equal(preview.automaticTransfer, false);
});

test("Broker OS valida el ciclo completo de financiamiento sin saltar etapas", () => {
  assert.equal(FINANCING_STAGES.length, 12);
  assert.equal(brokerFinancingChecklist("SOLICITUD").length > 0, true);
  assert.equal(validateBrokerFinancingTransition({ currentStage: "SOLICITUD", nextStage: "APROBACION" }).ok, false);
  assert.equal(validateBrokerFinancingTransition({ currentStage: "SOLICITUD", nextStage: "EVALUACION" }).ok, true);
  assert.equal(validateBrokerFinancingTransition({ currentStage: "EVALUACION", nextStage: "RECHAZADO" }).terminal, true);
});
