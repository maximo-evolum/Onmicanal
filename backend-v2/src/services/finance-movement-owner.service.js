import { FinanceOperationError, withFinanceWrite } from "./finance-integrity.service.js";
import { canPerformFinanceAction, FINANCE_ACTIONS } from "./finance-security.service.js";
import { financialDate } from "./finance-manual-writes.service.js";
import { assertFinancePeriodOpen } from "./finance-period-control.service.js";
import { financeOperationalDate } from "./finance-context.service.js";
const fail = (status, message) => { throw new FinanceOperationError(status, message); };
const roles = ["SUPER_ADMIN", "OWNER", "ADMIN", "AGENT", "SELLER"];

export async function listMovementOwners(db, tenantId) {
  const users = []; let cursor;
  for (;;) {
    const page = await db.workspaceUser.findMany({ where: { tenantId, role: { in: roles } }, select: { id: true, name: true, isActive: true }, orderBy: { id: "asc" }, take: 500, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) });
    users.push(...page);
    if (page.length < 500) return users;
    cursor = page.at(-1).id;
  }
}

export async function assignMovementOwner(db, { tenantId, userId, role, movementId, assignedToId, expectedVersion, reason, operationKey }) {
  if (!canPerformFinanceAction(role, FINANCE_ACTIONS.CONFIGURE)) fail(403, "Solo administradores pueden asignar responsables.");
  if (!tenantId || !userId || !movementId) fail(400, "Falta la cuenta o el movimiento.");
  if (assignedToId !== null && (typeof assignedToId !== "string" || !assignedToId || assignedToId.length > 160)) fail(400, "Selecciona un responsable válido o Sin responsable.");
  reason = String(reason || "").trim();
  if (reason.length < 10 || reason.length > 1000 || !/^[a-zA-Z0-9_-]{16,100}$/.test(String(operationKey || "")) || typeof expectedVersion !== "string" || !Number.isFinite(Date.parse(expectedVersion))) fail(400, "Se requiere versión vigente, motivo de 10 a 1000 caracteres e identificador de operación.");
  return withFinanceWrite(db, async (tx) => {
    const movement = await tx.industryRecord.findFirst({ where: { tenantId, id: movementId, recordType: "bank_movement" } });
    if (!movement) fail(404, "Movimiento no encontrado en esta empresa.");
    const previous = await tx.tenantAuditLog.findFirst({ where: { tenantId, entityId: movementId, action: "FINANCE_MOVEMENT_OWNER_CHANGED", metadata: { path: ["operationKey"], equals: operationKey } } });
    if (previous) {
      if (previous.actorUserId !== userId || previous.metadata?.assignedToId !== assignedToId || previous.metadata?.reason !== reason) fail(409, "Este intento ya se utilizó con otros datos.");
      return { movementId, assignedToId: movement.assignedToId || null, version: new Date(movement.updatedAt).toISOString(), replayed: true };
    }
    if (new Date(movement.updatedAt).toISOString() !== expectedVersion) fail(409, "El movimiento cambió. Actualiza antes de asignar; no se sobrescribieron cambios.");
    if (["DELETED", "EXCLUDED"].includes(movement.status) || movement.data?.excluded) fail(409, "No se asigna trabajo a un movimiento eliminado o excluido.");
    let assignedName = "Sin responsable";
    if (assignedToId) {
      const user = await tx.workspaceUser.findFirst({ where: { tenantId, id: assignedToId, isActive: true, role: { in: roles } }, select: { id: true, name: true } });
      if (!user) fail(422, "El responsable no está activo o no pertenece al personal de esta empresa.");
      assignedName = user.name || "Usuario registrado";
    }
    if ((movement.assignedToId || null) === assignedToId) fail(409, "El movimiento ya tiene ese responsable.");
    const oldOwner = movement.assignedToId ? await tx.workspaceUser.findFirst({ where: { tenantId, id: movement.assignedToId }, select: { name: true } }) : null;
    const assignmentSummary = `${movement.assignedToId ? oldOwner?.name || "Responsable anterior no disponible" : "Sin responsable"} → ${assignedName}`;
    let date = "";
    try { date = financialDate(financeOperationalDate(movement)); } catch { /* Administrative assignment does not fabricate an accounting period. */ }
    if (date) await assertFinancePeriodOpen(tx, tenantId, date.slice(0, 7));
    const updated = await tx.industryRecord.update({ where: { id: movementId }, data: { assignedToId } });
    await tx.tenantAuditLog.create({ data: { tenantId, actorUserId: userId, action: "FINANCE_MOVEMENT_OWNER_CHANGED", entity: "bank_movement", entityId: movementId, metadata: { operationKey, reason, assignmentSummary, previousAssignedToId: movement.assignedToId || null, assignedToId, dateUnresolved: !date } } });
    return { movementId, assignedToId, version: new Date(updated.updatedAt).toISOString(), replayed: false };
  });
}
