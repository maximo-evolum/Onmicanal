export function retentionDueFields(record, schema, now = new Date()) {
  const fields = schema?.fields && typeof schema.fields === "object" ? schema.fields : {};
  const updatedAt = new Date(record.updatedAt || now);
  const ageDays = Math.floor((now.getTime() - updatedAt.getTime()) / 86_400_000);
  return Object.entries(fields)
    .filter(([name, config]) => Object.prototype.hasOwnProperty.call(record.data || {}, name) && Number.isInteger(config?.retentionDays) && ageDays >= config.retentionDays)
    .map(([name, config]) => ({ field: name, retentionDays: config.retentionDays, ageDays }));
}
