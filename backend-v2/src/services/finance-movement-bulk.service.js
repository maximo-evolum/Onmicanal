import { FinanceOperationError } from "./finance-integrity.service.js";
import { sendFinanceMovementToReview } from "./finance-allocation.service.js";
export async function reviewMovementBatch(db, { tenantId, userId, items, reason, operationKey }, review = sendFinanceMovementToReview) {
  if (!Array.isArray(items) || !items.length || items.length > 25 || new Set(items.map((i) => i?.id)).size !== items.length || items.some((i) => !i?.id || typeof i.id !== "string" || i.id.length > 160 || typeof i.version !== "string" || !Number.isFinite(Date.parse(i.version)))) throw new FinanceOperationError(400, "Selecciona entre 1 y 25 movimientos distintos con su versión vigente.");
  const detail = String(reason || "").trim();
  if (detail.length < 10 || detail.length > 1000 || !/^[a-zA-Z0-9_-]{16,100}$/.test(String(operationKey || ""))) throw new FinanceOperationError(400, "Se requiere un motivo de 10 a 1000 caracteres e identificador de operación.");
  const results = [];
  for (const item of items) {
    try {
      const result = await review(db, { tenantId, userId, movementId: item.id, expectedVersion: item.version, detail, operationKey });
      results.push({ id: item.id, status: result.replayed ? "ALREADY_APPLIED" : "APPLIED", message: result.replayed ? "Este intento ya fue confirmado." : "Enviado a revisión." });
    } catch (error) {
      results.push({ id: item.id, status: error instanceof FinanceOperationError ? "BLOCKED" : "UNKNOWN", message: error instanceof FinanceOperationError ? error.message : "No se pudo confirmar el resultado. Reintenta el mismo lote." });
    }
  }
  return { operationKey, results };
}
