const dataOf = (r) => r?.data && typeof r.data === "object" && !Array.isArray(r.data) ? r.data : {};
const text = (v) => String(v ?? "").trim();
const upper = (v) => text(v).toUpperCase();
const supplied = (v) => v !== undefined && v !== null && v !== "";
const inactiveStatuses = new Set(["ANNULLED", "CANCELLED", "CANCELED", "VOID", "ANULADA", "ANULADO", "REJECTED", "DELETED", "EXCLUDED"]);
export function financeDocumentSide(record) {
  if (record.recordType === "finance_payable") return "SUPPLIER";
  const d = dataOf(record), supplier = Boolean(text(d.supplierName || d.supplier || d.providerName)), customer = Boolean(text(d.customerName || d.customer || d.clientName));
  if ([d.documentSide, d.side, d.direction, d.kind, d.documentFlow, d.counterpartyType].some((v) => ["SUPPLIER", "PROVIDER", "PAYABLE", "PURCHASE", "COMPRA", "PROVEEDOR", "EGRESO", "RECEIVED", "RECIBIDO"].includes(upper(v)))) return "SUPPLIER";
  if (supplier !== customer) return supplier ? "SUPPLIER" : "CUSTOMER";
  return "CUSTOMER";
}
export function financeParty(record) {
  const d = dataOf(record), side = financeDocumentSide(record), supplier = side === "SUPPLIER";
  return { side, name: text(supplier ? d.supplierName || d.supplier || d.providerName : d.customerName || d.customer || d.clientName) || (supplier ? "Proveedor sin nombre" : "Cliente sin nombre"), rut: text(supplier ? d.supplierRut || d.rut : d.clientRut || d.customerRut || d.rut) || null };
}
export function financeDocumentDate(record) {
  const d = dataOf(record), value = d.issueDate || d.emissionDate || d.date;
  const day = value instanceof Date ? (Number.isNaN(value.getTime()) ? "" : value.toISOString().slice(0, 10)) : text(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) && Number.isFinite(Date.parse(day)) && new Date(day).toISOString().slice(0, 10) === day ? day : "";
}
export function financeDocumentState(record, now = new Date()) {
  const d = dataOf(record), issues = [];
  const read = (value, name, fallback = 0) => {
    if (!supplied(value)) return fallback;
    const n = (typeof value === "number" || (typeof value === "string" && value.trim())) ? Number(value) : NaN;
    if (!Number.isFinite(n) || n < 0) { issues.push(`${name}: monto inválido.`); return fallback; }
    return n;
  };
  const rawAmount = d.amount ?? d.total ?? d.totalAmount ?? d.value;
  const originalAmount = read(rawAmount, "Total original");
  if (!supplied(rawAmount)) issues.push("Falta el monto original del documento.");
  const creditNotes = read(d.creditNotesTotal ?? d.creditNoteAmount, "Notas de crédito"), debitNotes = read(d.debitNotesTotal ?? d.debitNoteAmount, "Notas de débito");
  const adjusted = originalAmount - creditNotes + debitNotes, amount = Math.max(0, adjusted);
  const justifiedDifference = read(d.justifiedDifferenceTotal, "Diferencias justificadas");
  if (adjusted < 0) issues.push("Las notas de crédito superan el monto ajustable.");
  const storedPaid = supplied(d.paidAmount) ? read(d.paidAmount, "Pagos registrados") : null;
  if (!supplied(d.balance) && storedPaid === null && amount > 0) issues.push("No se conoce el saldo ni el pago acumulado; requiere respaldo histórico.");
  // Stored balance is already net of applied adjustments. Never deduct NC twice.
  const balance = supplied(d.balance) ? read(d.balance, "Saldo") : Math.max(0, amount - (storedPaid ?? 0) - justifiedDifference);
  if (balance > amount || (storedPaid !== null && storedPaid > amount)) issues.push("El saldo o los pagos superan el monto ajustado.");
  if (balance + justifiedDifference > amount) issues.push("El saldo y las diferencias justificadas superan el monto del documento.");
  const paidAmount = Math.max(0, amount - balance - justifiedDifference);
  if (storedPaid !== null && Math.abs(storedPaid - paidAmount) > 0.000001) issues.push("Los pagos registrados y el saldo no cuadran con el monto ajustado.");
  const rawStatus = upper(record.status || d.status || "OPEN");
  const inactive = inactiveStatuses.has(rawStatus) || inactiveStatuses.has(upper(d.status));
  const type = upper(d.documentType || d.documentTypeName).normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const adjustment = ["56", "61"].includes(text(d.documentTypeCode)) || /NOTA (DE )?(CREDITO|DEBITO)/.test(type);
  if (!inactive && !adjustment && rawStatus === "PAID" && balance > 0) issues.push("El documento figura pagado pero conserva saldo sin respaldar.");
  const dueDay = financeDocumentDate({ data: { issueDate: d.dueDate } });
  const due = dueDay ? new Date(dueDay) : null;
  const dueDate = due && !Number.isNaN(due.getTime()) ? due : null;
  const status = inactive ? (rawStatus === "DELETED" || rawStatus === "EXCLUDED" ? rawStatus : "ANNULLED") : adjustment ? "ADJUSTMENT" : issues.length ? "REQUIRES_REVIEW" : balance === 0 ? "PAID" : dueDate && dueDate < now ? "OVERDUE" : paidAmount > 0 ? "PARTIAL" : "OPEN";
  return { amount, originalAmount, creditNotes, debitNotes, justifiedDifference, balance: inactive || adjustment ? 0 : balance, paidAmount: inactive || adjustment ? 0 : paidAmount, dueDate, status,
    included: !inactive && !adjustment && !issues.length, inactive, adjustment, qualityIssues: issues };
}
export function summarizeFinanceDocuments(records, now = new Date()) {
  const empty = () => ({ total: 0, issued: 0, paid: 0, pendingAmount: 0, overdueAmount: 0, pending: 0, overdue: 0 });
  const customers = empty(), suppliers = empty(), issues = [], excluded = { inactive: 0, adjustments: 0, invalid: 0 };
  const entries = records.filter((r) => ["finance_invoice", "finance_payable"].includes(r.recordType)).map((record) => ({ record, side: financeDocumentSide(record), state: financeDocumentState(record, now) }));
  for (const entry of entries) {
    const { record, side, state: s } = entry;
    if (!s.included) {
      if (s.inactive) excluded.inactive++;
      else if (s.adjustment) excluded.adjustments++;
      else { excluded.invalid++; issues.push({ id: record.id, title: `${record.title || record.id}: ${s.qualityIssues.join(" ")}` }); }
      continue;
    }
    const sum = side === "CUSTOMER" ? customers : suppliers;
    sum.total++; sum.issued += s.amount; sum.paid += s.paidAmount; sum.pendingAmount += s.balance;
    if (s.balance > 0) sum.pending++;
    if (s.status === "OVERDUE") { sum.overdue++; sum.overdueAmount += s.balance; }
  }
  return { customers, suppliers, entries, excluded, issues };
}

export function financeDocumentAmounts(record, now = new Date()) {
  const s = financeDocumentState(record, now);
  return { status: s.status, totalAmount: s.originalAmount, amount: s.amount, balance: s.balance, paidAmount: s.paidAmount,
    justifiedDifferenceTotal: s.justifiedDifference,
    creditNotesTotal: s.creditNotes, debitNotesTotal: s.debitNotes, includedInTotals: s.included, qualityIssues: s.qualityIssues };
}
