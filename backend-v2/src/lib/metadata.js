const DEFAULT_MAX_DEPTH = 6;
const DEFAULT_MAX_STRING_LENGTH = 20_000;

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) && !(value instanceof Date);
}

function normalizeValue(value, depth, options) {
  if (value === undefined || typeof value === "function" || typeof value === "symbol") return undefined;
  if (value === null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "string") return value.slice(0, options.maxStringLength);
  if (value instanceof Date) return value.toISOString();
  if (depth >= options.maxDepth) return undefined;

  if (Array.isArray(value)) {
    return value
      .map((item) => normalizeValue(item, depth + 1, options))
      .filter((item) => item !== undefined);
  }

  if (!isPlainObject(value)) return undefined;

  const normalized = {};
  for (const [key, item] of Object.entries(value)) {
    const cleanKey = String(key || "").trim();
    if (!cleanKey || cleanKey.startsWith("__")) continue;
    const cleanValue = normalizeValue(item, depth + 1, options);
    if (cleanValue !== undefined) normalized[cleanKey] = cleanValue;
  }
  return normalized;
}

export function normalizeMetadata(value, fallback = {}, options = {}) {
  const normalized = normalizeValue(value, 0, {
    maxDepth: options.maxDepth || DEFAULT_MAX_DEPTH,
    maxStringLength: options.maxStringLength || DEFAULT_MAX_STRING_LENGTH
  });

  return isPlainObject(normalized) ? normalized : fallback;
}

function deepMerge(left, right) {
  const base = normalizeMetadata(left, {});
  const incoming = normalizeMetadata(right, {});
  const merged = { ...base };

  for (const [key, value] of Object.entries(incoming)) {
    if (isPlainObject(merged[key]) && isPlainObject(value)) {
      merged[key] = deepMerge(merged[key], value);
    } else {
      merged[key] = value;
    }
  }

  return merged;
}

export function mergeMetadata(...sources) {
  return sources.reduce((merged, source) => deepMerge(merged, source), {});
}

export function hasMetadata(value) {
  return Object.keys(normalizeMetadata(value, {})).length > 0;
}

export function metadataOrNull(value) {
  const normalized = normalizeMetadata(value, {});
  return Object.keys(normalized).length ? normalized : null;
}

export function pickMetadataValue(metadata, key, fallback = null) {
  const source = normalizeMetadata(metadata, {});
  return Object.prototype.hasOwnProperty.call(source, key) ? source[key] : fallback;
}

function isEmpty(value) {
  return value === undefined || value === null || value === "";
}

function configForField(config) {
  return typeof config === "string" ? { type: config } : (config || { type: "string" });
}

function valueMatchesType(value, type) {
  if (isEmpty(value)) return true;
  switch (String(type || "string").toLowerCase()) {
    case "string": return typeof value === "string";
    case "number": return typeof value === "number" && Number.isFinite(value);
    case "boolean": return typeof value === "boolean";
    case "array": return Array.isArray(value);
    case "object":
    case "json": return isPlainObject(value);
    case "date": return typeof value === "string" && !Number.isNaN(Date.parse(value));
    case "relation": return typeof value === "string" && value.length > 0;
    default: return true;
  }
}

export function metadataFields(entity) {
  if (Array.isArray(entity?.fields)) {
    return Object.fromEntries(entity.fields.map((field) => [field, { type: "string" }]));
  }
  return isPlainObject(entity?.fields) ? entity.fields : {};
}

export function validateMetadata(data, entity, { allowUnknown = true } = {}) {
  const metadata = normalizeMetadata(data, {});
  const fields = metadataFields(entity);
  const errors = [];
  const unknownFields = [];

  for (const [name, rawConfig] of Object.entries(fields)) {
    const config = configForField(rawConfig);
    const value = metadata[name];
    if (config.required && isEmpty(value)) {
      errors.push({ field: name, code: "REQUIRED", message: "El campo es requerido" });
      continue;
    }
    if (!isEmpty(value) && !valueMatchesType(value, config.type)) {
      errors.push({ field: name, code: "INVALID_TYPE", expected: config.type || "string", message: "El tipo de dato no es valido" });
      continue;
    }
    if (!isEmpty(value) && Array.isArray(config.options) && !config.options.includes(value)) {
      errors.push({ field: name, code: "INVALID_OPTION", options: config.options, message: "El valor no pertenece a las opciones permitidas" });
    }
  }

  for (const name of Object.keys(metadata)) {
    if (!Object.prototype.hasOwnProperty.call(fields, name)) unknownFields.push(name);
  }
  if (!allowUnknown) {
    for (const field of unknownFields) {
      errors.push({ field, code: "UNKNOWN_FIELD", message: "El campo no existe en el esquema publicado" });
    }
  }

  return { ok: errors.length === 0, data: metadata, errors, unknownFields, fields };
}
