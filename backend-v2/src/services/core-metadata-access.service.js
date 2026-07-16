import { redactMetadataForRole } from "../lib/metadata-access.js";
import { getPublishedMetadataSchema } from "./metadata-schemas.service.js";

export async function redactCoreMetadataForViewer({ tenantId, role, recordType, record, key }) {
  if (!record || role === "SUPER_ADMIN") return record;
  const schema = await getPublishedMetadataSchema(tenantId, recordType);
  if (!schema) return record;
  const redacted = redactMetadataForRole(record[key], schema, role);
  return { ...record, [key]: redacted.data, metadataAccess: redacted.hiddenFields.length ? { hiddenFields: redacted.hiddenFields } : undefined };
}
