export const COMMERCIAL_STATES = Object.freeze({
  NEW: { code: "NEW", label: "Nuevo", priority: "low" },
  CONTACTED: { code: "CONTACTED", label: "Contactado", priority: "medium" },
  QUALIFIED: { code: "QUALIFIED", label: "Calificado", priority: "medium" },
  PROPOSAL: { code: "PROPOSAL", label: "Propuesta enviada", priority: "medium" },
  READY_TO_CLOSE: { code: "READY_TO_CLOSE", label: "Listo para cierre", priority: "high" },
  PAYMENT_PENDING: { code: "PAYMENT_PENDING", label: "Espera de pago", priority: "high" },
  PARTIAL_PAYMENT: { code: "PARTIAL_PAYMENT", label: "Abono recibido", priority: "high" },
  RESERVED: { code: "RESERVED", label: "Reserva", priority: "high" },
  PAID: { code: "PAID", label: "Pagado", priority: "high" },
  WON: { code: "WON", label: "Ganado", priority: "high" },
  LOST: { code: "LOST", label: "Perdido", priority: "low" },
  CLOSED: { code: "CLOSED", label: "Cerrado", priority: "low" }
});

const PAYMENT_TO_COMMERCIAL = {
  PENDING: "PAYMENT_PENDING",
  PARTIAL: "PARTIAL_PAYMENT",
  PAID: "PAID"
};

const LEAD_TO_COMMERCIAL = {
  NEW: "NEW",
  CONTACTED: "CONTACTED",
  DISCOVERY: "CONTACTED",
  QUALIFIED: "QUALIFIED",
  PROPOSAL: "PROPOSAL",
  NEGOTIATION: "PROPOSAL",
  READY_TO_CLOSE: "READY_TO_CLOSE",
  PAYMENT_PENDING: "PAYMENT_PENDING",
  PARTIAL_PAYMENT: "PARTIAL_PAYMENT",
  PAID: "PAID",
  BOOKED: "RESERVED",
  VISIT_SCHEDULED: "RESERVED",
  WON: "WON",
  LOST: "LOST"
};

export function deriveCommercialState({ conversation = null, lead = null, payment = null, booking = null } = {}) {
  let code = "NEW";

  if (conversation?.status === "CLOSED") code = "CLOSED";
  if (conversation?.status === "RESOLVED") code = "CONTACTED";

  const leadCode = LEAD_TO_COMMERCIAL[String(lead?.status || "").toUpperCase()];
  if (leadCode) code = leadCode;

  const bookingStatus = String(booking?.status || "").toUpperCase();
  if (["CONFIRMED", "PAYMENT_PENDING", "PARTIAL"].includes(bookingStatus)) {
    code = bookingStatus === "CONFIRMED" ? "RESERVED" : "PAYMENT_PENDING";
  }

  const paymentCode = PAYMENT_TO_COMMERCIAL[String(payment?.status || "").toUpperCase()];
  if (paymentCode) code = paymentCode;

  if ((conversation?.aiHandoffRequired || conversation?.aiNextActionCode === "READY_TO_CLOSE") && !["PAYMENT_PENDING", "PARTIAL_PAYMENT", "PAID", "RESERVED"].includes(code)) {
    code = "READY_TO_CLOSE";
  }

  return COMMERCIAL_STATES[code] || COMMERCIAL_STATES.NEW;
}
