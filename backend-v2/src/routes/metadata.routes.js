import { Router } from "express";
import { MODULES, PLAN_DEFINITIONS } from "../lib/modules.js";
import { metadataFields, normalizeMetadata, validateMetadata } from "../lib/metadata.js";
import { getAnyIndustryTemplate, listAllIndustryTemplates } from "../services/industry-templates.service.js";
import { getTenantModules } from "../services/tenant-modules.service.js";
import { createMetadataSchemaDraft, getPublishedMetadataSchema, listMetadataSchemas, publishMetadataSchema } from "../services/metadata-schemas.service.js";
import { requireRole, ROLE_GROUPS } from "../middleware/tenant-access.js";
import { recordAuditLog } from "../lib/audit.js";
import { METADATA_GOVERNANCE_CATALOG } from "../lib/metadata-governance.js";
import { anonymizeExpiredSensitiveFields, retentionDueFields } from "../lib/metadata-retention.js";
import { env } from "../lib/env.js";
import { prisma } from "../lib/db.js";
import { migrateMetadataValue } from "../lib/metadata-migration.js";
import { getMetadataSchemaQuality } from "../services/metadata-quality.service.js";

export const metadataRouter = Router();

// Metadatos define estructuras, retencion y reglas de validacion para toda
// la cuenta. Solo perfiles administrativos pueden consultarlo o modificarlo.
metadataRouter.use(requireRole(ROLE_GROUPS.MANAGERS));

function cleanRecordType(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, "_");
}

function inferFieldType(value) {
  if (Array.isArray(value)) return "array";
  if (value === null || value === undefined) return "string";
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "object") return "object";
  return "string";
}

function entityToSchema(entity = {}) {
  const fields = metadataFields(entity);
  return {
    recordType: entity.type || entity.code || entity.name,
    label: entity.label || entity.name || entity.type,
    fields: Object.entries(fields).map(([name, config]) => ({
      name,
      type: typeof config === "string" ? config : config?.type || inferFieldType(config?.default),
      required: Boolean(config?.required),
      options: Array.isArray(config?.options) ? config.options : undefined
    }))
  };
}

metadataRouter.get("/metadata/catalog", async (req, res) => {
  try {
    const tenantIndustry = req.tenant?.industry || "GENERAL";
    const requestedIndustry = String(req.query.industry || "").trim();
    // Solo el Super Admin puede explorar fichas de otras verticales. Para el
    // resto, incluso si modifica la URL manualmente, se conserva su rubro.
    const selectedIndustry = req.user?.role === "SUPER_ADMIN" && requestedIndustry
      ? requestedIndustry
      : tenantIndustry;
    const template = await getAnyIndustryTemplate(selectedIndustry);
    const modules = await getTenantModules(req.tenantId);
    const templateEntities = Array.isArray(template?.entities)
      ? template.entities.map(entityToSchema)
      : Object.entries(template?.entities || {}).map(([type, config]) => entityToSchema({ type, ...(config || {}) }));
    const publishedSchemas = await listMetadataSchemas(req.tenantId);
    const overrides = publishedSchemas.filter((item) => item.status === "PUBLISHED");
    const entities = [
      ...templateEntities.filter((entity) => !overrides.some((schema) => schema.recordType === entity.recordType)),
      ...overrides.map((schema) => ({ recordType: schema.recordType, label: schema.label, fields: Object.entries(schema.fields || {}).map(([name, config]) => ({ name, type: config?.type || "string", required: Boolean(config?.required), options: config?.options })) }))
    ];
    const allEntities = req.user?.role === "SUPER_ADMIN"
      ? (await listAllIndustryTemplates()).flatMap((industry) => {
        const rawEntities = Array.isArray(industry?.entities)
          ? industry.entities
          : Object.entries(industry?.entities || {}).map(([type, config]) => ({ type, ...(config || {}) }));
        return rawEntities.map((entity) => ({ ...entityToSchema(entity), industry: industry.code, industryLabel: industry.name }));
      })
      : [];

    res.json({
      tenantId: req.tenantId,
      industry: template?.code || tenantIndustry,
      activeModules: modules,
      modules: MODULES,
      plans: PLAN_DEFINITIONS,
      entities,
      allEntities,
      industries: await listAllIndustryTemplates()
    });
  } catch (error) {
    console.error("Metadata catalog error:", error);
    res.status(500).json({ error: "No se pudo cargar catalogo de metadata" });
  }
});

metadataRouter.get("/metadata/schemas", requireRole(ROLE_GROUPS.MANAGERS), async (req, res) => {
  const recordType = cleanRecordType(req.query.recordType);
  res.json({ schemas: await listMetadataSchemas(req.tenantId, recordType) });
});

// Preflight de calidad antes de publicar o endurecer un esquema. No retorna
// valores de negocio: solo IDs, conteos y tipos de incumplimiento.
metadataRouter.get("/metadata/schemas/:id/quality", requireRole(ROLE_GROUPS.MANAGERS), async (req, res) => {
  try {
    const schema = await prisma.metadataSchema.findFirst({ where: { id: req.params.id, tenantId: req.tenantId } });
    if (!schema) return res.status(404).json({ error: "Esquema no encontrado" });
    return res.json(await getMetadataSchemaQuality({ tenantId: req.tenantId, schema, limit: req.query.limit }));
  } catch (error) {
    console.error("Metadata quality report error:", error);
    return res.status(500).json({ error: "No se pudo generar el reporte de calidad" });
  }
});

metadataRouter.get("/metadata/governance-catalog", requireRole(ROLE_GROUPS.MANAGERS), (_req, res) => {
  res.json(METADATA_GOVERNANCE_CATALOG);
});

metadataRouter.get("/metadata/retention/report", requireRole(ROLE_GROUPS.MANAGERS), async (req, res) => {
  const schemas = (await listMetadataSchemas(req.tenantId)).filter((item) => item.status === "PUBLISHED");
  const records = await prisma.industryRecord.findMany({ where: { tenantId: req.tenantId, recordType: { in: schemas.map((item) => item.recordType) } }, take: 1000 });
  const schemaByType = new Map(schemas.map((item) => [item.recordType, item]));
  const due = records.flatMap((record) => retentionDueFields(record, schemaByType.get(record.recordType)).map((field) => ({ recordId: record.id, recordType: record.recordType, ...field })));
  res.json({ generatedAt: new Date().toISOString(), automaticDeletionEnabled: env.metadataRetentionEnabled, reviewedRecords: records.length, due });
});

metadataRouter.post("/metadata/retention/anonymize", requireRole(ROLE_GROUPS.MANAGERS), async (req, res) => {
  if (!env.metadataRetentionEnabled) return res.status(409).json({ error: "La anonimización automática está desactivada. Configura METADATA_RETENTION_ENABLED=true después de revisar el reporte." });
  const schemas = (await listMetadataSchemas(req.tenantId)).filter((item) => item.status === "PUBLISHED");
  const schemaByType = new Map(schemas.map((item) => [item.recordType, item]));
  const records = await prisma.industryRecord.findMany({ where: { tenantId: req.tenantId, recordType: { in: schemas.map((item) => item.recordType) } }, take: 1000 });
  let updated = 0;
  for (const record of records) {
    const result = anonymizeExpiredSensitiveFields(record, schemaByType.get(record.recordType));
    if (!result.due.length) continue;
    await prisma.industryRecord.update({ where: { id: record.id }, data: { data: result.data } });
    updated += 1;
  }
  await recordAuditLog(req, "METADATA_RETENTION_ANONYMIZED", "industry_record", null, { updated });
  res.json({ updated });
});

metadataRouter.post("/metadata/schemas", requireRole(ROLE_GROUPS.MANAGERS), async (req, res) => {
  try {
    const recordType = cleanRecordType(req.body?.recordType);
    const label = String(req.body?.label || "").trim();
    if (!recordType || !label) return res.status(400).json({ error: "recordType y label son requeridos" });
    const schema = await createMetadataSchemaDraft({ tenantId: req.tenantId, recordType, label, fields: req.body?.fields, policies: req.body?.policies });
    await recordAuditLog(req, "METADATA_SCHEMA_DRAFT_CREATED", "metadata_schema", schema.id, { recordType, version: schema.version });
    return res.status(201).json({ schema });
  } catch (error) {
    console.error("Create metadata schema error:", error);
    return res.status(error.statusCode || 500).json({ error: error.message || "No se pudo crear el borrador de metadata", details: error.details });
  }
});

metadataRouter.post("/metadata/schemas/:id/publish", requireRole(ROLE_GROUPS.MANAGERS), async (req, res) => {
  try {
    const schema = await publishMetadataSchema({ tenantId: req.tenantId, id: req.params.id });
    if (!schema) return res.status(404).json({ error: "Borrador no encontrado" });
    await recordAuditLog(req, "METADATA_SCHEMA_PUBLISHED", "metadata_schema", schema.id, { recordType: schema.recordType, version: schema.version });
    return res.json({ schema });
  } catch (error) {
    console.error("Publish metadata schema error:", error);
    return res.status(500).json({ error: "No se pudo publicar el esquema de metadata" });
  }
});

metadataRouter.post("/metadata/schemas/:id/migrate", requireRole(ROLE_GROUPS.MANAGERS), async (req, res) => {
  const target = await prisma.metadataSchema.findFirst({ where: { id: req.params.id, tenantId: req.tenantId, status: "PUBLISHED" } });
  if (!target) return res.status(404).json({ error: "Esquema publicado no encontrado" });
  const migration = target.policies?.migration || {};
  const records = await prisma.industryRecord.findMany({ where: { tenantId: req.tenantId, recordType: target.recordType, OR: [{ schemaVersion: null }, { schemaVersion: { lt: target.version } }] }, take: 1000 });
  const preview = records.map((record) => ({ id: record.id, before: record.data, after: migrateMetadataValue(record.data, migration) }));
  if (req.body?.apply !== true) return res.json({ dryRun: true, targetVersion: target.version, records: preview });
  for (const item of preview) await prisma.industryRecord.update({ where: { id: item.id }, data: { data: item.after, schemaVersion: target.version } });
  await recordAuditLog(req, "METADATA_SCHEMA_MIGRATED", "metadata_schema", target.id, { migrated: preview.length, targetVersion: target.version });
  return res.json({ dryRun: false, migrated: preview.length, targetVersion: target.version });
});

metadataRouter.post("/metadata/schemas/:id/migrate-core", requireRole(ROLE_GROUPS.MANAGERS), async (req, res) => {
  const target = await prisma.metadataSchema.findFirst({ where: { id: req.params.id, tenantId: req.tenantId, status: "PUBLISHED" } });
  const definitions = {
    lead: { model: prisma.lead, key: "customFields" },
    booking: { model: prisma.booking, key: "metadata" },
    payment: { model: prisma.payment, key: "metadata" }
  };
  const definition = definitions[target?.recordType];
  if (!target || !definition) return res.status(400).json({ error: "Este esquema no corresponde a un modelo core migrable" });
  const records = await definition.model.findMany({ where: { tenantId: req.tenantId, OR: [{ schemaVersion: null }, { schemaVersion: { lt: target.version } }] }, take: 1000 });
  const migration = target.policies?.migration || {};
  const preview = records.map((record) => ({ id: record.id, before: record[definition.key] || {}, after: migrateMetadataValue(record[definition.key], migration) }));
  if (req.body?.apply !== true) return res.json({ dryRun: true, recordType: target.recordType, targetVersion: target.version, records: preview });
  for (const item of preview) await definition.model.update({ where: { id: item.id }, data: { [definition.key]: item.after, schemaVersion: target.version } });
  await recordAuditLog(req, "METADATA_CORE_SCHEMA_MIGRATED", "metadata_schema", target.id, { recordType: target.recordType, migrated: preview.length, targetVersion: target.version });
  return res.json({ dryRun: false, recordType: target.recordType, migrated: preview.length, targetVersion: target.version });
});

metadataRouter.post("/metadata/normalize", (req, res) => {
  res.json({
    metadata: normalizeMetadata(req.body?.metadata ?? req.body ?? {}, {}),
    maxDepth: 6
  });
});

metadataRouter.post("/metadata/validate", async (req, res) => {
  try {
    const template = await getAnyIndustryTemplate(req.body?.industry || req.tenant?.industry || "GENERAL");
    const recordType = String(req.body?.recordType || "").trim();
    const data = normalizeMetadata(req.body?.data || {}, {});
    const rawEntities = Array.isArray(template?.entities)
      ? template.entities
      : Object.entries(template?.entities || {}).map(([type, config]) => ({ type, ...(config || {}) }));
    const templateSchema = rawEntities.find((entity) => [entity.type, entity.code, entity.name].includes(recordType));
    const publishedSchema = await getPublishedMetadataSchema(req.tenantId, recordType);
    const schema = publishedSchema ? { fields: publishedSchema.fields } : templateSchema;
    const result = validateMetadata(data, schema, {
      allowUnknown: req.body?.allowUnknown !== false
    });

    res.json({
      ...result,
      recordType,
      schemaVersion: publishedSchema?.version || 1,
      source: publishedSchema ? "tenant_published" : "industry_template"
    });
  } catch (error) {
    console.error("Metadata validate error:", error);
    res.status(500).json({ error: "No se pudo validar metadata" });
  }
});
