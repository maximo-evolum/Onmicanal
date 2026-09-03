import { randomUUID } from "node:crypto";
import { normalizeBankStatementRows, withBankStatementNet, summarizeBankStatementRows } from "./finance-bank-statements.service.js";

function cleanText(value, fallback = "") {
  const normalized = String(value ?? "").trim();
  return normalized || fallback;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function sourceTransactions(payload) {
  if (Array.isArray(payload?.transactions)) return payload.transactions;
  if (Array.isArray(payload?.data?.transactions)) return payload.data.transactions;
  if (Array.isArray(payload?.result?.transactions)) return payload.result.transactions;
  return [];
}

function safeNumber(value) {
  const number = Number(String(value ?? "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(number) ? Math.max(0, number) : 0;
}

// Flöid documenta `in` y `out` para las transacciones. Las transformamos al
// formato común de cartolas, manteniendo el id externo solo como referencia
// de deduplicación y sin conservar credenciales bancarias.
export function normalizeFloidTransactions(payload, account = {}) {
  const transactions = sourceTransactions(payload);
  const rows = transactions.map((transaction) => {
    const item = transaction && typeof transaction === "object" ? transaction : {};
    const incoming = safeNumber(item.in ?? item.credit ?? item.creditAmount);
    const outgoing = safeNumber(item.out ?? item.debit ?? item.debitAmount);
    return {
      Fecha: item.date || item.transactionDate || item.createdAt || "",
      Descripción: item.description || item.detail || item.name || "Movimiento bancario",
      Abono: incoming || "",
      Cargo: outgoing || "",
      Saldo: item.balance || item.availableBalance || "",
      Referencia: item.id || item.transactionId || item.doc_number || item.documentNumber || "",
      Contraparte: item.counterparty || item.counterpartyName || item.payer || "",
      RUT: item.rut || item.counterpartyRut || ""
    };
  });
  const movements = normalizeBankStatementRows(rows, account);
  return {
    caseId: cleanText(payload?.caseId || payload?.caseid || payload?.data?.caseId),
    status: cleanText(payload?.status || payload?.code || payload?.data?.status, "SUCCESSFUL").toUpperCase(),
    movements: movements.map((movement, index) => ({
      ...movement,
      externalMovementId: cleanText(transactions[index]?.id || transactions[index]?.transactionId || transactions[index]?.doc_number) || null,
      source: "floid_open_banking"
    })),
    summary: withBankStatementNet(summarizeBankStatementRows(movements))
  };
}

export function createFloidConsentCase(account = {}) {
  return {
    caseId: randomUUID(),
    account: {
      bankKey: cleanText(account.bankKey),
      accountAlias: cleanText(account.accountAlias || account.alias, "Cuenta sin nombre").slice(0, 100),
      accountType: cleanText(account.accountType, "Cuenta corriente").slice(0, 60),
      accountLast4: String(account.accountLast4 || "").replace(/\D/g, "").slice(-4) || null
    }
  };
}

export function floidTransactionsFromPayload(payload) {
  return asArray(sourceTransactions(payload));
}
