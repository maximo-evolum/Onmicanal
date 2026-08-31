import test from "node:test";
import assert from "node:assert/strict";
import { brokerSaleReadiness, normalizeBrokerSaleCase } from "../src/services/broker-sale.service.js";

const checkpoints = Object.fromEntries(["oferta", "promesa", "titulos", "escritura", "inscripcion", "entrega"].map((key) => [key, { confirmedAt: "2026-08-30T12:00:00.000Z" }]));

const completeSale = {
  buyerName: "Carolina Fuentes",
  buyerQualificationStatus: "PREAPROBADO",
  preapprovalBank: "Banco de demostración",
  preapprovalAmount: 180000000,
  offerAmount: 229000000,
  offerStatus: "ACEPTADA",
  offerReceivedAt: "2026-08-12",
  offerRespondedAt: "2026-08-13",
  promiseStatus: "FIRMADA",
  promiseSignedAt: "2026-08-20",
  promiseAmount: 229000000,
  promisePenaltyPct: 10,
  titleStudyStatus: "APROBADO",
  titleStudyReviewedAt: "2026-08-22",
  financingStatus: "APROBADO",
  bankAppraisalStatus: "APROBADA",
  deedStatus: "FIRMADA",
  deedSignedAt: "2026-08-25",
  cbrStatus: "INSCRITA",
  cbrEntryNumber: "DEMO-2026-100",
  cbrRegisteredAt: "2026-08-28",
  handoverStatus: "COMPLETADA",
  handoverAt: "2026-08-30",
  handoverRecipient: "Carolina Fuentes",
  checkpoints,
};

test("normaliza el expediente de venta sin aceptar estados arbitrarios", () => {
  const normalized = normalizeBrokerSaleCase({ buyerName: "  Carolina ", offerStatus: "aceptada", financingStatus: "no requiere", handoverStatus: "inexistente" });
  assert.equal(normalized.buyerName, "Carolina");
  assert.equal(normalized.offerStatus, "ACEPTADA");
  assert.equal(normalized.financingStatus, "NO_REQUIERE");
  assert.equal(normalized.handoverStatus, "PENDIENTE");
});

test("impide avanzar a promesa si la oferta no tiene confirmación humana", () => {
  const result = brokerSaleReadiness({ targetStage: "PROMESA", saleCase: { ...completeSale, checkpoints: {} } });
  assert.equal(result.ready, false);
  assert.match(result.missing.join(" "), /responsable/i);
});

test("autoriza los hitos finales solo con expediente completo y confirmado", () => {
  for (const stage of ["PROMESA", "ESTUDIO_DE_TITULO", "ESCRITURA", "INSCRIPCION_CBR", "ENTREGA_Y_POSTVENTA"]) {
    const result = brokerSaleReadiness({ targetStage: stage, saleCase: completeSale });
    assert.equal(result.ready, true, `debe estar listo para ${stage}`);
  }
});

test("exige inscripción y entrega verificables antes de cerrar una venta", () => {
  const result = brokerSaleReadiness({ targetStage: "ENTREGA_Y_POSTVENTA", saleCase: { ...completeSale, cbrEntryNumber: "", handoverStatus: "AGENDADA" } });
  assert.equal(result.ready, false);
  assert.equal(result.missing.length, 2);
});
