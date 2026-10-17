/** Archivo: Implementa reglas de negocio y procesos del dominio finance movement classification. */
// La importación normaliza los montos. No adivina separadores locales ni
// asume que un monto positivo sin marca bancaria es un ingreso.
export function classifyFinanceMovement(data = {}) {
  const value = data.amount;
  const validType = typeof value === "number" || (typeof value === "string" && value.trim() !== "");
  const raw = validType ? Number(value) : NaN;
  const amount = Number.isFinite(raw) ? Math.abs(raw) : null;
  const mark = String(data.direction || "").trim().toUpperCase() || String(data.movementType || "").trim().toUpperCase();
  const direction = ["CREDIT", "ABONO", "A"].includes(mark) ? "CREDIT"
    : ["DEBIT", "CARGO", "C"].includes(mark) ? "DEBIT"
    : amount !== null && raw < 0 ? "DEBIT" : "UNKNOWN";
  return { amount, direction };
}
