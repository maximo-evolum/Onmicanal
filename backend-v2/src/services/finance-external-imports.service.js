import { createHash } from "node:crypto";
import { FinanceOperationError, findAllFinanceRecords, withFinanceWrite } from "./finance-integrity.service.js";
import { lockDocumentImportPeriods } from "./finance-document-periods.service.js";
import { assertBankPeriodsOpen } from "./finance-bank-periods.service.js";
import { normalizeFloidTransactions } from "./finance-floid.service.js";
import { bankMovementFingerprint } from "./finance-bank-statements.service.js";
import { financialDate } from "./finance-manual-writes.service.js";

const fail = (status, message) => { throw new FinanceOperationError(status, message); };
const dataOf = (row) => row?.data || {};
const fingerprint = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const snapshot = (invoice) => ({ title: invoice.title, status: invoice.status, data: Object.fromEntries(Object.entries(invoice.data).filter(([key]) => key !== "syncedAt").sort(([a], [b]) => a.localeCompare(b))) });

export function externalDocumentDate(value) {
  const raw = String(value || "").trim();
  // Keep the issuer's calendar date; do not shift it through UTC/local time.
  const date = /^\d{4}-\d{2}-\d{2}T/.test(raw) && Number.isFinite(Date.parse(raw)) ? raw.slice(0, 10) : raw;
  return financialDate(date);
}

export function nuboxScheduledOutcome(details) {
  const failed = Number(details?.failed || 0);
  const warnings = (details?.results || []).filter((r) => r.warning || r.analysis?.requiresReview).length;
  return failed || warnings
    ? { status: "FAILED", error: `${failed} empresa(s) no sincronizadas y ${warnings} con pasos posteriores pendientes. Revisa el detalle; las importaciones exitosas se conservaron.` }
    : { status: "COMPLETED", error: null };
}

// Fetch every page BEFORE starting a financial transaction. A malformed,
// repeated or incomplete response must never produce a partial import.
export async function collectNuboxSales(request, { period, limit = 100, maxRows = 20000 }) {
  const size = Math.max(1, Math.min(100, Number(limit) || 100));
  const sales = []; const ids = new Set(); let expected = null;
  for (let page = 1; page <= maxRows + 1; page++) {
    const result = await request(`/v1/sales?period=${encodeURIComponent(period)}&page=${page}&size=${size}`);
    const payload = result.payload;
    const rows = Array.isArray(payload) ? payload : ["content", "items", "data", "results"].map((key) => payload?.[key]).find(Array.isArray);
    if (!rows) fail(502, "Nubox devolvió una estructura desconocida. No se importaron documentos.");
    const total = Number(result.total || payload?.totalElements || payload?.total || 0);
    if (total > 0) {
      if (!Number.isSafeInteger(total) || (expected !== null && expected !== total)) fail(409, "El total de Nubox cambió durante la consulta. Reintenta la sincronización completa.");
      expected = total;
    }
    if (sales.length + rows.length > maxRows || total > maxRows) fail(413, "El período de Nubox supera el límite seguro de documentos. No se importó parcialmente.");
    for (const row of rows) {
      const id = String(row?.id ?? "").trim();
      if (!id || ids.has(id)) fail(502, "Nubox entregó documentos sin identificador o páginas repetidas. No se importó el lote.");
      ids.add(id); sales.push(row);
    }
    if (expected !== null && sales.length > expected) fail(502, "El total de documentos de Nubox no coincide con sus páginas.");
    if (expected !== null && sales.length === expected) return sales;
    if (rows.length < size) {
      if (expected !== null && sales.length !== expected) fail(502, "Faltan páginas de documentos de Nubox. No se importó el lote incompleto.");
      return sales;
    }
  }
  fail(413, "La consulta de Nubox excedió el límite de páginas; no se importaron documentos.");
}

export async function importNuboxDocuments(db, { tenantId, configId, period, invoices }) {
  if (!tenantId) fail(400, "Empresa requerida.");
  return withFinanceWrite(db, async (tx) => {
    const existing = await findAllFinanceRecords(tx, { where: { tenantId, recordType: "finance_invoice" } });
    const evidence = await findAllFinanceRecords(tx, { where: { tenantId, recordType: { in: ["finance_invoice_receipt", "finance_reconciliation", "finance_document_adjustment", "finance_opening_balance"] } } });
    const byId = new Map(existing.filter((r) => dataOf(r).nuboxDocumentId).map((r) => [String(r.data.nuboxDocumentId), r]));
    const seen = new Set(); const changes = []; let ignored = 0;
    for (const invoice of invoices) {
      const id = invoice.externalDocumentId; const d = invoice.data;
      if (!id || seen.has(id)) fail(422, "El lote Nubox contiene identificadores ausentes o repetidos.");
      seen.add(id);
      if (["56", "61"].includes(String(d.documentTypeCode))) fail(422, "El lote Nubox contiene notas de crédito/débito. Requieren el flujo de ajustes referenciados; no se trataron como facturas.");
      if (![d.amount, d.balance].every((value) => Number.isFinite(value) && value >= 0) || d.balance > d.amount) fail(422, "Nubox entregó montos o saldos inconsistentes.");
      const current = byId.get(id); const hash = fingerprint(snapshot(invoice)); const old = dataOf(current);
      if (old.nuboxSnapshotHash === hash) { ignored++; continue; }
      if (current) {
        const linked = evidence.some((r) => [r.data?.invoiceId, r.data?.documentId, ...(Array.isArray(r.data?.allocations) ? r.data.allocations : []).map((a) => a.invoiceId || a.documentId)].includes(current.id));
        const local = linked || old.lastManualPaymentId || old.lastAdjustmentId || old.reconciliationId || Number(old.paidAmount || 0) > 0 || Number(old.creditNotesTotal || 0) > 0 || Number(old.debitNotesTotal || 0) > 0;
        if (local) fail(409, `El documento ${d.invoiceNumber} tiene pagos, ajustes o conciliaciones locales. Requiere revisión antes de reemplazar sus datos con Nubox.`);
      }
      changes.push({ invoice, current, hash });
    }
    await lockDocumentImportPeriods(tx, tenantId, changes.map((c) => c.invoice), changes.filter((c) => c.current).map((c) => c.current), "NUBOX");
    let created = 0; let updated = 0;
    for (const { invoice, current, hash } of changes) {
      const next = { title: invoice.title, status: invoice.status, data: { ...dataOf(current), ...invoice.data, status: invoice.status, nuboxSnapshotHash: hash } };
      if (current) { await tx.industryRecord.update({ where: { id: current.id }, data: next }); updated++; }
      else { await tx.industryRecord.create({ data: { tenantId, recordType: "finance_invoice", ...next } }); created++; }
    }
    const summary = { received: invoices.length, total: invoices.length, created, updated, ignored };
    if (changes.length) await tx.tenantAuditLog.create({ data: { tenantId, action: "FINANCE_NUBOX_DOCUMENTS_IMPORTED", entity: "tenant_channel_config", entityId: configId, metadata: { period, ...summary } } });
    return summary;
  });
}

export async function importFloidBankMovements(db, { tenantId, consentId, payload }) {
  return withFinanceWrite(db, async (tx) => {
    const consent = await tx.industryRecord.findFirst({ where: { id: consentId, tenantId, recordType: "finance_open_banking_consent" } });
    if (!consent) fail(404, "Consentimiento no encontrado.");
    const d = dataOf(consent); const normalized = normalizeFloidTransactions(payload, d.account || {});
    if (!normalized.caseId || normalized.caseId !== d.caseId) fail(409, "La respuesta no corresponde al consentimiento bancario.");
    const hash = fingerprint(normalized.movements);
    if (consent.status === "SYNCED" && d.lastPayloadHash === hash) return { ...d.lastSyncSummary, batch: null, consent, summary: normalized.summary, replay: true };
    if (!["PENDING", "PROCESSING"].includes(consent.status)) fail(409, "El consentimiento ya fue procesado o no está activo. Genera una nueva autorización.");
    if (!normalized.movements.length) fail(422, "Flöid no entregó movimientos para esta autorización.");
    const existing = await findAllFinanceRecords(tx, { where: { tenantId, recordType: { in: ["bank_movement", "finance_exception"] } } });
    const known = new Map(existing.flatMap((r) => { const m = r.recordType === "bank_movement" ? dataOf(r) : dataOf(r).movement; return m ? [[m.fingerprint || bankMovementFingerprint(m), m]] : []; }));
    const unique = []; const review = []; let duplicates = 0;
    for (const movement of normalized.movements) {
      if (known.has(movement.fingerprint)) {
        const old = known.get(movement.fingerprint);
        if (old.direction && old.direction !== movement.direction) fail(409, "Un movimiento repetido tiene distinto cargo/abono. Revisa el origen; no se descartó la diferencia.");
        duplicates++; continue;
      }
      known.set(movement.fingerprint, movement);
      (movement.needsReview ? review : unique).push(movement);
    }
    await assertBankPeriodsOpen(tx, tenantId, [...unique, ...review], "Banca abierta");
    const importedAt = new Date().toISOString(); const summary = { imported: unique.length, duplicates, requiresReview: review.length };
    let batch = null;
    if (unique.length || review.length) {
      batch = await tx.industryRecord.create({ data: { tenantId, recordType: "bank_statement", title: `Banca abierta · ${d.caseId}`, status: "IMPORTED", data: { source: "floid_open_banking", consentId, caseId: d.caseId, account: d.account, summary: normalized.summary, importedAt, importedRows: unique.length, duplicateRows: duplicates, reviewRows: review.length } } });
      for (const movement of unique) await tx.industryRecord.create({ data: { tenantId, recordType: "bank_movement", title: `${movement.transactionDate} · ${movement.description}`.slice(0, 220), status: "PENDING", data: { ...movement, importBatchId: batch.id, sourceBatchId: batch.id, consentId, caseId: d.caseId, importedAt } } });
      for (const movement of review) await tx.industryRecord.create({ data: { tenantId, recordType: "finance_exception", title: `Revisar banca abierta · ${movement.description}`.slice(0, 220), status: "OPEN", data: { type: "OPEN_BANKING_IMPORT_REVIEW", priority: "MEDIUM", detail: movement.reviewReasons.join(", "), movement, importBatchId: batch.id, consentId, caseId: d.caseId } } });
    }
    const updated = await tx.industryRecord.update({ where: { id: consentId }, data: { status: "SYNCED", data: { ...d, lastPayloadHash: hash, lastSyncAt: importedAt, lastSyncSummary: summary, lastProviderStatus: normalized.status } } });
    await tx.tenantAuditLog.create({ data: { tenantId, action: "FINANCE_FLOID_WEBHOOK_IMPORTED", entity: "finance_open_banking_consent", entityId: consentId, metadata: { caseId: d.caseId, ...summary } } });
    return { ...summary, batch, consent: updated, summary: normalized.summary };
  });
}
