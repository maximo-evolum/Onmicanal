export function formatFinanceMoney(value: unknown, currency = "CLP") {
  const code = String(currency || "CLP").toUpperCase(), n = Number(value);
  if (!Number.isFinite(n)) return "Monto por revisar";
  const digits = code === "CLP" ? 0 : code === "UF" ? 4 : 2;
  return new Intl.NumberFormat("es-CL", { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(n) + ` ${code}`;
}
