/** Archivo: Verifica que AI Ops de Broker sea explicable, de solo lectura y dependiente del modelo operacional. */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildBrokerAiOpsSnapshot } from "../src/services/broker-ai-ops.service.js";

test("AI Ops traduce las prioridades del modelo operacional sin crear una regla paralela", () => {
  const snapshot = buildBrokerAiOpsSnapshot({
    readModel: {
      generatedAt: "2026-11-04T12:00:00.000Z",
      scope: { level: "ASSIGNED", description: "Solo cartera asignada" },
      priorities: [{ id: "operation-1", priority: "HIGH", source: "OPERATION_HEALTH", title: "Seguimiento venta", detail: "Lleva 30 días sin avance.", impact: "SALUD_DEL_PIPELINE", responsibleUserId: "broker-1", operationId: "operation-1", requiresApproval: true }],
      pipeline: { total: 3, active: 2, bottlenecks: [{ label: "Negociación", count: 2, risk: 1, attention: 1, averageStageAgeDays: 18 }] },
      activity: { updatedLast30Days: 2 },
      operationalCenter: { documentsPending: 1, aiApprovalsPending: 1 }
    },
    teamMembers: [{ id: "broker-1", name: "Camila Corredora" }]
  });
  assert.equal(snapshot.priorities.length, 1);
  assert.equal(snapshot.priorities[0].reason, "Lleva 30 días sin avance.");
  assert.equal(snapshot.priorities[0].responsible, "Camila Corredora");
  assert.match(snapshot.priorities[0].href, /operationId=operation-1/);
  assert.equal(snapshot.priorities[0].requiresApproval, true);
  assert.equal(snapshot.patterns.some((item) => item.key === "pipeline-bottleneck"), true);
  assert.match(snapshot.notice, /No cambia estados/i);
});

test("AI Ops declara datos insuficientes en vez de inventar un patrón", () => {
  const snapshot = buildBrokerAiOpsSnapshot({
    readModel: { priorities: [], pipeline: { total: 1, active: 1, bottlenecks: [] }, activity: { updatedLast30Days: 1 }, operationalCenter: { documentsPending: 0, aiApprovalsPending: 0 } }
  });
  assert.equal(snapshot.patterns[0].status, "INSUFFICIENT_DATA");
  assert.match(snapshot.patterns[0].title, /Datos insuficientes/i);
});

test("la ruta AI Ops exige permiso de IA y reutiliza la lectura operacional", () => {
  const dirname = path.dirname(fileURLToPath(import.meta.url));
  const source = fs.readFileSync(path.resolve(dirname, "../src/routes/broker.routes.js"), "utf8");
  assert.match(source, /brokerRouter\.get\("\/broker\/ai-ops", requireBrokerAction\("ai", "VIEW"\)/);
  assert.match(source, /buildBrokerAiOpsSnapshot\(\{ readModel, teamMembers \}\)/);
  assert.match(source, /no actualiza etapas y no inicia comunicaciones externas/);
});
