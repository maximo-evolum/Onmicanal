import { normalizeMetadata } from "./metadata.js";

export function migrateMetadataValue(data, migration = {}) {
  const next = { ...normalizeMetadata(data, {}) };
  for (const [from, to] of Object.entries(migration.rename || {})) {
    if (Object.prototype.hasOwnProperty.call(next, from) && !Object.prototype.hasOwnProperty.call(next, to)) next[to] = next[from];
    delete next[from];
  }
  for (const field of migration.remove || []) delete next[field];
  for (const [field, value] of Object.entries(migration.defaults || {})) {
    if (next[field] === undefined) next[field] = value;
  }
  return next;
}
