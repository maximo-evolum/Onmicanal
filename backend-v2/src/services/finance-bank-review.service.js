import { normalizeBankStatementRows, MAX_BANK_STATEMENT_ROWS } from "./finance-bank-statements.service.js";
import { FinanceOperationError } from "./finance-integrity.service.js";

const key = (value) => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
export const BANK_REVIEW_FIELDS = [
  { key: "date", label: "Fecha del movimiento", canonical: "fecha", aliases: ["fecha", "fecha_movimiento", "fecha_transaccion", "fecha_operacion", "fecha_valor", "date", "transaction_date"] },
  { key: "description", label: "Descripción / glosa", canonical: "descripcion", pattern: /descr|glosa|detalle|concepto/, aliases: [] },
  { key: "amount", label: "Monto con signo", canonical: "monto", aliases: ["monto", "importe", "amount", "valor", "monto_movimiento", "importe_movimiento"] },
  { key: "debit", label: "Cargo (columna separada)", canonical: "cargo", aliases: ["cargo", "debe", "debito", "egreso", "retiro", "withdrawal", "debit"] },
  { key: "credit", label: "Abono (columna separada)", canonical: "abono", aliases: ["abono", "haber", "credito", "ingreso", "deposito", "deposit", "credit"] },
  { key: "direction", label: "Marca cargo / abono", canonical: "cargo_abono", pattern: /cargo.*abono|abono.*cargo|tipo.*mov|naturaleza|signo/, aliases: ["direction", "tipo"] },
  { key: "reference", label: "Referencia / comprobante", canonical: "referencia", aliases: ["referencia", "reference", "comprobante", "folio", "nro_operacion", "numero_operacion", "id_movimiento", "numero_documento", "n_documento"] },
  { key: "rut", label: "RUT de contraparte", canonical: "rut", aliases: ["rut", "rut_contraparte", "rut_cliente", "rut_proveedor", "tax_id"] },
  { key: "payerName", label: "Nombre de contraparte", canonical: "contraparte", aliases: ["contraparte", "nombre_contraparte", "ordenante", "beneficiario", "pagador", "titular", "payer", "counterparty"] },
  { key: "balance", label: "Saldo", canonical: "saldo", aliases: ["saldo", "saldo_contable", "saldo_disponible", "balance"] }
];
export function bankReviewColumns(rows) {
  return [...new Set(rows.flatMap((row) => Object.keys(row || {}).filter((name) => name !== "__financeOrigin")))];
}
export function validateBankReviewConfig(input = {}, columns, rowCount = MAX_BANK_STATEMENT_ROWS) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new FinanceOperationError(400, "La configuración de revisión no es válida.");
  const mapping = {};
  const used = new Set();
  for (const [name, column] of Object.entries(input.mapping || {})) {
    if (!BANK_REVIEW_FIELDS.some((field) => field.key === name)) throw new FinanceOperationError(400, "El mapeo contiene un campo desconocido.");
    if (column === "" || column === null) continue;
    if (column === "__IGNORE__") { mapping[name] = column; continue; }
    if (typeof column !== "string" || column.length > 300 || (columns && !columns.includes(column))) throw new FinanceOperationError(400, `No existe la columna seleccionada para ${name}. Revisa la plantilla.`);
    if (used.has(column)) throw new FinanceOperationError(400, "Una misma columna no puede representar dos datos diferentes.");
    used.add(column); mapping[name] = column;
  }
  const excludedRows = [];
  const seen = new Set();
  if (input.excludedRows !== undefined && !Array.isArray(input.excludedRows)) throw new FinanceOperationError(400, "Las exclusiones deben ser una lista de filas con motivo.");
  if ((input.excludedRows || []).length > MAX_BANK_STATEMENT_ROWS) throw new FinanceOperationError(400, "Hay demasiadas exclusiones.");
  for (const entry of input.excludedRows || []) {
    if (!Number.isInteger(entry?.dataRow) || entry.dataRow < 1 || entry.dataRow > rowCount || seen.has(entry.dataRow)) throw new FinanceOperationError(400, "La fila a excluir no existe o está repetida.");
    const reason = String(entry.reason || "").trim();
    if (reason.length < 5 || reason.length > 300) throw new FinanceOperationError(400, "Indica un motivo de exclusión de entre 5 y 300 caracteres.");
    seen.add(entry.dataRow); excludedRows.push({ dataRow: entry.dataRow, reason });
  }
  return { mapping, excludedRows };
}
export function normalizeBankReviewRows(sourceRows, account, input = {}) {
  const config = validateBankReviewConfig(input, bankReviewColumns(sourceRows), sourceRows.length);
  const mapped = sourceRows.map((source) => {
    const row = { ...source };
    for (const field of BANK_REVIEW_FIELDS) {
      const column = config.mapping[field.key];
      if (!column) continue;
      // Remove competing automatic aliases only for fields explicitly mapped.
      for (const name of Object.keys(row)) if (field.aliases.includes(key(name)) || field.pattern?.test(key(name))) delete row[name];
      row[field.canonical] = column === "__IGNORE__" ? "" : source[column] ?? "";
    }
    return row;
  });
  const excluded = new Map(config.excludedRows.map((row) => [row.dataRow, row.reason]));
  return normalizeBankStatementRows(mapped, account).map((row, index) => ({ ...row,
    dataRow: index + 1, rowNumber: sourceRows[index]?.__financeOrigin?.row || row.rowNumber, source: sourceRows[index],
    origin: sourceRows[index]?.__financeOrigin || { kind: "parsed", row: null, sheet: null },
    excluded: excluded.has(index + 1), exclusionReason: excluded.get(index + 1) || null
  }));
}
export function bankReviewPage(preview, query = {}, { all = false } = {}) {
  const revision = Number(query.revision);
  if (!Number.isInteger(revision) || revision !== preview.revision) throw new FinanceOperationError(409, "La revisión cambió. Recupera su versión actual.");
  const allRows = preview.normalizedRows || normalizeBankReviewRows(preview.sourceRows, preview.account, preview.reviewConfig);
  const allowed = ["all", "review", "excluded", "credit", "debit", "duplicate"];
  const filter = String(query.filter || "all");
  if (!allowed.includes(filter)) throw new FinanceOperationError(400, "Filtro de revisión no válido.");
  const search = key(String(query.search || "").slice(0, 200));
  const rows = allRows.filter((row) => (!search || key([row.description, row.reference, row.rut, row.payerName, row.transactionDate, row.dataRow].join(" ")).includes(search)) &&
    (filter === "all" || (filter === "review" && row.needsReview && !row.excluded) || (filter === "excluded" && row.excluded) || (filter === "credit" && row.direction === "CREDIT") || (filter === "debit" && row.direction === "DEBIT") || (filter === "duplicate" && row.duplicate)));
  const page = all ? 1 : Math.max(1, Math.min(5000, Math.trunc(Number(query.page) || 1)));
  const pageSize = all ? MAX_BANK_STATEMENT_ROWS : 25;
  return { revision, page, pageSize, total: rows.length, totalSourceRows: allRows.length, pages: Math.max(1, Math.ceil(rows.length / pageSize)), rows: rows.slice((page - 1) * pageSize, page * pageSize) };
}

export function exportBankReviewCsv(preview, query) {
  const cell = (value) => { const text = String(value ?? ""); return `"${(/^[\s]*[=+@-]/.test(text) ? "'" : "") + text.replace(/"/g, '""')}"`; };
  const rows = bankReviewPage(preview, query, { all: true }).rows;
  return "\uFEFF" + [["N° registro", "Origen", "Fila de origen", "Fecha", "Descripción", "Referencia", "RUT", "Monto", "Tipo", "Estado", "Motivo"],
    ...rows.map((row) => [row.dataRow, row.origin?.sheet || row.origin?.kind || "", row.origin?.row || "", row.transactionDate, row.description, row.reference, row.rut, row.amount, row.movementType,
      row.excluded ? "Excluida" : row.needsReview ? "Revisar" : row.duplicate ? "Duplicada" : "Válida", row.exclusionReason || row.reviewReasons?.join("; ") || ""])]
    .map((row) => row.map(cell).join(";")).join("\r\n");
}
