export function redactMetadataForRole(data, schema, role) {
  const source = data && typeof data === "object" && !Array.isArray(data) ? data : {};
  const fields = schema?.fields && typeof schema.fields === "object" ? schema.fields : {};
  const visible = { ...source };
  const hiddenFields = [];

  for (const [name, config] of Object.entries(fields)) {
    const allowedRoles = Array.isArray(config?.accessRoles) ? config.accessRoles.map((item) => String(item).toUpperCase()) : [];
    if (allowedRoles.length && !allowedRoles.includes(String(role || "").toUpperCase())) {
      delete visible[name];
      hiddenFields.push(name);
    }
  }
  return { data: visible, hiddenFields };
}
