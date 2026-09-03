import ExcelJS from "exceljs";

const MAX_MIGRATION_ROWS = 500;
const MAX_MIGRATION_FILE_BYTES = 8 * 1024 * 1024;

function normalizeKey(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function cleanText(value, fallback = "") {
  const normalized = String(value ?? "").trim();
  return normalized || fallback;
}

function readValue(row, aliases) {
  const entries = Object.entries(row || {});
  for (const alias of aliases) {
    const found = entries.find(([key]) => normalizeKey(key) === alias);
    if (found && cleanText(found[1])) return cleanText(found[1]);
  }
  return "";
}

function parseAmount(value) {
  if (typeof value === "number") return Number.isFinite(value) ? Math.abs(value) : 0;
  const raw = cleanText(value).replace(/\$/g, "").replace(/\s/g, "");
  if (!raw) return 0;
  // En Chile los miles suelen venir como 1.250.000. Si hay coma, esta se
  // considera separador decimal; sin coma, los puntos repetidos son miles.
  const dots = (raw.match(/\./g) || []).length;
  const normalized = raw.includes(",") && raw.includes(".")
    ? raw.replace(/\./g, "").replace(",", ".")
    : raw.includes(",")
      ? raw.replace(",", ".")
      : dots > 1 || (dots === 1 && /\.\d{3}$/.test(raw))
        ? raw.replace(/\./g, "")
        : raw;
  const parsed = Number(normalized.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? Math.abs(parsed) : 0;
}

function parseDate(value) {
  const raw = cleanText(value);
  if (!raw) return null;
  const chile = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (chile) {
    const year = chile[3].length === 2 ? `20${chile[3]}` : chile[3];
    const date = new Date(`${year}-${chile[2].padStart(2, "0")}-${chile[1].padStart(2, "0")}T12:00:00.000Z`);
    return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
  }
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

function historicalStatus({ sourceStatus, amount, balance, paidAmount, dueDate, now }) {
  const status = normalizeKey(sourceStatus);
  if (/(anulad|cancel)/.test(status)) return "CANCELLED";
  if (/(pagad|paid|cobrad|settled|cerrad)/.test(status) || (amount > 0 && balance === 0)) return "PAID";
  if (paidAmount > 0 || (amount > 0 && balance > 0 && balance < amount) || /(parcial|partial)/.test(status)) return "PARTIAL";
  const due = dueDate ? new Date(`${dueDate}T23:59:59.999Z`) : null;
  if (due && due < now) return "OVERDUE";
  return "OPEN";
}

function safeSourceRow(row) {
  return Object.fromEntries(Object.entries(row || {}).slice(0, 80).map(([key, value]) => [String(key).slice(0, 100), String(value ?? "").slice(0, 500)]));
}

function valueFromSheetCell(value) {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "object") {
    if (typeof value.text === "string") return value.text;
    if (value.result !== undefined) return valueFromSheetCell(value.result);
    if (Array.isArray(value.richText)) return value.richText.map((item) => item?.text || "").join("");
  }
  return String(value).trim();
}

function detectDelimiter(source) {
  const candidates = [";", ",", "\t"];
  const sample = String(source || "").split("\n").slice(0, 40).join("\n");
  return candidates.reduce((selected, candidate) => (sample.split(candidate).length > sample.split(selected).length ? candidate : selected), ";");
}

// Algunos bancos chilenos exportan una carátula antes de la tabla (titular,
// cuenta, saldos, etc.). No se puede asumir que la primera fila es el
// encabezado: buscamos una fila que tenga suficientes nombres de columnas
// financieros y conservamos la primera como alternativa para CSV simples.
function headerScore(row) {
  const known = new Set([
    "fecha", "fecha_movimiento", "fecha_emision", "fecha_vencimiento",
    "monto", "importe", "valor", "cargo", "abono", "cargo_abono",
    "descripcion", "descripcion_movimiento", "glosa", "detalle",
    "documento", "n_documento", "factura", "folio", "referencia",
    "cliente", "proveedor", "rut", "saldo", "estado"
  ]);
  return (Array.isArray(row) ? row : []).reduce((score, cell) => {
    const key = normalizeKey(cell);
    return score + (known.has(key) ? 1 : 0);
  }, 0);
}

function rowsToObjects(rows) {
  if (!Array.isArray(rows) || rows.length < 2) return [];
  const searchLimit = Math.min(rows.length - 1, 40);
  let headerIndex = 0;
  let bestScore = headerScore(rows[0]);
  for (let index = 1; index <= searchLimit; index += 1) {
    const score = headerScore(rows[index]);
    if (score > bestScore) {
      bestScore = score;
      headerIndex = index;
    }
  }
  // Dos columnas conocidas bastan para formatos simples; para una carátula
  // con texto libre mantenemos la primera fila, que será revisada aguas abajo.
  if (bestScore < 2) headerIndex = 0;
  const headers = rows[headerIndex].map((header, index) => cleanText(header, `Columna ${index + 1}`));
  return rows.slice(headerIndex + 1)
    .map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ""])))
    .filter((row) => Object.values(row).some((value) => cleanText(value)));
}

function parseDelimitedText(text) {
  const source = String(text || "").replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const delimiter = detectDelimiter(source);
  const rows = [];
  let currentRow = [];
  let currentValue = "";
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (char === '"') {
      if (quoted && source[index + 1] === '"') {
        currentValue += '"';
        index += 1;
      } else quoted = !quoted;
    } else if (char === delimiter && !quoted) {
      currentRow.push(currentValue.trim());
      currentValue = "";
    } else if (char === "\n" && !quoted) {
      currentRow.push(currentValue.trim());
      if (currentRow.some(Boolean)) rows.push(currentRow);
      currentRow = [];
      currentValue = "";
    } else currentValue += char;
  }
  currentRow.push(currentValue.trim());
  if (currentRow.some(Boolean)) rows.push(currentRow);
  return rowsToObjects(rows);
}

async function parseSpreadsheet(buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheet = workbook.worksheets.find((candidate) => candidate.actualRowCount > 1) || workbook.worksheets[0];
  if (!sheet) return [];
  const rawRows = [];
  sheet.eachRow({ includeEmpty: false }, (row) => rawRows.push(row.values.slice(1).map(valueFromSheetCell)));
  return rowsToObjects(rawRows);
}

export async function readHistoricalFinanceFile(file, { maxBytes = MAX_MIGRATION_FILE_BYTES } = {}) {
  if (!file?.buffer?.length) throw new Error("Selecciona un archivo con datos para revisar.");
  if (file.buffer.length > maxBytes) throw new Error(`El archivo supera el límite de ${Math.round(maxBytes / (1024 * 1024))} MB para una revisión segura.`);
  const name = cleanText(file.originalname || file.name).toLocaleLowerCase("es");
  if (/\.(xlsx|xlsm)$/i.test(name)) return parseSpreadsheet(file.buffer);
  if (/\.csv$/i.test(name)) return parseDelimitedText(file.buffer.toString("utf8"));
  throw new Error("Usa un archivo CSV o Excel (.xlsx). Los PDF e imágenes se adjuntan en Documentos para revisión humana.");
}

export function normalizeHistoricalFinanceRows(rows, { now = new Date(), limit = MAX_MIGRATION_ROWS } = {}) {
  if (!Array.isArray(rows)) return [];
  return rows.slice(0, Math.max(1, Math.min(Number(limit) || MAX_MIGRATION_ROWS, MAX_MIGRATION_ROWS))).map((rawRow, index) => {
    const row = rawRow && typeof rawRow === "object" && !Array.isArray(rawRow) ? rawRow : {};
    const supplierName = readValue(row, ["proveedor", "supplier", "beneficiario", "vendor", "razon_social_proveedor", "nombre_proveedor"]);
    const customerName = readValue(row, ["cliente", "customer", "deudor", "razon_social", "razon_social_cliente", "nombre_cliente"]);
    const kindHint = normalizeKey(readValue(row, ["tipo", "naturaleza", "clase", "tipo_documento", "direction"]));
    const kind = supplierName || /(pagar|egreso|proveedor|purchase|payable)/.test(kindHint) ? "PAYABLE" : "RECEIVABLE";
    const partyName = kind === "PAYABLE" ? supplierName : customerName;
    const documentNumber = readValue(row, ["folio", "numero", "nro", "n_documento", "documento", "factura", "invoice_number", "numero_factura"]);
    const amount = parseAmount(readValue(row, ["monto", "monto_total", "total", "importe", "valor", "debe", "amount"]));
    const rawBalance = readValue(row, ["saldo", "saldo_pendiente", "pendiente", "por_cobrar", "por_pagar", "balance"]);
    const rawPaid = readValue(row, ["pagado", "monto_pagado", "abonado", "pago", "paid_amount"]);
    const paidAmount = parseAmount(rawPaid);
    const balance = rawBalance ? parseAmount(rawBalance) : Math.max(0, amount - paidAmount);
    const issueDate = parseDate(readValue(row, ["fecha_emision", "emision", "fecha_documento", "fecha", "issue_date"]));
    const dueDate = parseDate(readValue(row, ["fecha_vencimiento", "vencimiento", "vence", "due_date"]));
    const sourceStatus = readValue(row, ["estado", "status", "situacion", "estado_pago"]);
    const status = historicalStatus({ sourceStatus, amount, balance, paidAmount, dueDate, now });
    const missing = [];
    if (!documentNumber) missing.push("número o folio");
    if (!partyName) missing.push(kind === "PAYABLE" ? "proveedor" : "cliente");
    if (!amount) missing.push("monto");
    const source = safeSourceRow(row);
    return {
      rowNumber: index + 2,
      kind,
      documentSide: kind === "PAYABLE" ? "SUPPLIER" : "CUSTOMER",
      recordType: kind === "PAYABLE" ? "finance_payable" : "finance_invoice",
      documentNumber,
      partyName,
      rut: readValue(row, ["rut", "rut_cliente", "rut_proveedor", "tax_id"]),
      category: readValue(row, ["categoria", "category", "centro_costo", "concepto", "glosa"]),
      amount,
      paidAmount: Math.min(amount, paidAmount),
      balance: Math.min(amount, balance),
      issueDate,
      dueDate,
      status,
      sourceStatus,
      needsReview: missing.length > 0,
      reviewReasons: missing,
      source
    };
  });
}

export function summarizeHistoricalFinanceRows(rows) {
  const normalizedRows = Array.isArray(rows) ? rows : [];
  const byStatus = Object.fromEntries(["OPEN", "PARTIAL", "PAID", "OVERDUE", "CANCELLED"].map((status) => [status, 0]));
  const byKind = { RECEIVABLE: 0, PAYABLE: 0 };
  let openReceivables = 0;
  let openPayables = 0;
  let reviewRows = 0;
  for (const row of normalizedRows) {
    byStatus[row.status] = (byStatus[row.status] || 0) + 1;
    byKind[row.kind] = (byKind[row.kind] || 0) + 1;
    if (row.kind === "PAYABLE") openPayables += row.balance || 0;
    else openReceivables += row.balance || 0;
    if (row.needsReview) reviewRows += 1;
  }
  return {
    totalRows: normalizedRows.length,
    reviewRows,
    byStatus,
    byKind,
    openReceivables,
    openPayables
  };
}

export { MAX_MIGRATION_ROWS, MAX_MIGRATION_FILE_BYTES };
