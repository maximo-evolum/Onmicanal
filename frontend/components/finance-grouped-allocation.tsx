"use client";
import { useEffect, useRef, useState } from "react";
import { RecordBrowser } from "@/components/finance-allocation-workspace";
import { previewFinanceGroup, approveFinanceGroup, reverseFinanceGroup, getFinanceGroups, type FinanceGroup, type FinanceGroupPreview, type FinanceGroupPage, type FinanceAllocationPage, type FinanceWorkspaceContext } from "@/lib/api";
type Row = FinanceAllocationPage["records"][number];
const money = (v: number) => new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 }).format(v);
const key = (m: string, i: string) => JSON.stringify([m, i]);
const date = (s?: string) => s ? new Date(s).toLocaleString("es-CL") : "—";
export function FinanceGroupedAllocation({ context, canManage, canPrepare, disabled, onBusy, onChanged }: { context: FinanceWorkspaceContext; canManage: boolean; canPrepare: boolean; disabled: boolean; onBusy: (v: boolean) => void; onChanged: () => Promise<void> }) {
  const [movements, setMovements] = useState<Row[]>([]), [invoices, setInvoices] = useState<Row[]>([]), [values, setValues] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<FinanceGroupPreview | null>(null), [reason, setReason] = useState(""), [allPeriods, setAllPeriods] = useState(false);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(""), [revision, setRevision] = useState(0);
  const [groups, setGroups] = useState<FinanceGroupPage | null>(null), [page, setPage] = useState(1), [query, setQuery] = useState("");
  const lock = useRef(false), generation = useRef(0), locked = busy || disabled, prepareLocked = locked || !canPrepare || context.currency !== "CLP";
  const effectiveContext = { ...context, period: allPeriods ? "" : context.period };
  useEffect(() => {
    const seq = ++generation.current; setGroups(null);
    const timer = setTimeout(() => { getFinanceGroups(page, query, effectiveContext.period).then((r) => { if (seq === generation.current) { if (page > r.pages) setPage(r.pages); else setGroups(r); } }).catch((e) => { if (seq === generation.current) setMessage(e instanceof Error ? e.message : "No se pudieron consultar los grupos."); }); }, 200);
    return () => { clearTimeout(timer); generation.current++; };
  }, [page, query, revision, effectiveContext.period]);
  function clear() { setMovements([]); setInvoices([]); setValues({}); setPreview(null); setReason(""); }
  function select(row: Row, isMovement: boolean) {
    const entries = isMovement ? movements : invoices, max = isMovement ? 10 : 20;
    if (!entries.some((r) => r.id === row.id) && entries.length >= max) { setMessage(`Puedes seleccionar hasta ${max} ${isMovement ? "abonos" : "facturas"}.`); return; }
    setPreview(null); setValues({});
    const next = entries.some((r) => r.id === row.id) ? entries.filter((r) => r.id !== row.id) : [...entries, row];
    if (isMovement) setMovements(next); else setInvoices(next);
  }
  const allocations = movements.flatMap((m) => invoices.map((i) => ({ movementId: m.id, invoiceId: i.id, amount: Number(values[key(m.id, i.id)] || 0) }))).filter((a) => a.amount !== 0);
  const movementSum = (id: string) => allocations.filter((a) => a.movementId === id).reduce((s, a) => s + a.amount, 0);
  const invoiceSum = (id: string) => allocations.filter((a) => a.invoiceId === id).reduce((s, a) => s + a.amount, 0);
  const valid = movements.length > 0 && invoices.length > 0 && allocations.every((a) => Number.isSafeInteger(a.amount) && a.amount > 0) && movements.every((m) => movementSum(m.id) === Number(m.data?.amount)) && invoices.every((i) => invoiceSum(i.id) > 0 && invoiceSum(i.id) <= Number(i.financial?.balance));
  async function run(action: () => Promise<void>) {
    if (lock.current || locked) return; lock.current = true; setBusy(true); onBusy(true); setMessage("");
    try { await action(); } catch (e) { setPreview(null); setMessage(e instanceof Error ? e.message : "No se pudo completar. Actualiza los datos antes de reintentar."); }
    finally { lock.current = false; setBusy(false); onBusy(false); }
  }
  function approve() {
    if (!preview || !canManage) return;
    const confirmed = window.prompt(`Se aplicarán ${money(preview.total)} de ${preview.movements.length} abonos a ${preview.documents.length} facturas. Períodos: ${preview.periods.join(", ")}. Escribe APROBAR.`);
    if (confirmed === null) return;
    if (confirmed !== "APROBAR") { setMessage("No se guardó: escribe APROBAR para confirmar."); return; }
    void run(async () => { await approveFinanceGroup({ allocations: preview.allocations, expectedVersion: preview.version, confirmation: confirmed, reason }); clear(); setRevision((r) => r + 1); setMessage("Grupo aprobado. Todos los cobros y saldos se guardaron conjuntamente."); await onChanged(); });
  }
  function reverse(group: FinanceGroup) {
    if (!canManage) return;
    const value = window.prompt(`Revertir el grupo completo de ${money(group.data.amount)}. Todos los períodos afectados deben estar abiertos. Indica un motivo de al menos 10 caracteres.`);
    if (value === null) return;
    if (value.trim().length < 10) { setMessage("El motivo debe tener al menos 10 caracteres."); return; }
    void run(async () => { await reverseFinanceGroup(group.id, value); clear(); setRevision((r) => r + 1); setMessage("Grupo revertido: saldos restituidos y abonos liberados, sin borrar evidencia."); await onChanged(); });
  }
  return <section id="finance-grouped-allocation" className="finance-card finance-grouped-allocation" aria-label="Conciliaciones agrupadas">
    <h2>Conciliaciones agrupadas</h2><p>Varios abonos a una o varias facturas del mismo cliente. Define cuánto paga cada abono y revisa el resultado completo antes de aprobar.</p>
    <p className="finance-note">Hasta 10 abonos y 20 facturas en CLP. Cada abono se asigna completo y ninguna factura recibe más que su saldo. Un saldo de factura puede quedar pendiente. Para dinero sobrante utiliza Saldos a favor; para descuentos o retenciones, Diferencias justificadas.</p>
    {message && <p role="status" className="finance-note">{message}</p>}{busy && <p role="status" aria-live="polite">Validando o guardando el grupo… No repitas la acción.</p>}
    <label className="finance-group-periods"><input type="checkbox" checked={allPeriods} disabled={locked} onChange={(e) => { setAllPeriods(e.target.checked); setPage(1); clear(); }} />Consultar abonos y grupos de todos los períodos</label>
    {allPeriods && <p>Las fechas originales se conservan. Se verificará que cada período afectado esté abierto.</p>}
    <details><summary>Preparar nueva distribución agrupada</summary>
      <h3>1. Abonos ({movements.length}/10)</h3><RecordBrowser context={effectiveContext} kind="movements" revision={revision} disabled={prepareLocked} selected={movements.map((m) => m.id)} onSelect={(r) => select(r, true)} />
      <h3>2. Facturas del mismo cliente ({invoices.length}/20)</h3><RecordBrowser context={effectiveContext} kind="invoices" revision={revision} disabled={prepareLocked} selected={invoices.map((i) => i.id)} onSelect={(r) => select(r, false)} />
      {!!movements.length && !!invoices.length && <><h3>3. Importe de cada cruce</h3><p>Deja vacío un cruce que no corresponda. Cambiar los registros seleccionados limpia la distribución para evitar asignaciones antiguas.</p>
        <div className="finance-review-table-wrap finance-group-matrix"><table><thead><tr><th>Abono / importe</th>{invoices.map((i) => <th key={i.id}>{i.title}<small>Saldo: {money(Number(i.financial?.balance))}</small></th>)}<th>Por asignar</th></tr></thead><tbody>{movements.map((m) => <tr key={m.id}><th>{m.title}<small>{String(m.data?.transactionDate || m.data?.date || "")} · {money(Number(m.data?.amount))}</small></th>{invoices.map((i) => <td key={i.id}><input aria-label={`${m.title} a ${i.title}`} type="number" min="0" step="1" max={Math.min(Number(m.data?.amount), Number(i.financial?.balance))} disabled={prepareLocked} value={values[key(m.id, i.id)] || ""} onChange={(e) => { setValues({ ...values, [key(m.id, i.id)]: e.target.value }); setPreview(null); }} placeholder="0" /></td>)}<td>{money(Number(m.data?.amount) - movementSum(m.id))}</td></tr>)}<tr><th>Saldo de factura después</th>{invoices.map((i) => <td key={i.id}>{money(Number(i.financial?.balance) - invoiceSum(i.id))}</td>)}<td>Sin diferencias implícitas</td></tr></tbody></table></div>
        {!valid && <p>Asigna todo el importe de cada abono, utiliza todas las facturas seleccionadas y revisa que ninguna reciba más de su saldo.</p>}
        <button className="primary-btn" type="button" disabled={prepareLocked || !valid} onClick={() => void run(async () => { setPreview(await previewFinanceGroup(allocations)); setMessage("Vista previa validada. Aún no se modificaron saldos."); })}>Validar y mostrar vista previa</button></>}
    </details>
    {preview && <div className="finance-bank-mapping"><h3>Vista previa validada por el servidor</h3><p>Cliente RUT {preview.customerRut} · Total {money(preview.total)} · Períodos {preview.periods.join(", ")}</p><div className="finance-review-table-wrap"><table><thead><tr><th>Factura</th><th>Saldo anterior</th><th>Cobro aplicado</th><th>Saldo restante</th></tr></thead><tbody>{preview.documents.map((d) => <tr key={d.id}><td>{d.title}</td><td>{money(d.balance)}</td><td>{money(d.applied)}</td><td>{money(d.remaining)}</td></tr>)}</tbody></table></div><label>Motivo y referencia del respaldo<textarea minLength={10} maxLength={1000} value={reason} disabled={locked} onChange={(e) => setReason(e.target.value)} /></label><p>Se vuelve a verificar todo al aprobar. Si los datos cambiaron, la operación se detiene y debes generar una nueva vista previa.</p><button className="primary-btn" type="button" disabled={locked || !canManage || reason.trim().length < 10} onClick={approve}>Aprobar grupo completo</button>{!canManage && <p>Tu rol puede preparar la distribución, pero no aprobarla.</p>}</div>}
    <h3>Grupos e historial</h3><p>El historial incluye el grupo completo cuando afecta al período consultado; no se recorta por cuenta bancaria.</p><div className="finance-review-toolbar"><label>Buscar RUT, factura o motivo<input value={query} disabled={locked} onChange={(e) => { setQuery(e.target.value); setPage(1); }} /></label><button type="button" disabled={locked} onClick={() => { setPreview(null); setRevision((r) => r + 1); }}>Actualizar historial</button></div>
    <div className="finance-group-history">{groups?.records.map((g) => <article key={g.id}><strong>{g.title} · {money(g.data.amount)}</strong><p>{g.status === "REVERSED" ? "Revertido" : "Aprobado"} · RUT {g.data.customerRut} · {date(g.data.approvedAt)}</p><details><summary>Ver distribución e historial del grupo</summary><p>{g.data.reason} · Usuario aprobador: {g.data.approvedById}</p><p>Períodos: {g.data.periods.join(", ")}</p>{g.data.allocations.map((a) => <p key={key(a.movementId, a.invoiceId)}>{g.data.movements.find((m) => m.id === a.movementId)?.title || a.movementId} → {g.data.documents.find((d) => d.id === a.invoiceId)?.title || a.invoiceId}: <strong>{money(a.amount)}</strong></p>)}{g.data.reversedAt && <p>Reversa: {date(g.data.reversedAt)} · {g.data.reversalReason}</p>}</details>{g.validation?.errors.map((e) => <p key={e} role="alert">{e}</p>)}{g.status === "APPROVED" && <button type="button" className="finance-danger-button" disabled={locked || !canManage || !g.validation?.valid} onClick={() => reverse(g)}>Revertir grupo completo</button>}</article>)}</div>
    {!groups ? <p role="status">Consultando historial…</p> : !groups.total ? <p>No hay grupos con estos filtros.</p> : null}
    <div className="finance-review-toolbar"><button type="button" disabled={locked || page <= 1} onClick={() => setPage(page - 1)}>Anterior</button><span>Página {page} de {groups?.pages || 1} · {groups?.total || 0} grupos</span><button type="button" disabled={locked || !groups || page >= groups.pages} onClick={() => setPage(page + 1)}>Siguiente</button></div>
  </section>;
}
