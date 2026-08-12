import { Router } from "express";
import bcrypt from "bcryptjs";
import { prisma } from "../lib/db.js";
import { MODULES } from "../lib/modules.js";
import { buildBalancedAssignments } from "../lib/industries.js";
import { isModuleAllowedForIndustry } from "../lib/industry-module-access.js";
import { ensureTenantModuleEligibility } from "../services/tenant-modules.service.js";
import { requireRole, ROLE_GROUPS } from "../middleware/tenant-access.js";
import { mergeMetadata, normalizeMetadata } from "../lib/metadata.js";
import { recordAuditLog } from "../lib/audit.js";
import { ensureAutomatedMetadataDraft, getPublishedMetadataSchema } from "../services/metadata-schemas.service.js";
import { evaluateMetadataRecord } from "../services/metadata-quality.service.js";
import { redactMetadataForRole } from "../lib/metadata-access.js";
import { runWorkflowsForEvent } from "./workflows.routes.js";
import { runFinancePostIngestionAnalysis } from "../services/finance-automation.service.js";

export const industryRecordsRouter = Router();

const RECORD_MODULES = Object.freeze({
  property: MODULES.PROPERTIES,
  property_import: MODULES.REALTY_LOADS,
  // La formación pertenece al equipo de corredores; no a la carga de
  // propiedades. Esto permite llevar progreso de capacitación sin mezclarlo
  // con inventario ni importaciones.
  property_training: MODULES.BROKERS,
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
  customer: MODULES.REALTY_CLIENTS,
  patient: MODULES.PATIENTS,
  exam: MODULES.EXAMS,
  revenue: MODULES.REVENUE,
  vehicle: MODULES.VEHICLE_OWNERS,
  part: MODULES.PARTS_INVENTORY,
  work_order: MODULES.MECHANIC_ASSIGNMENTS,
  ready_notification: MODULES.READY_NOTIFICATIONS,
  shift: MODULES.SHIFT_MANAGEMENT,
  restaurant_table: MODULES.GASTRONOMY_OPERATIONS,
  restaurant_order: MODULES.GASTRONOMY_OPERATIONS,
  restaurant_daily_close: MODULES.GASTRONOMY_OPERATIONS,
  restaurant_guest: MODULES.GASTRONOMY_OPERATIONS,
  dental_patient: MODULES.DENTAL_CARE,
  dental_odontogram: MODULES.DENTAL_CARE,
  dental_treatment: MODULES.DENTAL_CARE,
  dental_consent: MODULES.DENTAL_CARE,
  clinical_patient: MODULES.HEALTH_CARE,
  clinical_attention: MODULES.HEALTH_CARE,
  clinical_order: MODULES.HEALTH_CARE,
  clinical_followup: MODULES.HEALTH_CARE,
  veterinary_pet: MODULES.VETERINARY_CARE,
  veterinary_vaccine: MODULES.VETERINARY_CARE,
  veterinary_hospitalization: MODULES.VETERINARY_CARE,
  veterinary_prescription: MODULES.VETERINARY_CARE,
  document: MODULES.DOCUMENTS,
  workflow_definition: MODULES.WORKFLOWS,
  workflow_run: MODULES.WORKFLOWS,
  finance_invoice: MODULES.FINANCE_INVOICES,
  bank_statement: MODULES.FINANCE_BANK_SYNC,
  bank_movement: MODULES.FINANCE_BANK_SYNC,
  finance_reconciliation: MODULES.FINANCE_RECONCILIATION,
  finance_exception: MODULES.FINANCE_EXCEPTIONS,
  finance_collection_case: MODULES.FINANCE_COLLECTIONS
});

function cleanText(value, fallback = "") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function normalizeRecordType(value) {
  return cleanText(value, "property").toLowerCase().replace(/\s+/g, "_");
}

async function assertRecordModule(req, recordType) {
  const module = RECORD_MODULES[recordType];
  if (!module) return true;
  const role = req.user?.role;
  if (role === "SUPER_ADMIN") return true;
  if (!isModuleAllowedForIndustry(module, req.tenant?.industry)) return false;
  return ensureTenantModuleEligibility({ tenantId: req.tenantId, module, tenant: req.tenant });
}

async function evaluateRecordMetadata(tenantId, recordType, data) {
  const schema = await getPublishedMetadataSchema(tenantId, recordType);
  return evaluateMetadataRecord({ tenantId, data, schema });
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

    const requestedId = String(req.params.userId || "");
    const brokerUser = await prisma.workspaceUser.findFirst({
      where: { id: req.params.userId, tenantId: req.tenantId },
      select: { id: true, name: true, email: true, role: true, jobTitle: true }
    });

    // Algunos corredores históricos existen solo como ficha (su usuario pudo
    // haberse eliminado antes). El frontend los muestra igual, por lo que la
    // baja debe poder limpiar esa ficha sin devolver un falso "no encontrado".
    const brokerProfiles = await prisma.industryRecord.findMany({
      where: { tenantId: req.tenantId, recordType: "broker_profile" },
      select: { id: true, title: true, assignedToId: true, data: true }
    });
    const matchingProfiles = brokerProfiles.filter((profile) => {
      const data = profile.data && typeof profile.data === "object" && !Array.isArray(profile.data) ? profile.data : {};
      return profile.id === requestedId || profile.assignedToId === requestedId || String(data.userId || "") === requestedId;
    });

    if (!brokerUser && !matchingProfiles.length) return res.status(404).json({ error: "Corredor no encontrado" });

    const jobTitle = String(brokerUser?.jobTitle || "").toLowerCase();
    if (brokerUser && brokerUser.role !== "SELLER" && !jobTitle.includes("corredor")) {
      return res.status(400).json({ error: "Solo se pueden eliminar perfiles de corredor desde este modulo" });
    }

    const brokerIds = new Set([requestedId]);
    if (brokerUser?.id) brokerIds.add(brokerUser.id);
    for (const profile of matchingProfiles) {
      brokerIds.add(profile.id);
      if (profile.assignedToId) brokerIds.add(profile.assignedToId);
      const data = profile.data && typeof profile.data === "object" && !Array.isArray(profile.data) ? profile.data : {};
      if (data.userId) brokerIds.add(String(data.userId));
    }

    const properties = await prisma.industryRecord.findMany({
      where: { tenantId: req.tenantId, recordType: "property" },
      select: { id: true, data: true, assignedToId: true }
    });
    const assignedProperties = properties.filter((property) => {
      const data = property.data && typeof property.data === "object" && !Array.isArray(property.data) ? property.data : {};
      return brokerIds.has(String(property.assignedToId || "")) || brokerIds.has(String(data.assignedBrokerId || ""));
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

      if (matchingProfiles.length) {
        await tx.industryRecord.deleteMany({ where: { id: { in: matchingProfiles.map((profile) => profile.id) } } });
      }
      if (brokerUser) await tx.workspaceUser.delete({ where: { id: brokerUser.id } });
    });

    const profileData = matchingProfiles[0]?.data && typeof matchingProfiles[0].data === "object" && !Array.isArray(matchingProfiles[0].data)
      ? matchingProfiles[0].data
      : {};
    await recordAuditLog(req, "BROKER_USER_DELETED", "broker_profile", brokerUser?.id || matchingProfiles[0]?.id || requestedId, {
      name: brokerUser?.name || cleanText(profileData.name) || matchingProfiles[0]?.title || "Corredor sin usuario",
      email: brokerUser?.email || cleanText(profileData.email),
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
    const automatedSchema = await ensureAutomatedMetadataDraft({
      tenantId: req.tenantId,
      industry: req.tenant?.industry,
      recordType
    });
    if (automatedSchema) {
      await recordAuditLog(req, "METADATA_SCHEMA_AUTO_DRAFT_CREATED", "metadata_schema", automatedSchema.id, {
        recordType,
        version: automatedSchema.version,
        industry: req.tenant?.industry || "GENERAL"
      });
    }
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
    // Los workflows por evento trabajan en segundo plano lógico: si uno falla,
    // queda en su cola de errores y no se pierde la ficha recién creada.
    const workflowDispatch = await runWorkflowsForEvent({
      tenantId: req.tenantId,
      event: "record.created",
      input: { recordType, status: record.status },
      target: { id: record.id, recordType, status: record.status }
    }).catch((error) => ({ event: "record.created", matched: 0, error: error?.message || "dispatch_failed" }));
    // Facturas y movimientos recién cargados quedan disponibles al instante.
    // El análisis se ejecuta aparte para no retrasar ni bloquear el guardado;
    // solo prepara sugerencias o excepciones según la política del tenant.
    if (["finance_invoice", "bank_movement", "bank_statement"].includes(recordType)) {
      void runFinancePostIngestionAnalysis({ tenantId: req.tenantId, source: `record:${recordType}` })
        .catch((error) => console.warn("[FINANCE_POST_INGESTION_WARNING]", error?.message || error));
    }
    res.status(201).json({
      ...(await redactRecordForViewer(req, record)),
      metadataValidation: metadataValidationResponse(evaluation),
      automatedSchema: automatedSchema ? { id: automatedSchema.id, label: automatedSchema.label, version: automatedSchema.version } : null,
      workflowDispatch
    });
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
    const workflowDispatch = await runWorkflowsForEvent({
      tenantId: req.tenantId,
      event: "record.updated",
      input: { recordType: existing.recordType, status: record.status },
      target: { id: record.id, recordType: existing.recordType, status: record.status }
    }).catch((error) => ({ event: "record.updated", matched: 0, error: error?.message || "dispatch_failed" }));
    res.json({ ...(await redactRecordForViewer(req, record)), metadataValidation: metadataValidationResponse(evaluation), workflowDispatch });
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
