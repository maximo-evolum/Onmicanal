// Contrato común de documentos financieros. Los registros viven en el JSON
// versionado de IndustryRecord, pero esta capa evita que cada fuente (manual,
// histórico, DTE o ERP) use nombres y cálculos distintos.

function text(value, fallback = "") {
  const normalized = String(value ?? "").trim();
  return normalized || fallback;
}

function amount(value, fallback = 0) {
  if (typeof value === "number") return Number.isFinite(value) ? Math.max(0, value) : fallback;
  const source = text(value).replace(/\$/g, "").replace(/\s/g, "");
  if (!source) return fallback;
  const dots = (source.match(/\./g) || []).length;
  const normalized = source.includes(",") && source.includes(".")
    ? source.replace(/\./g, "").replace(",", ".")
    : source.includes(",")
      ? source.replace(",", ".")
      : dots > 1 || (dots === 1 && /\.\d{3}$/.test(source))
        ? source.replace(/\./g, "")
        : source;
  const parsed = Number(normalized.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? Math.max(0, parsed) : fallback;
}

function date(value) {
  const source = text(value);
  if (!source) return null;
  const parsed = new Date(source.length === 10 ? `${source}T12:00:00.000Z` : source);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

function currency(value) {
  const normalized = text(value, "CLP").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 3);
  return normalized.length === 3 ? normalized : "CLP";
}

function first(source, keys, fallback = "") {
  for (const key of keys) {
    if (source?.[key] !== undefined && source?.[key] !== null && text(source[key])) return source[key];
  }
  return fallback;
}

function sideFor(recordType, source) {
  if (String(recordType) === "finance_payable") return "SUPPLIER";
  if (String(recordType) === "finance_invoice") return "CUSTOMER";
  return text(source?.documentSide).toUpperCase() === "SUPPLIER" ? "SUPPLIER" : "CUSTOMER";
}

function partyFor(side, source) {
  const name = side === "SUPPLIER"
    ? first(source, ["supplierName", "providerName", "partyName", "clientName", "customerName"])
    : first(source, ["clientName", "customerName", "partyName", "supplierName"]);
  const rut = side === "SUPPLIER"
    ? first(source, ["supplierRut", "providerRut", "partyRut", "rut", "clientRut", "customerRut"])
    : first(source, ["clientRut", "customerRut", "partyRut", "rut", "supplierRut"]);
  return { name: text(name).slice(0, 180), rut: text(rut).slice(0, 30) || null };
}

export function normalizeFinanceDocumentData(source = {}, recordType = "finance_invoice", { today = new Date().toISOString().slice(0, 10) } = {}) {
  const input = source && typeof source === "object" && !Array.isArray(source) ? source : {};
  const side = sideFor(recordType, input);
  const party = partyFor(side, input);
  const netAmount = amount(first(input, ["netAmount", "net", "montoNeto", "monto_neto"]));
  const vatAmount = amount(first(input, ["vatAmount", "vat", "iva", "taxAmount", "impuesto"]));
  const totalSupplied = amount(first(input, ["amount", "totalAmount", "total", "monto", "montoTotal", "importe", "valor"]));
  const totalAmount = totalSupplied || Math.max(0, netAmount + vatAmount);
  const creditNotesTotal = amount(first(input, ["creditNotesTotal", "creditNoteAmount", "notasCredito", "notaCredito"]));
  const debitNotesTotal = amount(first(input, ["debitNotesTotal", "debitNoteAmount", "notasDebito", "notaDebito"]));
  const paidAmount = amount(first(input, ["paidAmount", "montoPagado", "pagado", "paid"]));
  const adjustedAmount = Math.max(0, totalAmount - creditNotesTotal + debitNotesTotal);
  const suppliedBalance = first(input, ["balance", "saldo", "saldoPendiente"]);
  const balance = text(suppliedBalance) ? amount(suppliedBalance) : Math.max(0, adjustedAmount - paidAmount);
  const documentNumber = text(first(input, ["documentNumber", "invoiceNumber", "folio", "number", "numero"])).slice(0, 100);
  const documentType = text(first(input, ["documentType", "documentTypeName", "tipoDocumento", "tipo_documento"], side === "SUPPLIER" ? "Documento de proveedor" : "Factura de cliente")).slice(0, 160);
  const documentTypeCode = text(first(input, ["documentTypeCode", "tipoDte", "tipo_dte"])).slice(0, 12) || undefined;
  const issueDate = date(first(input, ["issueDate", "fechaEmision", "fecha_emision"])) || today;
  const dueDate = date(first(input, ["dueDate", "fechaVencimiento", "fecha_vencimiento"]));
  const paymentDate = date(first(input, ["paymentDate", "paidAt", "fechaPago", "fecha_pago"]));
  const paymentMethod = text(first(input, ["paymentMethod", "medioPago", "medio_pago"])).slice(0, 100) || undefined;
  const paymentIntermediary = text(first(input, ["paymentIntermediary", "intermediary", "intermediario"])).slice(0, 120) || undefined;
  const commissionAmount = amount(first(input, ["commissionAmount", "commission", "comision"]));
  const settlementReference = text(first(input, ["settlementReference", "liquidationReference", "liquidacion", "referenciaLiquidacion"])).slice(0, 160) || undefined;
  const referenceDocumentType = text(first(input, ["referenceDocumentType", "referenceType", "tipoDocumentoReferencia"])).slice(0, 30) || undefined;
  const referenceDocumentNumber = text(first(input, ["referenceDocumentNumber", "referenceNumber", "folioReferencia"])).slice(0, 100) || undefined;
  const referenceDocumentDate = date(first(input, ["referenceDocumentDate", "referenceDate", "fechaDocumentoReferencia"]));

  return {
    ...input,
    documentSide: side,
    direction: side === "SUPPLIER" ? "PURCHASE" : "SALE",
    documentNumber,
    ...(side === "CUSTOMER" ? { invoiceNumber: documentNumber, clientName: party.name, customerName: party.name, clientRut: party.rut, customerRut: party.rut } : { supplierName: party.name, supplierRut: party.rut }),
    partyName: party.name,
    partyRut: party.rut,
    documentType,
    ...(documentTypeCode ? { documentTypeCode } : {}),
    issueDate,
    ...(dueDate ? { dueDate } : {}),
    netAmount,
    vatAmount,
    amount: totalAmount,
    totalAmount,
    currency: currency(first(input, ["currency", "moneda"])),
    paidAmount,
    balance,
    creditNotesTotal,
    debitNotesTotal,
    ...(paymentDate ? { paymentDate, paidAt: paymentDate } : {}),
    ...(paymentMethod ? { paymentMethod } : {}),
    ...(paymentIntermediary ? { paymentIntermediary } : {}),
    ...(commissionAmount ? { commissionAmount } : {}),
    ...(settlementReference ? { settlementReference } : {}),
    ...(referenceDocumentType ? { referenceDocumentType } : {}),
    ...(referenceDocumentNumber ? { referenceDocumentNumber } : {}),
    ...(referenceDocumentDate ? { referenceDocumentDate } : {})
  };
}

export function validateFinanceDocumentData(data = {}) {
  const errors = [];
  const total = amount(data.totalAmount ?? data.amount);
  const net = amount(data.netAmount);
  const vat = amount(data.vatAmount);
  const paid = amount(data.paidAmount);
  const balance = amount(data.balance);
  const adjusted = Math.max(0, total - amount(data.creditNotesTotal) + amount(data.debitNotesTotal));
  if (!text(data.documentNumber || data.invoiceNumber)) errors.push("folio o número de documento");
  if (!text(data.partyName || data.clientName || data.customerName || data.supplierName)) errors.push("contraparte");
  if (!total) errors.push("monto total");
  if ((net > 0 || vat > 0) && Math.abs(total - net - vat) > 1) errors.push("neto + IVA debe coincidir con el total");
  if (paid > adjusted + 1) errors.push("monto pagado no puede superar el total ajustado");
  if (balance > adjusted + 1) errors.push("saldo no puede superar el total ajustado");
  return { ok: errors.length === 0, errors, adjustedAmount: adjusted };
}
