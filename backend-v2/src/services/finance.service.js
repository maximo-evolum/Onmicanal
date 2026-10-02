import { findAllFinanceRecords } from "./finance-integrity.service.js";
import { financeRecordRequiredModules } from './finance-record-access.service.js';
import { filterFinanceContext, parseFinanceContext } from "./finance-context.service.js";
import { overviewReconciliationMetrics, overviewCollectionSchedule } from "./finance-overview-metrics.service.js";
import { prisma } from "../lib/db.js";
import { financeDocumentState, summarizeFinanceDocuments, financeDocumentSide } from "./finance-document-values.service.js";

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
  const generic = new Set(["spa", "ltda", "limitada", "sociedad", "anonima", "empresa", "empresas", "comercial", "chile", "pago", "abono", "transferencia", "transf", "los", "las", "del"]);
  const meaningful = (value) => normalizeText(value).split(" ").filter((term) => term.length > 2 && !generic.has(term));
  const leftTerms = new Set(meaningful(left));
  return meaningful(right).some((term) => leftTerms.has(term));
}

const normalizedRut = (value) => String(value || "").replace(/[^0-9k]/gi, "").toUpperCase();
const invoiceParty = (data) => normalizedRut(data.clientRut || data.customerRut || data.rut || data.partyRut)
  || normalizeText(data.customerName || data.clientName || data.partyName);

export function sameFinanceInvoiceParty(invoices) {
  const parties = invoices.map((invoice) => invoiceParty(dataOf(invoice)));
  return parties.length > 0 && Boolean(parties[0]) && parties.every((party) => party === parties[0]);
}

export function hasFinanceIdentityEvidence(candidate) {
  return candidate.evidence.some((item) => ["RUT_MATCH", "INVOICE_REFERENCE", "PARTY_MATCH"].includes(item.code));
}

// Estos controles se comparten entre sugerencia y aprobación. Los anticipos
// requieren su propio expediente; no se imputan a una factura futura.
export function financeReconciliationBlockers(invoice, movement) {
  const doc = dataOf(invoice);
  const bank = dataOf(movement);
  const blockers = [];
  if (String(doc.currency || "CLP").toUpperCase() !== String(bank.currency || "CLP").toUpperCase()) blockers.push("La factura y el movimiento están expresados en monedas distintas; requiere revisión cambiaria.");
  const issue = dateOf(doc.issueDate || doc.emissionDate);
  const paid = dateOf(bank.transactionDate || bank.date);
  if (!issue) blockers.push("El documento no tiene fecha de emisión verificable.");
  if (!paid) blockers.push("El movimiento no tiene fecha verificable.");
  if (issue && paid && paid.toISOString().slice(0, 10) < issue.toISOString().slice(0, 10)) blockers.push("El abono es anterior a la emisión del documento. Debe revisarse como anticipo, no como pago de esta factura.");
  if (!["CREDIT", "ABONO"].includes(String(bank.direction || bank.movementType || "").toUpperCase())) blockers.push("No se ha identificado un abono bancario externo.");
  if (["ANNULLED", "CANCELLED", "REJECTED", "ANULADA"].includes(String(invoice.status || doc.status || "").toUpperCase())) blockers.push("El documento está anulado o rechazado.");
  if (financeDocumentSide(invoice) === "SUPPLIER") blockers.push("Un documento de proveedor no es una cuenta por cobrar a un cliente.");
  const state = financeDocumentState(invoice);
  if (!state.included) blockers.push("El documento requiere revisión o está fuera de la cartera operativa.", ...state.qualityIssues);
  if ([doc, bank].some((data) => data.demoOnly === true || Boolean(data.trainingRun) || data.isDemo === true || data.isSimulated === true || ["demo", "seed", "simulation"].includes(String(data.source || "").toLowerCase()))) blockers.push("Los datos de demostración no se concilian con documentos operativos.");
  const rut = normalizedRut(doc.clientRut || doc.customerRut || doc.rut || doc.partyRut);
  if (rut && bank.rut && rut !== normalizedRut(bank.rut)) blockers.push("El RUT del pagador es distinto del cliente; requiere identificar el pago por cuenta de terceros.");
  return blockers;
}

export function getInvoiceFinancialState(invoice, now = new Date()) {
  return financeDocumentState(invoice, now);
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
  const blockers = financeReconciliationBlockers(invoice, movement);
  const limitations = [...blockers];
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

  const reference = `${movementData.reference || ""} ${movementData.description || ""} ${movement.title || ""}`;
  const invoiceNumber = invoiceData.invoiceNumber || invoiceData.number || invoice.title;
  if (invoiceNumber && ` ${normalizeText(reference)} `.includes(` ${normalizeText(invoiceNumber)} `)) {
    score += 18;
    addEvidence("INVOICE_REFERENCE", "Referencia de factura", 18, `La referencia bancaria contiene “${invoiceNumber}”.`);
  } else {
    limitations.push("La cartola no contiene una referencia verificable al folio del documento.");
  }

  const invoiceRut = invoiceData.clientRut || invoiceData.customerRut || invoiceData.rut || invoiceData.partyRut;
  if (invoiceRut && movementData.rut && normalizedRut(invoiceRut) === normalizedRut(movementData.rut)) {
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

  const confidence = blockers.length ? 0 : Math.min(99, Math.round(score));
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
    eligible: blockers.length === 0,
    blockers,
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

export async function getFinanceOverview({ tenantId, now = new Date(), context = null, db = prisma, allowedModules = null }) {
  context = parseFinanceContext(context || {});
  const types = ["finance_invoice", "finance_payable", "finance_invoice_receipt", "bank_statement", "bank_movement", "finance_reconciliation", "finance_exception", "finance_collection_case", "finance_customer_credit", "finance_credit_application", "finance_reconciliation_difference", "finance_reconciliation_group"];
  const sourceRecords = await findAllFinanceRecords(db, {
    where: { tenantId, recordType: { in: types } },
    orderBy: { updatedAt: "desc" },
    take: 1000
  });
  const visible = allowedModules === null ? sourceRecords : sourceRecords.filter(r => {
    const required = financeRecordRequiredModules(r.recordType, r.data);
    return required.length > 0 && required.every(module => allowedModules.includes(module));
  });
  const restricted = allowedModules !== null && types.some(type => financeRecordRequiredModules(type).some(module => !allowedModules.includes(module)));
  const normalized = visible.map((r) => r.data?.sourceBatchId && !r.data.importBatchId ? { ...r, data: { ...r.data, importBatchId: r.data.sourceBatchId } } : r);
  const records = filterFinanceContext(normalized, context);
  const grouped = Object.fromEntries(types.map((type) => [type, records.filter((record) => record.recordType === type)]));
  const documents = summarizeFinanceDocuments(records, now);
  const invoices = documents.entries.filter((e) => e.side === "CUSTOMER" && e.state.included).map((e) => e.record);
  const movements = grouped.bank_movement;
  const reconciliations = grouped.finance_reconciliation;
  const exceptions = grouped.finance_exception;
  const collectionCases = grouped.finance_collection_case;

  const { issued, paid, pendingAmount: pending, overdueAmount: overdue } = documents.customers;
  const aging = { "No vencida": 0, "1-7 dias": 0, "8-30 dias": 0, "31-60 dias": 0, "61-90 dias": 0, "+90 dias": 0 };
  const dsoValues = [];

  for (const invoice of invoices) {
    const state = getInvoiceFinancialState(invoice, now);
    if (state.status !== "PAID") {
      const bucket = agingBucket(state.dueDate, now);
      aging[bucket] += state.balance;
    }
    const data = dataOf(invoice);
    const issuedAt = dateOf(data.issueDate);
    const paidAt = dateOf(data.paidAt);
    if (state.status === "PAID" && issuedAt && paidAt && paidAt >= issuedAt) dsoValues.push((paidAt.getTime() - issuedAt.getTime()) / DAY_MS);
  }

  const reconciliationMetrics = overviewReconciliationMetrics(movements, normalized.filter((r) => r.recordType === "finance_reconciliation"), normalized);
  const approvedReconciliations = reconciliationMetrics.matchedMovements;
  const openExceptions = exceptions.filter((record) => !["RESOLVED", "CLOSED"].includes(String(record.status).toUpperCase())).length;
  const criticalExceptions = exceptions.filter((record) => {
    const priority = String(dataOf(record).priority || "").toUpperCase();
    return !["RESOLVED", "CLOSED"].includes(String(record.status).toUpperCase()) && ["HIGH", "CRITICAL"].includes(priority);
  }).length;
  const openCollections = collectionCases.filter((record) => !["PAID", "CLOSED"].includes(String(record.status).toUpperCase())).length;
  const promiseCollections = collectionCases.filter((record) => Boolean(dataOf(record).promiseDate || dataOf(record).promiseDueDate || dataOf(record).promiseAmount)).length;
  const schedule = overviewCollectionSchedule(invoices, now, getInvoiceFinancialState);
  const expectedNext30 = schedule.next30Days;

  return {
    generatedAt: now.toISOString(),
    restricted,
    accessNote: restricted ? "Vista parcial según tus módulos habilitados. Los indicadores no representan la totalidad de la empresa." : null,
    context, schedule,
    documentQuality: summarizeFinanceDocuments(records.filter((r) => r.recordType === "finance_invoice" && financeDocumentSide(r) === "CUSTOMER"), now).excluded,
    scopeNote: "Facturas de clientes emitidas en el período seleccionado, con saldos actuales. Monto ajustado = total original − notas de crédito + notas de débito vinculadas. Cobrado = monto ajustado − saldo − diferencias justificadas; estas últimas no son dinero recibido. No equivale a cobros bancarios del mes. Se excluyen anuladas, notas independientes, proveedores y datos inconsistentes. La cuenta bancaria no filtra las facturas. No acredita cobertura ni reconstruye saldos históricos.",
    // Contract used by the Finance OS workspace. Keep the legacy kpis below
    // for backwards-compatible API consumers while exposing named domains.
    invoices: {
      total: invoices.length,
      justifiedDifferences: invoices.reduce((sum, invoice) => sum + getInvoiceFinancialState(invoice, now).justifiedDifference, 0),
      issued,
      paid,
      pending: documents.customers.pending,
      overdue: documents.customers.overdue,
      pendingAmount: pending,
      overdueAmount: overdue
    },
    collection: {
      rate: issued ? Number(((paid / issued) * 100).toFixed(1)) : 0,
      dsoDays: dsoValues.length ? Math.round(dsoValues.reduce((sum, value) => sum + value, 0) / dsoValues.length) : 0,
      dsoSampleSize: dsoValues.length,
      expectedNext30Days: expectedNext30
    },
    reconciliation: reconciliationMetrics,
    exceptions: { open: openExceptions, critical: criticalExceptions },
    collections: { open: openCollections, promises: promiseCollections },
    recent: { invoices: invoices.slice(0, 8).map((r) => ({ ...r, data: { ...dataOf(r), balance: getInvoiceFinancialState(r, now).balance } })), exceptions: exceptions.slice(0, 8), collectionCases: collectionCases.slice(0, 8) },
    // Connection health is permission-filtered by /finance/connection-health.
    // Never fabricate provider status from the presence of financial records.
    integrationReadiness: [],
    kpis: {
      invoices: invoices.length,
      issued,
      paid,
      pending,
      overdue,
      overdueRate: pending ? Number(((overdue / pending) * 100).toFixed(1)) : 0,
      dso: dsoValues.length ? Math.round(dsoValues.reduce((sum, value) => sum + value, 0) / dsoValues.length) : null,
      expectedNext30,
      unreconciledMovements: reconciliationMetrics.pendingMovements,
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
    integrationStatus: { source: "/finance/connection-health", status: "SEPARATE_QUERY_REQUIRED" }
  };
}

export async function getFinanceReconciliationSuggestions({ tenantId, movementId = null, limit = 30, context = null, db = prisma }) {
  const [invoices, movements] = await Promise.all([
    findAllFinanceRecords(db, { where: { tenantId, recordType: "finance_invoice" }, orderBy: { updatedAt: "desc" } }),
    findAllFinanceRecords(db, { where: { tenantId, recordType: "bank_movement", ...(movementId ? { id: movementId } : {}) }, orderBy: { updatedAt: "desc" } })
  ]);
  const eligibleRecords = filterFinanceContext([...invoices, ...movements], context, { documentMode: "outstanding" });
  const eligibleIds = new Set(eligibleRecords.map((record) => record.id));
  const openInvoices = invoices.filter((invoice) => eligibleIds.has(invoice.id) && getInvoiceFinancialState(invoice).status !== "PAID");
  // null is reserved for internal full-universe analysis, not a UI page size.
  const maxResults = limit === null ? Infinity : Math.max(1, Math.min(Number(limit) || 30, 200));
  const serializable = (record) => ({ id: record.id, title: record.title, data: dataOf(record), status: record.status });
  const results = [];

  for (const movement of movements) {
    if (!eligibleIds.has(movement.id)) continue;
    const movementData = dataOf(movement);
    const status = String(movement.status || movementData.status || "UNRECONCILED").toUpperCase();
    const kind = String(movementData.movementKind || "").toUpperCase();
    // Solo un abono externo puede liquidar una cuenta por cobrar. Comisiones,
    // egresos y traspasos propios se conservan para control, pero no se
    // proponen como pago de cliente.
    // Un movimiento ya conciliado o enviado a revisión no debe reaparecer como
    // una sugerencia activa. La revisión conserva el caso en Excepciones hasta
    // que una persona lo resuelva expresamente.
    if (["MATCHED", "REVIEW", "REJECTED"].includes(status) || String(movementData.direction || "").toUpperCase() === "DEBIT" || ["COMMISSION_OR_FEE", "INTERNAL_TRANSFER"].includes(kind)) continue;

    const scored = openInvoices.map((invoice) => scoreFinanceReconciliation(invoice, movement))
      .filter((candidate) => candidate.eligible && candidate.confidence >= 35 && hasFinanceIdentityEvidence(candidate))
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
          if (!sameFinanceInvoiceParty(group.map((candidate) => candidate.invoice))) continue;
          const total = group.reduce((sum, candidate) => sum + getInvoiceFinancialState(candidate.invoice).balance, 0);
          if (Math.abs(total - movementAmount) <= 1) {
            const confidence = Math.min(99, Math.round(group.reduce((sum, candidate) => sum + candidate.confidence, 0) / group.length));
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
        overpayment: false,
        grouped: true,
        invoiceIds: grouped.group.map((candidate) => candidate.invoice.id),
        invoices: grouped.group.map((candidate) => candidate.invoice),
        reasons: ["Pago agrupado", "Monto exacto entre documentos", ...grouped.group.flatMap((candidate) => candidate.reasons.filter((reason) => reason !== "Monto exacto")).slice(0, 3)],
        evidence: [
          { code: "GROUPED_PAYMENT", label: "Pago agrupado", weight: 40, detail: `El abono cubre exactamente ${grouped.group.length} documentos.` },
          ...grouped.group.flatMap((candidate) => candidate.evidence.filter((item) => item.code !== "EXACT_AMOUNT")).slice(0, 4)
        ],
        limitations: [...new Set(grouped.group.flatMap((candidate) => candidate.limitations))],
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
