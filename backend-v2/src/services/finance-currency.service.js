import { FinanceOperationError } from "./finance-integrity.service.js";

export const FINANCE_CURRENCIES = { CLP: 0, USD: 2, EUR: 2, UF: 4 };
export function financeCurrency(value, fallback = "CLP") {
  const raw = String(value ?? "").trim().toUpperCase();
  if (!raw) return fallback;
  const aliases = { PESOS: "CLP", "PESOS DE CHILE": "CLP", "PESO CHILENO": "CLP", "PESOS CHILENOS": "CLP", "$": "CLP", "US$": "USD", "DÓLARES": "USD", DOLARES: "USD", EURO: "EUR", EUROS: "EUR", "UNIDAD DE FOMENTO": "UF" };
  return aliases[raw] || raw;
}
export function requireFinanceCurrency(value) {
  const currency = financeCurrency(value);
  if (!Object.hasOwn(FINANCE_CURRENCIES, currency)) throw new FinanceOperationError(400, "Moneda no admitida: utiliza CLP, USD, EUR o UF. No se convierte automáticamente a pesos.");
  return currency;
}
export function validFinanceAmount(value, currency) {
  const digits = FINANCE_CURRENCIES[currency];
  if (digits === undefined || typeof value !== "number" || !Number.isFinite(value)) return false;
  const units = value * 10 ** digits;
  return Number.isSafeInteger(Math.round(units)) && Math.abs(units - Math.round(units)) < 0.000001;
}
export function financeRecordCurrency(record, index = new Map(), visited = new Set()) {
  if (!record || visited.has(record.id)) return "CLP";
  visited.add(record.id); const d = record.data || {};
  if (d.currency || d.account?.currency || d.movement?.currency) return financeCurrency(d.currency || d.account?.currency || d.movement?.currency);
  const origin = index.get(d.movementId) || index.get(d.importBatchId);
  return origin ? financeRecordCurrency(origin, index, visited) : "CLP";
}
