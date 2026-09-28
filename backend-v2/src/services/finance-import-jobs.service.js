import { validateBankReviewConfig, bankReviewColumns } from "./finance-bank-review.service.js";
import { createHash, randomUUID } from "node:crypto";
import { FinanceOperationError, withFinanceWrite } from "./finance-integrity.service.js";
import { fileSelectionChanged } from "./finance-file-selection.service.js";

export const IMPORT_LEASE_MS = 5 * 60 * 1000;
export const IMPORT_MAX_AUTOMATIC_ATTEMPTS = 3;
export const ACTIVE_IMPORT_STATUSES = ["RECEIVED", "PROCESSING", "READY", "FAILED"];
const MAX_FILE_BYTES = 12 * 1024 * 1024;
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const json = (value) => JSON.parse(JSON.stringify(value));
export function importAccount(value = {}) {
  return Object.fromEntries(["bankKey", "accountAlias", "accountType", "accountLast4", "bankAccountId", "currency"].map((key) => [key, String(value?.[key] || "").trim().slice(0, 180)]));
}
export function importJobView(job, now = Date.now()) {
  const { original: _original, revisions: _revisions, runToken: _runToken, ...safe } = job;
  return { ...safe, recoverable: ACTIVE_IMPORT_STATUSES.includes(job.status) &&
    (job.status !== "PROCESSING" || now - new Date(job.updatedAt).getTime() >= IMPORT_LEASE_MS) };
}
export async function getBankImportJob(db, tenantId, id, options = {}) {
  if (typeof tenantId !== "string" || !tenantId.trim()) throw new FinanceOperationError(403, "No se pudo determinar la empresa de la sesión.");
  if (typeof id !== "string" || !id.trim()) throw new FinanceOperationError(400, "Falta el identificador de la importación.");
  const job = await db.financeBankImportJob.findFirst({ where: { id, tenantId },
    ...(options.original ? { include: { original: true } } : {}) });
  if (!job) throw new FinanceOperationError(404, "No se encontró esta importación en tu empresa.");
  return job;
}
export async function createBankImportJob(db, { tenantId, userId, file, account }) {
  if (typeof tenantId !== "string" || !tenantId.trim()) throw new FinanceOperationError(403, "No se pudo determinar la empresa de la sesión.");
  if (!Buffer.isBuffer(file?.buffer) || !file.buffer.length || file.buffer.length > MAX_FILE_BYTES) {
    throw new FinanceOperationError(400, "Selecciona una cartola de hasta 12 MB.");
  }
  const sha256 = hash(file.buffer);
  const sourceFile = String(file.originalname || "cartola-bancaria").replace(/[\\/\r\n\x00-\x1f]/g, "_").slice(0, 180);
  const configuredQuota = Number(process.env.FINANCE_ORIGINALS_MAX_BYTES);
  const quota = Number.isSafeInteger(configuredQuota) && configuredQuota >= MAX_FILE_BYTES ? configuredQuota : 256 * 1024 * 1024;
  try {
  return await withFinanceWrite(db, async (tx) => {
    let original = await tx.financeBankOriginal.findUnique({ where: { tenantId_sha256: { tenantId, sha256 } }, select: { id: true } });
    // A repeated click returns the pending job, not a second copy or analysis.
    if (original) {
      const existing = await tx.financeBankImportJob.findFirst({ where: { tenantId, originalId: original.id, status: { in: ACTIVE_IMPORT_STATUSES } }, orderBy: { createdAt: "desc" } });
      if (existing) return existing;
    }
    if (await tx.financeBankImportJob.count({ where: { tenantId, status: { in: ACTIVE_IMPORT_STATUSES } } }) >= 100) {
      throw new FinanceOperationError(409, "Hay 100 importaciones pendientes. Incorpora o cancela algunas antes de subir más archivos.");
    }
    if (!original) {
      const usage = await tx.financeBankOriginal.aggregate({ where: { tenantId }, _sum: { size: true } });
      if (Number(usage._sum.size || 0) + file.buffer.length > quota) throw new FinanceOperationError(413, "Se alcanzó el límite de almacenamiento de originales de esta empresa. Contacta al administrador.");
      original = await tx.financeBankOriginal.create({ data: { tenantId, sha256, content: file.buffer, size: file.buffer.length }, select: { id: true } });
    }
    return tx.financeBankImportJob.create({ data: { tenantId, originalId: original.id, sourceFile, createdById: userId || null, account: importAccount(account) } });
  });
  } catch (error) {
    // PostgreSQL can report a concurrent identical upload as P2002 rather than
    // P2034. Reuse only the matching committed job; never hide other conflicts.
    if (error?.code === "P2002") {
      const original = await db.financeBankOriginal.findUnique({ where: { tenantId_sha256: { tenantId, sha256 } }, select: { id: true } });
      if (original) {
        const existing = await db.financeBankImportJob.findFirst({ where: { tenantId, originalId: original.id, status: { in: ACTIVE_IMPORT_STATUSES } }, orderBy: { createdAt: "desc" } });
        if (existing) return existing;
      }
    }
    throw error;
  }
}
export async function readBankImportPreview(db, tenantId, id) {
  const job = await getBankImportJob(db, tenantId, id);
  const revision = await db.financeBankImportRevision.findUnique({ where: { jobId_revision: { jobId: id, revision: job.revision } } });
  return { job: importJobView(job), preview: revision?.preview ? { ...revision.preview, jobId: job.id, revision: job.revision } : null };
}
export async function analyzeBankImportJob(db, { tenantId, id, account, reviewConfig, expectedRevision, analyze, background = false, queueOnly = false, timeoutMs = 120000 }) {
  const runToken = randomUUID();
  const claimed = await withFinanceWrite(db, async (tx) => {
    const job = await getBankImportJob(tx, tenantId, id);
    if (background && !["RECEIVED", "PROCESSING"].includes(job.status)) throw new FinanceOperationError(409, "La carga ya no está pendiente de análisis.");
    if (reviewConfig !== undefined && (!Number.isInteger(expectedRevision) || expectedRevision !== job.revision)) throw new FinanceOperationError(409, "La revisión cambió. Recupérala antes de guardar cambios.");
    const previous = job.status === "READY" ? await tx.financeBankImportRevision.findUnique({ where: { jobId_revision: { jobId: id, revision: job.revision } } }) : null;
    const previousRows = previous?.preview?.sourceRows;
    const requested = reviewConfig ?? job.reviewConfig ?? {};
    const changedSelection = fileSelectionChanged(job.reviewConfig?.selection, requested.selection);
    if (changedSelection && (Object.keys(requested.mapping || {}).length || (requested.excludedRows || []).length)) throw new FinanceOperationError(400, "Al cambiar la hoja o el rango, limpia el mapeo y las exclusiones anteriores para no aplicarlos a otros registros.");
    const config = validateBankReviewConfig(requested, !changedSelection && previousRows ? bankReviewColumns(previousRows) : undefined, changedSelection ? undefined : previousRows?.length);
    if (previousRows?.length && config.excludedRows.length === previousRows.length) throw new FinanceOperationError(400, "No puedes excluir todos los movimientos. Usa Cancelar carga para descartar la cartola completa.");
    if (!importJobView(job).recoverable) throw new FinanceOperationError(409, job.status === "PROCESSING"
      ? "Esta cartola sigue en análisis. Actualiza su estado; si se interrumpió, podrás reanudarla después de cinco minutos."
      : "Esta importación ya fue incorporada o cancelada.");
    const sheetChanged = (job.reviewConfig?.selection?.sheet || "") !== (config.selection?.sheet || "");
    const changed = await tx.financeBankImportJob.updateMany({ where: { id, tenantId, revision: job.revision, status: job.status }, data: { status: queueOnly ? "RECEIVED" : "PROCESSING", revision: job.revision + 1, attempts: queueOnly ? 0 : background ? Number(job.attempts || 0) + 1 : 1, runToken: queueOnly ? null : runToken, error: null, reviewConfig: config, account: importAccount(account ?? (sheetChanged ? {} : job.account)) } });
    if (changed.count !== 1) throw new FinanceOperationError(409, "Otra operación modificó la carga. Actualiza su estado.");
    return getBankImportJob(tx, tenantId, id);
  });
  if (queueOnly) return importJobView(claimed);
  let timeout;
  const heartbeat = setInterval(() => { void db.financeBankImportJob.updateMany({ where: { id, tenantId, runToken, status: "PROCESSING" }, data: { updatedAt: new Date() } }).catch(() => {}); }, 30000);
  heartbeat.unref?.();
  try {
    const job = await getBankImportJob(db, tenantId, id, { original: true });
    const buffer = Buffer.from(job.original.content);
    if (hash(buffer) !== job.original.sha256) throw new FinanceOperationError(409, "El original no supera la verificación de integridad. No se incorporaron movimientos.");
    const preview = json(await Promise.race([
      analyze({ file: { buffer, originalname: job.sourceFile, size: buffer.length }, account: claimed.account, reviewConfig: claimed.reviewConfig, tenantId }),
      new Promise((_, reject) => { timeout = setTimeout(() => reject(new FinanceOperationError(408, "El análisis excedió el tiempo permitido. Original conservado; revisa el archivo antes de reintentar.")), timeoutMs); })
    ]));
    await withFinanceWrite(db, async (tx) => {
      const changed = await tx.financeBankImportJob.updateMany({ where: { id, tenantId, runToken, status: "PROCESSING" }, data: { status: "READY", runToken: null, account: importAccount(preview.account), periodRange: preview.periodRange || { from: null, to: null }, error: null } });
      if (changed.count !== 1) throw new FinanceOperationError(409, "La revisión cambió mientras se analizaba. Recupera la revisión actual.");
      await tx.financeBankImportRevision.create({ data: { jobId: id, revision: claimed.revision, status: "READY", preview } });
    });
    return { ...preview, jobId: id, revision: claimed.revision };
  } catch (error) {
    const transient = ["P1001", "P1002", "P1008", "P1017", "P2024"].includes(error?.code);
    const retry = background && transient && claimed.attempts < IMPORT_MAX_AUTOMATIC_ATTEMPTS;
    const message = transient ? "La base de datos no estuvo disponible durante el análisis. El archivo original se conserva."
      : error instanceof FinanceOperationError ? String(error.message).slice(0, 1000)
      : "No se pudo analizar la cartola. Revisa el formato y la selección del archivo antes de reintentar.";
    await withFinanceWrite(db, async (tx) => {
      const changed = await tx.financeBankImportJob.updateMany({ where: { id, tenantId, runToken, status: "PROCESSING" }, data: { status: retry ? "RECEIVED" : "FAILED", runToken: null, error: message } });
      if (changed.count) await tx.financeBankImportRevision.create({ data: { jobId: id, revision: claimed.revision, status: "FAILED", error: message } });
    });
    throw new FinanceOperationError(error?.status || 400, message, { jobId: id });
  } finally { clearInterval(heartbeat); clearTimeout(timeout); }
}

// A bounded queue backed by PostgreSQL. No financial movements are created here.
// Parsing ends at READY; incorporation still requires an authorized confirmation.
export async function runBankImportWorker(db, { analyze, now = new Date(), limit = 5 } = {}) {
  const jobs = await db.financeBankImportJob.findMany({ where: { OR: [
    { status: "RECEIVED", updatedAt: { lte: new Date(now.getTime() - 30000) } },
    { status: "PROCESSING", updatedAt: { lte: new Date(now.getTime() - IMPORT_LEASE_MS) } }
  ] }, orderBy: [{ updatedAt: "asc" }, { id: "asc" }], take: Math.max(1, Math.min(10, limit)) });
  const results = [];
  for (const job of jobs) {
    // Repeated process crashes eventually require human review instead of an infinite loop.
    if (job.status === "PROCESSING" && Number(job.attempts || 0) >= IMPORT_MAX_AUTOMATIC_ATTEMPTS) {
      const result = await db.financeBankImportJob.updateMany({ where: { id: job.id, tenantId: job.tenantId, status: "PROCESSING", runToken: job.runToken, updatedAt: job.updatedAt }, data: { status: "FAILED", runToken: null, error: "El análisis se interrumpió tres veces. Original conservado; revisa la carga y reintenta manualmente." } });
      results.push({ id: job.id, status: result.count ? "FAILED" : "CHANGED" }); continue;
    }
    try {
      await analyzeBankImportJob(db, { tenantId: job.tenantId, id: job.id, analyze, background: true });
      results.push({ id: job.id, status: "READY" });
    } catch (error) {
      // One bad file must not prevent the remaining queue from progressing.
      results.push({ id: job.id, status: error?.status === 409 ? "CHANGED" : "REQUIRES_REVIEW" });
    }
  }
  return results;
}

export function startBankImportWorker(db, analyze, { intervalMs = 5000, onError = () => {} } = {}) {
  let running = false, stopped = false;
  const tick = async () => {
    if (running || stopped) return;
    running = true;
    try { await runBankImportWorker(db, { analyze }); } catch { onError("No se pudo consultar la cola de cartolas; se reintentará."); }
    finally { running = false; }
  };
  const timer = setInterval(tick, intervalMs); timer.unref?.(); void tick();
  return () => { stopped = true; clearInterval(timer); };
}
export async function cancelBankImportJob(db, tenantId, id) {
  return withFinanceWrite(db, async (tx) => {
    const job = await getBankImportJob(tx, tenantId, id);
    if (!ACTIVE_IMPORT_STATUSES.includes(job.status)) throw new FinanceOperationError(409, "Esta importación ya fue incorporada o cancelada.");
    return tx.financeBankImportJob.update({ where: { id }, data: { status: "CANCELLED", runToken: null } });
  });
}
// Called INSIDE the same Serializable transaction that creates movements.
export async function bankImportConfirmation(tx, tenantId, id, expectedRevision) {
  if (!id || !Number.isInteger(expectedRevision)) throw new FinanceOperationError(400, "Recupera o vuelve a seleccionar la cartola para confirmar una revisión guardada.");
  const job = await getBankImportJob(tx, tenantId, id);
  if (job.status === "IMPORTED") {
    const batch = await tx.industryRecord.findFirst({ where: { id: job.batchId, tenantId, recordType: "bank_statement" } });
    if (!batch || batch.status !== "IMPORTED") throw new FinanceOperationError(409, "La cartola fue eliminada o reemplazada. Crea una nueva importación con el original.");
    return { job, batch };
  }
  if (job.status !== "READY" || job.revision !== expectedRevision) throw new FinanceOperationError(409, "La revisión cambió o no está lista. Recupera la cartola antes de incorporarla.");
  const revision = await tx.financeBankImportRevision.findUnique({ where: { jobId_revision: { jobId: id, revision: job.revision } } });
  if (!revision?.preview) throw new FinanceOperationError(409, "La revisión no contiene movimientos. Vuelve a analizar el original.");
  return { job, preview: revision.preview };
}
