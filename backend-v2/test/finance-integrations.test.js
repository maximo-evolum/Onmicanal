import test from "node:test";
import assert from "node:assert/strict";
import { CHILEAN_FINANCIAL_INSTITUTIONS, normalizeChileanBankAccounts } from "../src/lib/finance-integrations.js";

test("incluye instituciones bancarias establecidas en Chile", () => {
  assert.ok(CHILEAN_FINANCIAL_INSTITUTIONS.length >= 18);
  assert.ok(CHILEAN_FINANCIAL_INSTITUTIONS.some((bank) => bank.name === "BancoEstado" && bank.cmfCode === "012"));
});

test("normaliza cuentas sin conservar el número completo", () => {
  const [account] = normalizeChileanBankAccounts([{
    bank: "BancoEstado",
    alias: "Recaudación",
    accountType: "Cuenta corriente",
    accountLast4: "1234",
    syncMode: "open_banking"
  }]);

  assert.deepEqual(account, {
    bank: "BancoEstado",
    bankKey: "bancoestado",
    cmfCode: "012",
    alias: "Recaudación",
    accountType: "Cuenta corriente",
    accountLast4: "1234",
    syncMode: "OPEN_BANKING",
    consentStatus: "PENDIENTE"
  });
});
