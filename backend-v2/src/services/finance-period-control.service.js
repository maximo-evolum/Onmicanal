import { FinanceOperationError, withFinanceWrite, findAllFinanceRecords } from "./finance-integrity.service.js";
import { getFinanceMonthlyClosePreview, validFinancePeriod } from "./finance-monthly-close.service.js";

const dataOf = (record) => record?.data && typeof record.data === "object" ? record.data : {};
const fail = (status, message) => { throw new FinanceOperationError(status, message); };
function validatePeriod(tenantId, period) {
  if (!tenantId) fail(401, "Se requiere una empresa autenticada.");
  if (!validFinancePeriod(period)) fail(400, "Selecciona un período válido (AAAA-MM).");
}
function reasonText(value) {
  const text = String(value || "").trim();
  if (text.length < 10 || text.length > 1000) fail(400, "Explica el motivo de reapertura con entre 10 y 1.000 caracteres.");
  return text;
}
function checkVersion(control, expectedVersion) {
  if (!Number.isInteger(expectedVersion) || expectedVersion < 0) fail(400, "Actualiza la vista del período antes de confirmar.");
  if (control.version !== expectedVersion) fail(409, "El estado del período cambió. Actualiza la vista antes de continuar.");
}
function publicControl(control, tenantId, period) {
  return { period, status: control?.status || "OPEN", version: control?.version || 0, latestCloseId: control?.latestCloseId || null, currency: "CLP" };
}

// Shared row write serializes lifecycle changes with participating operations.
// Merely checking status before a transaction would leave a close/write race.
export async function lockFinancePeriod(tx, tenantId, period) {
  validatePeriod(tenantId, period);
  return tx.financePeriodControl.upsert({ where: { tenantId_period: { tenantId, period } },
    create: { tenantId, period, status: "OPEN", version: 0, lockVersion: 1 },
    update: { lockVersion: { increment: 1 } } });
}

export async function assertFinancePeriodOpen(tx, tenantId, period) {
  const control = await lockFinancePeriod(tx, tenantId, period);
  if (control.status === "CLOSED") fail(409, `El período ${period} está cerrado. Reábrelo con autorización antes de modificarlo.`);
  return control;
}

export async function closeFinancePeriod(db, { tenantId, userId, period, confirmation, expectedVersion, note = "", previewBuilder = getFinanceMonthlyClosePreview }) {
  validatePeriod(tenantId, period);
  if (confirmation !== "CERRAR") fail(400, "Confirma el cierre con la palabra CERRAR.");
  if (String(note).length > 2000) fail(400, "La nota del cierre no puede superar 2.000 caracteres.");
  return withFinanceWrite(db, async (tx) => {
    const control = await lockFinancePeriod(tx, tenantId, period);
    checkVersion(control, expectedVersion);
    if (control.status === "CLOSED") fail(409, "El período ya está cerrado. Consulta su fotografía guardada.");
    const preview = await previewBuilder({ tenantId, period, db: tx });
    if (preview.period !== period || preview.status !== "READY_TO_CLOSE" || preview.blockers?.length) throw new FinanceOperationError(409, "Resuelve los pendientes antes de cerrar el período.", { preview });
    const closedAt = new Date().toISOString();
    const close = await tx.industryRecord.create({ data: { tenantId, recordType: "finance_monthly_close", title: `Cierre financiero ${period} · versión ${control.version + 1}`, status: "CLOSED", data: {
      ...preview, period, currency: "CLP", closedAt, closedById: userId || null, note: String(note).trim(), lifecycleVersion: control.version + 1, previousCloseId: control.latestCloseId || null
    } } });
    const updated = await tx.financePeriodControl.update({ where: { tenantId_period: { tenantId, period } }, data: { status: "CLOSED", version: { increment: 1 }, latestCloseId: close.id } });
    await tx.tenantAuditLog.create({ data: { tenantId, actorUserId: userId || null, action: "FINANCE_MONTHLY_CLOSE_REGISTERED", entity: "finance_monthly_close", entityId: close.id, metadata: { period, version: updated.version, previousCloseId: control.latestCloseId || null, metrics: preview.metrics } } });
    return { close, preview, periodControl: publicControl(updated, tenantId, period) };
  });
}

export async function reopenFinancePeriod(db, { tenantId, userId, period, closeId, confirmation, expectedVersion, reason }) {
  validatePeriod(tenantId, period); reason = reasonText(reason);
  if (confirmation !== "REABRIR") fail(400, "Confirma la reapertura con la palabra REABRIR.");
  return withFinanceWrite(db, async (tx) => {
    const control = await lockFinancePeriod(tx, tenantId, period);
    checkVersion(control, expectedVersion);
    if (control.status !== "CLOSED" || !closeId || control.latestCloseId !== closeId) fail(409, "Ese cierre ya no es el cierre activo del período. Actualiza la vista.");
    const close = await tx.industryRecord.findFirst({ where: { id: closeId, tenantId, recordType: "finance_monthly_close", status: "CLOSED" } });
    if (!close || dataOf(close).period !== period) fail(409, "No se pudo verificar el cierre activo. No se reabrió el período.");
    const reopenedAt = new Date().toISOString();
    // Keep each original snapshot immutable. Reopening is a separate record,
    // not an overwrite of its original amounts, rows, date or approving user.
    const event = await tx.industryRecord.create({ data: { tenantId, recordType: "finance_period_reopening", title: `Reapertura ${period}`, status: "APPLIED", data: { period, closeId, reopenedAt, reopenedById: userId || null, reason, lifecycleVersion: control.version + 1 } } });
    const updated = await tx.financePeriodControl.update({ where: { tenantId_period: { tenantId, period } }, data: { status: "OPEN", version: { increment: 1 } } });
    await tx.tenantAuditLog.create({ data: { tenantId, actorUserId: userId || null, action: "FINANCE_PERIOD_REOPENED", entity: "finance_period_reopening", entityId: event.id, metadata: { period, closeId, reason, version: updated.version } } });
    return { event, periodControl: publicControl(updated, tenantId, period) };
  });
}

export async function getFinancePeriodWorkspace(db, { tenantId, period, snapshotId, previewBuilder = getFinanceMonthlyClosePreview }) {
  validatePeriod(tenantId, period);
  return withFinanceWrite(db, async (tx) => {
    const control = await tx.financePeriodControl.findUnique({ where: { tenantId_period: { tenantId, period } } });
    if (control?.status === "CLOSED" && !control.latestCloseId) fail(409, "El período está cerrado pero falta su referencia de fotografía. Requiere revisión administrativa.");
    const history = await findAllFinanceRecords(tx, { where: { tenantId, recordType: { in: ["finance_monthly_close", "finance_period_reopening"] }, data: { path: ["period"], equals: period } }, orderBy: { createdAt: "desc" } });
    const target = snapshotId || (control?.status === "CLOSED" ? control.latestCloseId : null);
    const saved = target ? history.find((row) => row.id === target && row.recordType === "finance_monthly_close") : null;
    if (target && !saved) fail(404, "La fotografía solicitada no pertenece a esta empresa y período o ya no está disponible.");
    const preview = saved ? dataOf(saved) : await previewBuilder({ tenantId, period, db: tx });
    if (!Array.isArray(preview.rows) || !Array.isArray(preview.blockers) || !preview.metrics) fail(409, "La fotografía histórica no tiene un detalle completo para visualizarse. Se conserva sin modificar; requiere revisión administrativa.");
    return { ...preview, period, status: saved ? "CLOSED_SNAPSHOT" : preview.status, snapshotId: saved?.id || null,
      periodControl: publicControl(control, tenantId, period),
      history: history.map((row) => { const d = dataOf(row); return { id: row.id, kind: row.recordType === "finance_monthly_close" ? "CLOSE" : "REOPEN", at: d.closedAt || d.reopenedAt || row.createdAt, userId: d.closedById || d.reopenedById || null, note: d.reason || d.note || "", version: d.lifecycleVersion || null, closeId: d.closeId || row.id, active: control?.status === "CLOSED" && control.latestCloseId === row.id }; }),
      protection: { scope: "RECONCILIATION_IMPORTS_AND_MANUAL_WRITES", message: "El cierre protege conciliaciones, cartolas, cobros/pagos manuales, ediciones manuales de documentos, migraciones históricas, cargas DTE XML, importaciones de Nubox y banca abierta, y generación de excepciones IA. La generación de cobranzas valida el período actual de gestión, sin reescribir facturas antiguas. La edición de casos, recordatorios, workflows y otras acciones aún requieren integrar este control." }
    };
  });
}
