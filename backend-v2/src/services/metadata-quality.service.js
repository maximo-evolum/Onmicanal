import { prisma } from "../lib/db.js";
import { evaluateMetadataSchema } from "../lib/metadata-enforcement.js";

function relationValues(value) {
  if (Array.isArray(value)) return value.map((item) => String(item || "").trim()).filter(Boolean);
  const single = String(value || "").trim();
  return single ? [single] : [];
}

/** Evalúa registros sin exponer los valores sensibles de las relaciones. */
export async function evaluateMetadataRecord({ tenantId, data, schema }) {
  const evaluation = evaluateMetadataSchema({ data, schema });
  if (!schema || !evaluation.result) return evaluation;

  for (const [field, config] of Object.entries(schema.fields || {})) {
    if (String(config?.type || "").toLowerCase() !== "relation") continue;
    const targets = relationValues(data?.[field]);
    if (!targets.length) continue;

    const targetType = String(config?.relationRecordType || "").trim().toLowerCase();
    if (!targetType) {
      evaluation.result.errors.push({ field, code: "RELATION_TARGET_REQUIRED", message: "La relación debe declarar relationRecordType" });
      continue;
    }

    const related = await prisma.industryRecord.findMany({
      where: { tenantId, recordType: targetType, id: { in: targets } },
      select: { id: true }
    });
    const found = new Set(related.map((item) => item.id));
    const missing = targets.filter((id) => !found.has(id));
    if (missing.length) {
      evaluation.result.errors.push({
        field,
        code: "INVALID_RELATION",
        message: "El registro relacionado no existe en este tenant",
        invalidCount: missing.length
      });
    }
  }

  evaluation.result.ok = evaluation.result.errors.length === 0;
  evaluation.blocking = evaluation.mode === "STRICT" && !evaluation.result.ok;
  return evaluation;
}

/** Preflight para decidir con evidencia si un esquema puede pasar a STRICT. */
export async function getMetadataSchemaQuality({ tenantId, schema, limit = 200 }) {
  const records = await prisma.industryRecord.findMany({
    where: { tenantId, recordType: schema.recordType },
    select: { id: true, status: true, schemaVersion: true, data: true, updatedAt: true },
    orderBy: { updatedAt: "desc" },
    take: Math.max(1, Math.min(Number(limit) || 200, 500))
  });

  const errorCounts = new Map();
  const samples = [];
  let valid = 0;
  let unknownFields = 0;

  for (const record of records) {
    const evaluation = await evaluateMetadataRecord({ tenantId, data: record.data || {}, schema });
    const errors = evaluation.result?.errors || [];
    unknownFields += evaluation.result?.unknownFields?.length || 0;
    if (!errors.length) {
      valid += 1;
      continue;
    }
    for (const error of errors) {
      const key = `${error.field || "_record"}:${error.code || "INVALID"}`;
      errorCounts.set(key, (errorCounts.get(key) || 0) + 1);
    }
    if (samples.length < 20) {
      samples.push({ recordId: record.id, status: record.status, schemaVersion: record.schemaVersion, updatedAt: record.updatedAt, errors });
    }
  }

  const reviewed = records.length;
  return {
    generatedAt: new Date().toISOString(),
    schema: { id: schema.id, recordType: schema.recordType, version: schema.version, status: schema.status },
    reviewed,
    valid,
    invalid: reviewed - valid,
    validPercent: reviewed ? Math.round((valid / reviewed) * 100) : 100,
    unknownFields,
    readyForStrictMode: reviewed === 0 || (valid === reviewed && unknownFields === 0),
    errorCounts: [...errorCounts.entries()].map(([key, count]) => {
      const [field, code] = key.split(":");
      return { field, code, count };
    }).sort((a, b) => b.count - a.count),
    samples
  };
}
