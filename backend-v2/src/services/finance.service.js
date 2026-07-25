import { prisma } from "../lib/db.js";

const DAY_MS = 24 * 60 * 60 * 1000;

function dataOf(record) {
  return record?.data && typeof record.data === "object" && !Array.isArray(record.data) ? record.data : {};
}

function numberOf(value, fallback = 0) {
  const normalized = String(value ?? "").replace(/[^0-9,.-]/g, "").replace(/\.(?=.*\.)/g, "").replace(",", ".");
  const parsed = typeof value === "number" ? value : Number(normalized);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function dateOf(value) {
  const date = value ? new Date(String(value)) : null;
  return date && !Number.isNaN(date.getTime()) ? date : null;
}

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function sharesTerm(left, right) {
  const leftTerms = new Set(normalizeText(left).split(" ").filter((term) => term.length > 2));
  return normalizeText(right).split(" ").some((term) => term.length > 2 && leftTerms.has(term));
}

export function getInvoiceFinancialState(invoice, now = new Date()) {
  const data = dataOf(invoice);
  const amount = Math.max(0, numberOf(data.amount ?? data.total ?? data.value));
  const storedBalance = data.balance === undefined || data.balance === null || data.balance === ""
    ? amount
    : Math.max(0, numberOf(data.balance));
  const dueDate = dateOf(data.dueDate);
  const rawStatus = String(invoice?.status || data.status || "OPEN").toUpperCase();
  const status = rawStatus === "PAID" || storedBalance === 0
    ? "PAID"
    : (dueDate && dueDate < now ? "OVERDUE" : rawStatus === "PARTIAL" ? "PARTIAL" : "OPEN");

  return { amount, balance: storedBalance, dueDate, status };
}

export function scoreFinanceReconciliation(invoice, movement, now = new Date()) {
  const invoiceData = dataOf(invoice);
  const movementData = dataOf(movement);
  const financial = getInvoiceFinancialState(invoice, now);
  const movementAmount = Math.abs(numberOf(movementData.amount));
  const difference = Math.abs(financial.balance - movementAmount);
  const reasons = [];
  let score = 0;

  if (financial.balance > 0 && difference <= 1) {
    score += 62;
    reasons.push("Monto exacto");
  } else if (financial.balance > 0 && difference / financial.balance <= 0.01) {
    score += 50;
    reasons.push("Monto muy cercano");
  } else if (financial.balance > 0 && movementAmount > 0 && movementAmount < financial.balance) {
    score += 24;
    reasons.push("Posible pago parcial");
  }

  const reference = `${movementData.reference || ""} ${movement.title || ""}`;
  const invoiceNumber = invoiceData.invoiceNumber || invoiceData.number || invoice.title;
  if (invoiceNumber && normalizeText(reference).includes(normalizeText(invoiceNumber))) {
    score += 18;
    reasons.push("Referencia de factura");
  }

  if (invoiceData.rut && movementData.rut && normalizeText(invoiceData.rut) === normalizeText(movementData.rut)) {
    score += 12;
    reasons.push("RUT coincidente");
  }

  const customerName = invoiceData.customerName || invoiceData.customer || invoice.title;
  if (sharesTerm(customerName, movementData.payerName || movementData.counterparty || reference)) {
    score += 10;
    reasons.push("Cliente o razon social coincidente");
  }

  const movementDate = dateOf(movementData.transactionDate || movementData.date);
  if (financial.dueDate && movementDate) {
    const days = Math.abs(financial.dueDate.getTime() - movementDate.getTime()) / DAY_MS;
    if (days <= 10) {
      score += 5;
      reasons.push("Fecha compatible");
    }
  }

  return {
    invoiceId: invoice.id,
    movementId: movement.id,
    confidence: Math.min(99, Math.round(score)),
    difference,
    partial: movementAmount > 0 && movementAmount < financial.balance,
    reasons,
    invoice,
    movement
  };
}

function agingBucket(dueDate, now = new Date()) {
  if (!dueDate || dueDate >= now) return "No vencida";
  const days = Math.max(0, Math.floor((now.getTime() - dueDate.getTime()) / DAY_MS));
  if (days <= 30) return "1-30 dias";
  if (days <= 60) return "31-60 dias";
  if (days <= 90) return "61-90 dias";
  return "+90 dias";
}

export async function getFinanceOverview({ tenantId, now = new Date() }) {
  const types = ["finance_invoice", "bank_statement", "bank_movement", "finance_reconciliation", "finance_exception", "finance_collection_case"];
  const records = await prisma.industryRecord.findMany({
    where: { tenantId, recordType: { in: types } },
    orderBy: { updatedAt: "desc" },
    take: 1000
  });
  const grouped = Object.fromEntries(types.map((type) => [type, records.filter((record) => record.recordType === type)]));
  const invoices = grouped.finance_invoice;
  const movements = grouped.bank_movement;
  const reconciliations = grouped.finance_reconciliation;
  const exceptions = grouped.finance_exception;
  const collectionCases = grouped.finance_collection_case;

  let issued = 0;
  let paid = 0;
  let pending = 0;
  let overdue = 0;
  const aging = { "No vencida": 0, "1-30 dias": 0, "31-60 dias": 0, "61-90 dias": 0, "+90 dias": 0 };
  const dsoValues = [];

  for (const invoice of invoices) {
    const state = getInvoiceFinancialState(invoice, now);
    issued += state.amount;
    paid += Math.max(0, state.amount - state.balance);
    pending += state.balance;
    if (state.status !== "PAID") {
      const bucket = agingBucket(state.dueDate, now);
      aging[bucket] += state.balance;
      if (state.status === "OVERDUE") overdue += state.balance;
    }
    const data = dataOf(invoice);
    const issuedAt = dateOf(data.issueDate || invoice.createdAt);
    const paidAt = dateOf(data.paidAt);
    if (state.status === "PAID" && issuedAt && paidAt) dsoValues.push(Math.max(0, (paidAt.getTime() - issuedAt.getTime()) / DAY_MS));
  }

  const unreconciled = movements.filter((record) => String(record.status || dataOf(record).status || "UNRECONCILED").toUpperCase() !== "MATCHED");
  const approvedReconciliations = reconciliations.filter((record) => String(record.status).toUpperCase() === "APPROVED").length;
  const openExceptions = exceptions.filter((record) => !["RESOLVED", "CLOSED"].includes(String(record.status).toUpperCase())).length;
  const criticalExceptions = exceptions.filter((record) => {
    const priority = String(dataOf(record).priority || "").toUpperCase();
    return !["RESOLVED", "CLOSED"].includes(String(record.status).toUpperCase()) && ["HIGH", "CRITICAL"].includes(priority);
  }).length;
  const openCollections = collectionCases.filter((record) => !["PAID", "CLOSED"].includes(String(record.status).toUpperCase())).length;
  const promiseCollections = collectionCases.filter((record) => Boolean(dataOf(record).promiseDate || dataOf(record).promiseAmount)).length;
  const expectedNext30 = invoices.reduce((total, invoice) => {
    const state = getInvoiceFinancialState(invoice, now);
    if (state.status === "PAID" || !state.dueDate) return total;
    const days = (state.dueDate.getTime() - now.getTime()) / DAY_MS;
    return days >= 0 && days <= 30 ? total + state.balance : total;
  }, 0);

  return {
    generatedAt: now.toISOString(),
    // Contract used by the Finance OS workspace. Keep the legacy kpis below
    // for backwards-compatible API consumers while exposing named domains.
    invoices: {
      total: invoices.length,
      issued,
      paid,
      pending: invoices.filter((invoice) => getInvoiceFinancialState(invoice, now).status !== "PAID").length,
      overdue: invoices.filter((invoice) => getInvoiceFinancialState(invoice, now).status === "OVERDUE").length,
      pendingAmount: pending,
      overdueAmount: overdue
    },
    collection: {
      rate: issued ? Number(((paid / issued) * 100).toFixed(1)) : 0,
      dsoDays: dsoValues.length ? Math.round(dsoValues.reduce((sum, value) => sum + value, 0) / dsoValues.length) : 0,
      expectedNext30Days: expectedNext30
    },
    reconciliation: {
      totalMovements: movements.length,
      matchedMovements: movements.length - unreconciled.length,
      pendingMovements: unreconciled.length,
      rate: movements.length ? Number((((movements.length - unreconciled.length) / movements.length) * 100).toFixed(1)) : 0
    },
    exceptions: { open: openExceptions, critical: criticalExceptions },
    collections: { open: openCollections, promises: promiseCollections },
    recent: { invoices: invoices.slice(0, 8), exceptions: exceptions.slice(0, 8), collectionCases: collectionCases.slice(0, 8) },
    integrationReadiness: [
      { key: "erp", label: "ERP / contabilidad", status: "requires_configuration", note: "Nubox, Defontana, Softland u otro ERP requieren su integracion autorizada." },
      { key: "bank", label: "Cartolas bancarias", status: "manual", note: "Carga manual de CSV disponible; PDF y Excel quedan listos para el parser contratado." },
      { key: "channels", label: "Canales de cobranza", status: "requires_configuration", note: "WhatsApp, correo y SMS se activan solo con la cuenta y consentimiento configurados." }
    ],
    kpis: {
      invoices: invoices.length,
      issued,
      paid,
      pending,
      overdue,
      overdueRate: pending ? Number(((overdue / pending) * 100).toFixed(1)) : 0,
      dso: dsoValues.length ? Math.round(dsoValues.reduce((sum, value) => sum + value, 0) / dsoValues.length) : null,
      expectedNext30,
      unreconciledMovements: unreconciled.length,
      approvedReconciliations,
      openExceptions,
      openCollections
    },
    aging: Object.entries(aging).map(([bucket, amount]) => ({ bucket, amount })),
    recentInvoices: invoices.slice(0, 8).map((invoice) => ({ ...invoice, financial: getInvoiceFinancialState(invoice, now) })),
    recentMovements: movements.slice(0, 8),
    recentExceptions: exceptions.slice(0, 8),
    integrationStatus: {
      erp: "manual_or_api_pending",
      bankStatements: "manual_pdf_excel_csv_ready",
      collections: "crm_channels_ready_when_connected"
    }
  };
}

export async function getFinanceReconciliationSuggestions({ tenantId, movementId = null, limit = 30 }) {
  const [invoices, movements] = await Promise.all([
    prisma.industryRecord.findMany({ where: { tenantId, recordType: "finance_invoice" }, orderBy: { updatedAt: "desc" }, take: 500 }),
    prisma.industryRecord.findMany({ where: { tenantId, recordType: "bank_movement", ...(movementId ? { id: movementId } : {}) }, orderBy: { updatedAt: "desc" }, take: 500 })
  ]);
  const openInvoices = invoices.filter((invoice) => getInvoiceFinancialState(invoice).status !== "PAID");
  const candidates = movements
    .filter((movement) => String(movement.status || dataOf(movement).status || "UNRECONCILED").toUpperCase() !== "MATCHED")
    .flatMap((movement) => openInvoices.map((invoice) => scoreFinanceReconciliation(invoice, movement)))
    .filter((item) => item.confidence >= 35)
    .sort((left, right) => right.confidence - left.confidence)
    .slice(0, Math.max(1, Math.min(Number(limit) || 30, 200)));

  return candidates.map(({ invoice, movement, ...suggestion }) => ({
    ...suggestion,
    invoice: { id: invoice.id, title: invoice.title, data: dataOf(invoice), status: invoice.status },
    movement: { id: movement.id, title: movement.title, data: dataOf(movement), status: movement.status }
  }));
}

export function financeRecordData(record) {
  return dataOf(record);
}
