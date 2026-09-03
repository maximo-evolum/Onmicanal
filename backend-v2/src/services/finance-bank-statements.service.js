import { createHash } from "node:crypto";
import { getChileanFinancialInstitution } from "../lib/finance-integrations.js";
import { readHistoricalFinanceFile } from "./finance-migration.service.js";

export const MAX_BANK_STATEMENT_ROWS = 1000;
export const MAX_BANK_STATEMENT_FILE_BYTES = 12 * 1024 * 1024;

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
  if (debit) return { signedAmount: -Math.abs(parseNumber(debit)), direction: "DEBIT" };
  if (credit) return { signedAmount: Math.abs(parseNumber(credit)), direction: "CREDIT" };
  const rawAmount = getValue(row, ["monto", "importe", "amount", "valor", "monto_movimiento", "importe_movimiento"]);
  const signedAmount = parseNumber(rawAmount);
  return { signedAmount, direction: signedAmount < 0 ? "DEBIT" : "CREDIT" };
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
    const description = getValue(row, ["descripcion", "descripción", "glosa", "detalle", "movimiento", "concepto", "narrativa", "description"]);
    const reference = getValue(row, ["referencia", "reference", "comprobante", "folio", "nro_operacion", "numero_operacion", "número operación", "id_movimiento", "numero_documento"]);
    const payerName = getValue(row, ["contraparte", "nombre_contraparte", "ordenante", "beneficiario", "pagador", "titular", "payer", "counterparty"]);
    const rut = getValue(row, ["rut", "rut_contraparte", "rut_cliente", "rut_proveedor", "tax_id"]);
    const balance = parseNumber(getValue(row, ["saldo", "saldo_contable", "saldo_disponible", "balance"]));
    const { signedAmount, direction } = sourceAmount(row);
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
      balance: balance || null,
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
  if (!file?.buffer?.length) throw new Error("Selecciona una cartola CSV o Excel para revisar.");
  if (file.buffer.length > MAX_BANK_STATEMENT_FILE_BYTES) throw new Error("La cartola supera el límite de 12 MB para una importación segura.");
  return readHistoricalFinanceFile(file, { maxBytes: MAX_BANK_STATEMENT_FILE_BYTES });
}

export function withBankStatementNet(summary) {
  return { ...summary, net: summary.credits - summary.debits };
}
