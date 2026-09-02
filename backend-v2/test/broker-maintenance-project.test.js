import test from "node:test";
import assert from "node:assert/strict";
import { brokerMaintenanceReadiness, brokerProjectReadiness, normalizeBrokerMaintenance, normalizeBrokerProject } from "../src/services/broker-maintenance-project.service.js";

const maintenance = {
  category: "Gasfitería",
  description: "Filtración en lavaplatos",
  diagnosis: "Se requiere cambio de flexible y revisión de sello.",
  providerId: "provider-1",
  approvalStatus: "APROBADA",
  approvedAt: "2026-08-10",
  scheduledAt: "2026-08-12",
  resolvedAt: "2026-08-12",
  completionEvidence: "Acta interna DEMO-001 y fotografías de cierre.",
  acceptedAt: "2026-08-13",
  actualCost: 45000,
  checkpoints: {
    diagnostico: { confirmedAt: "2026-08-09" },
    aprobacion: { confirmedAt: "2026-08-10" },
    recepcion: { confirmedAt: "2026-08-13" },
  },
};
const quotes = [{ providerId: "provider-1", providerName: "Servicios Demo", amount: 45000, status: "SELECCIONADA" }];

test("normaliza mantenciones y proyectos con estados seguros", () => {
  const normalizedMaintenance = normalizeBrokerMaintenance({ category: "  Pintura ", priority: "critica", workflowStage: "ejecucion", approvalStatus: "inventada" });
  const normalizedProject = normalizeBrokerProject({ name: "  Mejora demo ", projectType: "Remodelación", status: "ejecucion" });
  assert.equal(normalizedMaintenance.category, "Pintura");
  assert.equal(normalizedMaintenance.priority, "CRITICA");
  assert.equal(normalizedMaintenance.workflowStage, "EJECUCION");
  assert.equal(normalizedMaintenance.approvalStatus, "PENDIENTE");
  assert.equal(normalizedProject.name, "Mejora demo");
  assert.equal(normalizedProject.status, "EJECUCION");
});

test("no deja programar una mantención sin cotización seleccionada y aprobación", () => {
  const result = brokerMaintenanceReadiness({ targetStage: "PROGRAMACION", maintenance: { ...maintenance, approvalStatus: "PENDIENTE", checkpoints: {} }, quotes: [{ ...quotes[0], status: "RECIBIDA" }] });
  assert.equal(result.ready, false);
  assert.match(result.missing.join(" "), /Cotización|Aprobación/i);
});

test("cierra una mantención solo con recepción y costo real", () => {
  const result = brokerMaintenanceReadiness({ targetStage: "CERRADA", maintenance, quotes });
  assert.equal(result.ready, true);
  const incomplete = brokerMaintenanceReadiness({ targetStage: "CERRADA", maintenance: { ...maintenance, acceptedAt: null, actualCost: null }, quotes });
  assert.equal(incomplete.ready, false);
  assert.equal(incomplete.missing.length, 2);
});

test("el proyecto exige presupuesto, aprobación y recepción confirmada", () => {
  const complete = { name: "Puesta en valor", projectType: "Remodelación", scope: "Pintura, iluminación y estilismo.", budget: 3200000, approvedBudget: 3150000, startAt: "2026-08-01", completedAt: "2026-08-25", acceptanceNotes: "Resultado recibido conforme.", checkpoints: { aprobacion: { confirmedAt: "2026-07-30" }, ejecucion: { confirmedAt: "2026-08-01" }, recepcion: { confirmedAt: "2026-08-25" } } };
  for (const stage of ["PRESUPUESTO", "APROBACION", "EJECUCION", "HITOS", "RECEPCION", "CERRADO"]) {
    assert.equal(brokerProjectReadiness({ targetStage: stage, project: complete }).ready, true, `debe estar listo para ${stage}`);
  }
});
