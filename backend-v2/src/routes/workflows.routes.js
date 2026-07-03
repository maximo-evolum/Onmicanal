import { Router } from "express";
import { prisma } from "../lib/db.js";
import { recordAuditLog } from "../lib/audit.js";
import { normalizeMetadata } from "../lib/metadata.js";
import { requireRole, ROLE_GROUPS } from "../middleware/tenant-access.js";

export const workflowsRouter = Router();

function cleanText(value, fallback = "") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function workflowWhere(req, recordType, extra = {}) {
  return { tenantId: req.tenantId, recordType, ...extra };
}

function normalizeWorkflow(body = {}) {
  const metadata = normalizeMetadata(body.metadata || body.data || {}, {});
  return {
    trigger: cleanText(body.trigger || metadata.trigger, "manual"),
    entityType: cleanText(body.entityType || metadata.entityType, "industry_record"),
    steps: Array.isArray(body.steps || metadata.steps) ? (body.steps || metadata.steps) : [],
    conditions: Array.isArray(body.conditions || metadata.conditions) ? (body.conditions || metadata.conditions) : [],
    actions: Array.isArray(body.actions || metadata.actions) ? (body.actions || metadata.actions) : []
  };
}

workflowsRouter.get("/workflows", async (req, res) => {
  try {
    const workflows = await prisma.industryRecord.findMany({
      where: workflowWhere(req, "workflow_definition", {
        ...(req.query.status ? { status: String(req.query.status).toUpperCase() } : {})
      }),
      orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
      take: Math.min(Number(req.query.limit || 100), 300)
    });
    res.json({ workflows });
  } catch (error) {
    console.error("List workflows error:", error);
    res.status(500).json({ error: "No se pudieron cargar workflows" });
  }
});

workflowsRouter.post("/workflows", requireRole(ROLE_GROUPS.MANAGERS), async (req, res) => {
  try {
    const name = cleanText(req.body?.name || req.body?.title);
    if (!name) return res.status(400).json({ error: "name es requerido" });

    const definition = normalizeWorkflow(req.body);
    const workflow = await prisma.industryRecord.create({
      data: {
        tenantId: req.tenantId,
        recordType: "workflow_definition",
        title: name,
        status: req.body?.status ? cleanText(req.body.status).toUpperCase() : "ACTIVE",
        data: normalizeMetadata({
          ...definition,
          version: 1,
          description: req.body?.description || null,
          createdByUserId: req.user?.id || null
        }, {})
      }
    });

    await recordAuditLog(req, "WORKFLOW_CREATED", "workflow_definition", workflow.id, { trigger: definition.trigger });
    res.status(201).json({ workflow });
  } catch (error) {
    console.error("Create workflow error:", error);
    res.status(500).json({ error: "No se pudo crear workflow" });
  }
});

workflowsRouter.patch("/workflows/:id", requireRole(ROLE_GROUPS.MANAGERS), async (req, res) => {
  try {
    const existing = await prisma.industryRecord.findFirst({
      where: workflowWhere(req, "workflow_definition", { id: req.params.id })
    });
    if (!existing) return res.status(404).json({ error: "Workflow no encontrado" });

    const definition = normalizeWorkflow({ ...(existing.data || {}), ...(req.body || {}) });
    const workflow = await prisma.industryRecord.update({
      where: { id: existing.id },
      data: {
        title: req.body?.name || req.body?.title ? cleanText(req.body.name || req.body.title) : existing.title,
        status: req.body?.status ? cleanText(req.body.status).toUpperCase() : existing.status,
        data: normalizeMetadata({
          ...(existing.data || {}),
          ...definition,
          version: Number(existing.data?.version || 1) + 1,
          updatedByUserId: req.user?.id || null
        }, {})
      }
    });

    await recordAuditLog(req, "WORKFLOW_UPDATED", "workflow_definition", workflow.id);
    res.json({ workflow });
  } catch (error) {
    console.error("Update workflow error:", error);
    res.status(500).json({ error: "No se pudo actualizar workflow" });
  }
});

workflowsRouter.post("/workflows/:id/run", requireRole(ROLE_GROUPS.STAFF), async (req, res) => {
  try {
    const workflow = await prisma.industryRecord.findFirst({
      where: workflowWhere(req, "workflow_definition", { id: req.params.id, status: "ACTIVE" })
    });
    if (!workflow) return res.status(404).json({ error: "Workflow activo no encontrado" });

    const input = normalizeMetadata(req.body?.input || {}, {});
    const target = normalizeMetadata(req.body?.target || {}, {});
    const actions = Array.isArray(workflow.data?.actions) ? workflow.data.actions : [];
    const firstTransition = actions.find((action) => action?.type === "set_status" && action?.status);

    if (target.id && firstTransition?.status) {
      const targetRecord = await prisma.industryRecord.findFirst({
        where: { id: String(target.id), tenantId: req.tenantId }
      });
      if (targetRecord) {
        await prisma.industryRecord.update({
          where: { id: targetRecord.id },
          data: { status: String(firstTransition.status).toUpperCase() }
        });
      }
    }

    const run = await prisma.industryRecord.create({
      data: {
        tenantId: req.tenantId,
        recordType: "workflow_run",
        title: `Run ${workflow.title}`,
        status: "COMPLETED",
        data: normalizeMetadata({
          workflowId: workflow.id,
          workflowTitle: workflow.title,
          input,
          target,
          actionsApplied: firstTransition ? [firstTransition] : [],
          ranByUserId: req.user?.id || null
        }, {})
      }
    });

    await recordAuditLog(req, "WORKFLOW_RUN", "workflow_run", run.id, { workflowId: workflow.id, target });
    res.status(201).json({ run });
  } catch (error) {
    console.error("Run workflow error:", error);
    res.status(500).json({ error: "No se pudo ejecutar workflow" });
  }
});
