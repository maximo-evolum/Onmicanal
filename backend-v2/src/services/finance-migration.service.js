import ExcelJS from "exceljs";
import JSZip from "jszip";
import { createHash } from "node:crypto";
import { normalizeFinanceDocumentData, validateFinanceDocumentData } from "./finance-document.service.js";

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

function normalizeRut(value) {
  return cleanText(value).replace(/\./g, "").replace(/\s/g, "").toUpperCase();
}

function isValidChileanRut(value) {
  const rut = normalizeRut(value);
  const match = rut.match(/^(\d{7,8})-?([0-9K])$/);
  if (!match) return false;
  let factor = 2;
  let sum = 0;
  for (const digit of [...match[1]].reverse()) {
    sum += Number(digit) * factor;
    factor = factor === 7 ? 2 : factor + 1;
  }
  const verifier = 11 - (sum % 11);
  const expected = verifier === 11 ? "0" : verifier === 10 ? "K" : String(verifier);
  return expected === match[2];
}

function sourceStatusSuggestsPaid(status) {
  return /(pagad|paid|cobrad|settled|cerrad)/.test(normalizeKey(status));
}

function sourceStatusSuggestsOpen(status) {
  return /(pendiente|abiert|open|por_cobrar|por_pagar|vencid)/.test(normalizeKey(status));
}

function dateBefore(left, right) {
  if (!left || !right) return false;
  return new Date(`${left}T12:00:00.000Z`) < new Date(`${right}T12:00:00.000Z`);
}

function canDetectHistoricalDuplicate(row) {
  return Boolean(cleanText(row?.documentNumber) && cleanText(row?.partyName) && Number(row?.amount) > 0);
}

// El análisis de calidad no corrige datos silenciosamente: explica por qué una
// fila requiere revisión y deja los duplicados visibles antes de importar.
export function assessHistoricalFinanceQuality(rows) {
  const normalizedRows = Array.isArray(rows) ? rows : [];
  const fingerprints = new Map();
  for (const row of normalizedRows) {
    if (!canDetectHistoricalDuplicate(row)) continue;
    const current = fingerprints.get(row.fingerprint) || [];
    current.push(row.rowNumber);
    fingerprints.set(row.fingerprint, current);
  }

  return normalizedRows.map((row) => {
    const reviewReasons = [...(Array.isArray(row.reviewReasons) ? row.reviewReasons : [])];
    const warnings = [];
    const adjustedTotal = Math.max(0, Number(row.amount || 0) - Number(row.creditNotesTotal || 0) + Number(row.debitNotesTotal || 0));
    const paidAndBalance = Number(row.paidAmount || 0) + Number(row.balance || 0);
    // La primera ocurrencia queda disponible para importar; sólo las
    // posteriores se consideran duplicadas y se omiten de forma segura.
    const duplicateOfRows = (fingerprints.get(row.fingerprint) || []).filter((rowNumber) => rowNumber < row.rowNumber);

    if (row.rut && !isValidChileanRut(row.rut)) reviewReasons.push("RUT con formato o dígito verificador inválido");
    if (!row.rut) warnings.push("Sin RUT: el matching automático tendrá menor precisión");
    if (dateBefore(row.dueDate, row.issueDate)) reviewReasons.push("vencimiento anterior a la fecha de emisión");
    if (dateBefore(row.paymentDate, row.issueDate)) reviewReasons.push("fecha de pago anterior a la fecha de emisión");
    if (Math.abs(paidAndBalance - adjustedTotal) > 1) reviewReasons.push("saldo y monto pagado no coinciden con el total ajustado");
    if (sourceStatusSuggestsPaid(row.sourceStatus) && Number(row.balance || 0) > 1) reviewReasons.push("estado de origen indica pagado, pero mantiene saldo pendiente");
    if (sourceStatusSuggestsOpen(row.sourceStatus) && adjustedTotal > 0 && Number(row.balance || 0) === 0) warnings.push("Estado de origen abierto, pero saldo informado es cero");
    if (duplicateOfRows.length) warnings.push(`Duplicado dentro del archivo: fila(s) ${duplicateOfRows.join(", ")}`);

    const uniqueReasons = [...new Set(reviewReasons)];
    const uniqueWarnings = [...new Set(warnings)];
    const score = Math.max(0, 100 - (uniqueReasons.length * 30) - (uniqueWarnings.length * 8));
    return {
      ...row,
      needsReview: uniqueReasons.length > 0,
      reviewReasons: uniqueReasons,
      duplicateInSource: duplicateOfRows.length > 0,
      duplicateOfRows,
      quality: {
        score,
        status: uniqueReasons.length ? "REVIEW" : duplicateOfRows.length ? "DUPLICATE" : uniqueWarnings.length ? "WARNING" : "READY",
        warnings: uniqueWarnings
      }
    };
  });
}

export function historicalFinanceFingerprint(input = {}) {
  const source = [
    normalizeKey(input.kind || input.documentSide),
    normalizeKey(input.documentNumber),
    normalizeKey(input.rut),
    Math.round(Number(input.amount) || 0),
    cleanText(input.issueDate),
    normalizeKey(input.partyName)
  ].join("|");
  return createHash("sha256").update(source).digest("hex");
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
  try {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const sheets = Array.isArray(workbook.worksheets) ? workbook.worksheets : [];
    const sheet = sheets.find((candidate) => candidate.actualRowCount > 1) || sheets[0];
    if (!sheet) return parseSpreadsheetFallback(buffer);
    const rawRows = [];
    sheet.eachRow({ includeEmpty: false }, (row) => rawRows.push(row.values.slice(1).map(valueFromSheetCell)));
    const rows = rowsToObjects(rawRows);
    // Un libro con metadatos incompletos puede abrirse sin error pero no
    // exponer hojas a ExcelJS. La segunda lectura evita devolver una cartola
    // vacía cuando el XML de la hoja sí contiene movimientos.
    return rows.length ? rows : parseSpreadsheetFallback(buffer);
  } catch (primaryError) {
    // Algunos bancos generan archivos XLSX válidos para Excel pero con el
    // catálogo de hojas incompleto. ExcelJS no siempre los abre; se intenta
    // una lectura segura de la primera hoja antes de pedir al usuario que lo
    // vuelva a exportar.
    try {
      return await parseSpreadsheetFallback(buffer);
    } catch {
      const detail = primaryError instanceof Error ? primaryError.message : "";
      if (/sheets|workbook|zip|central directory/i.test(detail)) {
        throw new Error("No se pudo leer la estructura del Excel. Ábrelo en Excel o Google Sheets, guárdalo como Libro de Excel (.xlsx) o expórtalo a CSV y vuelve a intentarlo.");
      }
      throw new Error("No se pudo leer el archivo Excel. Verifica que no esté protegido con contraseña ni dañado, o expórtalo nuevamente como .xlsx o CSV.");
    }
  }
}

function decodeXml(value) {
  return String(value || "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function xmlText(value) {
  return decodeXml(String(value || "").replace(/<[^>]+>/g, "")).trim();
}

function spreadsheetColumnIndex(reference) {
  const letters = String(reference || "").match(/[A-Z]+/i)?.[0]?.toUpperCase() || "";
  return [...letters].reduce((total, letter) => (total * 26) + letter.charCodeAt(0) - 64, 0) - 1;
}

function decodeSpreadsheetText(buffer) {
  const raw = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || "");
  if (raw[0] === 0xff && raw[1] === 0xfe) return raw.subarray(2).toString("utf16le");
  if (raw[0] === 0xfe && raw[1] === 0xff) {
    const swapped = Buffer.alloc(Math.max(0, raw.length - 2));
    for (let index = 2; index < raw.length - 1; index += 2) {
      swapped[index - 2] = raw[index + 1];
      swapped[index - 1] = raw[index];
    }
    return swapped.toString("utf16le");
  }
  return raw.toString("utf8").replace(/\u0000/g, "");
}

function parseLegacySpreadsheet(buffer) {
  const source = decodeSpreadsheetText(buffer);
  const rawRows = [];
  // Excel 2003 XML y exportaciones XML de bancos que mantienen las etiquetas
  // Row/Cell aunque tengan una extensión .xlsx.
  for (const rowMatch of source.matchAll(/<(?:[\w-]+:)?Row\b[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?Row>/gi)) {
    const row = [];
    let fallbackIndex = 0;
    for (const cellMatch of rowMatch[1].matchAll(/<(?:[\w-]+:)?Cell\b([^>]*)>([\s\S]*?)<\/(?:[\w-]+:)?Cell>/gi)) {
      const declaredIndex = Number(cellMatch[1].match(/(?:[\w-]+:)?Index="(\d+)"/i)?.[1] || 0) - 1;
      const targetIndex = declaredIndex >= 0 ? declaredIndex : fallbackIndex;
      row[targetIndex] = xmlText(cellMatch[2]);
      fallbackIndex = targetIndex + 1;
    }
    if (row.some((value) => cleanText(value))) rawRows.push(row);
  }
  if (rawRows.length) return rowsToObjects(rawRows);

  // Algunos portales bancarios entregan una tabla HTML con extensión Excel.
  for (const rowMatch of source.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const row = [...rowMatch[1].matchAll(/<(?:th|td)\b[^>]*>([\s\S]*?)<\/(?:th|td)>/gi)].map((cell) => xmlText(cell[1]));
    if (row.some((value) => cleanText(value))) rawRows.push(row);
  }
  return rowsToObjects(rawRows);
}

function parseOdsSpreadsheet(source) {
  const rawRows = [];
  for (const rowMatch of source.matchAll(/<table:table-row\b[^>]*>([\s\S]*?)<\/table:table-row>/gi)) {
    const row = [...rowMatch[1].matchAll(/<table:table-cell\b[^>]*>([\s\S]*?)<\/table:table-cell>/gi)].map((cell) => xmlText(cell[1]));
    if (row.some((value) => cleanText(value))) rawRows.push(row);
  }
  return rowsToObjects(rawRows);
}

async function parseSpreadsheetFallback(buffer) {
  let zip;
  try {
    zip = await JSZip.loadAsync(buffer);
  } catch {
    const legacyRows = parseLegacySpreadsheet(buffer);
    if (legacyRows.length) return legacyRows;
    throw new Error("El archivo no contiene una planilla compatible.");
  }
  const entries = Object.entries(zip.files).map(([name, entry]) => ({ name: name.replace(/^\/+/, ""), entry }));
  const worksheet = entries
    .filter(({ name }) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(name))
    .sort((left, right) => left.name.localeCompare(right.name, undefined, { numeric: true }))[0];
  if (!worksheet) {
    const ods = entries.find(({ name }) => /^content\.xml$/i.test(name));
    if (ods) {
      const rows = parseOdsSpreadsheet(await ods.entry.async("string"));
      if (rows.length) return rows;
    }
    throw new Error("No se encontró una hoja de cálculo.");
  }

  const shared = entries.find(({ name }) => /^xl\/sharedStrings\.xml$/i.test(name));
  const sharedXml = shared ? await shared.entry.async("string") : "";
  const sharedStrings = [...sharedXml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/gi)].map((match) => xmlText(match[1]));
  const sheetXml = await worksheet.entry.async("string");
  const rawRows = [];

  for (const rowMatch of sheetXml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/gi)) {
    const row = [];
    let fallbackIndex = 0;
    for (const cellMatch of rowMatch[1].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/gi)) {
      const attributes = cellMatch[1] || "";
      const body = cellMatch[2] || "";
      const reference = attributes.match(/\br="([^"]+)"/i)?.[1] || "";
      const index = spreadsheetColumnIndex(reference);
      const targetIndex = index >= 0 ? index : fallbackIndex;
      const type = attributes.match(/\bt="([^"]+)"/i)?.[1] || "";
      const rawValue = body.match(/<v\b[^>]*>([\s\S]*?)<\/v>/i)?.[1] || "";
      const inline = body.match(/<is\b[^>]*>([\s\S]*?)<\/is>/i)?.[1] || "";
      const value = type === "s" ? sharedStrings[Number(rawValue)] || "" : xmlText(rawValue || inline);
      row[targetIndex] = value;
      fallbackIndex = targetIndex + 1;
    }
    if (row.some((value) => cleanText(value))) rawRows.push(row);
  }
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
  const normalized = rows.slice(0, Math.max(1, Math.min(Number(limit) || MAX_MIGRATION_ROWS, MAX_MIGRATION_ROWS))).map((rawRow, index) => {
    const row = rawRow && typeof rawRow === "object" && !Array.isArray(rawRow) ? rawRow : {};
    const supplierName = readValue(row, ["proveedor", "supplier", "beneficiario", "vendor", "razon_social_proveedor", "nombre_proveedor"]);
    const customerName = readValue(row, ["cliente", "customer", "deudor", "razon_social", "razon_social_cliente", "nombre_cliente"]);
    const kindHint = normalizeKey(readValue(row, ["tipo", "naturaleza", "clase", "tipo_documento", "direction"]));
    const kind = supplierName || /(pagar|egreso|proveedor|purchase|payable)/.test(kindHint) ? "PAYABLE" : "RECEIVABLE";
    const partyName = kind === "PAYABLE" ? supplierName : customerName;
    const documentNumber = readValue(row, ["folio", "numero", "nro", "n_documento", "documento", "factura", "invoice_number", "numero_factura"]);
    const netAmount = parseAmount(readValue(row, ["monto_neto", "neto", "net_amount", "net"]));
    const vatAmount = parseAmount(readValue(row, ["iva", "monto_iva", "vat", "tax", "impuesto"]));
    const suppliedAmount = parseAmount(readValue(row, ["monto", "monto_total", "total", "importe", "valor", "debe", "amount"]));
    const amount = suppliedAmount || Math.max(0, netAmount + vatAmount);
    const rawBalance = readValue(row, ["saldo", "saldo_pendiente", "pendiente", "por_cobrar", "por_pagar", "balance"]);
    const rawPaid = readValue(row, ["pagado", "monto_pagado", "abonado", "pago", "paid_amount"]);
    const suppliedPaidAmount = parseAmount(rawPaid);
    const paidAmount = rawPaid ? suppliedPaidAmount : (rawBalance ? Math.max(0, amount - parseAmount(rawBalance)) : 0);
    const balance = rawBalance ? parseAmount(rawBalance) : Math.max(0, amount - paidAmount);
    const issueDate = parseDate(readValue(row, ["fecha_emision", "emision", "fecha_documento", "fecha", "issue_date"]));
    const dueDate = parseDate(readValue(row, ["fecha_vencimiento", "vencimiento", "vence", "due_date"]));
    const paymentDate = parseDate(readValue(row, ["fecha_pago", "fecha_de_pago", "payment_date", "paid_at"]));
    const sourceStatus = readValue(row, ["estado", "status", "situacion", "estado_pago"]);
    const documentType = readValue(row, ["tipo_documento", "tipo_doc", "document_type", "tipo"]);
    const currency = readValue(row, ["moneda", "currency", "divisa"]);
    const paymentMethod = readValue(row, ["medio_pago", "forma_pago", "payment_method", "medio_de_pago"]);
    const paymentIntermediary = readValue(row, ["intermediario", "pasarela", "payment_intermediary", "webpay", "transbank"]);
    const commissionAmount = parseAmount(readValue(row, ["comision", "monto_comision", "commission", "fee"]));
    const settlementReference = readValue(row, ["liquidacion", "referencia_liquidacion", "settlement_reference", "liquidation_reference"]);
    const creditNotesTotal = parseAmount(readValue(row, ["notas_credito", "nota_credito", "credit_notes", "credit_note_amount"]));
    const debitNotesTotal = parseAmount(readValue(row, ["notas_debito", "nota_debito", "debit_notes", "debit_note_amount"]));
    const referenceDocumentType = readValue(row, ["tipo_documento_referencia", "reference_document_type", "tipo_referencia"]);
    const referenceDocumentNumber = readValue(row, ["folio_referencia", "documento_referencia", "reference_document_number", "reference_number"]);
    const referenceDocumentDate = parseDate(readValue(row, ["fecha_documento_referencia", "reference_document_date", "reference_date"]));
    const status = historicalStatus({ sourceStatus, amount, balance, paidAmount, dueDate, now });
    const missing = [];
    if (!documentNumber) missing.push("número o folio");
    if (!partyName) missing.push(kind === "PAYABLE" ? "proveedor" : "cliente");
    if (!amount) missing.push("monto");
    if (!issueDate) missing.push("fecha de emisión");
    const documentData = normalizeFinanceDocumentData({
      documentNumber,
      documentType,
      partyName,
      partyRut: readValue(row, ["rut", "rut_cliente", "rut_proveedor", "tax_id"]),
      netAmount,
      vatAmount,
      amount,
      paidAmount,
      balance,
      issueDate,
      dueDate,
      paymentDate,
      paymentMethod,
      paymentIntermediary,
      commissionAmount,
      settlementReference,
      creditNotesTotal,
      debitNotesTotal,
      referenceDocumentType,
      referenceDocumentNumber,
      referenceDocumentDate,
      currency,
      documentSide: kind === "PAYABLE" ? "SUPPLIER" : "CUSTOMER"
    }, kind === "PAYABLE" ? "finance_payable" : "finance_invoice", { today: issueDate || new Date(now).toISOString().slice(0, 10) });
    const financeValidation = validateFinanceDocumentData(documentData);
    for (const error of financeValidation.errors) if (!missing.includes(error)) missing.push(error);
    const source = safeSourceRow(row);
    const fingerprint = historicalFinanceFingerprint({ kind, documentNumber, rut: readValue(row, ["rut", "rut_cliente", "rut_proveedor", "tax_id"]), amount, issueDate, partyName });
    return {
      rowNumber: index + 2,
      kind,
      documentSide: kind === "PAYABLE" ? "SUPPLIER" : "CUSTOMER",
      recordType: kind === "PAYABLE" ? "finance_payable" : "finance_invoice",
      documentNumber,
      partyName,
      rut: readValue(row, ["rut", "rut_cliente", "rut_proveedor", "tax_id"]),
      category: readValue(row, ["categoria", "category", "centro_costo", "concepto", "glosa"]),
      ...documentData,
      amount: documentData.amount,
      paidAmount: Math.min(documentData.amount, documentData.paidAmount),
      balance: Math.min(Math.max(0, financeValidation.adjustedAmount), documentData.balance),
      status,
      sourceStatus,
      fingerprint,
      needsReview: missing.length > 0,
      reviewReasons: missing,
      source
    };
  });
  return assessHistoricalFinanceQuality(normalized);
}

export function summarizeHistoricalFinanceRows(rows) {
  const normalizedRows = Array.isArray(rows) ? rows : [];
  const byStatus = Object.fromEntries(["OPEN", "PARTIAL", "PAID", "OVERDUE", "CANCELLED"].map((status) => [status, 0]));
  const byKind = { RECEIVABLE: 0, PAYABLE: 0 };
  let openReceivables = 0;
  let openPayables = 0;
  let reviewRows = 0;
  let duplicateRows = 0;
  let readyRows = 0;
  let qualityScoreTotal = 0;
  for (const row of normalizedRows) {
    byStatus[row.status] = (byStatus[row.status] || 0) + 1;
    byKind[row.kind] = (byKind[row.kind] || 0) + 1;
    if (row.kind === "PAYABLE") openPayables += row.balance || 0;
    else openReceivables += row.balance || 0;
    if (row.needsReview) reviewRows += 1;
    if (row.duplicateInSource) duplicateRows += 1;
    if (!row.needsReview && !row.duplicateInSource) readyRows += 1;
    qualityScoreTotal += Number(row.quality?.score ?? (row.needsReview ? 50 : 100));
  }
  return {
    totalRows: normalizedRows.length,
    reviewRows,
    byStatus,
    byKind,
    openReceivables,
    openPayables,
    duplicateRows,
    readyRows,
    averageQualityScore: normalizedRows.length ? Math.round(qualityScoreTotal / normalizedRows.length) : 0
  };
}

export { MAX_MIGRATION_ROWS, MAX_MIGRATION_FILE_BYTES };
