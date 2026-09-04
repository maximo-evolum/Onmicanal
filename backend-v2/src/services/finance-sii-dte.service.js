import { createHash } from "node:crypto";

export const MAX_SII_DTE_FILES = 20;
export const MAX_SII_DTE_FILE_BYTES = 5 * 1024 * 1024;

function cleanText(value, fallback = "") {
  const normalized = String(value ?? "").replace(/\s+/g, " ").trim();
  return normalized || fallback;
}

function decodeXml(value) {
  return cleanText(value)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function tag(xml, name, fallback = "") {
  const escaped = String(name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = String(xml || "").match(new RegExp(`<${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escaped}>`, "i"));
  return match ? decodeXml(match[1]) : fallback;
}

function section(xml, name) {
  const escaped = String(name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = String(xml || "").match(new RegExp(`<${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escaped}>`, "i"));
  return match ? match[1] : "";
}

function normalizeRut(value) {
  return cleanText(value).replace(/[.\s]/g, "").toUpperCase();
}

function safeNumber(value) {
  const number = Number(String(value ?? "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(number) ? Math.max(0, number) : 0;
}

function validDate(value) {
  const source = cleanText(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(source) ? source : null;
}

const DTE_TYPES = Object.freeze({
  "33": "Factura electrónica",
  "34": "Factura no afecta o exenta electrónica",
  "39": "Boleta electrónica",
  "43": "Liquidación factura electrónica",
  "46": "Factura de compra electrónica",
  "52": "Guía de despacho electrónica",
  "56": "Nota de débito electrónica",
  "61": "Nota de crédito electrónica"
});

export function siiDteFingerprint(input = {}) {
  const source = [
    normalizeRut(input.emitterRut),
    normalizeRut(input.receiverRut),
    cleanText(input.documentTypeCode),
    cleanText(input.documentNumber),
    cleanText(input.issueDate),
    safeNumber(input.amount)
  ].join("|");
  return createHash("sha256").update(source).digest("hex");
}

function parseDocument(xml, { companyRut, sourceFile = "dte.xml" } = {}) {
  const document = section(xml, "Documento") || String(xml || "");
  const header = section(document, "Encabezado") || document;
  const idDoc = section(header, "IdDoc");
  const emitter = section(header, "Emisor");
  const receiver = section(header, "Receptor");
  const totals = section(header, "Totales");
  const reference = section(document, "Referencia");
  const documentTypeCode = tag(idDoc, "TipoDTE");
  const documentNumber = tag(idDoc, "Folio");
  const issueDate = validDate(tag(idDoc, "FchEmis"));
  const emitterRut = normalizeRut(tag(emitter, "RUTEmisor"));
  const receiverRut = normalizeRut(tag(receiver, "RUTRecep"));
  const emitterName = tag(emitter, "RznSoc", "Emisor sin razón social");
  const receiverName = tag(receiver, "RznSocRecep", "Receptor sin razón social");
  const netAmount = safeNumber(tag(totals, "MntNeto"));
  const vatAmount = safeNumber(tag(totals, "IVA"));
  const amount = safeNumber(tag(totals, "MntTotal"));
  const normalizedCompanyRut = normalizeRut(companyRut);
  const reviewReasons = [];
  if (!documentTypeCode) reviewReasons.push("tipo de DTE");
  if (!documentNumber) reviewReasons.push("folio");
  if (!issueDate) reviewReasons.push("fecha de emisión");
  if (!emitterRut) reviewReasons.push("RUT del emisor");
  if (!receiverRut) reviewReasons.push("RUT del receptor");
  if (!amount) reviewReasons.push("monto total");
  let side = null;
  if (normalizedCompanyRut && emitterRut === normalizedCompanyRut) side = "CUSTOMER";
  else if (normalizedCompanyRut && receiverRut === normalizedCompanyRut) side = "SUPPLIER";
  else reviewReasons.push("el DTE no corresponde al RUT configurado en SII");
  const documentTypeName = DTE_TYPES[documentTypeCode] || `DTE tipo ${documentTypeCode || "desconocido"}`;
  const fingerprint = siiDteFingerprint({ emitterRut, receiverRut, documentTypeCode, documentNumber, issueDate, amount });
  return {
    sourceFile: cleanText(sourceFile, "dte.xml").slice(0, 180),
    documentTypeCode,
    documentTypeName,
    documentNumber,
    issueDate,
    emitterRut,
    emitterName,
    receiverRut,
    receiverName,
    netAmount,
    vatAmount,
    amount,
    referenceDocumentType: tag(reference, "TpoDocRef") || null,
    referenceDocumentNumber: tag(reference, "FolioRef") || null,
    referenceDocumentDate: validDate(tag(reference, "FchRef")),
    currency: "CLP",
    side,
    partyName: side === "CUSTOMER" ? receiverName : side === "SUPPLIER" ? emitterName : "Contraparte por revisar",
    partyRut: side === "CUSTOMER" ? receiverRut : side === "SUPPLIER" ? emitterRut : null,
    fingerprint,
    needsReview: reviewReasons.length > 0,
    reviewReasons
  };
}

export function parseSiiDteFiles(files, { companyRut } = {}) {
  const input = Array.isArray(files) ? files.slice(0, MAX_SII_DTE_FILES) : [];
  if (!normalizeRut(companyRut)) throw new Error("Configura el RUT del contribuyente en Centro de Conexiones antes de importar DTE.");
  return input.map((file) => {
    if (!file?.buffer?.length) throw new Error("Uno de los archivos DTE está vacío.");
    if (file.buffer.length > MAX_SII_DTE_FILE_BYTES) throw new Error("Cada DTE XML debe pesar como máximo 5 MB.");
    if (!/\.xml$/i.test(cleanText(file.originalname || file.name))) throw new Error("Solo se pueden importar documentos DTE en formato XML.");
    const xml = file.buffer.toString("utf8").replace(/^\uFEFF/, "");
    if (!/<(?:EnvioDTE|SetDTE|DTE|Documento)\b/i.test(xml)) throw new Error("El archivo no tiene una estructura DTE XML reconocible.");
    return parseDocument(xml, { companyRut, sourceFile: file.originalname || file.name });
  });
}

export function sanitizeSiiDteDocuments(documents, { companyRut } = {}) {
  const normalizedCompanyRut = normalizeRut(companyRut);
  if (!normalizedCompanyRut) throw new Error("Configura el RUT del contribuyente en Centro de Conexiones antes de importar DTE.");
  return (Array.isArray(documents) ? documents : []).slice(0, MAX_SII_DTE_FILES).map((source) => {
    const document = source && typeof source === "object" ? source : {};
    const emitterRut = normalizeRut(document.emitterRut);
    const receiverRut = normalizeRut(document.receiverRut);
    const side = emitterRut === normalizedCompanyRut ? "CUSTOMER" : receiverRut === normalizedCompanyRut ? "SUPPLIER" : null;
    const documentTypeCode = cleanText(document.documentTypeCode).slice(0, 6);
    const documentNumber = cleanText(document.documentNumber).slice(0, 80);
    const issueDate = validDate(document.issueDate);
    const netAmount = safeNumber(document.netAmount);
    const vatAmount = safeNumber(document.vatAmount);
    const amount = safeNumber(document.amount);
    const referenceDocumentType = cleanText(document.referenceDocumentType).slice(0, 10) || null;
    const referenceDocumentNumber = cleanText(document.referenceDocumentNumber).slice(0, 80) || null;
    const referenceDocumentDate = validDate(document.referenceDocumentDate);
    const reviewReasons = [];
    if (!documentTypeCode) reviewReasons.push("tipo de DTE");
    if (!documentNumber) reviewReasons.push("folio");
    if (!issueDate) reviewReasons.push("fecha de emisión");
    if (!emitterRut || !receiverRut) reviewReasons.push("RUT de emisor y receptor");
    if (!amount) reviewReasons.push("monto total");
    if (!side) reviewReasons.push("el DTE no corresponde al RUT configurado en SII");
    const documentTypeName = cleanText(document.documentTypeName, DTE_TYPES[documentTypeCode] || `DTE tipo ${documentTypeCode || "desconocido"}`).slice(0, 160);
    const emitterName = cleanText(document.emitterName, "Emisor sin razón social").slice(0, 180);
    const receiverName = cleanText(document.receiverName, "Receptor sin razón social").slice(0, 180);
    return {
      sourceFile: cleanText(document.sourceFile, "dte.xml").slice(0, 180), documentTypeCode, documentTypeName, documentNumber, issueDate,
      emitterRut, emitterName, receiverRut, receiverName, netAmount, vatAmount, amount, currency: "CLP", side,
      referenceDocumentType, referenceDocumentNumber, referenceDocumentDate,
      partyName: side === "CUSTOMER" ? receiverName : side === "SUPPLIER" ? emitterName : "Contraparte por revisar",
      partyRut: side === "CUSTOMER" ? receiverRut : side === "SUPPLIER" ? emitterRut : null,
      fingerprint: siiDteFingerprint({ emitterRut, receiverRut, documentTypeCode, documentNumber, issueDate, amount }),
      needsReview: reviewReasons.length > 0, reviewReasons
    };
  });
}

export function summarizeSiiDteDocuments(documents) {
  return (Array.isArray(documents) ? documents : []).reduce((summary, document) => {
    summary.total += 1;
    if (document.needsReview) summary.review += 1;
    if (document.side === "CUSTOMER") { summary.customerDocuments += 1; summary.customerAmount += document.amount || 0; }
    if (document.side === "SUPPLIER") { summary.supplierDocuments += 1; summary.supplierAmount += document.amount || 0; }
    return summary;
  }, { total: 0, review: 0, customerDocuments: 0, supplierDocuments: 0, customerAmount: 0, supplierAmount: 0 });
}
