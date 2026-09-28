import { FinanceOperationError } from "./finance-integrity.service.js";

// Selection is separate from mapping: changing it invalidates row identities.
export function validateFileSelection(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new FinanceOperationError(400, "La selección de tabla no es válida.");
  const result = {};
  for (const name of Object.keys(value)) if (!["sheet", "headerRow", "endRow", "delimiter"].includes(name)) throw new FinanceOperationError(400, "Opción de lectura desconocida.");
  if (value.sheet !== undefined && value.sheet !== "") {
    if (typeof value.sheet !== "string" || value.sheet.length > 200) throw new FinanceOperationError(400, "Nombre de hoja inválido.");
    result.sheet = value.sheet;
  }
  for (const name of ["headerRow", "endRow"]) if (value[name] !== undefined && value[name] !== null && value[name] !== "") {
    if (!Number.isSafeInteger(value[name]) || value[name] < 1 || value[name] > 100000) throw new FinanceOperationError(400, "Las filas deben ser números enteros entre 1 y 100.000.");
    result[name] = value[name];
  }
  if (result.endRow && result.headerRow && result.endRow <= result.headerRow) throw new FinanceOperationError(400, "La última fila debe estar después del encabezado.");
  if (value.delimiter !== undefined && value.delimiter !== "") {
    if (![";", ",", "\t", "|"].includes(value.delimiter)) throw new FinanceOperationError(400, "Separador de columnas no admitido.");
    result.delimiter = value.delimiter;
  }
  return result;
}

export function fileSelectionChanged(before, after) {
  return JSON.stringify(validateFileSelection(before)) !== JSON.stringify(validateFileSelection(after));
}
