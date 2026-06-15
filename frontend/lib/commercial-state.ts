import { Conversation, Lead } from "./types";

export const COMMERCIAL_STATE_OPTIONS = [
  ["NEW", "Nuevo"],
  ["CONTACTED", "Contactado"],
  ["QUALIFIED", "Calificado"],
  ["PROPOSAL", "Propuesta enviada"],
  ["READY_TO_CLOSE", "Listo para cierre"],
  ["PAYMENT_PENDING", "Espera de pago"],
  ["PARTIAL_PAYMENT", "Abono recibido"],
  ["BOOKED", "Reserva"],
  ["PAID", "Pagado"],
  ["WON", "Ganado"],
  ["LOST", "Perdido"]
] as const;

const LABELS: Record<string, { label: string; priority: "low" | "medium" | "high" }> = {
  NEW: { label: "Nuevo", priority: "low" },
  CONTACTED: { label: "Contactado", priority: "medium" },
  DISCOVERY: { label: "Contactado", priority: "medium" },
  QUALIFIED: { label: "Calificado", priority: "medium" },
  PROPOSAL: { label: "Propuesta enviada", priority: "medium" },
  NEGOTIATION: { label: "Propuesta enviada", priority: "medium" },
  READY_TO_CLOSE: { label: "Listo para cierre", priority: "high" },
  PAYMENT_PENDING: { label: "Espera de pago", priority: "high" },
  PARTIAL_PAYMENT: { label: "Abono recibido", priority: "high" },
  BOOKED: { label: "Reserva", priority: "high" },
  RESERVED: { label: "Reserva", priority: "high" },
  VISIT_SCHEDULED: { label: "Reserva", priority: "high" },
  PAID: { label: "Pagado", priority: "high" },
  WON: { label: "Ganado", priority: "high" },
  LOST: { label: "Perdido", priority: "low" },
  CLOSED: { label: "Cerrado", priority: "low" }
};

export function getCommercialState(conversation?: Conversation | null, lead?: Lead | null) {
  const backendState = conversation?.commercialState;
  if (backendState?.code) return backendState;

  const raw = String(lead?.status || conversation?.aiNextActionCode || conversation?.status || "NEW").toUpperCase();
  if ((conversation?.aiHandoffRequired || conversation?.aiNextActionCode === "READY_TO_CLOSE") && !["PAYMENT_PENDING", "PARTIAL_PAYMENT", "PAID"].includes(raw)) {
    return { code: "READY_TO_CLOSE", ...LABELS.READY_TO_CLOSE };
  }
  return { code: raw, ...(LABELS[raw] || LABELS.NEW) };
}
