function cleanText(value, fallback = "") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function normalizedSearch(value) {
  return cleanText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

// Catálogo basado en las instituciones bancarias establecidas en Chile publicadas por la CMF.
// No implica que cada banco entregue todavía una API de banca abierta a EVOLUM.
export const CHILEAN_FINANCIAL_INSTITUTIONS = Object.freeze([
  { key: "banco_de_chile", name: "Banco de Chile", cmfCode: "001" },
  { key: "banco_internacional", name: "Banco Internacional", cmfCode: "009" },
  { key: "bancoestado", name: "BancoEstado", cmfCode: "012" },
  { key: "scotiabank_chile", name: "Scotiabank Chile", cmfCode: "014" },
  { key: "bci", name: "Banco de Crédito e Inversiones (BCI)", cmfCode: "016" },
  { key: "banco_bice", name: "Banco BICE", cmfCode: "028" },
  { key: "hsbc_chile", name: "HSBC Bank Chile", cmfCode: "031" },
  { key: "santander_chile", name: "Banco Santander Chile", cmfCode: "037" },
  { key: "itau_chile", name: "Banco Itaú Chile", cmfCode: "039" },
  { key: "jpmorgan_chile", name: "J.P. Morgan Chase Bank N.A.", cmfCode: "041" },
  { key: "banco_falabella", name: "Banco Falabella", cmfCode: "051" },
  { key: "banco_ripley", name: "Banco Ripley", cmfCode: "053" },
  { key: "banco_consorcio", name: "Banco Consorcio", cmfCode: "055" },
  { key: "btg_pactual_chile", name: "Banco BTG Pactual Chile", cmfCode: "059" },
  { key: "china_construction_bank_chile", name: "China Construction Bank Agencia Chile", cmfCode: "060" },
  { key: "bank_of_china_chile", name: "Bank of China Agencia Chile", cmfCode: "061" },
  { key: "tanner_banco_digital", name: "Tanner Banco Digital", cmfCode: "062" },
  { key: "tenpo_bank_chile", name: "Tenpo Bank Chile", cmfCode: "063" }
]);

export function getChileanFinancialInstitution(value) {
  const text = cleanText(value);
  const search = normalizedSearch(text);
  return CHILEAN_FINANCIAL_INSTITUTIONS.find((institution) => (
    institution.key === text
    || institution.cmfCode === text
    || normalizedSearch(institution.name) === search
  )) || null;
}

export function normalizeChileanBankAccounts(value) {
  if (!Array.isArray(value)) return [];

  return value.slice(0, 20).map((item) => {
    const source = item && typeof item === "object" && !Array.isArray(item) ? item : {};
    const requestedBank = cleanText(source.bank || source.bankKey);
    const institution = getChileanFinancialInstitution(requestedBank);
    if (!requestedBank && !institution) return null;

    const last4 = String(source.accountLast4 || "").replace(/\D/g, "").slice(-4);
    const requestedSyncMode = cleanText(source.syncMode).toUpperCase();
    const requestedConsent = cleanText(source.consentStatus).toUpperCase();

    return {
      bank: institution?.name || requestedBank,
      bankKey: institution?.key || normalizedSearch(requestedBank).replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 80),
      ...(institution?.cmfCode ? { cmfCode: institution.cmfCode } : {}),
      alias: cleanText(source.alias).slice(0, 100) || "Cuenta sin nombre",
      accountType: cleanText(source.accountType).slice(0, 60) || "Cuenta corriente",
      ...(last4 ? { accountLast4: last4 } : {}),
      syncMode: ["CSV", "OPEN_BANKING"].includes(requestedSyncMode) ? requestedSyncMode : "CSV",
      consentStatus: ["PENDIENTE", "AUTORIZADO", "REVOCADO"].includes(requestedConsent) ? requestedConsent : "PENDIENTE"
    };
  }).filter(Boolean);
}
