import { classifyFinanceMovement } from "./finance-movement-classification.service.js";

const data = (r) => r?.data && typeof r.data === "object" ? r.data : {};
const upper = (v) => String(v ?? "").trim().toUpperCase();
const positivePesos = (n) => typeof n === "number" && Number.isSafeInteger(n) && n > 0;
const sameTenant = (a, b) => a?.tenantId === b?.tenantId;
const currency = (r) => upper(data(r).currency || "CLP");
function validDay(value) {
  const day = String(value || "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) && Number.isFinite(Date.parse(day)) && new Date(day).toISOString().slice(0, 10) === day ? day : "";
}
export const excludedCloseMovement = (r) => Boolean(data(r).excluded) || ["DELETED", "EXCLUDED"].includes(upper(r.status));

// Read-only evidence check. Historical states are never repaired or inferred.
// Operational dates are supplied by the close so linked records share a period.
export function auditCloseReconciliations(records, periodMovements, period, operationalDate, scopedRecords = records) {
  const index = new Map(records.map((r) => [r.id, r]));
  const scopedIds = new Set(scopedRecords.map((r) => r.id));
  const periodMovementIds = new Set(periodMovements.map((r) => r.id));
  const reconciliations = records.filter((r) => r.recordType === "finance_reconciliation");
  const receipts = records.filter((r) => r.recordType === "finance_invoice_receipt");
  const byMovement = new Map(), receiptsByRec = new Map(), activeReceiptsByMovement = new Map();
  function add(map, key, record) { if (!map.has(key)) map.set(key, []); map.get(key).push(record); }
  for (const rec of reconciliations) if (upper(rec.status) === "APPROVED") add(byMovement, data(rec).movementId, rec);
  for (const receipt of receipts) {
    add(receiptsByRec, data(receipt).reconciliationId, receipt);
    if (upper(receipt.status) === "RECONCILED") add(activeReceiptsByMovement, data(receipt).movementId, receipt);
  }
  const movements = periodMovements.filter((m) => !excludedCloseMovement(m));
  const validIds = new Set(), validatedRecIds = new Set(), blockers = [];
  const inconsistentIds = new Set();
  for (const m of movements) {
    const md = data(m), rec = index.get(md.reconciliationId), rd = data(rec);
    const approved = byMovement.get(m.id) || [];
    const activeReceipts = activeReceiptsByMovement.get(m.id) || [];
    const claimsMatch = ["MATCHED", "RECONCILED", "CLOSED"].includes(upper(m.status));
    if (!claimsMatch && !md.reconciliationId && !approved.length && !activeReceipts.length) continue;
    const reasons = [];
    if (!["MATCHED", "RECONCILED"].includes(upper(m.status))) reasons.push("El movimiento no tiene un estado conciliado vigente.");
    const linked = rec?.recordType === "finance_reconciliation" && sameTenant(m, rec) && rd.movementId === m.id;
    if (!linked) reasons.push("Falta el vínculo de ida y vuelta con una conciliación de esta empresa.");
    if (linked && (upper(rec.status) !== "APPROVED" || rd.reversedAt)) reasons.push("La conciliación no está aprobada o tiene una reversa registrada.");
    if (approved.length !== 1 || approved[0]?.id !== rec?.id) reasons.push("Debe existir una sola aprobación vigente para este movimiento.");
    if (activeReceipts.some((r) => data(r).reconciliationId !== rec?.id)) reasons.push("Hay cobros activos del movimiento asociados a otra conciliación.");
    if (linked && upper(rec.status) === "APPROVED") {
      const bank = classifyFinanceMovement(md);
      if (bank.direction !== "CREDIT" || !positivePesos(bank.amount) || currency(m) !== "CLP" || currency(rec) !== currency(m) || Number(rd.amount) !== bank.amount) reasons.push("El abono, la moneda y el monto aprobado no coinciden o no corresponden al flujo de cobro bancario admitido.");
      const allocations = Array.isArray(rd.allocations) ? rd.allocations : [];
      const ids = allocations.map((a) => a?.invoiceId);
      const allocationShape = allocations.length > 0 && new Set(ids).size === ids.length && allocations.every((a) => typeof a?.invoiceId === "string" && a.invoiceId && positivePesos(a.amount));
      const total = allocations.reduce((s, a) => s + (positivePesos(a?.amount) ? a.amount : 0), 0);
      if (!allocationShape || !Number.isSafeInteger(total) || total !== bank.amount) reasons.push("Faltan asignaciones válidas por factura o su suma no coincide con el abono.");
      if (Array.isArray(rd.invoiceIds) && (rd.invoiceIds.length !== ids.length || new Set(rd.invoiceIds).size !== ids.length || rd.invoiceIds.some((id) => !ids.includes(id)))) reasons.push("La lista de documentos aprobados no coincide con las asignaciones.");
      if (rd.invoiceId && (ids.length !== 1 || rd.invoiceId !== ids[0])) reasons.push("La factura principal no coincide con la asignación.");
      const evidence = receiptsByRec.get(rec.id) || [];
      if (evidence.length !== allocations.length || !evidence.length) reasons.push("Faltan comprobantes de cobro o hay comprobantes duplicados.");
      const used = new Set();
      for (const receipt of evidence) {
        const d = data(receipt), assignment = allocations.find((a) => a?.invoiceId === d.invoiceId);
        if (!sameTenant(m, receipt) || upper(receipt.status) !== "RECONCILED" || d.reversedAt || d.movementId !== m.id || currency(receipt) !== currency(m) || !assignment || !positivePesos(d.amount) || d.amount !== assignment.amount || used.has(d.invoiceId)) reasons.push("Un comprobante está revertido, duplicado o no coincide con la factura, el movimiento o el monto asignado.");
        used.add(d.invoiceId);
      }
      for (const id of ids) {
        const invoice = index.get(id);
        if (invoice?.recordType !== "finance_invoice" || !sameTenant(m, invoice) || currency(invoice) !== currency(m) || ["DELETED", "EXCLUDED", "ANNULLED", "CANCELLED", "REJECTED", "ANULADA"].includes(upper(invoice.status))) reasons.push("Una factura vinculada no está disponible o vigente en esta empresa y moneda.");
      }
    }
    if (reasons.length) {
      inconsistentIds.add(m.id);
      blockers.push({ type: "CONCILIACION_INCONSISTENTE", id: `reconciliation-${m.id}`, title: `${m.title || m.id}: ${[...new Set(reasons)].join(" ")}` });
    } else { validIds.add(m.id); validatedRecIds.add(rec.id); }
  }
  // An orphan approval must not disappear simply because its movement was
  // deleted. An unknown operational period blocks until evidence is repaired.
  for (const rec of reconciliations.filter((r) => upper(r.status) === "APPROVED")) {
    if (!scopedIds.has(rec.id) && !periodMovementIds.has(data(rec).movementId)) continue;
    if (validatedRecIds.has(rec.id)) continue;
    const movement = index.get(data(rec).movementId);
    const date = validDay(operationalDate(rec));
    if (date && !date.startsWith(`${period}-`)) continue;
    if (movement?.recordType === "bank_movement" && inconsistentIds.has(movement.id) && periodMovementIds.has(movement.id)) continue;
    blockers.push({ type: "CONCILIACION_SIN_RESPALDO", id: `approval-${rec.id}`, title: `${rec.title || rec.id}: aprobación sin movimiento conciliado verificable${date ? " en el período" : " ni fecha operativa acreditada"}. Revisa su vínculo antes de cerrar.` });
  }
  // Orphan live receipts also indicate a potentially applied payment; they
  // cannot be silently ignored when their reconciliation disappeared/reversed.
  for (const receipt of receipts.filter((r) => upper(r.status) === "RECONCILED" && (data(r).reconciliationId || data(r).movementId || data(r).source === "bank_reconciliation"))) {
    if (!scopedIds.has(receipt.id) && !periodMovementIds.has(data(receipt).movementId)) continue;
    const d = data(receipt), movement = index.get(d.movementId);
    if (validIds.has(movement?.id) || inconsistentIds.has(movement?.id)) continue;
    const date = validDay(operationalDate(receipt));
    if (date && !date.startsWith(`${period}-`)) continue;
    blockers.push({ type: "CONCILIACION_SIN_RESPALDO", id: `receipt-${receipt.id}`, title: `${receipt.title || receipt.id}: comprobante de cobro bancario sin conciliación y movimiento vigentes verificables. Revisa el respaldo del pago.` });
  }
  return { movements, validIds, inconsistentIds, blockers, inconsistentMovements: inconsistentIds.size,
    unreconciled: movements.filter((m) => !validIds.has(m.id)),
    excludedMovements: periodMovements.length - movements.length };
}
