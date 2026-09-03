import test from "node:test";
import assert from "node:assert/strict";
import { createFloidConsentCase, normalizeFloidTransactions } from "../src/services/finance-floid.service.js";

test("normaliza el formato de transacciones de Floid para la conciliación común", () => {
  const result = normalizeFloidTransactions({
    caseId: "case-demo-001",
    status: "successful",
    transactions: [
      { id: "trx-1", date: "2026-09-03", description: "Abono cliente Comercial Andes", in: 1250000, out: 0, currency: "CLP" },
      { id: "trx-2", date: "2026-09-04", description: "Pago proveedor", in: 0, out: 450000, currency: "CLP" }
    ]
  }, { bankKey: "bancoestado", accountAlias: "Recaudación", accountLast4: "1234" });

  assert.equal(result.caseId, "case-demo-001");
  assert.equal(result.status, "SUCCESSFUL");
  assert.equal(result.movements.length, 2);
  assert.equal(result.movements[0].bank, "BancoEstado");
  assert.equal(result.movements[0].direction, "CREDIT");
  assert.equal(result.movements[0].externalMovementId, "trx-1");
  assert.equal(result.movements[1].direction, "DEBIT");
  assert.deepEqual(result.summary, { totalRows: 2, reviewRows: 0, credits: 1250000, debits: 450000, net: 800000 });
});

test("prepara el consentimiento sin exponer ni recibir una clave bancaria", () => {
  const consent = createFloidConsentCase({
    bankKey: "bci",
    accountAlias: "Operaciones",
    accountType: "Cuenta corriente",
    accountLast4: "Cuenta 001234"
  });

  assert.match(consent.caseId, /^[0-9a-f-]{36}$/i);
  assert.deepEqual(consent.account, {
    bankKey: "bci",
    accountAlias: "Operaciones",
    accountType: "Cuenta corriente",
    accountLast4: "1234"
  });
  assert.equal(JSON.stringify(consent).includes("password"), false);
  assert.equal(JSON.stringify(consent).includes("accountNumber"), false);
});
