import { FinanceOperationError, findAllFinanceRecords, withFinanceWrite } from "./finance-integrity.service.js";
import { assertFinancePeriodOpen } from "./finance-period-control.service.js";

const dataOf = (row) => row?.data && typeof row.data === "object" ? row.data : row || {};
export function bankPeriodImpact(rows) {
  const periods = new Set(); const undatedRows = [];
  rows.forEach((row, index) => {
    const data = dataOf(row);
    const value = data.transactionDate || data.date || data.movement?.transactionDate || data.movement?.date;
    const date = value instanceof Date ? (Number.isFinite(value.getTime()) ? value.toISOString().slice(0, 10) : "") : String(value || "").slice(0, 10);
    if (!/^\d{4}-(0[1-9]|1[0-2])-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) {
      undatedRows.push(row.id || data.dataRow || data.rowNumber || index + 1); return;
    }
    periods.add(date.slice(0, 7));
  });
  return { periods: [...periods].sort(), undatedRows };
}

export async function bankPeriodRestrictions(db, tenantId, rows) {
  const impact = bankPeriodImpact(rows);
  const closed = impact.periods.length ? await db.financePeriodControl.findMany({ where: { tenantId, status: "CLOSED", period: { in: impact.periods } }, select: { period: true } }) : [];
  const closedPeriods = closed.map((row) => row.period).sort();
  const messages = [];
  if (impact.undatedRows.length) messages.push(`Hay ${impact.undatedRows.length} fila(s) sin fecha válida. Corrige sus fechas o exclúyelas con motivo antes de incorporar; no se puede determinar qué período afectarían.`);
  if (closedPeriods.length) messages.push(`Período(s) cerrado(s): ${closedPeriods.join(", ")}. Solicita su reapertura autorizada antes de modificar la cartola.`);
  return { ...impact, closedPeriods, blocked: Boolean(messages.length), message: messages.join(" ") };
}

// Called within the SAME Serializable transaction as the writes. Sorted locks
// keep multi-month statements from acquiring period rows in opposite order.
export async function assertBankPeriodsOpen(tx, tenantId, rows, sourceFile = "Cartola") {
  const impact = bankPeriodImpact(rows);
  if (impact.undatedRows.length) throw new FinanceOperationError(409, `${sourceFile}: no se puede determinar el período de ${impact.undatedRows.length} fila(s). Revisa las fechas antes de modificar datos.`, { invalidDateRows: impact.undatedRows.slice(0, 25), invalidDateCount: impact.undatedRows.length });
  for (const period of impact.periods) {
    try { await assertFinancePeriodOpen(tx, tenantId, period); }
    catch (error) {
      if (error instanceof FinanceOperationError) throw new FinanceOperationError(error.status, `${sourceFile}: ${error.message} No se modificó ningún movimiento de esta cartola.`, { closedPeriod: period });
      throw error;
    }
  }
  return impact;
}

export async function deleteBankStatementInOpenPeriods(db, { tenantId, userId, batchId }) {
  return withFinanceWrite(db, async (tx) => {
    const batch = await tx.industryRecord.findFirst({ where: { id: batchId, tenantId, recordType: "bank_statement" } });
    if (!batch) throw new FinanceOperationError(404, "Cartola no encontrada.");
    const data = dataOf(batch);
    if (!data.sourceFile || ["DELETED", "REPROCESSED"].includes(batch.status)) throw new FinanceOperationError(409, "Sólo se puede eliminar una cartola manual activa.");
    const [movements, exceptions] = await Promise.all([
      findAllFinanceRecords(tx, { where: { tenantId, recordType: "bank_movement", data: { path: ["importBatchId"], equals: batchId } } }),
      findAllFinanceRecords(tx, { where: { tenantId, recordType: "finance_exception", data: { path: ["importBatchId"], equals: batchId } } })
    ]);
    await assertBankPeriodsOpen(tx, tenantId, [...movements, ...exceptions], data.sourceFile);
    if (movements.some((row) => row.status === "MATCHED" || dataOf(row).reconciliationId || dataOf(row).reconciledAt)) throw new FinanceOperationError(409, "Esta cartola tiene movimientos conciliados. No se eliminó ningún dato.");
    const movementIds = movements.map((row) => row.id);
    const ids = new Set(movementIds);
    const reconciliations = await findAllFinanceRecords(tx, { where: { tenantId, recordType: "finance_reconciliation" } });
    if (reconciliations.some((row) => ids.has(dataOf(row).movementId))) throw new FinanceOperationError(409, "La cartola tiene historial de conciliaciones, incluso si fueron revertidas. Debe conservarse como evidencia; utiliza una corrección documentada, no la eliminación.");
    if (exceptions.length) await tx.industryRecord.deleteMany({ where: { tenantId, recordType: "finance_exception", id: { in: exceptions.map((row) => row.id) } } });
    if (movementIds.length) await tx.industryRecord.deleteMany({ where: { tenantId, recordType: "bank_movement", id: { in: movementIds } } });
    await tx.industryRecord.delete({ where: { id: batch.id } });
    await tx.tenantAuditLog.create({ data: { tenantId, actorUserId: userId || null, action: "FINANCE_BANK_STATEMENT_DELETED", entity: "bank_statement", entityId: batch.id,
      metadata: { sourceFile: data.sourceFile, originalId: data.originalId || null, importJobId: data.importJobId || null, deletedMovements: movementIds.length, deletedExceptions: exceptions.length, periods: bankPeriodImpact([...movements, ...exceptions]).periods } } });
    return { ok: true, deleted: { statementId: batch.id, movements: movementIds.length, exceptions: exceptions.length } };
  });
}
