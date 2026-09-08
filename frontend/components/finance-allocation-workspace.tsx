"use client";

import { useEffect, useState } from "react";
import { getFinanceAllocationWorkspace, applyManualFinanceAllocation, reverseFinanceReconciliation, type IndustryRecord, type FinanceAllocationPage, type FinanceWorkspaceContext } from "@/lib/api";

type Row = FinanceAllocationPage["records"][number];
const dataOf = (row: IndustryRecord) => (row.data || {}) as Record<string, unknown>;
const money = (value: unknown) => new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 }).format(Number(value || 0));

function RecordBrowser({ context, kind, revision, disabled, selected, onSelect, onReverse }: {
  context: FinanceWorkspaceContext; kind: string; revision: number; disabled: boolean; selected: string[];
  onSelect: (row: Row) => void; onReverse?: (row: Row) => void;
}) {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [result, setResult] = useState<FinanceAllocationPage | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true; setLoading(true); setError(""); setResult(null);
    const timer = setTimeout(() => { getFinanceAllocationWorkspace(context, kind, page, search).then((response) => {
      if (!active) return;
      if (page > response.pages) { setPage(response.pages); return; }
      setResult(response);
    }).catch((e) => { if (active) setError(e.message); }).finally(() => { if (active) setLoading(false); }); }, 200);
    return () => { active = false; clearTimeout(timer); };
  }, [context.period, context.accountKey, context.currency, kind, page, search, revision]);
  return <div className="finance-bank-review">
    <label>Buscar por nombre, RUT, folio o referencia<input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Escribe para buscar" /></label>
    {error ? <p role="alert">{error}</p> : null}
    <div className="finance-review-table-wrap"><table><thead><tr><th>{kind === "history" ? "Conciliación" : "Registro"}</th><th>{kind === "invoices" ? "Saldo disponible" : "Monto"}</th><th>Acción</th></tr></thead><tbody>{result?.records.map((row) => {
      const data = dataOf(row); const entries = Array.isArray(data.allocations) ? data.allocations as Array<{ invoiceId: string; amount: number; documentTitle?: string }> : [];
      return <tr key={row.id}><td><strong>{row.title}</strong><small>{String(data.transactionDate || data.issueDate || "")} · {String(data.clientName || data.customerName || data.payerName || "")} · {String(data.clientRut || data.customerRut || data.rut || "")}</small>
        {kind === "movements" ? <small>{String(data.description || "")} · {String(data.direction === "DEBIT" ? "Cargo (no conciliable con clientes)" : data.direction === "CREDIT" ? "Abono" : "Tipo pendiente de identificar")}</small> : null}
        {kind === "history" ? <details><summary>{row.status === "REVERSED" ? "Revertida · ver trazabilidad" : "Aprobada · ver distribución"}</summary><p>{String(data.reason || "Aprobación de sugerencia")}</p><p>Aprobación: {String(data.approvedAt || "Sin fecha")}</p>{entries.map((item) => <p key={item.invoiceId}>{item.documentTitle || `Documento ${item.invoiceId}`}: {money(item.amount)}</p>)}{!entries.length ? <p>Conciliación histórica: la reversa comprobará sus comprobantes vinculados.</p> : null}{row.status === "REVERSED" ? <p>Reversa: {String(data.reversedAt)} · {String(data.reversalReason)}</p> : null}</details> : null}
      </td><td>{money(kind === "invoices" ? row.financial?.balance : data.amount)}</td><td>{kind === "history" ? <button type="button" className="finance-danger-button" disabled={disabled || row.status !== "APPROVED"} onClick={() => onReverse?.(row)}>Revertir con motivo</button> : <button type="button" className="finance-link-button" disabled={disabled} aria-pressed={selected.includes(row.id)} onClick={() => onSelect(row)}>{selected.includes(row.id) ? "Seleccionado · quitar" : "Seleccionar"}</button>}</td></tr>;
    })}</tbody></table></div>
    {loading ? <p role="status">Consultando registros…</p> : !result?.total ? <p>No hay registros con estos filtros.</p> : null}
    <div className="finance-review-toolbar"><button type="button" disabled={loading || page === 1} onClick={() => setPage(page - 1)}>Anterior</button><span>Página {page} de {result?.pages || 1} · {result?.total || 0} registros</span><button type="button" disabled={loading || !result || page >= result.pages} onClick={() => setPage(page + 1)}>Siguiente</button></div>
  </div>;
}

export function FinanceAllocationWorkspace({ context, canManage, disabled, onBusy, onChanged }: {
  context: FinanceWorkspaceContext; canManage: boolean; disabled: boolean; onBusy: (value: boolean) => void; onChanged: () => Promise<void>;
}) {
  const [movement, setMovement] = useState<Row | null>(null);
  const [allocations, setAllocations] = useState<Array<{ row: Row; amount: string }>>([]);
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const locked = disabled || busy || !canManage;
  const total = allocations.reduce((sum, item) => sum + Number(item.amount), 0);
  const available = movement ? Number(dataOf(movement).amount) : 0;
  function selectInvoice(row: Row) {
    setAllocations((items) => items.some((item) => item.row.id === row.id) ? items.filter((item) => item.row.id !== row.id) : items.length < 100 ? [...items, { row, amount: String(row.financial?.balance || 0) }] : items);
  }
  async function confirm() {
    if (!movement || locked) return;
    if (!window.confirm(`¿Aplicar ${money(total)} a ${allocations.length} documento(s)? Se actualizarán sus saldos y quedará registrada tu decisión.`)) return;
    setBusy(true); onBusy(true); setMessage("");
    try {
      await applyManualFinanceAllocation(movement.id, allocations.map((item) => ({ invoiceId: item.row.id, amount: Number(item.amount) })), reason);
      setMovement(null); setAllocations([]); setReason(""); setRevision((value) => value + 1); setMessage("Conciliación aplicada. Los saldos y comprobantes quedaron actualizados."); await onChanged();
    } catch (e) { setMessage(e instanceof Error ? e.message : "No se pudo aplicar. Actualiza antes de reintentar."); }
    finally { setBusy(false); onBusy(false); }
  }
  async function reverse(row: Row) {
    if (locked) return;
    const reason = window.prompt("Motivo de la reversa (mínimo 10 caracteres). Se restaurarán los saldos sin borrar los comprobantes.");
    if (reason === null) return;
    if (reason.trim().length < 10) { setMessage("El motivo debe tener al menos 10 caracteres."); return; }
    setBusy(true); onBusy(true); setMessage("");
    try { const result = await reverseFinanceReconciliation(row.id, reason); setRevision((value) => value + 1); setMovement(null); setAllocations([]); setMessage(result.alreadyReversed ? "Esta conciliación ya estaba revertida; no se modificaron saldos otra vez." : "Conciliación revertida. El abono vuelve a estar disponible y sus comprobantes conservan la trazabilidad."); await onChanged(); }
    catch (e) { setMessage(e instanceof Error ? e.message : "No se pudo revertir."); }
    finally { setBusy(false); onBusy(false); }
  }
  return <section className="finance-card finance-allocation-workspace"><h2>Distribuir pagos y revisar conciliaciones</h2><p>Selecciona un abono y distribúyelo entre documentos del mismo cliente. Puedes dejar saldos pendientes por factura, pero debes asignar el abono completo, sin diferencias. Varios abonos pueden aplicarse sucesivamente al saldo de una misma factura.</p>
    {!canManage ? <p className="finance-note">Puedes consultar. Sólo una cuenta administradora puede aprobar o revertir.</p> : null}
    {message ? <p className="finance-note" role="status">{message}</p> : null}
    <details><summary>1. Seleccionar movimiento del período y cuenta activos</summary><RecordBrowser context={context} kind="movements" revision={revision} disabled={locked} selected={movement ? [movement.id] : []} onSelect={(row) => { setMovement(movement?.id === row.id ? null : row); setAllocations([]); }} /></details>
    {movement ? <><p><strong>Abono seleccionado:</strong> {movement.title} · {money(available)}</p><details open><summary>2. Seleccionar documentos pendientes (incluye períodos anteriores)</summary><RecordBrowser context={context} kind="invoices" revision={revision} disabled={locked} selected={allocations.map((item) => item.row.id)} onSelect={selectInvoice} /></details>
      {allocations.length ? <div className="finance-bank-mapping"><h3>3. Revisar distribución</h3>{allocations.map((item) => <label key={item.row.id}>{item.row.title} · saldo {money(item.row.financial?.balance)}<input type="number" min="1" step="1" max={item.row.financial?.balance} value={item.amount} disabled={locked} onChange={(event) => setAllocations((items) => items.map((entry) => entry.row.id === item.row.id ? { ...entry, amount: event.target.value } : entry))} /></label>)}<p>Asignado: {money(total)} · Falta asignar: {money(available - total)}</p><label>Motivo y evidencia de la decisión<textarea value={reason} minLength={10} maxLength={1000} disabled={locked} onChange={(event) => setReason(event.target.value)} placeholder="Ej. Comprobante del cliente que identifica las facturas y sus montos." /></label><button type="button" className="primary-btn" disabled={locked || total !== available || reason.trim().length < 10 || allocations.some((item) => !Number.isSafeInteger(Number(item.amount)) || Number(item.amount) <= 0 || Number(item.amount) > Number(item.row.financial?.balance))} onClick={() => void confirm()}>{busy ? "Procesando…" : "Confirmar distribución"}</button></div> : null}</> : null}
    <details><summary>Historial del período · consultar o revertir</summary><p>La reversa exige un motivo y se bloquea si el período está cerrado o los comprobantes no cuadran. No elimina registros.</p><RecordBrowser context={context} kind="history" revision={revision} disabled={locked} selected={[]} onSelect={() => {}} onReverse={(row) => void reverse(row)} /></details>
  </section>;
}
