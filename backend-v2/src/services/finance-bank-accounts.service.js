import { randomUUID } from "node:crypto";
import { FinanceOperationError, findAllFinanceRecords, withFinanceWrite } from "./finance-integrity.service.js";
import { getChileanFinancialInstitution } from "../lib/finance-integrations.js";
import { requireFinanceCurrency } from "./finance-currency.service.js";

const type = "finance_bank_account", fail = (status, text) => { throw new FinanceOperationError(status, text); };
const text = (v) => String(v ?? "").trim();
const aliasKey = (v) => text(v).normalize("NFKC").toLocaleLowerCase("es");
export function bankAccountView(record) { return { id: record.id, status: record.status, ...record.data }; }
export async function listFinanceBankAccounts(db, tenantId) {
  if (!tenantId) fail(401, "Falta la empresa de la sesión.");
  return (await findAllFinanceRecords(db, { where: { tenantId, recordType: type } })).map(bankAccountView).sort((a, b) => a.accountAlias.localeCompare(b.accountAlias, "es"));
}
export async function saveFinanceBankAccount(db, { tenantId, userId, id, input }) {
  if (!tenantId || !userId) fail(401, "Falta la sesión autenticada.");
  if (!input || typeof input !== "object" || Array.isArray(input)) fail(400, "Los datos de la cuenta no son válidos.");
  const alias = text(input.accountAlias);
  if (alias.length < 3 || alias.length > 100) fail(400, "Pon un nombre de cuenta de entre 3 y 100 caracteres.");
  return withFinanceWrite(db, async (tx) => {
    const all = await findAllFinanceRecords(tx, { where: { tenantId, recordType: type } });
    const existing = id ? all.find((r) => r.id === id) : null;
    if (id && !existing) fail(404, "Cuenta no encontrada en esta empresa.");
    let data;
    if (existing) {
      if (!Number.isInteger(input.version) || input.version !== existing.data.version) fail(409, "La cuenta cambió. Actualiza la lista antes de guardar.");
      for (const k of ["bankKey", "currency", "accountLast4", "accountType"]) if (input[k] !== undefined && input[k] !== existing.data[k]) fail(409, "Banco, moneda y datos de identificación son inmutables. Crea otra cuenta y conserva el historial de la anterior.");
      if (!["ACTIVE", "INACTIVE"].includes(input.status)) fail(400, "Estado de cuenta inválido.");
      data = { ...existing.data, accountAlias: alias, version: existing.data.version + 1 };
    } else {
      if (all.length >= 100) fail(409, "Se alcanzó el límite de 100 cuentas de esta empresa.");
      const bank = getChileanFinancialInstitution(input.bankKey);
      if (!bank) fail(400, "Selecciona un banco del catálogo.");
      if (!/^\d{4}$/.test(text(input.accountLast4))) fail(400, "Indica únicamente los últimos cuatro dígitos de la cuenta.");
      const accountType = text(input.accountType || "Cuenta corriente");
      if (!["Cuenta corriente", "Cuenta vista", "Cuenta de ahorro"].includes(accountType)) fail(400, "Selecciona un tipo de cuenta válido.");
      data = { bankAccountId: null, bankKey: bank.key, bank: bank.name, cmfCode: bank.cmfCode, currency: requireFinanceCurrency(input.currency), accountAlias: alias, accountLast4: text(input.accountLast4), accountType, version: 1 };
    }
    if (all.some((r) => r.id !== id && r.data.bankKey === data.bankKey && r.data.currency === data.currency && aliasKey(r.data.accountAlias) === aliasKey(alias))) fail(409, "Ya existe una cuenta con ese nombre, banco y moneda. Usa un nombre distinto para otra cuenta.");
    const recordId = id || `fba_${randomUUID()}`;
    data.bankAccountId = recordId;
    const status = existing ? input.status : "ACTIVE";
    const record = existing ? await tx.industryRecord.update({ where: { id }, data: { title: alias, status, data } }) : await tx.industryRecord.create({ data: { id: recordId, tenantId, recordType: type, title: alias, status, data } });
    await tx.tenantAuditLog.create({ data: { tenantId, actorUserId: userId, action: existing ? "FINANCE_BANK_ACCOUNT_UPDATED" : "FINANCE_BANK_ACCOUNT_CREATED", entity: type, entityId: record.id, metadata: { before: existing ? bankAccountView(existing) : null, after: bankAccountView(record) } } });
    return bankAccountView(record);
  });
}
export async function resolveFinanceBankAccount(db, tenantId, input = {}) {
  if (!tenantId) fail(401, "Falta la empresa de la sesión.");
  if (!input || typeof input !== "object" || Array.isArray(input)) fail(400, "Selecciona una cuenta válida.");
  if (!input.bankAccountId) return { ...input, currency: input.currency ? requireFinanceCurrency(input.currency) : "" };
  const record = await db.industryRecord.findFirst({ where: { tenantId, id: input.bankAccountId, recordType: type } });
  if (!record) fail(404, "La cuenta bancaria no pertenece a esta empresa.");
  if (record.status !== "ACTIVE") fail(409, "La cuenta está inactiva. No admite nuevas cargas; su historial se conserva.");
  return { ...record.data };
}
