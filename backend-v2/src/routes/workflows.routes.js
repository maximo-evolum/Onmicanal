import { Router } from "express";
import { prisma } from "../lib/db.js";
import { recordAuditLog } from "../lib/audit.js";
import { normalizeMetadata } from "../lib/metadata.js";
import { createTenantNotification } from "../lib/notifications.js";
import { requireRole, ROLE_GROUPS } from "../middleware/tenant-access.js";

export const workflowsRouter = Router();

const MAX_WORKFLOW_ITEMS = 50;
const ACTION_TYPES = new Set(["set_status", "set_field", "create_record", "create_notification", "emit_event"]);
const CONDITION_OPERATORS = new Set(["equals", "not_equals", "exists", "includes"]);

function cleanText(value, fallback = "") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function workflowWhere(req, recordType, extra = {}) {
  return { tenantId: req.tenantId, recordType, ...extra };
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function clone(value) {
  return JSON.parse(JSON.stringify(value ?? {}));
}

function safePath(value) {
  const path = cleanText(value);
  if (!/^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*)*$/.test(path)) return null;
  return path;
}

function valueAt(source, path) {
  return safePath(path)?.split(".").reduce((current, key) => current?.[key], source);
}

function withValueAt(source, path, value) {
  const keys = safePath(path)?.split(".");
  if (!keys?.length) throw new Error("La ruta del campo no es válida");
  const result = clone(source);
  let current = result;
  for (const key of keys.slice(0, -1)) {
    current[key] = asObject(current[key]);
    current = current[key];
  }
  current[keys.at(-1)] = value;
  return result;
}

function normalizeWorkflow(body = {}) {
  const metadata = normalizeMetadata(body.metadata || body.data || {}, {});
  return {
    trigger: cleanText(body.trigger || metadata.trigger, "manual"),
    entityType: cleanText(body.entityType || metadata.entityType, "industry_record"),
    steps: Array.isArray(body.steps || metadata.steps) ? (body.steps || metadata.steps).slice(0, MAX_WORKFLOW_ITEMS) : [],
    conditions: Array.isArray(body.conditions || metadata.conditions) ? (body.conditions || metadata.conditions).slice(0, MAX_WORKFLOW_ITEMS) : [],
    actions: Array.isArray(body.actions || metadata.actions) ? (body.actions || metadata.actions).slice(0, MAX_WORKFLOW_ITEMS) : []
  };
}

export function validateWorkflowDefinition(definition) {
  const errors = [];
  for (const [index, condition] of definition.conditions.entries()) {
    if (!asObject(condition) || !safePath(condition.field) || !CONDITION_OPERATORS.has(cleanText(condition.operator, "equals"))) {
      errors.push(`Condición ${index + 1} no es válida`);
    }
  }
  for (const [index, action] of definition.actions.entries()) {
    const type = cleanText(action?.type).toLowerCase();
    if (!asObject(action) || !ACTION_TYPES.has(type)) {
      errors.push(`Acción ${index + 1} no es válida`);
      continue;
    }
    if (type === "set_status" && !cleanText(action.status)) errors.push(`Acción ${index + 1}: status es requerido`);
    if (type === "set_field" && !safePath(action.field || action.path)) errors.push(`Acción ${index + 1}: field es requerido`);
    if (type === "create_record" && !cleanText(action.recordType)) errors.push(`Acción ${index + 1}: recordType es requerido`);
    if (type === "create_notification" && !cleanText(action.title)) errors.push(`Acción ${index + 1}: title es requerido`);
  }
  return errors;
}

export function evaluateWorkflowConditions(conditions, context) {
  const results = (conditions || []).map((condition) => {
    const value = valueAt(context, condition.field);
    const expected = condition.value;
    const operator = cleanText(condition.operator, "equals").toLowerCase();
    let matches = false;
    if (operator === "exists") matches = value !== undefined && value !== null && value !== "";
    if (operator === "equals") matches = String(value ?? "") === String(expected ?? "");
    if (operator === "not_equals") matches = String(value ?? "") !== String(expected ?? "");
    if (operator === "includes") matches = Array.isArray(value)
      ? value.map(String).includes(String(expected ?? ""))
      : String(value ?? "").toLowerCase().includes(String(expected ?? "").toLowerCase());
    return { field: condition.field, operator, expected, value, matches };
  });
  return { matches: results.every((result) => result.matches), results };
}

async function applyWorkflowActions({ actions, tenantId, targetRecord, workflow, runId }) {
  let currentTarget = targetRecord;
  const applied = [];
  for (const action of actions) {
    const type = cleanText(action.type).toLowerCase();
    if (type === "set_status") {
      if (!currentTarget) throw new Error("La acción set_status requiere un registro objetivo");
      currentTarget = await prisma.industryRecord.update({
        where: { id: currentTarget.id },
        data: { status: cleanText(action.status).toUpperCase() }
      });
      applied.push({ type, targetId: currentTarget.id, status: currentTarget.status });
      continue;
    }
    if (type === "set_field") {
      if (!currentTarget) throw new Error("La acción set_field requiere un registro objetivo");
      const field = safePath(action.field || action.path);
      const data = withValueAt(asObject(currentTarget.data), field, action.value ?? null);
      currentTarget = await prisma.industryRecord.update({ where: { id: currentTarget.id }, data: { data } });
      applied.push({ type, targetId: currentTarget.id, field, value: action.value ?? null });
      continue;
    }
    if (type === "create_record") {
      const record = await prisma.industryRecord.create({
        data: {
          tenantId,
          recordType: cleanText(action.recordType).toLowerCase(),
          title: cleanText(action.title, `${workflow.title} · resultado`),
          status: cleanText(action.status, "ACTIVE").toUpperCase(),
          data: normalizeMetadata({ ...asObject(action.data), workflowId: workflow.id, workflowRunId: runId }, {})
        }
      });
      applied.push({ type, recordId: record.id, recordType: record.recordType });
      continue;
    }
    if (type === "create_notification") {
      const notification = await createTenantNotification({
        tenantId,
        title: cleanText(action.title),
        body: cleanText(action.body || action.message),
        severity: cleanText(action.severity, "info"),
        targetUrl: action.targetUrl || null,
        assignedToId: action.assignedToId || null,
        metadata: { workflowId: workflow.id, workflowRunId: runId }
      });
      if (!notification) throw new Error("No se pudo crear la notificación del workflow");
      applied.push({ type, notificationId: notification.id });
      continue;
    }
    if (type === "emit_event") {
      applied.push({ type, event: cleanText(action.event, "workflow.event"), payload: asObject(action.payload) });
    }
  }
  return { applied, target: currentTarget };
}

async function runWorkflow({ req, workflow, input, target, rootRunId = null, attempt = 1, trigger = "manual" }) {
  const targetRecord = target.id
    ? await prisma.industryRecord.findFirst({ where: { id: String(target.id), tenantId: req.tenantId } })
    : null;
  const run = await prisma.industryRecord.create({
    data: {
      tenantId: req.tenantId,
      recordType: "workflow_run",
      title: `Run ${workflow.title}`,
      status: "RUNNING",
      data: normalizeMetadata({ workflowId: workflow.id, workflowTitle: workflow.title, input, target, rootRunId, attempt, trigger, startedAt: new Date().toISOString(), ranByUserId: req.user?.id || null }, {})
    }
  });

  try {
    const context = { ...input, input, target: { ...target, data: asObject(targetRecord?.data) } };
    const conditions = evaluateWorkflowConditions(workflow.data?.conditions || [], context);
    if (!conditions.matches) {
      const skipped = await prisma.industryRecord.update({
        where: { id: run.id },
        data: { status: "SKIPPED", data: normalizeMetadata({ ...(run.data || {}), conditions, completedAt: new Date().toISOString() }, {}) }
      });
      return { run: skipped, conditions, applied: [] };
    }
    const execution = await applyWorkflowActions({
      actions: workflow.data?.actions || [], tenantId: req.tenantId, targetRecord, workflow, runId: run.id
    });
    const completed = await prisma.industryRecord.update({
      where: { id: run.id },
      data: { status: "COMPLETED", data: normalizeMetadata({ ...(run.data || {}), conditions, actionsApplied: execution.applied, completedAt: new Date().toISOString() }, {}) }
    });
    return { run: completed, conditions, applied: execution.applied };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error desconocido";
    const failed = await prisma.industryRecord.update({
      where: { id: run.id },
      data: { status: "FAILED", data: normalizeMetadata({ ...(run.data || {}), error: message, failedAt: new Date().toISOString() }, {}) }
    });
    await prisma.industryRecord.create({
      data: {
        tenantId: req.tenantId,
        recordType: "workflow_dead_letter",
        title: `DLQ ${workflow.title}`,
        status: "OPEN",
        data: normalizeMetadata({ workflowId: workflow.id, workflowRunId: failed.id, rootRunId: rootRunId || failed.id, input, target, attempt, error: message }, {})
      }
    });
    throw Object.assign(new Error(message), { workflowRun: failed });
  }
}

function workflowTrigger(workflow) {
  return cleanText(workflow?.data?.trigger, "manual").toLowerCase();
}

function scheduledIntervalMinutes(workflow) {
  const raw = Number(workflow?.data?.schedule?.intervalMinutes || workflow?.data?.intervalMinutes || 60);
  return Math.min(24 * 60, Math.max(5, Number.isFinite(raw) ? Math.floor(raw) : 60));
}

// Dispara flujos configurados por un evento del negocio. Un fallo se registra
// en su DLQ, pero jamás revierte la creación o actualización original.
export async function runWorkflowsForEvent({ tenantId, event, input = {}, target = {} }) {
  const normalizedEvent = cleanText(event).toLowerCase();
  const workflows = await prisma.industryRecord.findMany({
    where: { tenantId, recordType: "workflow_definition", status: "ACTIVE" },
    take: 200
  });
  const matched = workflows.filter((workflow) => workflowTrigger(workflow) === normalizedEvent);
  const results = [];
  for (const workflow of matched) {
    try {
      const result = await runWorkflow({
        req: { tenantId, user: { id: null } }, workflow,
        input: normalizeMetadata(input, {}), target: normalizeMetadata(target, {}), trigger: normalizedEvent
      });
      results.push({ workflowId: workflow.id, status: result.run.status, runId: result.run.id });
    } catch (error) {
      results.push({ workflowId: workflow.id, status: "FAILED", runId: error?.workflowRun?.id || null });
    }
  }
  return { event: normalizedEvent, matched: matched.length, results };
}

// Ejecución periódica para flujos con trigger `schedule`. El control de
// duplicados entre instancias lo realiza el programador de plataforma.
export async function runScheduledWorkflows({ now = new Date() } = {}) {
  const workflows = await prisma.industryRecord.findMany({
    where: { recordType: "workflow_definition", status: "ACTIVE" },
    take: 500
  });
  const scheduled = workflows.filter((workflow) => workflowTrigger(workflow) === "schedule");
  const results = [];
  for (const workflow of scheduled) {
    const intervalMinutes = scheduledIntervalMinutes(workflow);
    const latest = await prisma.industryRecord.findFirst({
      where: { tenantId: workflow.tenantId, recordType: "workflow_run", data: { path: ["workflowId"], equals: workflow.id } },
      orderBy: { createdAt: "desc" }, select: { createdAt: true }
    });
    if (latest && now.getTime() - latest.createdAt.getTime() < intervalMinutes * 60_000) {
      results.push({ workflowId: workflow.id, status: "SKIPPED", reason: "not_due" });
      continue;
    }
    try {
      const result = await runWorkflow({
        req: { tenantId: workflow.tenantId, user: { id: null } }, workflow,
        input: { scheduledAt: now.toISOString() }, target: {}, trigger: "schedule"
      });
      results.push({ workflowId: workflow.id, status: result.run.status, runId: result.run.id });
    } catch (error) {
      results.push({ workflowId: workflow.id, status: "FAILED", runId: error?.workflowRun?.id || null });
    }
  }
  return { processed: results.length, results };
}

workflowsRouter.get("/workflows", async (req, res) => {
  try {
    const workflows = await prisma.industryRecord.findMany({
      where: workflowWhere(req, "workflow_definition", { ...(req.query.status ? { status: String(req.query.status).toUpperCase() } : {}) }),
      orderBy: [{ status: "asc" }, { updatedAt: "desc" }], take: Math.min(Number(req.query.limit || 100), 300)
    });
    res.json({ workflows });
  } catch (error) { console.error("List workflows error:", error); res.status(500).json({ error: "No se pudieron cargar workflows" }); }
});

workflowsRouter.get("/workflows/:id/versions", async (req, res) => {
  try {
    const versions = await prisma.industryRecord.findMany({
      where: workflowWhere(req, "workflow_definition_version", { data: { path: ["workflowId"], equals: req.params.id } }),
      orderBy: { createdAt: "desc" }, take: 100
    });
    res.json({ versions });
  } catch (error) { console.error("List workflow versions error:", error); res.status(500).json({ error: "No se pudieron cargar versiones" }); }
});

workflowsRouter.get("/workflows/:id/runs", async (req, res) => {
  try {
    const runs = await prisma.industryRecord.findMany({
      where: workflowWhere(req, "workflow_run", { data: { path: ["workflowId"], equals: req.params.id } }),
      orderBy: { createdAt: "desc" }, take: Math.min(Number(req.query.limit || 100), 300)
    });
    res.json({ runs });
  } catch (error) { console.error("List workflow runs error:", error); res.status(500).json({ error: "No se pudieron cargar ejecuciones" }); }
});

workflowsRouter.get("/workflow-dead-letters", requireRole(ROLE_GROUPS.MANAGERS), async (req, res) => {
  try {
    const deadLetters = await prisma.industryRecord.findMany({
      where: workflowWhere(req, "workflow_dead_letter", { ...(req.query.status ? { status: String(req.query.status).toUpperCase() } : {}) }),
      orderBy: { createdAt: "desc" }, take: Math.min(Number(req.query.limit || 100), 300)
    });
    res.json({ deadLetters });
  } catch (error) { console.error("List workflow DLQ error:", error); res.status(500).json({ error: "No se pudo cargar la cola de errores" }); }
});

workflowsRouter.post("/workflows", requireRole(ROLE_GROUPS.MANAGERS), async (req, res) => {
  try {
    const name = cleanText(req.body?.name || req.body?.title);
    if (!name) return res.status(400).json({ error: "name es requerido" });
    const definition = normalizeWorkflow(req.body);
    const errors = validateWorkflowDefinition(definition);
    if (errors.length) return res.status(400).json({ error: "Definición inválida", details: errors });
    const workflow = await prisma.industryRecord.create({
      data: { tenantId: req.tenantId, recordType: "workflow_definition", title: name, status: req.body?.status ? cleanText(req.body.status).toUpperCase() : "ACTIVE", data: normalizeMetadata({ ...definition, version: 1, description: req.body?.description || null, createdByUserId: req.user?.id || null }, {}) }
    });
    await recordAuditLog(req, "WORKFLOW_CREATED", "workflow_definition", workflow.id, { trigger: definition.trigger });
    res.status(201).json({ workflow });
  } catch (error) { console.error("Create workflow error:", error); res.status(500).json({ error: "No se pudo crear workflow" }); }
});

workflowsRouter.patch("/workflows/:id", requireRole(ROLE_GROUPS.MANAGERS), async (req, res) => {
  try {
    const existing = await prisma.industryRecord.findFirst({ where: workflowWhere(req, "workflow_definition", { id: req.params.id }) });
    if (!existing) return res.status(404).json({ error: "Workflow no encontrado" });
    const definition = normalizeWorkflow({ ...(existing.data || {}), ...(req.body || {}) });
    const errors = validateWorkflowDefinition(definition);
    if (errors.length) return res.status(400).json({ error: "Definición inválida", details: errors });
    const nextVersion = Number(existing.data?.version || 1) + 1;
    await prisma.industryRecord.create({
      data: { tenantId: req.tenantId, recordType: "workflow_definition_version", title: `${existing.title} · v${existing.data?.version || 1}`, status: "ARCHIVED", data: normalizeMetadata({ workflowId: existing.id, version: existing.data?.version || 1, definition: existing.data, archivedByUserId: req.user?.id || null }, {}) }
    });
    const workflow = await prisma.industryRecord.update({
      where: { id: existing.id }, data: { title: req.body?.name || req.body?.title ? cleanText(req.body.name || req.body.title) : existing.title, status: req.body?.status ? cleanText(req.body.status).toUpperCase() : existing.status, data: normalizeMetadata({ ...(existing.data || {}), ...definition, version: nextVersion, updatedByUserId: req.user?.id || null }, {}) }
    });
    await recordAuditLog(req, "WORKFLOW_UPDATED", "workflow_definition", workflow.id, { version: nextVersion });
    res.json({ workflow });
  } catch (error) { console.error("Update workflow error:", error); res.status(500).json({ error: "No se pudo actualizar workflow" }); }
});

workflowsRouter.post("/workflows/:id/run", requireRole(ROLE_GROUPS.STAFF), async (req, res) => {
  try {
    const workflow = await prisma.industryRecord.findFirst({ where: workflowWhere(req, "workflow_definition", { id: req.params.id, status: "ACTIVE" }) });
    if (!workflow) return res.status(404).json({ error: "Workflow activo no encontrado" });
    const result = await runWorkflow({ req, workflow, input: normalizeMetadata(req.body?.input || {}, {}), target: normalizeMetadata(req.body?.target || {}, {}), trigger: "manual" });
    await recordAuditLog(req, "WORKFLOW_RUN", "workflow_run", result.run.id, { workflowId: workflow.id, status: result.run.status });
    res.status(201).json(result);
  } catch (error) { console.error("Run workflow error:", error); res.status(500).json({ error: "No se pudo ejecutar workflow", run: error.workflowRun || null }); }
});

workflowsRouter.post("/workflow-dead-letters/:id/retry", requireRole(ROLE_GROUPS.MANAGERS), async (req, res) => {
  try {
    const deadLetter = await prisma.industryRecord.findFirst({ where: workflowWhere(req, "workflow_dead_letter", { id: req.params.id, status: "OPEN" }) });
    if (!deadLetter) return res.status(404).json({ error: "Error de workflow no encontrado o ya resuelto" });
    const workflow = await prisma.industryRecord.findFirst({ where: workflowWhere(req, "workflow_definition", { id: deadLetter.data?.workflowId, status: "ACTIVE" }) });
    if (!workflow) return res.status(409).json({ error: "El workflow asociado no está activo" });
    const result = await runWorkflow({ req, workflow, input: asObject(deadLetter.data?.input), target: asObject(deadLetter.data?.target), rootRunId: deadLetter.data?.rootRunId || deadLetter.data?.workflowRunId, attempt: Number(deadLetter.data?.attempt || 1) + 1 });
    await prisma.industryRecord.update({ where: { id: deadLetter.id }, data: { status: "RESOLVED", data: normalizeMetadata({ ...(deadLetter.data || {}), resolvedAt: new Date().toISOString(), retriedRunId: result.run.id, resolvedByUserId: req.user?.id || null }, {}) } });
    await recordAuditLog(req, "WORKFLOW_DEAD_LETTER_RETRIED", "workflow_dead_letter", deadLetter.id, { runId: result.run.id });
    res.status(201).json(result);
  } catch (error) { console.error("Retry workflow error:", error); res.status(500).json({ error: "No se pudo reintentar workflow", run: error.workflowRun || null }); }
});
