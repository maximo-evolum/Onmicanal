export const ledgerDefaults = { owner: "", search: "", from: "", to: "", min: "", max: "", direction: "ALL", status: "ALL", dateScope: "PERIOD", importRevision: "", confidence: "ALL", sort: "date_desc", pageSize: "25" };
export type LedgerFilters = typeof ledgerDefaults;
export const ledgerColumns = { date: "Fecha", description: "Descripción / contraparte", direction: "Tipo", amount: "Monto", status: "Estado", sourceFile: "Cartola", bank: "Banco", reference: "Referencia", importRevision: "Revisión importada", confidenceLabel: "Puntaje de conciliación" };
export type LedgerColumn = keyof typeof ledgerColumns;
export const defaultColumns: LedgerColumn[] = ["date", "description", "direction", "amount", "status"];
export type LedgerPreferences = { version: 1; columns: LedgerColumn[]; saved: Array<{ name: string; filters: LedgerFilters }> };
export function ledgerPreferenceKey(tenant: string, user: string) {
  if (!tenant || !user) throw new Error("La cuenta no está identificada; no se guardaron preferencias.");
  return `finance-ledger-v1:${encodeURIComponent(tenant)}:${encodeURIComponent(user)}`;
}
export function normalizeLedgerFilters(value: unknown): LedgerFilters {
  const input = (value || {}) as Record<string, unknown>, result = { ...ledgerDefaults };
  for (const key of Object.keys(result) as Array<keyof LedgerFilters>) if (typeof input[key] === "string") result[key] = (input[key] as string).slice(0, 200);
  const allowed = { direction: ["ALL", "CREDIT", "DEBIT", "UNKNOWN"], status: ["ALL", "MATCHED", "PENDING", "REVIEW", "EXCLUDED", "OTHER"], dateScope: ["PERIOD", "UNDATED"], sort: ["date_desc", "date_asc", "amount_desc", "amount_asc"], pageSize: ["10", "25", "50", "100"] };
  for (const key of Object.keys(allowed) as Array<keyof typeof allowed>) if (!allowed[key].includes(result[key])) result[key] = ledgerDefaults[key];
  if (result.dateScope === "UNDATED") { result.from = ""; result.to = ""; }
  if (!["ALL", "HIGH", "MEDIUM", "LOW", "UNKNOWN"].includes(result.confidence)) result.confidence = "ALL";
  if (result.importRevision && result.importRevision !== "UNKNOWN" && (!/^\d+$/.test(result.importRevision) || !Number.isSafeInteger(Number(result.importRevision)))) result.importRevision = "";
  return result;
}
export function readLedgerPreferences(raw: string | null): LedgerPreferences {
  if (!raw) return { version: 1, columns: [...defaultColumns], saved: [] };
  const value = JSON.parse(raw);
  if (value?.version !== 1 || !Array.isArray(value.columns) || !Array.isArray(value.saved)) throw new Error("Las preferencias guardadas no son válidas. Puedes restaurarlas.");
  const columns = [...new Set(value.columns.filter((key: unknown) => typeof key === "string" && Object.hasOwn(ledgerColumns, key)))] as LedgerColumn[];
  return { version: 1, columns: columns.length ? columns : [...defaultColumns], saved: value.saved.slice(0, 20).filter((item: { name?: unknown }) => typeof item?.name === "string" && item.name.trim()).map((item: { name: string; filters: unknown }) => ({ name: item.name.trim().slice(0, 60), filters: normalizeLedgerFilters(item.filters) })) };
}
