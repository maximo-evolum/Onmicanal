import test from "node:test";
import assert from "node:assert/strict";
import {
  brokerPostSaleReadiness,
  normalizeBrokerHandover,
  normalizeBrokerInspection,
  normalizeBrokerPostSaleCase,
  normalizeBrokerWarrantyCase,
} from "../src/services/broker-post-sale.service.js";

test("una inspección exige evidencia y recepción antes del cierre", () => {
  const incomplete = normalizeBrokerInspection({ scheduledAt: "2026-09-01", inspectorName: "Inspector demo", inspectedAt: "2026-09-01", conditionSummary: "Revisión", checklist: { detalle: "Medidores" } });
  incomplete.checkpoints = { inspeccion: { confirmedAt: "2026-09-01" } };
  assert.equal(brokerPostSaleReadiness({ kind: "inspection", targetStage: "CERRADA", entity: incomplete }).ready, false);
  const complete = { ...incomplete, completedAt: new Date("2026-09-02"), checkpoints: { ...incomplete.checkpoints, recepcion: { confirmedAt: "2026-09-02" } } };
  assert.equal(brokerPostSaleReadiness({ kind: "inspection", targetStage: "CERRADA", entity: complete }).ready, true);
});

test("la entrega exige inventario, acta y aceptación humana", () => {
  const handover = normalizeBrokerHandover({ scheduledAt: "2026-09-01", recipientName: "Comprador demo", inventoryReference: "INV-01", actaReference: "ACTA-01", handoverAt: "2026-09-02", acceptedAt: "2026-09-02" });
  handover.checkpoints = { inventario: { confirmedAt: "2026-09-01" }, firma: { confirmedAt: "2026-09-02" } };
  assert.equal(brokerPostSaleReadiness({ kind: "handover", targetStage: "CERRADA", entity: handover }).ready, false);
  handover.checkpoints.entrega = { confirmedAt: "2026-09-02" };
  assert.equal(brokerPostSaleReadiness({ kind: "handover", targetStage: "CERRADA", entity: handover }).ready, true);
});

test("postventa y garantía no se cierran sin resolución confirmada", () => {
  const postSale = normalizeBrokerPostSaleCase({ title: "Caso demo", description: "Sello exterior", responsibleName: "Postventa", diagnosis: "Desgaste", actionPlan: "Aplicar sello", responseDueAt: "2026-09-05", resolution: "Sello aplicado", resolvedAt: "2026-09-05" });
  postSale.checkpoints = { diagnostico: { confirmedAt: "2026-09-01" } };
  assert.equal(brokerPostSaleReadiness({ kind: "case", targetStage: "CERRADA", entity: postSale }).ready, false);
  postSale.checkpoints.resolucion = { confirmedAt: "2026-09-05" };
  assert.equal(brokerPostSaleReadiness({ kind: "case", targetStage: "CERRADA", entity: postSale }).ready, true);

  const warranty = normalizeBrokerWarrantyCase({ coverageType: "PROVEEDOR", providerName: "Proveedor demo", warrantyUntil: "2027-02-01", claimReference: "GAR-01", submittedAt: "2026-09-02", resolution: "Repuesto instalado", resolvedAt: "2026-09-05" });
  warranty.checkpoints = { cobertura: { confirmedAt: "2026-09-01" }, reclamo: { confirmedAt: "2026-09-02" } };
  assert.equal(brokerPostSaleReadiness({ kind: "warranty", targetStage: "CERRADA", entity: warranty }).ready, false);
  warranty.checkpoints.recepcion = { confirmedAt: "2026-09-05" };
  assert.equal(brokerPostSaleReadiness({ kind: "warranty", targetStage: "CERRADA", entity: warranty }).ready, true);
});
