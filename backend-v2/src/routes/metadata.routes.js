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

export const metadataRouter = Router();

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
    const template = await getAnyIndustryTemplate(req.query.industry || tenantIndustry);
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

    res.json({
      tenantId: req.tenantId,
      industry: template?.code || tenantIndustry,
      activeModules: modules,
      modules: MODULES,
      plans: PLAN_DEFINITIONS,
      entities,
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

metadataRouter.get("/metadata/governance-catalog", requireRole(ROLE_GROUPS.MANAGERS), (_req, res) => {
  res.json(METADATA_GOVERNANCE_CATALOG);
});

metadataRouter.get("/metadata/retention/report", requireRole(ROLE_GROUPS.MANAGERS), async (req, res) => {
  const schemas = (await listMetadataSchemas(req.tenantId)).filter((item) => item.status === "PUBLISHED");
  const records = await prisma.industryRecord.findMany({ where: { tenantId: req.tenantId, recordType: { in: schemas.map((item) => item.recordType) } }, take: 1000 });
  const schemaByType = new Map(schemas.map((item) => [item.recordType, item]));
  const due = records.flatMap((record) => retentionDueFields(record, schemaByType.get(record.recordType)).map((field) => ({ recordId: record.id, recordType: record.recordType, ...field })));
  res.json({ generatedAt: new Date().toISOString(), automaticDeletionEnabled: false, reviewedRecords: records.length, due });
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
