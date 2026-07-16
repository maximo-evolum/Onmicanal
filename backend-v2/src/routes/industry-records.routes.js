import { Router } from "express";
import bcrypt from "bcryptjs";
import { prisma } from "../lib/db.js";
import { MODULES } from "../lib/modules.js";
import { buildBalancedAssignments } from "../lib/industries.js";
import { ensureTenantModuleEligibility } from "../services/tenant-modules.service.js";
import { requireRole, ROLE_GROUPS } from "../middleware/tenant-access.js";
import { mergeMetadata, normalizeMetadata } from "../lib/metadata.js";
import { recordAuditLog } from "../lib/audit.js";
import { getPublishedMetadataSchema } from "../services/metadata-schemas.service.js";
import { evaluateMetadataSchema } from "../lib/metadata-enforcement.js";
import { redactMetadataForRole } from "../lib/metadata-access.js";

export const industryRecordsRouter = Router();

const RECORD_MODULES = Object.freeze({
  property: MODULES.PROPERTIES,
  property_import: MODULES.REALTY_LOADS,
  property_training: MODULES.REALTY_LOADS,
  owner: MODULES.PROPERTIES,
  broker_profile: MODULES.BROKERS,
  seller_assignment: MODULES.PROPERTY_ASSIGNMENTS,
  lead: MODULES.SALES,
  visit: MODULES.BOOKINGS,
  realty_alert: MODULES.REALTY_ACTIVITY,
  broker_followup: MODULES.BROKER_PORTAL,
  deal: MODULES.SALES,
  commission_distribution: MODULES.SALES,
  forecast: MODULES.AI_OPS,
  ai_interaction: MODULES.AI_OPS,
  customer: MODULES.CUSTOMERS,
  revenue: MODULES.REVENUE,
  vehicle: MODULES.VEHICLES,
  part: MODULES.PARTS_INVENTORY,
  work_order: MODULES.MECHANIC_ASSIGNMENTS,
  ready_notification: MODULES.READY_NOTIFICATIONS,
  document: MODULES.DOCUMENTS,
  workflow_definition: MODULES.WORKFLOWS,
  workflow_run: MODULES.WORKFLOWS
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
  if (role === "SUPER_ADMIN") return true;
  const module = RECORD_MODULES[recordType];
  if (!module) return true;
  return ensureTenantModuleEligibility({ tenantId: req.tenantId, module, tenant: req.tenant });
}

async function evaluateRecordMetadata(tenantId, recordType, data) {
  const schema = await getPublishedMetadataSchema(tenantId, recordType);
  const evaluation = evaluateMetadataSchema({ data, schema });
  if (!schema || !evaluation.result) return evaluation;
  for (const [field, config] of Object.entries(schema.fields || {})) {
    if (String(config?.type || "").toLowerCase() !== "relation" || !data?.[field]) continue;
    const targetType = String(config.relationRecordType || "").trim();
    if (!targetType) {
      evaluation.result.errors.push({ field, code: "RELATION_TARGET_REQUIRED", message: "La relación debe declarar relationRecordType" });
      continue;
    }
    const exists = await prisma.industryRecord.findFirst({ where: { id: String(data[field]), tenantId, recordType: targetType }, select: { id: true } });
    if (!exists) evaluation.result.errors.push({ field, code: "INVALID_RELATION", message: "El registro relacionado no existe en este tenant" });
  }
  evaluation.result.ok = evaluation.result.errors.length === 0;
  evaluation.blocking = evaluation.mode === "STRICT" && !evaluation.result.ok;
  return evaluation;
}

function metadataValidationResponse(evaluation) {
  if (!evaluation.result) return null;
  return {
    schemaVersion: evaluation.schemaVersion,
    mode: evaluation.mode,
    ok: evaluation.result.ok,
    errors: evaluation.result.errors,
    unknownFields: evaluation.result.unknownFields
  };
}

async function redactRecordForViewer(req, record) {
  const schema = await getPublishedMetadataSchema(req.tenantId, record.recordType);
  if (!schema || req.user?.role === "SUPER_ADMIN") return record;
  const redacted = redactMetadataForRole(record.data, schema, req.user?.role);
  return { ...record, data: redacted.data, metadataAccess: redacted.hiddenFields.length ? { hiddenFields: redacted.hiddenFields } : undefined };
}

function tenantRecordWhere(req, extra = {}) {
  if (req.user?.role === "SUPER_ADMIN" && req.query?.tenantId) {
    return { tenantId: String(req.query.tenantId), ...extra };
  }
  return { tenantId: req.tenantId, ...extra };
}

async function hashPassword(password) {
  return bcrypt.hash(String(password), 10);
}

industryRecordsRouter.get("/industry-records/users", async (req, res) => {
  try {
    const users = await prisma.workspaceUser.findMany({
      where: {
        tenantId: req.user?.role === "SUPER_ADMIN" && req.query?.tenantId ? String(req.query.tenantId) : req.tenantId,
        isActive: true
      },
      select: { id: true, name: true, email: true, role: true, jobTitle: true },
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
    res.json(await Promise.all(records.map((record) => redactRecordForViewer(req, record))));
  } catch (error) {
    console.error("List industry records error:", error);
    res.status(500).json({ error: "No se pudieron obtener registros del rubro" });
  }
});

industryRecordsRouter.post("/industry-records/brokers", requireRole(ROLE_GROUPS.MANAGERS), async (req, res) => {
  try {
    if (!(await assertRecordModule(req, "broker_profile"))) {
      return res.status(403).json({ error: "Modulo de corredores no habilitado" });
    }

    const name = cleanText(req.body?.name);
    const email = cleanText(req.body?.email).toLowerCase();
    const password = cleanText(req.body?.password);
    const phone = cleanText(req.body?.phone);

    if (!name || !email || !password) {
      return res.status(400).json({ error: "Nombre, email y contrasena son requeridos" });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: "La contrasena debe tener al menos 6 caracteres" });
    }

    const existing = await prisma.workspaceUser.findUnique({ where: { email } });
    if (existing) {
      return res.status(409).json({ error: "Ya existe un usuario con este correo" });
    }

    const result = await prisma.$transaction(async (tx) => {
      const user = await tx.workspaceUser.create({
        data: {
          tenantId: req.tenantId,
          name,
          email,
          passwordHash: await hashPassword(password),
          role: "SELLER",
          jobTitle: "Corredor inmobiliario",
          isActive: true
        },
        select: { id: true, name: true, email: true, role: true, jobTitle: true }
      });

      const profile = await tx.industryRecord.create({
        data: {
          tenantId: req.tenantId,
          recordType: "broker_profile",
          title: name,
          status: "ACTIVE",
          assignedToId: user.id,
          data: {
            name,
            email,
            phone,
            role: "Corredor",
            workspaceRole: "SELLER",
            userId: user.id,
            moduleScope: ["crm", "inbox", "agenda", "dashboard", "pipeline", "ai_ops", "properties", "broker_portal"]
          }
        },
        include: { assignedTo: { select: { id: true, name: true, email: true, role: true, jobTitle: true } } }
      });

      return { user, profile };
    });

    await recordAuditLog(req, "BROKER_USER_CREATED", "broker_profile", result.profile.id, {
      userId: result.user.id,
      email: result.user.email
    });
    res.status(201).json(result);
  } catch (error) {
    console.error("Create broker user error:", error);
    res.status(500).json({ error: "No se pudo crear el corredor" });
  }
});

// El perfil de corredor y su usuario son una sola unidad operacional. Al
// eliminarlo, la cartera queda disponible para reasignacion sin perder fichas.
industryRecordsRouter.delete("/industry-records/brokers/:userId", requireRole(ROLE_GROUPS.MANAGERS), async (req, res) => {
  try {
    if (!(await assertRecordModule(req, "broker_profile"))) {
      return res.status(403).json({ error: "Modulo de corredores no habilitado" });
    }

    const broker = await prisma.workspaceUser.findFirst({
      where: { id: req.params.userId, tenantId: req.tenantId },
      select: { id: true, name: true, email: true, role: true, jobTitle: true }
    });
    if (!broker) return res.status(404).json({ error: "Corredor no encontrado" });

    const jobTitle = String(broker.jobTitle || "").toLowerCase();
    if (broker.role !== "SELLER" && !jobTitle.includes("corredor")) {
      return res.status(400).json({ error: "Solo se pueden eliminar perfiles de corredor desde este modulo" });
    }

    const assignedProperties = await prisma.industryRecord.findMany({
      where: { tenantId: req.tenantId, recordType: "property", assignedToId: broker.id },
      select: { id: true, data: true }
    });

    await prisma.$transaction(async (tx) => {
      for (const property of assignedProperties) {
        const currentData = property.data && typeof property.data === "object" && !Array.isArray(property.data)
          ? property.data
          : {};
        await tx.industryRecord.update({
          where: { id: property.id },
          data: {
            assignedToId: null,
            data: {
              ...currentData,
              assignedBrokerId: "",
              assignedBrokerName: "",
              assignmentMode: "sin_corredor"
            }
          }
        });
      }

      await tx.industryRecord.deleteMany({
        where: { tenantId: req.tenantId, recordType: "broker_profile", assignedToId: broker.id }
      });
      await tx.workspaceUser.delete({ where: { id: broker.id } });
    });

    await recordAuditLog(req, "BROKER_USER_DELETED", "broker_profile", broker.id, {
      name: broker.name,
      email: broker.email,
      unassignedProperties: assignedProperties.length
    });
    res.json({ ok: true, unassignedProperties: assignedProperties.length });
  } catch (error) {
    console.error("Delete broker user error:", error);
    res.status(500).json({ error: "No se pudo eliminar el corredor" });
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

    const normalizedData = normalizeMetadata(req.body?.data, {});
    const evaluation = await evaluateRecordMetadata(req.tenantId, recordType, normalizedData);
    if (evaluation.blocking) {
      return res.status(422).json({ error: "Los metadatos no cumplen el esquema publicado", metadataValidation: metadataValidationResponse(evaluation) });
    }

    const record = await prisma.industryRecord.create({
      data: {
        tenantId: req.tenantId,
        recordType,
        title,
        status: cleanText(req.body?.status, "ACTIVE").toUpperCase(),
        assignedToId,
        data: normalizedData,
        schemaVersion: evaluation.schemaVersion
      },
      include: { assignedTo: { select: { id: true, name: true, email: true, role: true } } }
    });
    await recordAuditLog(req, "INDUSTRY_RECORD_CREATED", recordType, record.id, { recordType, status: record.status });
    res.status(201).json({ ...(await redactRecordForViewer(req, record)), metadataValidation: metadataValidationResponse(evaluation) });
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
    const nextMetadata = req.body?.data !== undefined ? normalizeMetadata(req.body.data, {}) : existing.data;
    const evaluation = await evaluateRecordMetadata(req.tenantId, existing.recordType, nextMetadata);
    if (evaluation.blocking) {
      return res.status(422).json({ error: "Los metadatos no cumplen el esquema publicado", metadataValidation: metadataValidationResponse(evaluation) });
    }
    if (req.body?.data !== undefined) data.data = nextMetadata;
    if (evaluation.schemaVersion) data.schemaVersion = evaluation.schemaVersion;

    const record = await prisma.industryRecord.update({
      where: { id: existing.id },
      data,
      include: { assignedTo: { select: { id: true, name: true, email: true, role: true } } }
    });
    await recordAuditLog(req, "INDUSTRY_RECORD_UPDATED", existing.recordType, record.id, { recordType: existing.recordType, status: record.status });
    res.json({ ...(await redactRecordForViewer(req, record)), metadataValidation: metadataValidationResponse(evaluation) });
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
    const nextMetadata = mergeMetadata(existing.data, patch);
    const evaluation = await evaluateRecordMetadata(req.tenantId, existing.recordType, nextMetadata);
    if (evaluation.blocking) {
      return res.status(422).json({ error: "Los metadatos no cumplen el esquema publicado", metadataValidation: metadataValidationResponse(evaluation) });
    }
    const record = await prisma.industryRecord.update({
      where: { id: existing.id },
      data: { data: nextMetadata, ...(evaluation.schemaVersion ? { schemaVersion: evaluation.schemaVersion } : {}) },
      include: { assignedTo: { select: { id: true, name: true, email: true, role: true } } }
    });
    await recordAuditLog(req, "INDUSTRY_RECORD_METADATA_UPDATED", existing.recordType, record.id, { recordType: existing.recordType });
    res.json({ ...(await redactRecordForViewer(req, record)), metadataValidation: metadataValidationResponse(evaluation) });
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
    await recordAuditLog(req, "INDUSTRY_RECORD_DELETED", existing.recordType, existing.id, { recordType: existing.recordType, title: existing.title });
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
