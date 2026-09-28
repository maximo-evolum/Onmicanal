import { financeDocumentSide, financeDocumentState } from "./finance-document-values.service.js";
import { auditCloseReconciliations } from "./finance-close-reconciliation.service.js";
const dayMs = 86400000;
const data = (r) => r?.data || {};
const upper = (v) => String(v || "").trim().toUpperCase();
export function isOverviewCustomerInvoice(record) {
  return financeDocumentSide(record) === "CUSTOMER" && financeDocumentState(record).included;
}
export function overviewReconciliationMetrics(movements, reconciliations, evidenceRecords) {
  const excluded = (r) => data(r).excluded || ["DELETED", "EXCLUDED"].includes(upper(r.status));
  const nonExcluded = movements.filter((r) => !excluded(r));
  const active = nonExcluded.filter((r) => strictDay(data(r).transactionDate || data(r).operatingDate || data(r).date));
  const index = new Map(reconciliations.map((r) => [r.id, r]));
  const audit = evidenceRecords ? auditCloseReconciliations(evidenceRecords, active, "", () => "") : null;
  const matched = active.filter((m) => {
    if (audit) return audit.validIds.has(m.id);
    const r = index.get(data(m).reconciliationId);
    return ["MATCHED", "RECONCILED"].includes(upper(m.status)) && r?.recordType === "finance_reconciliation" && upper(r.status) === "APPROVED" && data(r).movementId === m.id;
  });
  const validIds = new Set(matched.map((r) => r.id));
  return { totalMovements: active.length, matchedMovements: matched.length, pendingMovements: active.length - matched.length,
    excludedMovements: movements.length - nonExcluded.length, invalidDateMovements: nonExcluded.length - active.length,
    inconsistentMovements: active.filter((r) => !validIds.has(r.id) && (["MATCHED", "RECONCILED"].includes(upper(r.status)) || data(r).reconciliationId)).length,
    rate: active.length ? Number((matched.length / active.length * 100).toFixed(1)) : 0 };
}
function strictDay(value) {
  const s = String(value || "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s ? s : "";
}
export function overviewCollectionSchedule(invoices, now, financialState) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now).map((p) => [p.type, p.value]));
  const asOf = `${parts.year}-${parts.month}-${parts.day}`, start = Date.parse(asOf);
  const weeks = Array.from({ length: 6 }, (_, i) => ({ label: `Semana ${i + 1}`, from: new Date(start + i * 7 * dayMs).toISOString().slice(0, 10), to: new Date(start + (i * 7 + 6) * dayMs).toISOString().slice(0, 10), amount: 0, documents: 0 }));
  let next30Days = 0, undatedDocuments = 0;
  for (const invoice of invoices) {
    const state = financialState(invoice, now);
    if (state.status === "PAID" || !Number.isFinite(state.balance) || state.balance <= 0) continue;
    const due = strictDay(data(invoice).dueDate);
    if (!due) { undatedDocuments++; continue; }
    const offset = Math.round((Date.parse(due) - start) / dayMs);
    if (offset >= 0 && offset < 30) next30Days += state.balance;
    if (offset >= 0 && offset < 42) { const week = weeks[Math.floor(offset / 7)]; week.amount += state.balance; week.documents++; }
  }
  return { asOf, weeks, next30Days, undatedDocuments, basis: "Saldos pendientes agrupados por vencimiento de las facturas de clientes del contexto seleccionado. No es predicción de pago ni incluye promesas de cobro." };
}

export function overviewMetricsCsv(overview, tenantId) {
  const r = overview.reconciliation;
  const rows = [["Sección", "Indicador", "Valor", "Detalle"], ["Contexto", "Empresa (ID)", tenantId, "Empresa autenticada"], ["Contexto", "Moneda", overview.context.currency, "No se convierten monedas"], ["Contexto", "Período", overview.context.period || "Todos", overview.scopeNote], ["Contexto", "Cuenta (ID)", overview.context.accountKey || "Todas", "Aplica a movimientos, no atribuye facturas a un banco"], ["Contexto", "Generado UTC", overview.generatedAt, "Fotografía de consulta, no cierre certificado"],
    ["Conciliación", "Movimientos activos con fecha", r.totalMovements, "Denominador de la tasa"], ["Conciliación", "Confirmados", r.matchedMovements, "Vínculo bidireccional con aprobación vigente"], ["Conciliación", "No confirmados", r.pendingMovements, "Incluye inconsistencias de vínculo"], ["Conciliación", "Tasa (%)", r.rate, "Confirmados / activos con fecha × 100"], ["Conciliación", "Excluidos", r.excludedMovements, "Fuera del denominador"], ["Conciliación", "Vínculos inconsistentes", r.inconsistentMovements, "Requieren revisión; no se cuentan como confirmados"],
    ["Clientes", "Saldo pendiente", overview.invoices.pendingAmount, "Solo facturas de clientes del contexto"], ["Clientes", "Vencido", overview.invoices.overdueAmount, "Saldo actual"], ["Clientes", "DSO observado (días)", overview.collection.dsoSampleSize ? overview.collection.dsoDays : "Sin evidencia", `${overview.collection.dsoSampleSize} documentos pagados con fechas`], ["Calendario", "Vencimientos próximos 30 días", overview.schedule.next30Days, overview.schedule.basis], ["Calendario", "Sin vencimiento válido", overview.schedule.undatedDocuments, "No atribuidos a una semana"],
    ["Clientes", "Diferencias justificadas", overview.invoices.justifiedDifferences || 0, "Ajustes de saldo autorizados; no son ingresos bancarios ni notas de crédito"],
    ...overview.schedule.weeks.map((w) => ["Calendario", `${w.label}: ${w.from} al ${w.to}`, w.amount, `${w.documents} documentos`])];
  const cell = (v) => { const s = String(v ?? ""); return `"${(/^[\s]*[=+@-]/.test(s) ? "'" : "") + s.replace(/"/g, '""')}"`; };
  return "\uFEFF" + rows.map((row) => row.map(cell).join(";")).join("\r\n");
}
