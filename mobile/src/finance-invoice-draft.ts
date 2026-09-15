export type InvoiceScope = { tenantId: string; userId: string };
export type InvoiceFields = { number: string; customer: string; rut: string; amount: string; issueDate: string; dueDate: string };
export type InvoiceDraft = { version: 1; scope: InvoiceScope; operationKey: string; phase: "editing" | "pending"; fields: InvoiceFields };
type Storage = { getItemAsync: (key: string) => Promise<string | null>; setItemAsync: (key: string, value: string) => Promise<void> };
const queues = new Map<string, Promise<unknown>>();
export function invoiceDraftKey(scope: InvoiceScope) {
  if (![scope.tenantId, scope.userId].every((id) => /^[a-zA-Z0-9_-]{1,120}$/.test(id))) throw new Error("No se pudo identificar la cuenta. Vuelve a iniciar sesión.");
  return `finance_invoice_v1.${scope.tenantId}.${scope.userId}`;
}
export function newInvoiceDraft(scope: InvoiceScope): InvoiceDraft {
  invoiceDraftKey(scope);
  return { version: 1, scope, operationKey: `invoice-${Date.now()}-${Math.random().toString(36).slice(2)}`, phase: "editing", fields: { number: "", customer: "", rut: "", amount: "", issueDate: "", dueDate: "" } };
}
export function validateInvoiceDraft(value: unknown, scope: InvoiceScope): InvoiceDraft {
  const draft = value as InvoiceDraft;
  if (!draft || draft.version !== 1 || draft.scope?.tenantId !== scope.tenantId || draft.scope?.userId !== scope.userId || !/^[a-zA-Z0-9_-]{16,100}$/.test(draft.operationKey) || !["editing", "pending"].includes(draft.phase) || !draft.fields) throw new Error("El borrador no corresponde a esta cuenta o no tiene un formato válido. No se sobrescribió.");
  for (const key of ["number", "customer", "rut", "amount", "issueDate", "dueDate"] as const) if (typeof draft.fields[key] !== "string" || draft.fields[key].length > 120) throw new Error("El borrador contiene un campo inválido. No se sobrescribió.");
  return draft;
}
export function invoiceDraftRepository(storage: Storage) {
  return {
    async load(scope: InvoiceScope) {
      const key = invoiceDraftKey(scope);
      await queues.get(key)?.catch(() => undefined);
      const raw = await storage.getItemAsync(key);
      if (!raw) return newInvoiceDraft(scope);
      let value;
      try { value = JSON.parse(raw); } catch { throw new Error("No se pudo leer el borrador guardado. Se conservó sin cambios."); }
      return validateInvoiceDraft(value, scope);
    },
    save(draft: InvoiceDraft): Promise<void> {
      validateInvoiceDraft(draft, draft.scope);
      const key = invoiceDraftKey(draft.scope), serialized = JSON.stringify(draft);
      const task = (queues.get(key) || Promise.resolve()).catch(() => undefined).then(() => storage.setItemAsync(key, serialized));
      queues.set(key, task);
      void task.finally(() => { if (queues.get(key) === task) queues.delete(key); }).catch(() => undefined);
      return task;
    }
  };
}

export function invoicePayload(draft: InvoiceDraft) {
  const fields = draft.fields, amount = Number(fields.amount);
  const date = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
  if (!fields.number.trim() || !fields.customer.trim() || !/^\d+$/.test(fields.amount) || !Number.isSafeInteger(amount) || amount <= 0 || !date(fields.issueDate) || !date(fields.dueDate) || fields.dueDate < fields.issueDate) throw new Error("Revisa folio, cliente, monto CLP entero sin separadores y fechas AAAA-MM-DD. El vencimiento no puede preceder a la emisión.");
  return { ...fields, number: fields.number.trim(), customer: fields.customer.trim(), rut: fields.rut.trim(), amount, idempotencyKey: draft.operationKey, expectedScope: draft.scope };
}
