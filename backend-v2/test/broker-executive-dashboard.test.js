/** Archivo: Verifica el Dashboard Ejecutivo y el Operation Tracker sin duplicar operaciones ni etapas. */
import test from "node:test";
import assert from "node:assert/strict";
import { brokerOperationPayload } from "../src/services/broker-operation-contract.service.js";
import { buildBrokerExecutiveDashboard, buildBrokerOperationTracker, trackerAdvanceReadiness, trackerChecklistUpdate, validateBrokerForecastAssumptions } from "../src/services/broker-executive-dashboard.service.js";

function sale(stage = "RECEPCION_MANDATO", extras = {}) {
  return brokerOperationPayload({
    id: "sale-1",
    tenantId: "tenant-1",
    title: "Venta departamento Providencia",
    assignedToId: "broker-1",
    createdAt: new Date("2026-10-01T10:00:00.000Z"),
    updatedAt: new Date("2026-10-10T10:00:00.000Z"),
    data: { operationType: "SALE", stage, propertyId: "property-1", estimatedCommission: 2500000, timeline: [{ at: "2026-10-01T10:00:00.000Z", type: "OPERATION_CREATED", stage }] },
    ...extras
  });
}

test("Dashboard Ejecutivo calcula forecast y conversión desde la lectura operativa existente", () => {
  const operation = sale("OFERTA_Y_NEGOCIACION");
  const model = {
    scope: { level: "COMPANY", description: "Empresa autorizada" },
    priorities: [],
    team: [{ userId: "broker-1", name: "Camila", activeOperations: 1, attentionOperations: 0, riskOperations: 0, projectedCommission: 2500000 }],
    pipeline: {
      bottlenecks: [{ key: "NEGOTIATION", label: "Negociación", count: 1, attention: 0, risk: 1, averageStageAgeDays: 20, kind: "RISK" }],
      operations: [{ operationId: "sale-1", title: operation.title, propertyId: "property-1", operationType: "SALE", stage: "OFERTA_Y_NEGOCIACION", pipelineKey: "OFFER", pipelineLabel: "Oferta", assignedToId: "broker-1", amount: 150000000, projectedCommission: 2500000, createdAt: "2026-10-01", updatedAt: "2026-10-10", stageStartedAt: "2026-10-01", ageDays: 10, stageAgeDays: 20, health: "RISK", bottleneck: "ETAPA_ESTANCADA", detail: "Seguimiento", terminal: false }]
    }
  };
  const dashboard = buildBrokerExecutiveDashboard({ readModel: model, operations: [operation], properties: [{ id: "property-1", data: { price: 150000000, comuna: "Providencia" } }], teamMembers: [{ id: "broker-1", name: "Camila" }] });
  assert.equal(dashboard.kpis.activeOperations, 1);
  assert.equal(dashboard.forecast.lines[0].commercialStage, "NEGOCIACION");
  assert.equal(dashboard.forecast.lines[0].probabilityPct, 70);
  assert.equal(dashboard.forecast.lines[0].weightedAmount, 105000000);
  assert.equal(dashboard.conversion.byCommune[0].label, "Providencia");
  assert.equal(dashboard.risks[0].title, operation.title);
});

test("Supuestos de forecast son acotados y no pueden disminuir entre etapas", () => {
  assert.equal(validateBrokerForecastAssumptions({ CAPTACION: 10, TASACION: 9 }).ok, false);
  assert.equal(validateBrokerForecastAssumptions({ CAPTACION: -1 }).ok, false);
  assert.equal(validateBrokerForecastAssumptions({ CAPTACION: 10, TASACION: 20, PUBLICACION: 30, INTERESADOS: 40, NEGOCIACION: 70, CIERRE_LEGAL: 90 }).ok, true);
});

test("Tracker usa la misma operación, expone contexto documental y exige checklist antes de avanzar", () => {
  const operation = sale();
  const first = buildBrokerOperationTracker({
    operation,
    actor: "PROPIETARIO",
    now: new Date("2026-10-20T10:00:00.000Z"),
    documents: [
      { id: "doc-1", title: "Certificado de dominio vigente", recordType: "legal_document", status: "APPROVED" },
      { id: "doc-2", title: "Borrador de promesa", recordType: "legal_document", status: "PENDING" }
    ]
  });
  assert.equal(first.current?.key, "TITULO_INICIAL");
  assert.equal(first.current?.checklist.length > 0, true);
  assert.equal(first.actorView?.actor, "PROPIETARIO");
  assert.equal(first.context.stageAgeDays, 19);
  assert.equal(first.context.risk.level, "MEDIO");
  assert.equal(first.context.documents.total, 2);
  assert.equal(first.context.documents.pending, 1);
  const withNamedResponsible = buildBrokerOperationTracker({
    operation: { ...operation, assignedToName: "Camila Rojas" },
    now: new Date("2026-10-20T10:00:00.000Z")
  });
  assert.equal(withNamedResponsible.context.responsible, "Camila Rojas");
  assert.equal(trackerAdvanceReadiness(operation).ok, false);
  let updated = operation;
  for (const entry of first.current.checklist) {
    const result = trackerChecklistUpdate({ operation: updated, checklistKey: entry.key, completed: true, actor: "Camila" });
    assert.equal(result.ok, true);
    updated = { ...updated, data: { ...updated.data, trackerChecklist: result.checks } };
  }
  assert.equal(trackerAdvanceReadiness(updated).ok, true);
  const completed = buildBrokerOperationTracker({ operation: updated });
  assert.equal(completed.notice.includes("misma operación"), true);
});
