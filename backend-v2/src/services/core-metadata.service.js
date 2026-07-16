import { evaluateMetadataSchema } from "../lib/metadata-enforcement.js";
import { getPublishedMetadataSchema } from "./metadata-schemas.service.js";

export async function resolveCoreMetadata({ tenantId, recordType, metadata }) {
  const schema = await getPublishedMetadataSchema(tenantId, recordType);
  const evaluation = evaluateMetadataSchema({ data: metadata || {}, schema });
  if (evaluation.blocking) {
    const error = new Error("Los metadatos no cumplen el esquema publicado");
    error.statusCode = 422;
    error.metadataValidation = evaluation.result;
    throw error;
  }
  return { metadata: evaluation.result?.data || metadata || {}, schemaVersion: evaluation.schemaVersion || null, validation: evaluation.result };
}
