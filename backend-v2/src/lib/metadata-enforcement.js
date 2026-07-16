import { validateMetadata } from "./metadata.js";

export function evaluateMetadataSchema({ data, schema }) {
  if (!schema) {
    return { schemaVersion: null, mode: "NONE", result: null, blocking: false };
  }

  const policies = schema.policies && typeof schema.policies === "object" ? schema.policies : {};
  const mode = String(policies.enforcement || "COMPATIBLE").toUpperCase() === "STRICT" ? "STRICT" : "COMPATIBLE";
  const result = validateMetadata(data, { fields: schema.fields || {} }, {
    allowUnknown: policies.allowUnknown !== false
  });

  return {
    schemaVersion: schema.version,
    mode,
    result,
    blocking: mode === "STRICT" && !result.ok
  };
}
