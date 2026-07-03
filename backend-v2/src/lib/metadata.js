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
