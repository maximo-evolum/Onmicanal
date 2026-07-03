import { Router } from "express";
import { prisma } from "../lib/db.js";
import { MODULES } from "../lib/modules.js";
import { buildBalancedAssignments } from "../lib/industries.js";
import { hasTenantModule } from "../services/tenant-modules.service.js";
import { requireRole, ROLE_GROUPS } from "../middleware/tenant-access.js";
import { mergeMetadata, normalizeMetadata } from "../lib/metadata.js";

export const industryRecordsRouter = Router();

const RECORD_MODULES = Object.freeze({
  property: MODULES.PROPERTIES,
  seller_assignment: MODULES.PROPERTY_ASSIGNMENTS,
  customer: MODULES.CUSTOMERS,
  revenue: MODULES.REVENUE,
  vehicle: MODULES.VEHICLES,
  part: MODULES.PARTS_INVENTORY,
  work_order: MODULES.MECHANIC_ASSIGNMENTS,
  ready_notification: MODULES.READY_NOTIFICATIONS
});

function cleanText(value, fallback = "") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function normalizeRecordType(value) {
  return cleanText(value, "property").toLowerCase().replace(/\s+/g, "_");
}

async function assertRecordModule(req, recordType) {
  const role = req.user?.role;
  if (["SUPER_ADMIN", "OWNER", "ADMIN"].includes(role)) return true;
  const module = RECORD_MODULES[recordType];
  if (!module) return true;
  return hasTenantModule(req.tenantId, module);
}

function tenantRecordWhere(req, extra = {}) {
  if (req.user?.role === "SUPER_ADMIN" && req.query?.tenantId) {
    return { tenantId: String(req.query.tenantId), ...extra };
  }
  return { tenantId: req.tenantId, ...extra };
}

industryRecordsRouter.get("/industry-records/users", async (req, res) => {
  try {
    const users = await prisma.workspaceUser.findMany({
      where: {
        tenantId: req.user?.role === "SUPER_ADMIN" && req.query?.tenantId ? String(req.query.tenantId) : req.tenantId,
        isActive: true
      },
      select: { id: true, name: true, email: true, role: true },
      orderBy: [{ role: "asc" }, { name: "asc" }]
    });
    res.json(users);
  } catch (error) {
    console.error("List industry users error:", error);
    res.status(500).json({ error: "No se pudieron obtener usuarios del rubro" });
  }
});

industryRecordsRouter.get("/industry-records", async (req, res) => {
  try {
    const recordType = req.query.type ? normalizeRecordType(req.query.type) : null;
    if (recordType && !(await assertRecordModule(req, recordType))) {
      return res.status(403).json({ error: `Modulo no habilitado para ${recordType}` });
    }

    const records = await prisma.industryRecord.findMany({
      where: tenantRecordWhere(req, {
        ...(recordType ? { recordType } : {}),
        ...(req.query.status ? { status: String(req.query.status) } : {})
      }),
      include: { assignedTo: { select: { id: true, name: true, email: true, role: true } } },
      orderBy: [{ updatedAt: "desc" }],
      take: Math.min(Number(req.query.limit || 200), 500)
    });
    res.json(records);
  } catch (error) {
    console.error("List industry records error:", error);
    res.status(500).json({ error: "No se pudieron obtener registros del rubro" });
  }
});

industryRecordsRouter.post("/industry-records", requireRole(ROLE_GROUPS.STAFF), async (req, res) => {
  try {
    const recordType = normalizeRecordType(req.body?.recordType);
    if (!(await assertRecordModule(req, recordType))) {
      return res.status(403).json({ error: `Modulo no habilitado para ${recordType}` });
    }

    const title = cleanText(req.body?.title);
    if (!title) return res.status(400).json({ error: "title es requerido" });

    const assignedToId = cleanText(req.body?.assignedToId) || null;
    if (assignedToId) {
      const user = await prisma.workspaceUser.findFirst({ where: { id: assignedToId, tenantId: req.tenantId, isActive: true } });
      if (!user) return res.status(400).json({ error: "Usuario asignado no pertenece a este cliente" });
    }

    const record = await prisma.industryRecord.create({
      data: {
        tenantId: req.tenantId,
        recordType,
        title,
        status: cleanText(req.body?.status, "ACTIVE").toUpperCase(),
        assignedToId,
        data: normalizeMetadata(req.body?.data, {})
      },
      include: { assignedTo: { select: { id: true, name: true, email: true, role: true } } }
    });
    res.status(201).json(record);
  } catch (error) {
    console.error("Create industry record error:", error);
    res.status(500).json({ error: "No se pudo crear el registro del rubro" });
  }
});

industryRecordsRouter.patch("/industry-records/:id", requireRole(ROLE_GROUPS.STAFF), async (req, res) => {
  try {
    const existing = await prisma.industryRecord.findFirst({
      where: { id: req.params.id, tenantId: req.tenantId }
    });
    if (!existing) return res.status(404).json({ error: "Registro no encontrado" });
    if (!(await assertRecordModule(req, existing.recordType))) {
      return res.status(403).json({ error: `Modulo no habilitado para ${existing.recordType}` });
    }

    const data = {};
    if (req.body?.title !== undefined) data.title = cleanText(req.body.title, existing.title);
    if (req.body?.status !== undefined) data.status = cleanText(req.body.status, existing.status).toUpperCase();
    if (req.body?.assignedToId !== undefined) {
      const assignedToId = cleanText(req.body.assignedToId) || null;
      if (assignedToId) {
        const user = await prisma.workspaceUser.findFirst({ where: { id: assignedToId, tenantId: req.tenantId, isActive: true } });
        if (!user) return res.status(400).json({ error: "Usuario asignado no pertenece a este cliente" });
      }
      data.assignedToId = assignedToId;
    }
    if (req.body?.data !== undefined) data.data = normalizeMetadata(req.body.data, {});

    const record = await prisma.industryRecord.update({
      where: { id: existing.id },
      data,
      include: { assignedTo: { select: { id: true, name: true, email: true, role: true } } }
    });
    res.json(record);
  } catch (error) {
    console.error("Update industry record error:", error);
    res.status(500).json({ error: "No se pudo actualizar el registro" });
  }
});

industryRecordsRouter.patch("/industry-records/:id/metadata", requireRole(ROLE_GROUPS.STAFF), async (req, res) => {
  try {
    const existing = await prisma.industryRecord.findFirst({
      where: { id: req.params.id, tenantId: req.tenantId }
    });
    if (!existing) return res.status(404).json({ error: "Registro no encontrado" });
    if (!(await assertRecordModule(req, existing.recordType))) {
      return res.status(403).json({ error: `Modulo no habilitado para ${existing.recordType}` });
    }

    const patch = normalizeMetadata(req.body?.metadata ?? req.body?.data, {});
    const record = await prisma.industryRecord.update({
      where: { id: existing.id },
      data: { data: mergeMetadata(existing.data, patch) },
      include: { assignedTo: { select: { id: true, name: true, email: true, role: true } } }
    });
    res.json(record);
  } catch (error) {
    console.error("Update industry metadata error:", error);
    res.status(500).json({ error: "No se pudieron actualizar los metadatos" });
  }
});

industryRecordsRouter.delete("/industry-records/:id", requireRole(ROLE_GROUPS.MANAGERS), async (req, res) => {
  try {
    const existing = await prisma.industryRecord.findFirst({ where: { id: req.params.id, tenantId: req.tenantId } });
    if (!existing) return res.status(404).json({ error: "Registro no encontrado" });
    await prisma.industryRecord.delete({ where: { id: existing.id } });
    res.json({ ok: true });
  } catch (error) {
    console.error("Delete industry record error:", error);
    res.status(500).json({ error: "No se pudo eliminar el registro" });
  }
});

industryRecordsRouter.post("/industry-records/assignments/balance", requireRole(ROLE_GROUPS.STAFF), async (req, res) => {
  try {
    const recordType = normalizeRecordType(req.body?.recordType || "property");
    const assigneeRole = cleanText(req.body?.assigneeRole, "SELLER").toUpperCase();
    const records = await prisma.industryRecord.findMany({
      where: { tenantId: req.tenantId, recordType, status: { not: "ARCHIVED" } },
      orderBy: [{ createdAt: "asc" }]
    });
    const assignees = await prisma.workspaceUser.findMany({
      where: { tenantId: req.tenantId, isActive: true, role: assigneeRole },
      select: { id: true, name: true, email: true, role: true },
      orderBy: { name: "asc" }
    });

    const plan = buildBalancedAssignments(records, assignees);
    res.json({ recordType, assigneeRole, assignments: plan });
  } catch (error) {
    console.error("Balance industry assignments error:", error);
    res.status(500).json({ error: "No se pudo calcular la asignacion" });
  }
});
