import { FinanceOperationError, findAllFinanceRecords, withFinanceWrite } from "./finance-integrity.service.js";
import { analyzeHistoricalRecord, historicalTarget, historicalDay, historicalVersion, HISTORICAL_TYPES } from "./finance-historical-quality.service.js";
import { assertFinancePeriodOpen } from "./finance-period-control.service.js";
import { financeDocumentState, financeDocumentSide } from "./finance-document-values.service.js";
import { financeRecordAccount } from "./finance-context.service.js";
import { classifyFinanceMovement } from "./finance-movement-classification.service.js";
import { bankMovementFingerprint } from "./finance-bank-statements.service.js";
import { CHILEAN_FINANCIAL_INSTITUTIONS } from "../lib/finance-integrations.js";

const text = (v) => String(v ?? "").trim();
const fail = (status, message) => { throw new FinanceOperationError(status, message); };
const fields = ["issueDate", "dueDate", "documentNumber", "partyName", "amount", "balance", "paidAmount", "creditNotesTotal", "debitNotesTotal", "currency", "transactionDate", "direction", "description", "bankKey", "accountAlias", "accountLast4", "accountType", "reference"];
export function historicalAccess(record, access) {
  const target = historicalTarget(record);
  if (record.recordType === "finance_exception" && !access.exceptions) return false;
  return ["bank_statement", "bank_movement"].includes(target) ? access.bank : target === "finance_payable" || financeDocumentSide(record) === "SUPPLIER" ? access.suppliers : access.customers;
}
export async function listHistoricalReview(db, { tenantId, access, page = 1, query = "" }) {
  if (!tenantId) fail(401, "Falta la empresa autenticada.");
  page = Number(page); if (!Number.isSafeInteger(page) || page < 1) fail(400, "Página inválida.");
  const records = await findAllFinanceRecords(db, { where: { tenantId, recordType: { in: HISTORICAL_TYPES } } });
  const index = new Map(records.map((r) => [r.id, r]));
  const results = records.filter((r) => historicalAccess(r, access)).flatMap((r) => {
    const a = analyzeHistoricalRecord(r, index); if (!a?.issues.length) return [];
    const d = a.data, account = financeRecordAccount({ ...r, data: d }, index) || {}, m = classifyFinanceMovement(d);
    const supplier = financeDocumentSide({ ...r, recordType: a.target, data: d }) === "SUPPLIER";
    const values = a.document ? { issueDate: a.date, dueDate: historicalDay(d.dueDate), documentNumber: d.documentNumber || d.invoiceNumber || d.number || "", partyName: supplier ? d.supplierName || d.supplier || d.providerName || "" : d.customerName || d.customer || d.clientName || "", amount: d.amount ?? d.total ?? d.totalAmount, balance: d.balance, paidAmount: d.paidAmount, creditNotesTotal: d.creditNotesTotal ?? d.creditNoteAmount ?? 0, debitNotesTotal: d.debitNotesTotal ?? d.debitNoteAmount ?? 0, currency: d.currency || "" }
      : { transactionDate: a.date, amount: m.amount, direction: m.direction === "UNKNOWN" ? "" : m.direction, description: d.description || "", reference: d.reference || "", currency: d.currency || "", bankKey: account.bankKey || "", accountAlias: account.accountAlias || "", accountLast4: account.accountLast4 || "", accountType: account.accountType || "" };
    return [{ id: r.id, title: r.title, recordType: r.recordType, target: a.target, version: historicalVersion(r), issues: a.issues, values, source: { file: text(d.sourceFile), row: d.importRow || d.migrationRow || d.rowNumber || null, batchId: d.importBatchId || d.sourceBatchId || d.migrationBatchId || null }, lastReview: d.historicalReview || null }];
  }).filter((r) => !query || `${r.title} ${r.source.file} ${r.values.documentNumber || ""}`.toLocaleLowerCase("es").includes(text(query).toLocaleLowerCase("es"))).sort((a, b) => a.id.localeCompare(b.id));
  return { total: results.length, page, pages: Math.max(1, Math.ceil(results.length / 25)), records: results.slice((page - 1) * 25, page * 25 + 0), banks: CHILEAN_FINANCIAL_INSTITUTIONS.map((b) => ({ key: b.key, name: b.name })), scope: "Todos los períodos y monedas de la empresa; incluye registros sin fecha. No se infiere información desde la fecha de carga." };
}
function validAmount(v, label, positive = false) {
  if (v === null || v === "" || v === undefined || !["number", "string"].includes(typeof v)) fail(422, `${label}: indica el monto respaldado por el original.`);
  const n = Number(v); if (!Number.isSafeInteger(n) || n < 0 || (positive && n === 0)) fail(422, `${label}: debe ser un entero ${positive ? "positivo" : "no negativo"} en CLP.`); return n;
}
function correctionData(record, a, patch) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch) || Object.keys(patch).some((k) => !fields.includes(k))) fail(422, "La corrección contiene campos no permitidos.");
  const d = { ...a.data };
  for (const [key, value] of Object.entries(patch)) { if (typeof value === "object" && value !== null) fail(422, "Valores de corrección inválidos."); d[key] = value; }
  const dateKey = a.document ? "issueDate" : "transactionDate";
  if (!a.statement) {
    if (!historicalDay(d[dateKey])) fail(422, "Confirma una fecha de origen válida con el documento original.");
    d[dateKey] = historicalDay(d[dateKey]);
    if (d.currency !== "CLP") fail(422, "La corrección operativa admite CLP. No se convierten monedas ni se cambia una moneda extranjera a pesos.");
    if (a.data.currency && a.data.currency !== "CLP") fail(422, "No se permite reclasificar una moneda extranjera como CLP.");
  }
  if (a.document) {
    if (!text(d.partyName) || !text(d.documentNumber)) fail(422, "Indica contraparte y folio respaldados.");
    for (const key of ["partyName", "documentNumber"]) { d[key] = text(d[key]); if (d[key].length > 200) fail(422, "La contraparte o folio supera el largo permitido."); }
    d.amount = validAmount(d.amount, "Monto original", true); d.balance = validAmount(d.balance, "Saldo");
    d.creditNotesTotal = validAmount(d.creditNotesTotal ?? 0, "Notas de crédito"); d.debitNotesTotal = validAmount(d.debitNotesTotal ?? 0, "Notas de débito");
    d.paidAmount = validAmount(d.paidAmount, "Pagos históricos acumulados");
    if (d.dueDate && (!historicalDay(d.dueDate) || historicalDay(d.dueDate) < d.issueDate)) fail(422, "El vencimiento debe ser válido y no anterior a la emisión.");
    const supplier = financeDocumentSide({ ...record, recordType: a.target }) === "SUPPLIER";
    d[supplier ? "supplierName" : "customerName"] = d.partyName; d.invoiceNumber = supplier ? d.invoiceNumber : d.documentNumber;
    const s = financeDocumentState({ ...record, recordType: a.target, status: "OPEN", data: { ...d, status: "OPEN" } });
    if (!s.included) fail(422, `Los importes no cuadran: ${s.qualityIssues.join(" ")}`);
    d.status = s.status;
  } else {
    const bank = CHILEAN_FINANCIAL_INSTITUTIONS.find((b) => b.key === d.bankKey);
    if (!bank || !(text(d.accountAlias) && text(d.accountAlias).toLowerCase() !== "cuenta sin nombre") && !/^\d{4}$/.test(text(d.accountLast4))) fail(422, "Selecciona un banco y un alias identificable o los últimos cuatro dígitos.");
    if (d.accountLast4 && !/^\d{4}$/.test(text(d.accountLast4))) fail(422, "Los últimos dígitos deben ser cuatro números.");
    for (const key of ["accountAlias", "accountType", "description", "reference"]) { d[key] = text(d[key]); if (d[key].length > 500) fail(422, "El texto ingresado es demasiado largo."); }
    d.bank = bank.name;
    if (a.statement) d.account = { bankKey: d.bankKey, bank: d.bank, accountAlias: d.accountAlias, accountLast4: d.accountLast4 || null, accountType: d.accountType };
    else {
      d.amount = validAmount(d.amount, "Monto", true);
      if (!["CREDIT", "DEBIT"].includes(d.direction) || !d.description || d.description === "Movimiento sin descripción") fail(422, "Indica abono/cargo y la descripción original.");
      d.movementType = d.direction === "CREDIT" ? "ABONO" : "CARGO";
      d.fingerprint = bankMovementFingerprint(d); d.account = { bankKey: d.bankKey, bank: d.bank, accountAlias: d.accountAlias, accountLast4: d.accountLast4 || null, accountType: d.accountType };
    }
  }
  return d;
}
export async function correctHistoricalRecord(db, { tenantId, userId, id, version, patch, reason, evidence, confirmation, access }) {
  if (!tenantId || !userId) fail(401, "Se requiere sesión autenticada.");
  if (confirmation !== "CORREGIR") fail(422, "Confirma con CORREGIR.");
  for (const value of [reason, evidence]) if (text(value).length < 10 || text(value).length > 1500) fail(422, "Motivo y respaldo deben tener entre 10 y 1.500 caracteres.");
  return withFinanceWrite(db, async (tx) => {
    const record = await tx.industryRecord.findFirst({ where: { id, tenantId, recordType: { in: HISTORICAL_TYPES } } });
    if (!record || !historicalAccess(record, access)) fail(404, "Registro no disponible para esta empresa y sus módulos habilitados.");
    if (record.data?.correctedRecordId) fail(409, "Esta fila ya fue regularizada. Consulta su registro operativo; no se generó un duplicado.");
    if (historicalVersion(record) !== version) fail(409, "El registro cambió; actualiza antes de corregirlo.");
    const all = await findAllFinanceRecords(tx, { where: { tenantId, recordType: { in: [...HISTORICAL_TYPES, "finance_reconciliation", "finance_invoice_receipt", "finance_payable_payment", "finance_opening_balance", "finance_document_adjustment"] } } });
    const index = new Map(all.map((r) => [r.id, r])); const a = analyzeHistoricalRecord(record, index);
    if (!a?.issues.length) fail(409, "Este registro no requiere corrección histórica. Utiliza su flujo operativo habitual.");
    const affected = a.statement ? all.filter((r) => r.recordType === "bank_movement" && (r.data?.importBatchId || r.data?.sourceBatchId) === id && !["DELETED", "EXCLUDED"].includes(r.status)) : [];
    const affectedIds = new Set([id, ...affected.map((r) => r.id)]);
    const linked = all.some((r) => {
      if (!["finance_reconciliation", "finance_invoice_receipt", "finance_payable_payment", "finance_opening_balance", "finance_document_adjustment"].includes(r.recordType) || ["REVERSED", "CANCELLED", "REJECTED"].includes(r.status)) return false;
      const d = r.data || {}; return [d.invoiceId, d.payableId, d.movementId, d.documentId].some((key) => affectedIds.has(key)) || (Array.isArray(d.invoiceIds) && d.invoiceIds.some((key) => affectedIds.has(key))) || (Array.isArray(d.allocations) && d.allocations.some((v) => affectedIds.has(v.invoiceId)));
    });
    if (linked || [record, ...affected].some((r) => ["MATCHED", "RECONCILED"].includes(r.status) || r.data?.reconciliationId)) fail(409, "El registro tiene pagos, ajustes o conciliaciones asociados. Revierte o regulariza esos vínculos con su flujo autorizado antes de corregirlo.");
    if (!a.date) {
      const closed = await tx.financePeriodControl.findFirst({ where: { tenantId, status: "CLOSED" } });
      if (closed) fail(409, "El período original es desconocido y hay cierres vigentes. Revisión administrativa: reabre los cierres que pudieran verse afectados antes de corregir; no se asumirá un mes.");
    }
    const nextData = correctionData(record, a, patch);
    const nextDate = a.statement ? "" : historicalDay(nextData[a.document ? "issueDate" : "transactionDate"]);
    const dates = [a.date, nextDate].filter(Boolean);
    if (a.statement) for (const r of all) if ((r.data?.importBatchId || r.data?.sourceBatchId) === id) { const child = analyzeHistoricalRecord(r, index); if (child?.date) dates.push(child.date); else if (r.recordType === "bank_movement") fail(409, "La cartola tiene movimientos sin fecha. Corrige primero esos movimientos."); }
    for (const period of [...new Set(dates.map((d) => d.slice(0, 7)))].sort()) await assertFinancePeriodOpen(tx, tenantId, period);
    const duplicate = all.find((r) => r.id !== id && r.recordType === a.target && !["EXCLUDED", "DELETED"].includes(r.status) && (a.target === "bank_movement" ? bankMovementFingerprint(r.data || {}) === nextData.fingerprint : a.document && financeDocumentSide(r) === financeDocumentSide({ ...record, recordType: a.target }) && text(r.data?.documentNumber || r.data?.invoiceNumber) === nextData.documentNumber && historicalDay(r.data?.issueDate) === nextDate && text(r.data?.supplierName || r.data?.customerName || r.data?.clientName).toLowerCase() === nextData.partyName.toLowerCase()));
    if (duplicate) fail(409, `La corrección coincide con otro registro (${duplicate.title || duplicate.id}). Revisa duplicados; no se fusionó ni duplicó información.`);
    const at = new Date().toISOString();
    const data = { ...nextData, needsReview: false, reviewReasons: [], historicalReview: { at, userId, reason: text(reason), evidence: text(evidence), originalId: id } };
    let saved;
    if (record.recordType === "finance_exception") {
      saved = await tx.industryRecord.create({ data: { tenantId, recordType: a.target, title: record.title.replace(/^Revisar /, "Regularizado "), status: a.document ? data.status : "PENDING", data: { ...data, historicalSourceExceptionId: id } } });
      await tx.industryRecord.update({ where: { id }, data: { status: "RESOLVED", data: { ...record.data, correctedRecordId: saved.id, resolvedAt: at, resolvedById: userId, resolution: text(reason), historicalReview: data.historicalReview } } });
      if (a.document && data.paidAmount > 0) await tx.industryRecord.create({ data: { tenantId, recordType: "finance_opening_balance", title: `Saldo histórico respaldado · ${data.documentNumber}`, status: "MIGRATED", data: { [a.target === "finance_payable" ? "payableId" : "invoiceId"]: saved.id, amount: data.paidAmount, issueDate: data.issueDate, isOpeningBalance: true, source: "historical_correction", sourceExceptionId: id, evidence: text(evidence) } } });
    } else saved = await tx.industryRecord.update({ where: { id }, data: { data, status: a.document ? data.status : record.status } });
    const correction = await tx.industryRecord.create({ data: { tenantId, recordType: "finance_historical_correction", status: "APPLIED", title: `Corrección histórica · ${record.title}`.slice(0, 220), data: { sourceId: id, resultId: saved.id, before: { recordType: record.recordType, status: record.status, data: record.data }, after: { recordType: saved.recordType, status: saved.status, data: saved.data }, reason: text(reason), evidence: text(evidence), at, userId } } });
    await tx.tenantAuditLog.create({ data: { tenantId, actorUserId: userId, action: "FINANCE_HISTORICAL_RECORD_CORRECTED", entity: record.recordType, entityId: id, metadata: { correctionId: correction.id, resultId: saved.id, reason: text(reason), periods: [...new Set(dates.map((d) => d.slice(0, 7)))] } } });
    return { recordId: saved.id, correctionId: correction.id };
  });
}
