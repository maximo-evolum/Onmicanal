import { Router } from "express";
import { MODULES, PLAN_DEFINITIONS } from "../lib/modules.js";
import { normalizeMetadata } from "../lib/metadata.js";
import { getAnyIndustryTemplate, listAllIndustryTemplates } from "../services/industry-templates.service.js";
import { getTenantModules } from "../services/tenant-modules.service.js";

export const metadataRouter = Router();

function inferFieldType(value) {
  if (Array.isArray(value)) return "array";
  if (value === null || value === undefined) return "string";
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "object") return "object";
  return "string";
}

function entityToSchema(entity = {}) {
  const fields = Array.isArray(entity.fields)
    ? Object.fromEntries(entity.fields.map((field) => [field, { type: "string" }]))
    : entity.fields && typeof entity.fields === "object" ? entity.fields : {};
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
    const entities = Array.isArray(template?.entities)
      ? template.entities.map(entityToSchema)
      : Object.entries(template?.entities || {}).map(([type, config]) => entityToSchema({ type, ...(config || {}) }));

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
    const schema = rawEntities.find((entity) => [entity.type, entity.code, entity.name].includes(recordType));
    const fields = Array.isArray(schema?.fields)
      ? Object.fromEntries(schema.fields.map((field) => [field, { type: "string" }]))
      : schema?.fields && typeof schema.fields === "object" ? schema.fields : {};
    const missing = Object.entries(fields)
      .filter(([, config]) => Boolean(config?.required))
      .map(([key]) => key)
      .filter((key) => data[key] === undefined || data[key] === null || data[key] === "");

    res.json({
      ok: missing.length === 0,
      recordType,
      missing,
      data
    });
  } catch (error) {
    console.error("Metadata validate error:", error);
    res.status(500).json({ error: "No se pudo validar metadata" });
  }
});
