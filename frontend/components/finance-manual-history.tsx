"use client";
import { useEffect, useRef, useState } from "react";
import { getFinanceManualHistory, previewFinanceManualReversal, reverseFinanceManualSettlement, type FinanceManualKind, type FinanceManualHistoryPage, type FinanceManualReversalPreview } from "@/lib/api";
import styles from "./finance-manual-history.module.css";
const money = (v: number) => new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 }).format(v);
const day = (v?: string) => /^\d{4}-\d{2}-\d{2}$/.test(v || "") ? v!.split("-").reverse().join("/") : v || "Sin fecha";
const timestamp = (v?: string) => v ? new Date(v).toLocaleString("es-CL") : "No informado";
export function FinanceManualHistory({ kind, period, canManage, disabled, refreshVersion, onBusy, onChanged }: { kind: FinanceManualKind; period: string; canManage: boolean; disabled: boolean; refreshVersion: number; onBusy: (v: boolean) => void; onChanged: () => Promise<void> }) {
  const [result, setResult] = useState<FinanceManualHistoryPage | null>(null), [query, setQuery] = useState(""), [status, setStatus] = useState("ALL"), [page, setPage] = useState(1), [allPeriods, setAllPeriods] = useState(false), [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(""), [error, setError] = useState("");
  const [preview, setPreview] = useState<(FinanceManualReversalPreview & { id: string }) | null>(null), [reason, setReason] = useState(""), [confirmation, setConfirmation] = useState(""), [submitted, setSubmitted] = useState(false);
  const lock = useRef(false), alive = useRef(true), seq = useRef(0), dialog = useRef<HTMLDialogElement>(null);
  const locked = busy || disabled, incoming = kind === "RECEIPT";
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { if (preview) dialog.current?.showModal(); }, [preview]);
  useEffect(() => {
    const generation = ++seq.current; setResult(null); setError("");
    const timer = setTimeout(() => { getFinanceManualHistory(kind, { period: allPeriods ? "" : period, query, status, page }).then((r) => { if (generation === seq.current) { if (page > r.pages) setPage(r.pages); else setResult(r); } }).catch((e) => { if (generation === seq.current) setError(e instanceof Error ? e.message : "No se pudo consultar el historial."); }); }, 200);
    return () => { clearTimeout(timer); seq.current++; };
  }, [kind, period, allPeriods, query, status, page, revision, refreshVersion]);
  async function run(action: () => Promise<void>) {
    if (lock.current || locked) return; lock.current = true; setBusy(true); onBusy(true); setMessage(""); setError("");
    try { await action(); } catch (e) { if (alive.current) setError(e instanceof Error ? e.message : "No se pudo confirmar. Consulta el historial antes de iniciar otra operación."); }
    finally { lock.current = false; if (alive.current) setBusy(false); onBusy(false); }
  }
  const close = () => { if (!lock.current) { setPreview(null); setSubmitted(false); setReason(""); setConfirmation(""); } };
  function inspect(id: string) {
    if (!canManage) return;
    void run(async () => { const p = await previewFinanceManualReversal(kind, id); if (alive.current) { setReason(""); setConfirmation(""); setSubmitted(false); setPreview({ ...p, id }); } });
  }
  function reverse() {
    if (!preview || !canManage || reason.trim().length < 10 || confirmation !== "REVERTIR") return;
    const selected = preview; setSubmitted(true);
    void run(async () => {
      const response = await reverseFinanceManualSettlement(kind, selected.id, { expectedVersion: selected.version, reason, confirmation });
      if (!alive.current) return;
      setPreview(null); setSubmitted(false); setRevision((r) => r + 1); setMessage(response.alreadyReversed ? "La reversa ya estaba confirmada. No se duplicó." : "Reversa confirmada. El saldo se restituyó y el comprobante se conserva en el historial.");
      await onChanged();
    });
  }
  return <section className={`finance-card ${styles.panel}`} aria-label={incoming ? "Historial de cobros manuales" : "Historial de pagos manuales"}>
    <h2>{incoming ? "Cobros manuales e historial" : "Pagos manuales e historial"}</h2>
    <p>Corrige un registro equivocado sin borrarlo. La reversa restaura el saldo pendiente, conserva los otros pagos y exige que el período original esté abierto. No devuelve dinero, no realiza transferencias ni modifica el ERP.</p>
    <div className={styles.filters}><label>Buscar documento, nombre, RUT o referencia<input value={query} disabled={locked} onChange={(e) => { setQuery(e.target.value); setPage(1); }} /></label><label>Estado<select value={status} disabled={locked} onChange={(e) => { setStatus(e.target.value); setPage(1); }}><option value="ALL">Todos</option><option value="REGISTERED">Registrados</option><option value="REVERSED">Revertidos</option></select></label><label className={styles.check}><input type="checkbox" checked={allPeriods} disabled={locked} onChange={(e) => { setAllPeriods(e.target.checked); setPage(1); }} />Todos los períodos</label><button type="button" disabled={locked} onClick={() => setRevision((r) => r + 1)}>Actualizar</button></div>
    <small>Período por fecha del cobro/pago: {allPeriods ? "todos" : period || "todos"}. Estos registros manuales no se filtran por cuenta bancaria.</small>
    {message && <p role="status">{message}</p>}{error && !preview && <p role="alert" className={styles.error}>{error}</p>}{busy && <p role="status">Validando o guardando… No repitas la acción.</p>}
    <div className={styles.table}><table><thead><tr><th>Fecha efectiva</th><th>Documento / contraparte</th><th>Monto</th><th>Estado y referencia</th><th>Acciones</th></tr></thead><tbody>{result?.records.map((r) => <tr key={r.entry.id}><td>{day(r.entry.data.paymentDate)}</td><td><strong>{r.documentTitle}</strong><small>{r.partyName} {r.partyRut}</small></td><td>{money(r.entry.data.amount)}</td><td>{r.entry.status === "REVERSED" ? "Revertido" : "Registrado"}<small>{r.entry.data.reference || "Sin referencia"}</small></td><td><details><summary>Ver historial</summary><p>Registrado: {timestamp(r.entry.data.registeredAt)} · Usuario: {r.entry.data.registeredById || "No informado"}</p>{r.entry.data.reversedAt && <p>Revertido: {timestamp(r.entry.data.reversedAt)} · Usuario: {r.entry.data.reversedById} · Motivo: {r.entry.data.reversalReason}</p>}</details>{r.entry.status !== "REVERSED" && <><button type="button" disabled={locked || !canManage || !r.canReverse} onClick={() => inspect(r.entry.id)}>Revisar reversa</button>{r.blockedReason && <small>{r.blockedReason}</small>}</>}</td></tr>)}</tbody></table></div>
    {!result && !error && <p role="status">Cargando historial…</p>}{result?.total === 0 && <p>No hay registros con estos filtros.</p>}{!canManage && <p>Tu rol puede consultar el historial; la reversa requiere permisos de administración.</p>}
    <div className={styles.pagination}><button type="button" disabled={locked || page <= 1} onClick={() => setPage(page - 1)}>Anterior</button><span>Página {page} de {result?.pages || 1} · {result?.total || 0} registros</span><button type="button" disabled={locked || !result || page >= result.pages} onClick={() => setPage(page + 1)}>Siguiente</button></div>
    {preview && <dialog ref={dialog} className={styles.dialog} aria-labelledby="manual-reversal-title" onCancel={(e) => { e.preventDefault(); close(); }}><form onSubmit={(e) => { e.preventDefault(); reverse(); }}><h2 id="manual-reversal-title">Revertir {incoming ? "cobro" : "pago"} manual</h2><p>{preview.title}</p><p>Importe a revertir: <strong>{money(preview.amount)}</strong> · Fecha original: {day(preview.paymentDate)}</p><dl><dt>Saldo pendiente actual</dt><dd>{money(preview.before.balance)}</dd><dt>Saldo pendiente después</dt><dd>{money(preview.after.balance)}</dd><dt>Total pagado después</dt><dd>{money(preview.after.paidAmount)}</dd></dl><p>Se volverá a comprobar el período {preview.period} y que ningún saldo haya cambiado. Se conserva el comprobante original como Revertido.</p><label>Motivo / respaldo<textarea required minLength={10} maxLength={1000} disabled={busy || submitted} value={reason} onChange={(e) => setReason(e.target.value)} /></label><label>Escribe REVERTIR para confirmar<input required autoComplete="off" value={confirmation} disabled={busy || submitted} onChange={(e) => setConfirmation(e.target.value)} /></label>{error && <p role="alert" className={styles.error}>{error}</p>}{submitted && !busy && <p>El reintento conserva la misma confirmación y no duplica la reversa. Si cambió el saldo, cierra y genera otra vista previa.</p>}<footer><button type="button" disabled={busy} onClick={close}>Cerrar</button><button type="submit" disabled={busy || confirmation !== "REVERTIR" || reason.trim().length < 10}>{busy ? "Revirtiendo…" : submitted ? "Reintentar sin duplicar" : "Confirmar reversa"}</button></footer></form></dialog>}
  </section>;
}
