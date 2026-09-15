import { FinanceOperationError, withFinanceWrite, findAllFinanceRecords } from "./finance-integrity.service.js";
import { MAX_MIGRATION_ROWS, normalizeHistoricalFinanceRows, summarizeHistoricalFinanceRows, historicalFinanceFingerprint } from "./finance-migration.service.js";
import { sanitizeSiiDteDocuments, summarizeSiiDteDocuments, siiDteFingerprint } from "./finance-sii-dte.service.js";
import { lockDocumentImportPeriods, dteTargetCandidates, applyImportedDteAdjustments } from "./finance-document-periods.service.js";
const cleanText = (value, fallback = "") => String(value ?? "").trim() || fallback;
const safeAmount = (value) => Math.max(0, Number(value) || 0);
const financeRecordData = (record) => record?.data || {};
const normalizedId = (value) => String(value || "").replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
function migrationIdentity(value) {
  const d = value.data || value;
  const side = value.recordType === "finance_payable" || d.documentSide === "SUPPLIER" || d.kind === "PAYABLE" ? "SUPPLIER" : "CUSTOMER";
  const party = d.rut || d.partyRut || d.clientRut || d.customerRut || d.supplierRut || d.partyName || d.customerName || d.clientName || d.supplierName;
  const folio = d.documentNumber || d.invoiceNumber;
  return party && folio ? [side, normalizedId(party), String(folio)].join("|") : "";
}
function dteIdentity(value) {
  const d = value.data || value;
  return d.emitterRut && d.receiverRut && d.documentNumber && d.documentTypeCode ? [normalizedId(d.emitterRut), normalizedId(d.receiverRut), d.documentTypeCode, d.documentNumber].join("|") : "";
}

export async function importHistoricalDocuments(db, { tenantId, userId, ...input }) {
    const sourceFile = (cleanText(input.sourceFile) || "migracion-historica.csv").slice(0, 180);
    const rows = normalizeHistoricalFinanceRows(input.rows, { limit: MAX_MIGRATION_ROWS });
    if (!rows.length) throw new FinanceOperationError(400, "No se detectaron filas para importar.");
    return withFinanceWrite(db, async (tx) => {
    const summary = summarizeHistoricalFinanceRows(rows);
    const importedAt = new Date().toISOString();
    const existingDocuments = await findAllFinanceRecords(tx, {
      where: { tenantId: tenantId, recordType: { in: ["finance_invoice", "finance_payable", "finance_exception"] } },
      select: { id: true, recordType: true, data: true }, take: 10000, orderBy: { updatedAt: "desc" }
    });
    const knownFingerprints = new Set(existingDocuments.map((record) => {
      const data = financeRecordData(record);
      return cleanText(data.migrationFingerprint) || historicalFinanceFingerprint({
        kind: record.recordType === "finance_payable" || data.documentSide === "SUPPLIER" ? "PAYABLE" : "RECEIVABLE", documentNumber: data.documentNumber || data.invoiceNumber,
        rut: data.clientRut || data.customerRut || data.supplierRut || data.rut, amount: data.amount, issueDate: data.issueDate, partyName: data.customerName || data.clientName || data.supplierName
      });
    }).filter(Boolean));
    const seenFingerprints = new Set();
    const identities = new Set(existingDocuments.map(migrationIdentity).filter(Boolean));
    const importableRows = [];
    let duplicateRows = 0;
    for (const row of rows) {
      const hasStableIdentity = Boolean(cleanText(row.documentNumber) && cleanText(row.partyName) && safeAmount(row.amount) > 0);
      if (hasStableIdentity && (knownFingerprints.has(row.fingerprint) || seenFingerprints.has(row.fingerprint))) { duplicateRows += 1; continue; }
      const identity = migrationIdentity(row);
      if (hasStableIdentity && identity && identities.has(identity)) throw new FinanceOperationError(409, `El documento ${row.documentNumber} ya existe con datos diferentes. Revisa el historial; no se importó el lote.`);
      if (hasStableIdentity && identity) identities.add(identity);
      if (hasStableIdentity) seenFingerprints.add(row.fingerprint);
      importableRows.push(row);
    }
    if (!importableRows.length) return { imported: 0, duplicateRows, requiresReview: 0, summary };
    const periods = await lockDocumentImportPeriods(tx, tenantId, importableRows);
    const batch = await (async () => {
      const batchRecord = await tx.industryRecord.create({
        data: {
          tenantId: tenantId,
          recordType: "finance_migration_batch",
          title: `Migración histórica · ${sourceFile}`.slice(0, 220),
          status: "COMPLETED",
          data: { sourceFile, totalRows: rows.length, reviewRows: summary.reviewRows, duplicateRows, summary, importedAt, importedById: userId || null }
        }
      });
      const records = [];
      for (const row of importableRows) {
        const historicalData = {
          documentSide: row.documentSide,
          direction: row.kind === "PAYABLE" ? "PURCHASE" : "SALE",
          documentNumber: row.documentNumber,
          invoiceNumber: row.kind === "RECEIVABLE" ? row.documentNumber : undefined,
          documentType: row.documentType,
          documentTypeCode: row.documentTypeCode,
          customerName: row.kind === "RECEIVABLE" ? row.partyName : undefined,
          supplierName: row.kind === "PAYABLE" ? row.partyName : undefined,
          clientRut: row.kind === "RECEIVABLE" ? row.rut : undefined,
          supplierRut: row.kind === "PAYABLE" ? row.rut : undefined,
          partyName: row.partyName,
          partyRut: row.rut,
          category: row.category,
          netAmount: row.netAmount,
          vatAmount: row.vatAmount,
          amount: row.amount,
          totalAmount: row.totalAmount || row.amount,
          balance: row.balance,
          paidAmount: row.paidAmount,
          issueDate: row.issueDate,
          dueDate: row.dueDate,
          paymentDate: row.paymentDate,
          paymentMethod: row.paymentMethod,
          paymentIntermediary: row.paymentIntermediary,
          commissionAmount: row.commissionAmount,
          settlementReference: row.settlementReference,
          creditNotesTotal: row.creditNotesTotal,
          debitNotesTotal: row.debitNotesTotal,
          referenceDocumentType: row.referenceDocumentType,
          referenceDocumentNumber: row.referenceDocumentNumber,
          referenceDocumentDate: row.referenceDocumentDate,
          currency: row.currency,
          status: row.status,
          source: "historical_migration",
          sourceFile,
          migrationBatchId: batchRecord.id,
          migrationRow: row.rowNumber,
          isHistorical: true,
          needsReview: row.needsReview,
          reviewReasons: row.reviewReasons,
          sourceStatus: row.sourceStatus,
          migrationFingerprint: row.fingerprint,
          sourceRow: row.source
        };
        const created = await tx.industryRecord.create({
          data: {
            tenantId: tenantId,
            recordType: row.needsReview ? "finance_exception" : row.recordType,
            title: row.needsReview
              ? `Revisar migración fila ${row.rowNumber} · ${row.partyName || "sin contraparte"}`.slice(0, 220)
              : `${row.kind === "PAYABLE" ? "Cuenta por pagar" : "Factura"} ${row.documentNumber} · ${row.partyName}`.slice(0, 220),
            status: row.needsReview ? "OPEN" : row.status,
            data: row.needsReview
              ? { type: "MIGRATION_REVIEW", detail: `Faltan: ${row.reviewReasons.join(", ")}`, priority: "MEDIUM", ...historicalData }
              : historicalData
          }
        });
        records.push(created);
        // Un saldo histórico puede ser parcialmente o totalmente pagado. Se
        // conserva un comprobante interno para que el saldo inicial sea
        // auditable sin inventar una cartola bancaria ni un medio de pago.
        if (!row.needsReview && row.paidAmount > 0) {
          await tx.industryRecord.create({ data: {
            tenantId: tenantId,
            recordType: row.paymentDate ? (row.kind === "PAYABLE" ? "finance_payable_payment" : "finance_invoice_receipt") : "finance_opening_balance",
            title: `${row.kind === "PAYABLE" ? "Pago histórico" : "Cobro histórico"} ${row.documentNumber}`.slice(0, 220),
            status: "MIGRATED",
            data: { [row.kind === "PAYABLE" ? "payableId" : "invoiceId"]: created.id, amount: row.paidAmount, paymentDate: row.paymentDate || null, issueDate: row.issueDate, isOpeningBalance: !row.paymentDate, source: "historical_migration", migrationBatchId: batchRecord.id, migrationRow: row.rowNumber, note: "Saldo inicial importado; requiere respaldo externo si se necesita comprobante bancario." }
          } });
        }
      }
      await tx.industryRecord.update({ where: { id: batchRecord.id }, data: { data: { ...financeRecordData(batchRecord), importedRows: records.length, reviewRows: importableRows.filter((row) => row.needsReview).length, exceptionRows: importableRows.filter((row) => row.needsReview).length } } });
      return { batch: batchRecord, records };
    })();
    const requiresReview = importableRows.filter((row) => row.needsReview).length;
    await tx.tenantAuditLog.create({ data: { tenantId, actorUserId: userId || null, action: "FINANCE_HISTORICAL_MIGRATION_IMPORTED", entity: "finance_migration_batch", entityId: batch.batch.id, metadata: { sourceFile, totalRows: rows.length, imported: batch.records.length, duplicateRows, periods } } });
    return { batch: batch.batch, summary, imported: batch.records.length, duplicateRows, requiresReview };
    });

}

export async function importSiiDocuments(db, { tenantId, userId, sii, ...input }) {
    const documents = sanitizeSiiDteDocuments(input.documents, { companyRut: sii.companyRut });
    if (!documents.length) throw new FinanceOperationError(400, "No se detectaron DTE para importar.");
    return withFinanceWrite(db, async (tx) => {
    const summary = summarizeSiiDteDocuments(documents);
    const existing = await findAllFinanceRecords(tx, {
      where: { tenantId: tenantId, recordType: { in: ["finance_invoice", "finance_payable", "finance_document_adjustment", "finance_exception"] } },
      select: { id: true, recordType: true, data: true }, take: 10000, orderBy: { createdAt: "desc" }
    });
    const known = new Set(existing.map((record) => {
      const data = financeRecordData(record);
      return cleanText(data.siiDteFingerprint || data.document?.fingerprint) || (data.emitterRut && data.receiverRut ? siiDteFingerprint(data) : "");
    }).filter(Boolean));
    const seen = new Set();
    const identities = new Set(existing.map(dteIdentity).filter(Boolean));
    const valid = [];
    const review = [];
    let duplicates = 0;
    for (const document of documents) {
      if (known.has(document.fingerprint) || seen.has(document.fingerprint)) { duplicates += 1; continue; }
      const identity = dteIdentity(document);
      if (identity && identities.has(identity)) throw new FinanceOperationError(409, `El DTE ${document.documentNumber} ya existe con fecha o monto diferente. No se duplicó ni sobrescribió el documento.`);
      if (identity) identities.add(identity);
      seen.add(document.fingerprint);
      if (document.needsReview) { review.push(document); continue; }
      valid.push(document);
    }
    const importedAt = new Date().toISOString();
    if (!valid.length && !review.length) return { imported: 0, duplicates, requiresReview: 0, summary };
    const targetDocuments = existing.filter((record) => ["finance_invoice", "finance_payable"].includes(record.recordType));
    const targets = valid.filter((document) => ["56", "61"].includes(String(document.documentTypeCode))).flatMap((document) => {
      const candidates = dteTargetCandidates(document, targetDocuments);
      return candidates.length === 1 ? candidates : [];
    });
    const periods = await lockDocumentImportPeriods(tx, tenantId, [...valid, ...review], targets, "DTE");
    const result = await (async () => {
      const batch = await tx.industryRecord.create({
        data: { tenantId: tenantId, recordType: "finance_sii_import_batch", title: `Importación DTE SII · ${importedAt.slice(0, 10)}`, status: "COMPLETED", data: { companyRut: sii.companyRut, environment: sii.environment, importedAt, summary, importedRows: valid.length, duplicateRows: duplicates, reviewRows: review.length } }
      });
      if (valid.length) await tx.industryRecord.createMany({ data: valid.map((document) => {
        const isSupplier = document.side === "SUPPLIER";
        const isAdjustment = ["56", "61"].includes(String(document.documentTypeCode));
        return {
          tenantId: tenantId,
          recordType: isAdjustment ? "finance_document_adjustment" : (isSupplier ? "finance_payable" : "finance_invoice"),
          title: `${document.documentTypeName} ${document.documentNumber} · ${document.partyName}`.slice(0, 220),
          status: isAdjustment ? "PENDING_LINK" : "OPEN",
          data: {
            source: "sii_dte_xml", siiDteFingerprint: document.fingerprint, siiImportBatchId: batch.id, sourceFile: document.sourceFile,
            documentSide: document.side, direction: isAdjustment ? (document.documentTypeCode === "61" ? "CREDIT_NOTE" : "DEBIT_NOTE") : (isSupplier ? "PURCHASE" : "SALE"), documentNumber: document.documentNumber,
            adjustmentType: isAdjustment ? (document.documentTypeCode === "61" ? "CREDIT_NOTE" : "DEBIT_NOTE") : undefined,
            referenceDocumentType: document.referenceDocumentType, referenceDocumentNumber: document.referenceDocumentNumber, referenceDocumentDate: document.referenceDocumentDate,
            invoiceNumber: isSupplier ? undefined : document.documentNumber, documentTypeCode: document.documentTypeCode, documentTypeName: document.documentTypeName,
            emitterRut: document.emitterRut, emitterName: document.emitterName, receiverRut: document.receiverRut, receiverName: document.receiverName,
            customerName: isSupplier ? undefined : document.partyName, customerRut: isSupplier ? undefined : document.partyRut,
            clientName: isSupplier ? undefined : document.partyName, clientRut: isSupplier ? undefined : document.partyRut,
            supplierName: isSupplier ? document.partyName : undefined, supplierRut: isSupplier ? document.partyRut : undefined,
            rut: document.partyRut, issueDate: document.issueDate, netAmount: document.netAmount, vatAmount: document.vatAmount,
            amount: document.amount, totalAmount: document.amount, balance: isAdjustment ? 0 : document.amount, paidAmount: 0, currency: "CLP", importedAt
          }
        };
      }) });
      const pendingAdjustments = await applyImportedDteAdjustments(tx, tenantId, batch.id, importedAt);
      if (pendingAdjustments) await tx.industryRecord.update({ where: { id: batch.id }, data: { data: { ...batch.data, reviewRows: review.length + pendingAdjustments, pendingAdjustments } } });
      if (review.length) await tx.industryRecord.createMany({ data: review.map((document) => ({
        tenantId: tenantId, recordType: "finance_exception", title: `Revisar DTE ${document.documentNumber || "sin folio"} · ${document.sourceFile}`.slice(0, 220), status: "OPEN",
        data: { type: "SII_DTE_IMPORT_REVIEW", priority: "MEDIUM", detail: `Faltan: ${document.reviewReasons.join(", ")}`, source: "sii_dte_xml", siiImportBatchId: batch.id, issueDate: document.issueDate, siiDteFingerprint: document.fingerprint, document }
      })) });
      return { batch, imported: valid.length, requiresReview: review.length + pendingAdjustments };
    })();
    await tx.tenantAuditLog.create({ data: { tenantId, actorUserId: userId || null, action: "FINANCE_SII_DTE_IMPORTED", entity: "finance_sii_import_batch", entityId: result.batch.id, metadata: { imported: result.imported, duplicates, requiresReview: result.requiresReview, companyRut: sii.companyRut, environment: sii.environment, periods } } });
    return { ...result, duplicates, summary };
    });

}
