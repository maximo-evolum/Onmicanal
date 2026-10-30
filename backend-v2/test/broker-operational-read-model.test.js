/** Archivo: Verifica el contrato único de indicadores y prioridades de Broker OS. */
import test from "node:test";
import assert from "node:assert/strict";
import { brokerPropertyMissingData, buildBrokerOperationalReadModel } from "../src/services/broker-operational-read-model.service.js";

test("Broker OS construye indicadores y prioridades desde una única lectura", () => {
  const model = buildBrokerOperationalReadModel({
    now: new Date("2026-10-28T12:00:00.000Z"),
    properties: [{
      id: "property-1",
      title: "Departamento Providencia",
      assignedToId: "broker-1",
      data: { price: 120000000, address: "Av. Providencia 123", comuna: "Providencia" }
    }],
    operations: [{
      id: "operation-1",
      title: "Venta Departamento Providencia",
      assignedToId: "broker-1",
      data: { propertyId: "property-1", operationType: "SALE", stage: "EVALUACION_COMERCIAL", estimatedCommission: 2400000 }
    }],
    brokerRecords: [{
      id: "document-1",
      title: "Certificado de dominio vigente",
      recordType: "legal_document",
      status: "APPROVED",
      assignedToId: "broker-1",
      data: { propertyId: "property-1", expiresAt: "2026-10-30" }
    }],
    counts: { properties: 1, scheduledVisits: 2, openAlerts: 3, activeRentals: 0, openMaintenance: 1, openPostSale: 0, activeFinancing: 1 }
  });

  assert.equal(model.version, "BROKER_OPERATIONAL_READ_MODEL_V2");
  assert.equal(model.kpis.properties, 1);
  assert.equal(model.kpis.activeOperations, 1);
  assert.equal(model.reporting.portfolioValue, 120000000);
  assert.equal(model.reporting.projectedCommission, 2400000);
  assert.equal(model.pipeline.byStage["SALE:EVALUACION_COMERCIAL"], 1);
  assert.equal(model.priorities.some((item) => item.source === "PROPERTY_COMPLETENESS" && item.propertyId === "property-1"), true);
  assert.equal(model.priorities.some((item) => item.source === "OPERATION_NEXT_STAGE" && item.operationId === "operation-1"), true);
  assert.equal(model.priorities.some((item) => item.source === "DUE_DATE_CONTROL" && item.dueAt), true);
});

test("Centro operacional y pipeline conservan edad, riesgos, documentos, cobros y revisión IA explicables", () => {
  const model = buildBrokerOperationalReadModel({
    now: new Date("2026-10-29T12:00:00.000Z"),
    scope: { level: "TEAM", description: "Equipo comercial autorizado" },
    teamMembers: [{ id: "broker-1", name: "Camila Corredora", email: "camila@demo.cl" }],
    properties: [{ id: "property-1", title: "Casa Bosques de Montemar", assignedToId: "broker-1", data: { price: 210000000, address: "Los Pinos 245", comuna: "Concón", photoUrl: "foto.jpg" } }],
    operations: [
      { id: "operation-risk", title: "Venta Casa Bosques de Montemar", assignedToId: "broker-1", createdAt: new Date("2026-09-01T12:00:00.000Z"), updatedAt: new Date("2026-09-01T12:00:00.000Z"), journey: { pipeline: { key: "NEGOTIATION", label: "Negociación" } }, data: { propertyId: "property-1", operationType: "SALE", stage: "PROMESA", estimatedCommission: 4200000, timeline: [{ at: "2026-09-01T12:00:00.000Z", type: "STAGE_CHANGED", stage: "PROMESA" }] } },
      { id: "operation-no-owner", title: "Arriendo sin responsable", createdAt: new Date("2026-10-25T12:00:00.000Z"), updatedAt: new Date("2026-10-25T12:00:00.000Z"), journey: { pipeline: { key: "CONTACT", label: "Contacto" } }, data: { propertyId: "property-1", operationType: "RENTAL", stage: "CAPTACION", timeline: [{ at: "2026-10-25T12:00:00.000Z", type: "OPERATION_CREATED", stage: "CAPTACION" }] } }
    ],
    evaluations: [{ id: "evaluation-1", title: "Revisar propuesta IA", data: { decision: "PENDING_REVIEW" } }],
    brokerRecords: [
      { id: "document-1", title: "Certificado pendiente", recordType: "legal_document", status: "PENDING", data: { propertyId: "property-1" } },
      { id: "collection-1", title: "Arriendo octubre", recordType: "rental_payment", status: "OVERDUE", assignedToId: "broker-1", data: { propertyId: "property-1", amount: 650000, dueDate: "2026-10-05" } }
    ]
  });

  assert.equal(model.scope.level, "TEAM");
  assert.equal(model.pipeline.columns.length, 8);
  assert.equal(model.pipeline.operations.find((item) => item.operationId === "operation-risk")?.health, "RISK");
  assert.equal(model.pipeline.operations.find((item) => item.operationId === "operation-no-owner")?.bottleneck, "SIN_RESPONSABLE");
  assert.equal(model.operationalCenter.documentsPending, 1);
  assert.equal(model.operationalCenter.collectionsPending, 1);
  assert.equal(model.operationalCenter.aiApprovalsPending, 1);
  assert.equal(model.team[0]?.name, "Camila Corredora");
  assert.equal(model.priorities.some((item) => item.source === "OPERATION_HEALTH"), true);
  assert.equal(model.priorities.some((item) => item.source === "COLLECTION_CONTROL"), true);
  assert.equal(model.priorities.some((item) => item.source === "AI_EVALUATION_PENDING"), true);
});

test("Broker OS no declara activa una operación que ya alcanzó una etapa terminal", () => {
  const model = buildBrokerOperationalReadModel({
    operations: [{ id: "operation-closed", title: "Arriendo terminado", data: { operationType: "RENTAL", stage: "ENTREGA_LLAVES" } }]
  });
  assert.equal(model.pipeline.total, 1);
  assert.equal(model.pipeline.active, 0);
  assert.equal(model.pipeline.terminal, 1);
});

test("Broker OS reconoce comuna histórica y actual al revisar una ficha", () => {
  const missing = brokerPropertyMissingData({ data: { price: 100000000, address: "Av. Italia 320", comuna: "Ñuñoa", photoUrls: ["foto.jpg"] } });
  assert.deepEqual(missing, []);
});
