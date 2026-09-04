import { createHash } from "node:crypto";
import pdfParse from "pdf-parse";
import { getChileanFinancialInstitution } from "../lib/finance-integrations.js";
import { readHistoricalFinanceFile } from "./finance-migration.service.js";

export const MAX_BANK_STATEMENT_ROWS = 1000;
export const MAX_BANK_STATEMENT_FILE_BYTES = 12 * 1024 * 1024;

function fileName(file) {
  return cleanText(file?.originalname || file?.name, "cartola");
}

function looksLikeDelimitedText(source) {
  const sample = String(source || "").replace(/^\uFEFF/, "").trim();
  if (!sample || /[\u0000-\u0008\u000E-\u001F]/.test(sample)) return false;
  const lines = sample.split(/\r?\n/).filter(Boolean).slice(0, 5);
  return lines.some((line) => [";", ",", "\t"].some((separator) => line.split(separator).length >= 2));
}

// La extensión no es suficiente: algunos bancos descargan HTML/XML con nombre
// .xlsx. Detectamos el contenido antes de delegar el parseo.
export function detectBankStatementFileFormat(file) {
  const buffer = Buffer.isBuffer(file?.buffer) ? file.buffer : Buffer.from(file?.buffer || "");
  const prefix = buffer.subarray(0, 1024).toString("utf8").replace(/^\uFEFF/, "").trimStart();
  const name = fileName(file).toLocaleLowerCase("es");
  if (buffer.subarray(0, 5).toString("ascii") === "%PDF-") {
    return { key: "PDF", label: "PDF con texto", conversion: "Se extraerá la tabla de movimientos para revisión." };
  }
  if (buffer[0] === 0x50 && buffer[1] === 0x4b) {
    return { key: "SPREADSHEET", label: /\.xlsm$/i.test(name) ? "Excel habilitado para macros" : "Libro de Excel", conversion: "Lectura directa de la planilla." };
  }
  if (/^<(?:\?xml|!doctype\s+html|\/?(?:html|table)|(?:[\w-]+:)?Workbook)\b/i.test(prefix)) {
    return { key: "LEGACY_SPREADSHEET", label: "Exportación XML/HTML de Excel", conversion: "Se adaptará a una tabla de movimientos." };
  }
  if (looksLikeDelimitedText(prefix)) {
    return { key: "DELIMITED_TEXT", label: /\.txt$/i.test(name) ? "Archivo de texto delimitado" : "CSV o texto delimitado", conversion: "Se adaptará a una tabla de movimientos." };
  }
  return { key: "UNKNOWN", label: "Formato no reconocido", conversion: "Requiere una exportación compatible." };
}

function normalizePdfNumber(value) {
  return parseNumber(String(value || "").replace(/\s/g, ""));
}

function extractPdfAmountTokens(line) {
  return [...String(line || "").matchAll(/\(?-?\$?\s*(?:\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d+(?:,\d+)?)\)?/g)]
    .map((match) => ({ raw: match[0], amount: normalizePdfNumber(match[0]), index: match.index ?? 0 }))
    .filter((item) => item.amount > 0);
}

function pdfDirectionMarker(value) {
  const marker = normalizeKey(value);
  if (/(^|_)(abono|haber|credito|credit|ingreso|deposito|deposit)(_|$)/.test(marker)) return "ABONO";
  if (/(^|_)(cargo|debe|debito|egreso|retiro|comision|impuesto)(_|$)/.test(marker)) return "CARGO";
  return "";
}

// Un PDF con texto puede variar mucho entre bancos. Esta conversión es
// deliberadamente conservadora: sólo genera una fila cuando reconoce fecha,
// monto y una glosa. PDFs escaneados o maquetados como imagen quedan para
// revisión, evitando inventar movimientos financieros.
export function parsePdfBankStatementText(text) {
  const lines = String(text || "").replace(/\r/g, "").split("\n").map((line) => line.replace(/\s+/g, " ").trim()).filter(Boolean);
  const rows = [];
  for (const line of lines) {
    const dateMatch = line.match(/\b(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})\b/);
    if (!dateMatch) continue;
    const amounts = extractPdfAmountTokens(line.replace(dateMatch[0], " "));
    if (!amounts.length) continue;
    const marker = pdfDirectionMarker(line);
    // El número de comprobante puede estar intercalado en la misma línea.
    // Priorizamos el importe monetario de mayor magnitud y lo dejamos siempre
    // en la vista previa para que la persona valide antes de importarlo.
    const amountToken = [...amounts].sort((left, right) => right.amount - left.amount)[0];
    const description = line
      .replace(dateMatch[0], " ")
      .replace(/\(?-?\$?\s*(?:\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d+(?:,\d+)?)\)?/g, " ")
      .replace(/\b(?:abono|haber|credito|cr[eé]dito|ingreso|dep[oó]sito|cargo|debe|d[eé]bito|egreso|retiro)\b/gi, " ")
      .replace(/\s{2,}/g, " ")
      .trim();
    if (description.length < 3) continue;
    rows.push({
      Fecha: dateMatch[1],
      Descripción: description.slice(0, 400),
      Monto: amountToken.raw,
      "Cargo/Abono": marker
    });
  }
  return rows;
}

function cleanText(value, fallback = "") {
  const normalized = String(value ?? "").trim();
  return normalized || fallback;
}

function normalizeKey(value) {
  return cleanText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function getValue(row, aliases) {
  const entries = Object.entries(row || {});
  for (const alias of aliases) {
    const target = normalizeKey(alias);
    const found = entries.find(([key]) => normalizeKey(key) === target);
    if (found && cleanText(found[1])) return cleanText(found[1]);
  }
  return "";
}

// Exportaciones de bancos no siempre conservan el encabezado literal. Por
// ejemplo, CSV codificados en Windows-1252 pueden terminar como
// "DESCRIPCI_N MOVIMIENTO" al ser leídos por otro sistema. Este respaldo sólo
// usa nombres de columna, nunca intenta adivinar desde el monto.
function getValueByHeaderPattern(row, patterns) {
  const entries = Object.entries(row || {});
  for (const pattern of patterns) {
    const found = entries.find(([key, value]) => pattern.test(normalizeKey(key)) && cleanText(value));
    if (found) return cleanText(found[1]);
  }
  return "";
}

function bankStatementDescription(row) {
  return getValue(row, [
    "descripcion", "descripción", "descripcion_movimiento", "descripción movimiento", "descripcion de movimiento",
    "glosa", "glosa_movimiento", "detalle", "detalle_movimiento", "movimiento", "concepto", "narrativa", "description"
  ]) || getValueByHeaderPattern(row, [
    /^descripci.*movimiento/, /^glosa.*movimiento/, /^detalle.*movimiento/,
    /^descripci/, /^glosa/, /^detalle/, /^concepto/, /^narrativa/
  ]);
}

function bankStatementDirectionMarker(row) {
  return getValue(row, ["cargo_abono", "cargo/abono", "tipo_movimiento", "tipo", "debe_haber", "naturaleza", "signo"])
    || getValueByHeaderPattern(row, [/^cargo.*abono/, /^debe.*haber/, /^tipo.*movimiento/, /^naturaleza/, /^signo/]);
}

function parseNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const source = cleanText(value)
    .replace(/\$/g, "")
    .replace(/CLP/gi, "")
    .replace(/\s/g, "");
  if (!source) return 0;
  const negative = /^\(|^-/.test(source);
  const raw = source.replace(/[()]/g, "").replace(/^-/, "");
  const dots = (raw.match(/\./g) || []).length;
  const normalized = raw.includes(",") && raw.includes(".")
    ? raw.replace(/\./g, "").replace(",", ".")
    : raw.includes(",")
      ? raw.replace(",", ".")
      : dots > 1 || (dots === 1 && /\.\d{3}$/.test(raw))
        ? raw.replace(/\./g, "")
        : raw;
  const parsed = Number(normalized.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? (negative ? -Math.abs(parsed) : parsed) : 0;
}

function parseDate(value) {
  const raw = cleanText(value);
  if (!raw) return null;
  const chile = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (chile) {
    const year = chile[3].length === 2 ? `20${chile[3]}` : chile[3];
    const parsed = new Date(`${year}-${chile[2].padStart(2, "0")}-${chile[1].padStart(2, "0")}T12:00:00.000Z`);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
  }
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

function safeSourceRow(row) {
  return Object.fromEntries(Object.entries(row || {}).slice(0, 80).map(([key, value]) => [String(key).slice(0, 100), String(value ?? "").slice(0, 500)]));
}

function normalizedAccount(input = {}) {
  const institution = getChileanFinancialInstitution(input.bankKey || input.bank || input.cmfCode);
  if (!institution) throw new Error("Selecciona un banco del catálogo CMF antes de importar la cartola.");
  const last4 = String(input.accountLast4 || "").replace(/\D/g, "").slice(-4);
  return {
    bank: institution.name,
    bankKey: institution.key,
    cmfCode: institution.cmfCode,
    accountAlias: cleanText(input.accountAlias || input.alias, "Cuenta sin nombre").slice(0, 100),
    accountType: cleanText(input.accountType, "Cuenta corriente").slice(0, 60),
    accountLast4: last4 || null
  };
}

function sourceAmount(row) {
  const debit = getValue(row, ["cargo", "debe", "debito", "débito", "egreso", "retiro", "withdrawal", "debit"]);
  const credit = getValue(row, ["abono", "haber", "credito", "crédito", "ingreso", "deposito", "depósito", "deposit", "credit"]);
  if (debit) return { signedAmount: -Math.abs(parseNumber(debit)), direction: "DEBIT", directionSource: "Columna Cargo" };
  if (credit) return { signedAmount: Math.abs(parseNumber(credit)), direction: "CREDIT", directionSource: "Columna Abono" };
  const rawAmount = getValue(row, ["monto", "importe", "amount", "valor", "monto_movimiento", "importe_movimiento"]);
  const parsedAmount = parseNumber(rawAmount);
  // Santander usa una sola columna MONTO y una marca CARGO/ABONO: A es un
  // abono y C un cargo. El importe puede venir con o sin signo, por lo que la
  // marca tiene prioridad cuando está disponible.
  const marker = normalizeKey(bankStatementDirectionMarker(row));
  if (/^(a|abono|haber|credito|credit|ingreso|deposito|cr)(_|$)/.test(marker)) {
    return { signedAmount: Math.abs(parsedAmount), direction: "CREDIT", directionSource: "Marca Cargo/Abono" };
  }
  if (/^(c|cargo|debe|debito|egreso|retiro|debit|db|d)(_|$)/.test(marker)) {
    return { signedAmount: -Math.abs(parsedAmount), direction: "DEBIT", directionSource: "Marca Cargo/Abono" };
  }
  return { signedAmount: parsedAmount, direction: parsedAmount < 0 ? "DEBIT" : "CREDIT", directionSource: "Signo del monto" };
}

export function classifyBankMovement({ description = "", reference = "", direction = "" } = {}) {
  const source = normalizeKey(`${description} ${reference}`);
  if (/comision|mantenimiento|impuesto|iva|interes|gasto_bancario/.test(source)) return "COMMISSION_OR_FEE";
  if (/traspaso|transferencia_entre_cuentas|transferencia_propia|cuenta_propia/.test(source)) return "INTERNAL_TRANSFER";
  if (String(direction).toUpperCase() === "CREDIT") return "INCOME";
  if (String(direction).toUpperCase() === "DEBIT") return "EXPENSE";
  return "UNKNOWN";
}

export function bankMovementFingerprint(input = {}) {
  const source = [
    cleanText(input.bankKey),
    cleanText(input.accountLast4),
    cleanText(input.transactionDate || input.date),
    Math.round(Math.abs(Number(input.amount || 0))),
    normalizeKey(input.reference),
    normalizeKey(input.description)
  ].join("|");
  return createHash("sha256").update(source).digest("hex");
}

export function normalizeBankStatementRows(rows, accountInput = {}, { limit = MAX_BANK_STATEMENT_ROWS } = {}) {
  const account = normalizedAccount(accountInput);
  const cappedRows = Array.isArray(rows) ? rows.slice(0, Math.max(1, Math.min(Number(limit) || MAX_BANK_STATEMENT_ROWS, MAX_BANK_STATEMENT_ROWS))) : [];
  return cappedRows.map((rawRow, index) => {
    const row = rawRow && typeof rawRow === "object" && !Array.isArray(rawRow) ? rawRow : {};
    const transactionDate = parseDate(getValue(row, ["fecha", "fecha_movimiento", "fecha transaccion", "fecha_transaccion", "fecha operacion", "fecha_operacion", "fecha_valor", "date", "transaction_date"]));
    const description = bankStatementDescription(row);
    const reference = getValue(row, ["referencia", "reference", "comprobante", "folio", "nro_operacion", "numero_operacion", "número operación", "id_movimiento", "numero_documento", "n_documento", "n documento", "n° documento"]);
    const payerName = getValue(row, ["contraparte", "nombre_contraparte", "ordenante", "beneficiario", "pagador", "titular", "payer", "counterparty"]);
    const rut = getValue(row, ["rut", "rut_contraparte", "rut_cliente", "rut_proveedor", "tax_id"]);
    const balance = parseNumber(getValue(row, ["saldo", "saldo_contable", "saldo_disponible", "balance"]));
    const { signedAmount, direction, directionSource } = sourceAmount(row);
    const amount = Math.abs(signedAmount);
    const reviewReasons = [];
    if (!transactionDate) reviewReasons.push("fecha del movimiento");
    if (!amount) reviewReasons.push("monto");
    if (!description) reviewReasons.push("descripción o glosa");
    const fingerprint = bankMovementFingerprint({ ...account, transactionDate, amount, reference, description });
    return {
      rowNumber: index + 2,
      ...account,
      transactionDate,
      date: transactionDate,
      description: description || "Movimiento sin descripción",
      reference,
      payerName,
      rut,
      amount,
      signedAmount,
      direction,
      movementType: direction === "DEBIT" ? "CARGO" : "ABONO",
      directionSource,
      movementKind: classifyBankMovement({ description, reference, direction }),
      balance: balance || null,
      branch: getValue(row, ["sucursal", "oficina", "branch"]) || null,
      currency: "CLP",
      fingerprint,
      needsReview: reviewReasons.length > 0,
      reviewReasons,
      source: safeSourceRow(row)
    };
  });
}

export function summarizeBankStatementRows(rows) {
  const normalized = Array.isArray(rows) ? rows : [];
  return normalized.reduce((summary, row) => {
    summary.totalRows += 1;
    if (row.needsReview) summary.reviewRows += 1;
    if (row.direction === "CREDIT") summary.credits += row.amount || 0;
    else summary.debits += row.amount || 0;
    return summary;
  }, { totalRows: 0, reviewRows: 0, credits: 0, debits: 0, net: 0 });
}

export async function readBankStatementFile(file) {
  if (!file?.buffer?.length) throw new Error("Selecciona una cartola CSV, Excel, TXT o PDF con texto para revisar.");
  if (file.buffer.length > MAX_BANK_STATEMENT_FILE_BYTES) throw new Error("La cartola supera el límite de 12 MB para una importación segura.");
  const format = detectBankStatementFileFormat(file);
  if (format.key === "PDF") {
    const parsed = await pdfParse(file.buffer);
    const rows = parsePdfBankStatementText(parsed.text);
    if (!rows.length) {
      throw new Error("El PDF no contiene una tabla de movimientos legible. Si es una cartola escaneada o una imagen, expórtala desde el banco como CSV/Excel o súbela a Documentos para revisión humana.");
    }
    return rows;
  }
  if (format.key === "UNKNOWN") {
    throw new Error("No se reconoció el contenido del archivo. Usa CSV, TXT delimitado, Excel (.xlsx/.xlsm) o un PDF que contenga texto seleccionable.");
  }
  // Las exportaciones XML/HTML suelen llevar extensión .xls/.xlsx. También
  // puede ocurrir lo inverso: un CSV con nombre .xlsx. Forzamos el lector
  // correcto según el contenido, no según el nombre entregado por el banco.
  if (format.key === "LEGACY_SPREADSHEET" || format.key === "SPREADSHEET") {
    return readHistoricalFinanceFile({ ...file, originalname: `${fileName(file)}.xlsx` }, { maxBytes: MAX_BANK_STATEMENT_FILE_BYTES });
  }
  if (format.key === "DELIMITED_TEXT") {
    return readHistoricalFinanceFile({ ...file, originalname: `${fileName(file)}.csv` }, { maxBytes: MAX_BANK_STATEMENT_FILE_BYTES });
  }
  return readHistoricalFinanceFile(file, { maxBytes: MAX_BANK_STATEMENT_FILE_BYTES });
}

export function withBankStatementNet(summary) {
  return { ...summary, net: summary.credits - summary.debits };
}
