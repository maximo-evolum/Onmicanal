"use client";
import { useEffect, useRef, useState } from "react";
import { getFinanceDifferences, proposeFinanceDifference, resolveFinanceDifference, type FinanceDifference, type FinanceDifferencePage, type FinanceAllocationPage, type FinanceWorkspaceContext } from "@/lib/api";
import { RecordBrowser } from "@/components/finance-allocation-workspace";

type Row = FinanceAllocationPage["records"][number];
const money = (v: number) => new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 }).format(v);
const states: Record<string, string> = { PROPOSED: "Por aprobar", APPROVED: "Aprobada", REJECTED: "Rechazada", REVERSED: "Revertida" };
const stamp = (value?: string) => value ? new Date(value).toLocaleString("es-CL") : "—";

export function FinanceDifferences({ context, canManage, canPrepare, disabled, onBusy, onChanged }: { context: FinanceWorkspaceContext; canManage: boolean; canPrepare: boolean; disabled: boolean; onBusy: (value: boolean) => void; onChanged: () => Promise<void> }) {
  const [view, setView] = useState<FinanceDifferencePage | null>(null), [page, setPage] = useState(1), [query, setQuery] = useState(""), [filter, setFilter] = useState("");
  const [revision, setRevision] = useState(0), [busy, setBusy] = useState(false), [loading, setLoading] = useState(false), [message, setMessage] = useState("");
  const [movement, setMovement] = useState<Row | null>(null), [invoice, setInvoice] = useState<Row | null>(null);
  const [settlement, setSettlement] = useState(""), [category, setCategory] = useState("BANK_FEE"), [reason, setReason] = useState(""), [evidence, setEvidence] = useState("");
  const lock = useRef(false), generation = useRef(0);
  const locked = busy || disabled, prepareLocked = locked || !canPrepare || context.currency !== "CLP";
  useEffect(() => {
    const seq = ++generation.current; setLoading(true); setView(null);
    const timer = setTimeout(() => { getFinanceDifferences(page, query, filter).then((result) => {
      if (seq !== generation.current) return;
      if (page > result.pages) setPage(result.pages); else setView(result);
    }).catch((e) => { if (seq === generation.current) setMessage(e instanceof Error ? e.message : "No se pudieron consultar las diferencias."); }).finally(() => { if (seq === generation.current) setLoading(false); }); }, 200);
    return () => { clearTimeout(timer); generation.current++; };
  }, [page, query, filter, revision]);
  async function run(action: () => Promise<unknown>, success: string) {
    if (lock.current || locked) return;
    lock.current = true; setBusy(true); onBusy(true); setMessage("");
    try { await action(); setMovement(null); setInvoice(null); setSettlement(""); setReason(""); setEvidence(""); setMessage(success); await onChanged(); }
    catch (e) { setMessage(e instanceof Error ? e.message : "No se pudo guardar. Actualiza antes de reintentar."); }
    finally { setRevision((n) => n + 1); lock.current = false; setBusy(false); onBusy(false); }
  }
  function resolve(row: FinanceDifference, action: "approve" | "reject" | "reverse") {
    if (!canManage || locked) return;
    if (action === "approve") {
      const confirmation = window.prompt(`Se recibieron ${money(row.data.bankAmount)} y se justifican ${money(row.data.amount)}. La deuda disminuye ${money(row.data.settlementAmount)}. Escribe APROBAR para confirmar.`);
      if (confirmation === null) return;
      if (confirmation !== "APROBAR") { setMessage("No se guardó: escribe APROBAR para confirmar."); return; }
      void run(() => resolveFinanceDifference(row.id, action, { expectedVersion: row.version, confirmation }), "Diferencia aprobada. Cobro real, ajuste y saldo actualizados juntos.");
    } else {
      const value = window.prompt(action === "reverse" ? "Motivo de la reversa (mínimo 10 caracteres). Se restituirá la deuda y se liberará el abono, conservando el historial." : "Motivo del rechazo (mínimo 10 caracteres). No se modificarán los saldos.");
      if (value === null) return;
      if (value.trim().length < 10) { setMessage("El motivo debe tener al menos 10 caracteres."); return; }
      void run(() => resolveFinanceDifference(row.id, action, { reason: value }), action === "reverse" ? "Reversa completa guardada con historial." : "Propuesta rechazada; saldos sin cambios.");
    }
  }
  const bank = Number(movement?.data?.amount || 0), total = Number(settlement), difference = total - bank;
  const valid = Boolean(movement && invoice && Number.isSafeInteger(total) && difference > 0 && total <= Number(invoice.financial?.balance) && (category !== "ROUNDING" || difference <= 100) && reason.trim().length >= 10 && evidence.trim().length >= 10);
  return <section className="finance-card finance-differences" aria-label="Diferencias justificadas">
    <h2>Diferencias justificadas</h2>
    <p>Cuando el dinero recibido es menor que la deuda que corresponde saldar, prepara una justificación para revisión humana. El sistema conserva por separado el abono, el ajuste autorizado y la deuda restante.</p>
    <p className="finance-note">Operación en CLP, una factura por abono. No emite notas de crédito ni sustituye la validación contable o tributaria del respaldo. Los excesos se gestionan en Anticipos y saldos a favor. Esta bandeja consulta todos los períodos; los abonos usan el período y cuenta seleccionados.</p>
    {message && <p role="status" className="finance-note">{message}</p>}{busy && <p role="status" aria-live="polite">Guardando operación auditada… No repitas la acción.</p>}
    <details><summary>Preparar diferencia para aprobación</summary>
      {!canPrepare && <p>Tu cuenta tiene acceso de consulta.</p>}{context.currency !== "CLP" && <p>Selecciona CLP para preparar una propuesta.</p>}
      <h3>1. Seleccionar abono</h3><RecordBrowser context={context} kind="movements" revision={revision} disabled={prepareLocked} selected={movement ? [movement.id] : []} onSelect={(r) => { setMovement(r); setInvoice(null); setSettlement(""); }} />
      {movement && <><p>Abono seleccionado: <strong>{movement.title} · {money(bank)}</strong></p><h3>2. Seleccionar factura</h3><RecordBrowser context={context} kind="invoices" revision={revision} disabled={prepareLocked} selected={invoice ? [invoice.id] : []} onSelect={(r) => { setInvoice(r); setSettlement(String(r.financial?.balance || "")); }} /></>}
      {invoice && movement && <div className="finance-coverage-fields">
        <p className="finance-coverage-evidence"><strong>{invoice.title}</strong> · Saldo actual {money(Number(invoice.financial?.balance || 0))}</p>
        <label>Deuda que se propone saldar (CLP)<input type="number" min={bank + 1} step="1" max={Number(invoice.financial?.balance)} disabled={prepareLocked} value={settlement} onChange={(e) => setSettlement(e.target.value)} /></label>
        <label>Causa<select disabled={prepareLocked} value={category} onChange={(e) => setCategory(e.target.value)}>{Object.entries(view?.categories || { BANK_FEE: "Comisión bancaria o del intermediario", WITHHOLDING: "Retención respaldada", DISCOUNT: "Descuento comercial respaldado", ROUNDING: "Redondeo" }).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        <p className="finance-coverage-evidence">Dinero recibido: <strong>{money(bank)}</strong> · Diferencia propuesta: <strong>{Number.isFinite(difference) && difference > 0 ? money(difference) : "Debe ser positiva"}</strong> · Saldo restante: <strong>{Number.isFinite(total) && total <= Number(invoice.financial?.balance) ? money(Number(invoice.financial?.balance) - total) : "Revisa el importe"}</strong>{category === "ROUNDING" && <small>Límite operativo de redondeo: 100 CLP. Siempre requiere aprobación.</small>}</p>
        <label className="finance-coverage-evidence">Motivo (mínimo 10 caracteres)<textarea disabled={prepareLocked} maxLength={1500} value={reason} onChange={(e) => setReason(e.target.value)} /></label>
        <label className="finance-coverage-evidence">Referencia verificable del respaldo (folio, documento o ubicación)<textarea disabled={prepareLocked} maxLength={1500} value={evidence} onChange={(e) => setEvidence(e.target.value)} /></label>
        <button type="button" className="primary-btn" disabled={prepareLocked || !valid} onClick={() => void run(() => proposeFinanceDifference({ movementId: movement.id, invoiceId: invoice.id, settlementAmount: total, category, reason, evidence }), "Propuesta guardada para aprobación. Todavía no se cambiaron los saldos.")}>Enviar a aprobación</button>
      </div>}
    </details>
    <div className="finance-review-toolbar"><label>Buscar factura, abono o motivo<input value={query} disabled={locked} onChange={(e) => { setQuery(e.target.value); setPage(1); }} /></label><label>Estado<select value={filter} disabled={locked} onChange={(e) => { setFilter(e.target.value); setPage(1); }}><option value="">Todos</option>{Object.entries(states).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><button type="button" disabled={locked} onClick={() => setRevision((n) => n + 1)}>Actualizar</button></div>
    {loading && <p role="status">Consultando propuestas e historial…</p>}
    <div className="finance-review-table-wrap"><table><thead><tr><th>Factura / causa</th><th>Recibido</th><th>Justificado</th><th>Deuda saldada</th><th>Estado / acciones</th></tr></thead><tbody>{view?.records.map((r) => <tr key={r.id}>
      <td><strong>{r.data.invoiceTitle}</strong><small>{view.categories[r.data.category]} · {r.data.transactionDate}</small><details><summary>Ver respaldo e historial</summary><p>Abono: {r.data.movementTitle}</p><p>Motivo: {r.data.reason}</p><p>Respaldo: {r.data.evidence}</p><p>Propuesta: {stamp(r.data.proposedAt)} · Usuario {r.data.proposedById}</p>{r.data.approvedAt && <p>Aprobación: {stamp(r.data.approvedAt)} · Usuario {r.data.approvedById}</p>}{r.data.rejectedAt && <p>Rechazo: {stamp(r.data.rejectedAt)} · {r.data.rejectionReason}</p>}{r.data.reversedAt && <p>Reversa: {stamp(r.data.reversedAt)} · {r.data.reversalReason}</p>}</details>{r.validation?.errors.map((e) => <p role="alert" key={e}>{e}</p>)}</td>
      <td>{money(r.data.bankAmount)}</td><td>{money(r.data.amount)}</td><td>{money(r.data.settlementAmount)}<small>{r.status === "PROPOSED" ? "Propuesta, aún sin aplicar" : r.status !== "APPROVED" ? "Sin efecto vigente" : "Incluye abono y diferencia"}</small></td>
      <td><strong>{states[r.status] || r.status}</strong>{r.status === "PROPOSED" && <><button type="button" disabled={locked || !canManage} onClick={() => resolve(r, "approve")}>Aprobar</button><button type="button" disabled={locked || !canManage} onClick={() => resolve(r, "reject")}>Rechazar</button></>}{r.status === "APPROVED" && <button type="button" className="finance-danger-button" disabled={locked || !canManage || !r.validation?.valid} onClick={() => resolve(r, "reverse")}>Revertir con motivo</button>}</td>
    </tr>)}</tbody></table></div>
    {view?.total === 0 && <p>No hay diferencias con estos filtros.</p>}
    <div className="finance-review-toolbar"><button type="button" disabled={locked || loading || page <= 1} onClick={() => setPage(page - 1)}>Anterior</button><span>Página {page} de {view?.pages || 1} · {view?.total || 0} registros</span><button type="button" disabled={locked || loading || !view || page >= view.pages} onClick={() => setPage(page + 1)}>Siguiente</button></div>
  </section>;
}
