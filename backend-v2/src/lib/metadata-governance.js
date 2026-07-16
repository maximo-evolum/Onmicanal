const FIELD_TYPES = new Set(["string", "number", "boolean", "array", "object", "json", "date", "relation"]);
const SENSITIVITIES = new Set(["PUBLIC", "INTERNAL", "CONFIDENTIAL", "PERSONAL", "SENSITIVE"]);
const ROLES = new Set(["SUPER_ADMIN", "OWNER", "ADMIN", "AGENT", "SELLER", "VIEWER"]);

export function validateMetadataSchemaDefinition(fields) {
  const source = fields && typeof fields === "object" && !Array.isArray(fields) ? fields : null;
  const errors = [];
  if (!source || !Object.keys(source).length) return [{ field: "fields", code: "REQUIRED", message: "Define al menos un campo" }];

  for (const [name, rawConfig] of Object.entries(source)) {
    if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(name)) errors.push({ field: name, code: "INVALID_NAME", message: "Usa nombres alfanumericos en camelCase o snake_case" });
    const config = typeof rawConfig === "string" ? { type: rawConfig } : rawConfig || {};
    const type = String(config.type || "string").toLowerCase();
    if (!FIELD_TYPES.has(type)) errors.push({ field: name, code: "INVALID_TYPE", message: "Tipo de campo no permitido" });
    if (config.options !== undefined && !Array.isArray(config.options)) errors.push({ field: name, code: "INVALID_OPTIONS", message: "options debe ser un arreglo" });
    if (config.sensitivity !== undefined && !SENSITIVITIES.has(String(config.sensitivity).toUpperCase())) errors.push({ field: name, code: "INVALID_SENSITIVITY", message: "Clasificacion de sensibilidad no permitida" });
    if (["PERSONAL", "SENSITIVE"].includes(String(config.sensitivity || "").toUpperCase()) && !String(config.purpose || "").trim()) errors.push({ field: name, code: "PURPOSE_REQUIRED", message: "Los datos personales o sensibles requieren finalidad" });
    if (config.retentionDays !== undefined && (!Number.isInteger(config.retentionDays) || config.retentionDays < 1 || config.retentionDays > 36500)) errors.push({ field: name, code: "INVALID_RETENTION", message: "retentionDays debe estar entre 1 y 36500" });
    if (config.accessRoles !== undefined && (!Array.isArray(config.accessRoles) || config.accessRoles.some((role) => !ROLES.has(String(role).toUpperCase())))) errors.push({ field: name, code: "INVALID_ACCESS_ROLES", message: "accessRoles contiene un rol no permitido" });
  }
  return errors;
}

export const METADATA_GOVERNANCE_CATALOG = {
  fieldTypes: [...FIELD_TYPES],
  sensitivities: [...SENSITIVITIES],
  roles: [...ROLES],
  retentionDays: { minimum: 1, maximum: 36500 }
};
