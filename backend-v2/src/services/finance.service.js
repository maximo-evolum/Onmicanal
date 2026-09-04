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
  const originalAmount = Math.max(0, numberOf(data.amount ?? data.total ?? data.value));
  // El saldo operativo considera notas de crédito y débito ya vinculadas. No
  // cambia el documento tributario original; solo evita cobrar un saldo que ya
  // fue ajustado dentro del expediente financiero.
  const creditNotes = Math.max(0, numberOf(data.creditNotesTotal ?? data.creditNoteAmount));
  const debitNotes = Math.max(0, numberOf(data.debitNotesTotal ?? data.debitNoteAmount));
  const amount = Math.max(0, originalAmount - creditNotes + debitNotes);
  const storedBalance = data.balance === undefined || data.balance === null || data.balance === ""
    ? amount
    : Math.max(0, numberOf(data.balance));
  const dueDate = dateOf(data.dueDate);
  const rawStatus = String(invoice?.status || data.status || "OPEN").toUpperCase();
  const status = rawStatus === "PAID" || storedBalance === 0
    ? "PAID"
    : (dueDate && dueDate < now ? "OVERDUE" : rawStatus === "PARTIAL" ? "PARTIAL" : "OPEN");

  return { amount, originalAmount, creditNotes, debitNotes, balance: storedBalance, dueDate, status };
}

export function financeAgingSegment(dueDate, now = new Date()) {
  if (!dueDate || dueDate >= now) return { code: "POR_VENCER", label: "Por vencer", daysPastDue: 0, action: "Monitoreo preventivo" };
  const daysPastDue = Math.max(0, Math.floor((now.getTime() - dueDate.getTime()) / DAY_MS));
  if (daysPastDue <= 7) return { code: "1_7", label: "1–7 días", daysPastDue, action: "Cobranza preventiva" };
  if (daysPastDue <= 30) return { code: "8_30", label: "8–30 días", daysPastDue, action: "Cobranza activa" };
  if (daysPastDue <= 60) return { code: "31_60", label: "31–60 días", daysPastDue, action: "Cobranza intensiva" };
  if (daysPastDue <= 90) return { code: "61_90", label: "61–90 días", daysPastDue, action: "Cobranza crítica" };
  return { code: "MAS_90", label: "+90 días", daysPastDue, action: "Gestión especial" };
}

export function scoreFinanceReconciliation(invoice, movement, now = new Date()) {
  const invoiceData = dataOf(invoice);
  const movementData = dataOf(movement);
  const financial = getInvoiceFinancialState(invoice, now);
  const movementAmount = Math.abs(numberOf(movementData.amount));
  const difference = Math.abs(financial.balance - movementAmount);
  const reasons = [];
  const evidence = [];
  const limitations = [];
  let score = 0;

  const addEvidence = (code, label, weight, detail) => {
    reasons.push(label);
    evidence.push({ code, label, weight, detail });
  };

  if (financial.balance > 0 && difference <= 1) {
    score += 62;
    addEvidence("EXACT_AMOUNT", "Monto exacto", 62, `El abono coincide con el saldo pendiente (${financial.balance}).`);
  } else if (financial.balance > 0 && difference / financial.balance <= 0.01) {
    score += 50;
    addEvidence("NEAR_AMOUNT", "Monto muy cercano", 50, `La diferencia es ${difference}, dentro de una tolerancia máxima de 1%.`);
  } else if (financial.balance > 0 && movementAmount > 0 && movementAmount < financial.balance) {
    score += 24;
    addEvidence("PARTIAL_AMOUNT", "Posible pago parcial", 24, `El abono cubre ${movementAmount} de un saldo pendiente de ${financial.balance}.`);
  } else if (financial.balance > 0) {
    limitations.push(`El monto no cuadra: diferencia de ${difference} respecto del saldo pendiente.`);
  }

  const reference = `${movementData.reference || ""} ${movement.title || ""}`;
  const invoiceNumber = invoiceData.invoiceNumber || invoiceData.number || invoice.title;
  if (invoiceNumber && normalizeText(reference).includes(normalizeText(invoiceNumber))) {
    score += 18;
    addEvidence("INVOICE_REFERENCE", "Referencia de factura", 18, `La referencia bancaria contiene “${invoiceNumber}”.`);
  } else {
    limitations.push("La cartola no contiene una referencia verificable al folio del documento.");
  }

  const invoiceRut = invoiceData.clientRut || invoiceData.customerRut || invoiceData.rut || invoiceData.partyRut;
  if (invoiceRut && movementData.rut && normalizeText(invoiceRut) === normalizeText(movementData.rut)) {
    score += 12;
    addEvidence("RUT_MATCH", "RUT coincidente", 12, `El RUT de la contraparte coincide con ${invoiceRut}.`);
  } else if (invoiceRut && !movementData.rut) {
    limitations.push("El movimiento bancario no informa RUT de contraparte.");
  } else if (invoiceRut && movementData.rut) {
    limitations.push("El RUT informado por el movimiento no coincide con el documento.");
  }

  const customerName = invoiceData.customerName || invoiceData.clientName || invoiceData.customer || invoiceData.partyName || invoice.title;
  if (sharesTerm(customerName, movementData.payerName || movementData.counterparty || reference)) {
    score += 10;
    addEvidence("PARTY_MATCH", "Cliente o razon social coincidente", 10, `La descripción del abono coincide con ${customerName}.`);
  } else {
    limitations.push("No se encontró coincidencia clara de razón social en la descripción bancaria.");
  }

  const movementDate = dateOf(movementData.transactionDate || movementData.date);
  if (financial.dueDate && movementDate) {
    const days = Math.abs(financial.dueDate.getTime() - movementDate.getTime()) / DAY_MS;
    if (days <= 10) {
      score += 5;
      addEvidence("DATE_MATCH", "Fecha compatible", 5, `El movimiento ocurrió a ${Math.round(days)} día(s) del vencimiento.`);
    } else {
      limitations.push(`La fecha del movimiento está a ${Math.round(days)} día(s) del vencimiento.`);
    }
  } else if (!movementDate) {
    limitations.push("El movimiento no informa fecha para validar cercanía al vencimiento.");
  }

  const confidence = Math.min(99, Math.round(score));
  const partial = movementAmount > 0 && movementAmount < financial.balance;
  const overpayment = movementAmount > financial.balance + 1;
  const recommendedAction = overpayment || partial || confidence < 80
    ? "REVISAR_MANUALMENTE"
    : confidence >= 95
      ? "LISTA_PARA_APROBACION"
      : "VALIDAR_ANTES_DE_CONFIRMAR";

  return {
    invoiceId: invoice.id,
    movementId: movement.id,
    confidence,
    difference,
    partial,
    overpayment,
    reasons,
    evidence,
    limitations: [...new Set(limitations)],
    recommendedAction,
    explanation: evidence.length
      ? `${evidence.length} evidencia(s) respaldan la sugerencia; ${limitations.length} aspecto(s) deben considerarse antes de confirmar.`
      : "No hay evidencia suficiente para proponer una conciliación automática.",
    invoice,
    movement
  };
}

function agingBucket(dueDate, now = new Date()) {
  const code = financeAgingSegment(dueDate, now).code;
  return ({ POR_VENCER: "No vencida", "1_7": "1-7 dias", "8_30": "8-30 dias", "31_60": "31-60 dias", "61_90": "61-90 dias", MAS_90: "+90 dias" })[code] || "No vencida";
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
  const aging = { "No vencida": 0, "1-7 dias": 0, "8-30 dias": 0, "31-60 dias": 0, "61-90 dias": 0, "+90 dias": 0 };
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
  const promiseCollections = collectionCases.filter((record) => Boolean(dataOf(record).promiseDate || dataOf(record).promiseDueDate || dataOf(record).promiseAmount)).length;
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
    // `label` es el contrato del frontend; `bucket` se mantiene por compatibilidad
    // con integraciones ya construidas.
    aging: Object.entries(aging).map(([bucket, amount]) => ({ label: bucket, bucket, amount })),
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
  const maxResults = Math.max(1, Math.min(Number(limit) || 30, 200));
  const serializable = (record) => ({ id: record.id, title: record.title, data: dataOf(record), status: record.status });
  const results = [];

  for (const movement of movements) {
    const movementData = dataOf(movement);
    const status = String(movement.status || movementData.status || "UNRECONCILED").toUpperCase();
    const kind = String(movementData.movementKind || "").toUpperCase();
    // Solo un abono externo puede liquidar una cuenta por cobrar. Comisiones,
    // egresos y traspasos propios se conservan para control, pero no se
    // proponen como pago de cliente.
    if (status === "MATCHED" || String(movementData.direction || "").toUpperCase() === "DEBIT" || ["COMMISSION_OR_FEE", "INTERNAL_TRANSFER"].includes(kind)) continue;

    const scored = openInvoices.map((invoice) => scoreFinanceReconciliation(invoice, movement))
      .filter((candidate) => candidate.confidence >= 35)
      .sort((left, right) => right.confidence - left.confidence);
    if (!scored.length) continue;

    let best = scored[0];
    const movementAmount = Math.abs(numberOf(movementData.amount));
    const pool = scored.slice(0, 12).filter((candidate) => getInvoiceFinancialState(candidate.invoice).balance > 0);
    let grouped = null;
    // Un pago agrupado puede cubrir dos o tres facturas. Se limita el pool y
    // el tamaño del grupo para ser determinista, explicable y seguro.
    for (let first = 0; first < pool.length && !grouped; first += 1) {
      for (let second = first + 1; second < pool.length && !grouped; second += 1) {
        const candidates = [pool[first], pool[second]];
        for (let third = second + 1; third < pool.length + 1; third += 1) {
          const group = third < pool.length ? [...candidates, pool[third]] : candidates;
          const total = group.reduce((sum, candidate) => sum + getInvoiceFinancialState(candidate.invoice).balance, 0);
          if (Math.abs(total - movementAmount) <= 1) {
            const confidence = Math.min(99, Math.max(88, Math.round(group.reduce((sum, candidate) => sum + candidate.confidence, 0) / group.length)));
            grouped = { group, total, confidence };
            break;
          }
        }
      }
    }
    if (grouped && (best.confidence < 95 || best.difference > 1)) {
      best = {
        ...best,
        confidence: grouped.confidence,
        difference: Math.abs(grouped.total - movementAmount),
        partial: false,
        grouped: true,
        invoiceIds: grouped.group.map((candidate) => candidate.invoice.id),
        invoices: grouped.group.map((candidate) => candidate.invoice),
        reasons: ["Pago agrupado", "Monto exacto entre documentos", ...grouped.group.flatMap((candidate) => candidate.reasons.filter((reason) => reason !== "Monto exacto")).slice(0, 3)],
        evidence: [
          { code: "GROUPED_PAYMENT", label: "Pago agrupado", weight: 40, detail: `El abono cubre exactamente ${grouped.group.length} documentos.` },
          ...grouped.group.flatMap((candidate) => candidate.evidence.filter((item) => item.code !== "EXACT_AMOUNT")).slice(0, 4)
        ],
        limitations: [],
        recommendedAction: "VALIDAR_ANTES_DE_CONFIRMAR",
        explanation: "El monto coincide con un grupo de documentos. Confirma que pertenecen al mismo pagador antes de aplicar la conciliación."
      };
    }
    const selectedInvoiceIds = new Set(best.grouped ? best.invoiceIds : [best.invoice.id]);
    const alternatives = scored
      .filter((candidate) => !selectedInvoiceIds.has(candidate.invoice.id))
      .slice(0, 3)
      .map((candidate) => ({
        invoiceId: candidate.invoice.id,
        documentNumber: dataOf(candidate.invoice).invoiceNumber || dataOf(candidate.invoice).documentNumber || candidate.invoice.title,
        partyName: dataOf(candidate.invoice).customerName || dataOf(candidate.invoice).clientName || dataOf(candidate.invoice).partyName || "Contraparte sin nombre",
        confidence: candidate.confidence,
        amountDifference: candidate.difference,
        reasons: candidate.reasons
      }));
    best = { ...best, candidateCount: scored.length, alternatives };
    results.push(best);
  }

  return results
    .sort((left, right) => right.confidence - left.confidence)
    .slice(0, maxResults)
    .map(({ invoice, movement, invoices: groupedInvoices, ...suggestion }) => {
      const confidence = Math.min(99, Math.round(suggestion.confidence));
      return {
        ...suggestion,
        confidence,
        level: confidence >= 95 ? "HIGH" : confidence >= 80 ? "MEDIUM" : "LOW",
        amountDifference: suggestion.difference,
        invoice: serializable(invoice),
        invoices: groupedInvoices ? groupedInvoices.map(serializable) : undefined,
        movement: serializable(movement)
      };
    });
}

export function financeRecordData(record) {
  return dataOf(record);
}
