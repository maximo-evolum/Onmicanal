import test from "node:test";
import assert from "node:assert/strict";
import { brokerRentalReadiness, normalizeBrokerRentalCase } from "../src/services/broker-rental.service.js";

const checkpoints = Object.fromEntries(["evaluacion", "reserva", "contrato", "pago_inicial", "entrega"].map((key) => [key, { confirmedAt: "2026-08-30T12:00:00.000Z" }]));

const completeRental = {
  tenantName: "Camila Soto",
  applicantTaxStatus: "APROBADA",
  applicantCommercialStatus: "APROBADA",
  guarantorEvaluationStatus: "APROBADO",
  applicationReceivedAt: "2026-08-04",
  applicationReviewedAt: "2026-08-05",
  reservationStatus: "CONFIRMADA",
  reservationAmount: 250000,
  reservationExpiresAt: "2026-08-25",
  contractStatus: "FIRMADO",
  monthlyRent: 590000,
  contractStartAt: "2026-09-01",
  contractEndAt: "2027-08-31",
  paymentDay: 5,
  depositAmount: 590000,
  contractSignedAt: "2026-08-20",
  initialPaymentStatus: "VERIFICADO",
  initialPaymentAmount: 1180000,
  initialPaymentReceivedAt: "2026-08-22",
  handoverStatus: "COMPLETADA",
  handoverAt: "2026-09-01",
  handoverRecipient: "Camila Soto",
  checkpoints,
};

test("normaliza el expediente de arriendo sin aceptar estados arbitrarios", () => {
  const normalized = normalizeBrokerRentalCase({ tenantName: "  Camila ", applicantTaxStatus: "aprobada", reservationStatus: "confirmada", initialPaymentStatus: "inventado", paymentDay: 45 });
  assert.equal(normalized.tenantName, "Camila");
  assert.equal(normalized.applicantTaxStatus, "APROBADA");
  assert.equal(normalized.reservationStatus, "CONFIRMADA");
  assert.equal(normalized.initialPaymentStatus, "PENDIENTE");
  assert.equal(normalized.paymentDay, null);
});

test("no permite contrato sin reserva confirmada y revisada", () => {
  const result = brokerRentalReadiness({ targetStage: "CONTRATO", rentalCase: { ...completeRental, reservationStatus: "PENDIENTE", checkpoints: {} } });
  assert.equal(result.ready, false);
  assert.match(result.missing.join(" "), /Reserva/i);
});

test("exige evaluación, contrato, pago y entrega verificables antes de cerrar", () => {
  const relatedRecords = [{ recordType: "visit", status: "COMPLETADA", data: {} }];
  for (const stage of ["VISITAS", "RESERVA", "CONTRATO", "PAGO_INICIAL", "ENTREGA_LLAVES"]) {
    const result = brokerRentalReadiness({ targetStage: stage, rentalCase: completeRental, relatedRecords });
    assert.equal(result.ready, true, `debe estar listo para ${stage}`);
  }
});

test("bloquea la entrega si no se verifica el pago o la recepción", () => {
  const result = brokerRentalReadiness({ targetStage: "ENTREGA_LLAVES", rentalCase: { ...completeRental, initialPaymentStatus: "INFORMADO", handoverRecipient: "" } });
  assert.equal(result.ready, false);
  assert.equal(result.missing.length, 2);
});
