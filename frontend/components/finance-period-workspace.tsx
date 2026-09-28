"use client";

import { useEffect, useRef, useState } from "react";
import { getFinanceMonthlyClosePreview, registerFinanceMonthlyClose, reopenFinanceMonthlyPeriod, type FinanceMonthlyClosePreview } from "@/lib/api";
import { FinancePeriodCoveragePanel } from "@/components/finance-period-coverage";
import { FinanceHistoricalReviewPanel } from "@/components/finance-historical-review";

const money = (value: number | null) => value === null ? "Monto por revisar" : new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 }).format(value);
const date = (value: string) => Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString("es-CL") : "Fecha no disponible";

export function FinancePeriodWorkspace({ period, canManage, onBusy, onResolve }: {
  period: string; canManage: boolean; onBusy: (value: boolean) => void; onResolve: (type: string) => void;
}) {
  const [view, setView] = useState<FinanceMonthlyClosePreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [note, setNote] = useState("");
  const [reason, setReason] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [rowPage, setRowPage] = useState(1);
  const [blockerLimit, setBlockerLimit] = useState(25);
  const generation = useRef(0);
  const control = view?.periodControl;
  async function refresh(snapshotId?: string) {
    const request = ++generation.current;
    setBusy(true); setError("");
    try { const result = await getFinanceMonthlyClosePreview(period, snapshotId); if (request === generation.current) { setView(result); setRowPage(1); setBlockerLimit(25); setConfirmation(""); } }
    catch (e) { if (request === generation.current) { setError(e instanceof Error ? e.message : "No se pudo consultar el período."); setView(null); } }
    finally { if (request === generation.current) setBusy(false); }
  }
  useEffect(() => { void refresh(); return () => { generation.current += 1; }; }, [period]);

  async function close() {
    if (!control || !canManage || busy || confirmation !== "CERRAR" || view?.status !== "READY_TO_CLOSE") return;
    setBusy(true); onBusy(true); setError(""); setNotice("");
    try {
      await registerFinanceMonthlyClose({ period, expectedVersion: control.version, confirmation: "CERRAR", note });
      setNote(""); setNotice("Cierre guardado con su fotografía y auditoría. Estás viendo los valores registrados al cerrar."); await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "No se pudo cerrar."); }
    finally { setBusy(false); onBusy(false); }
  }
  async function reopen() {
    if (!control?.latestCloseId || !canManage || busy || confirmation !== "REABRIR" || reason.trim().length < 10) return;
    setBusy(true); onBusy(true); setError(""); setNotice("");
    try {
      await reopenFinanceMonthlyPeriod({ period, closeId: control.latestCloseId, expectedVersion: control.version, confirmation: "REABRIR", reason });
      setReason(""); setNotice("Período reabierto. La fotografía anterior permanece en el historial; el próximo cierre generará una nueva."); await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "No se pudo reabrir."); }
    finally { setBusy(false); onBusy(false); }
  }
  function download() {
    if (!view) return;
    const cell = (value: unknown) => { const source = String(value ?? ""); return `"${(typeof value === "string" && /^[\s]*[=+@-]/.test(source) ? "'" : "") + source.replace(/"/g, '""')}"`; };
    const rows = [["Fecha", "Tipo", "Documento", "Contraparte", "Categoría", "Monto", "Saldo", "Estado"], ...view.rows.map((row) => [row.fecha, row.tipo, row.documento, row.contraparte, row.categoria, row.monto ?? "Monto por revisar", row.saldo, row.estado])];
    const url = URL.createObjectURL(new Blob(["\uFEFF" + rows.map((row) => row.map(cell).join(";")).join("\r\n")], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a"); a.href = url; a.download = `cierre-${period}-${view.snapshotId || "vista-previa"}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <section className="finance-period-workspace">
    <FinanceHistoricalReviewPanel canManage={canManage} onChanged={() => refresh()} onBusy={onBusy} />
    {view?.metrics.customerCreditAvailable !== undefined ? <p className="finance-note">Saldo a favor de clientes al final del período: <strong>{money(view.metrics.customerCreditAvailable)}</strong>. Son abonos recibidos pendientes de aplicación; no se suman nuevamente como ingreso bancario ni como facturación.</p> : null}
    {view?.metrics.justifiedDifferences !== undefined ? <p className="finance-note">Diferencias justificadas en este período: <strong>{money(view.metrics.justifiedDifferences)}</strong>. Reducen deuda con aprobación y respaldo, pero no incrementan los ingresos bancarios ni emiten documentos tributarios.</p> : null}
    {view?.coverage ? <FinancePeriodCoveragePanel key={`${view.coverage.fingerprint}:${view.coverage.review?.id || "pending"}:${view.snapshotId || "live"}`} coverage={view.coverage} version={control?.version ?? 0} editable={canManage && !busy && control?.status === "OPEN" && !view.snapshotId} onSaved={() => refresh()} onBusy={onBusy} /> : view?.snapshotId ? <p className="finance-note">Este cierre histórico no contiene la verificación de cobertura nueva. Se conserva sin modificar ni certificar retroactivamente.</p> : null}
    <article className="finance-card"><div className="finance-card-heading"><div><span className="finance-eyebrow">Control mensual · empresa completa · CLP</span><h2>Cierre y reapertura de {period}</h2><p>Estado actual del período: <strong>{control?.status === "CLOSED" ? "Cerrado" : control ? "Abierto" : "Consultando"}</strong>{control ? ` · versión ${control.version}` : ""}</p></div><button type="button" className="secondary-btn" disabled={busy} onClick={() => void refresh()}>Actualizar estado actual</button></div>
      {error ? <p className="finance-note" role="alert">{error}</p> : null}{notice ? <p className="finance-note" role="status">{notice}</p> : null}{busy ? <p role="status">Procesando el período…</p> : null}
      {view?.protection ? <p className="finance-note"><strong>Alcance del bloqueo actual</strong> {view.protection.message}</p> : null}
      {!canManage ? <p>Puedes consultar y exportar. Cerrar o reabrir requiere una cuenta administradora.</p> : null}
      {canManage && control?.status === "OPEN" && view?.status === "READY_TO_CLOSE" ? <div className="finance-form"><label>Nota interna<textarea value={note} maxLength={2000} disabled={busy} onChange={(e) => setNote(e.target.value)} /></label><label>Escribe CERRAR para confirmar<input value={confirmation} disabled={busy} onChange={(e) => setConfirmation(e.target.value)} autoComplete="off" /></label><button type="button" className="primary-btn" disabled={busy || confirmation !== "CERRAR"} onClick={() => void close()}>Cerrar período y guardar fotografía</button></div> : null}
      {canManage && control?.status === "CLOSED" && view?.snapshotId === control.latestCloseId ? <details><summary>Reabrir período con autorización</summary><div className="finance-form"><p>Permite corregir las operaciones protegidas. No borra ni cambia la fotografía anterior y deja constancia de quién reabrió y por qué.</p><label>Motivo de reapertura<textarea value={reason} minLength={10} maxLength={1000} disabled={busy} onChange={(e) => setReason(e.target.value)} /></label><label>Escribe REABRIR para confirmar<input value={confirmation} disabled={busy} autoComplete="off" onChange={(e) => setConfirmation(e.target.value)} /></label><button type="button" className="finance-danger-button" disabled={busy || confirmation !== "REABRIR" || reason.trim().length < 10} onClick={() => void reopen()}>Reabrir y registrar motivo</button></div></details> : null}
    </article>
    {view ? <article className="finance-card"><h2>{view.snapshotId ? "Fotografía guardada · valores históricos" : "Vista previa · datos actuales"}</h2><p>{view.snapshotId ? `Cierre ${view.snapshotId}` : "Se recalculará dentro de la transacción al confirmar el cierre."}</p><div className="finance-migration-kpis"><div><small>Facturado</small><strong>{money(view.metrics.issued)}</strong></div><div><small>Cobrado</small><strong>{money(view.metrics.collected)}</strong></div><div><small>Pagado</small><strong>{money(view.metrics.paidPayables)}</strong></div><div><small>Abonos bancarios</small><strong>{money(view.metrics.incoming)}</strong></div><div><small>Cargos bancarios</small><strong>{money(view.metrics.outgoing)}</strong></div><div><small>Flujo bancario neto</small><strong>{money(view.metrics.netBankFlow)}</strong></div></div>
      {Boolean(view.metrics.unclassifiedMovements) ? <p className="finance-note" role="alert">Hay {view.metrics.unclassifiedMovements} movimiento(s) con monto o tipo por revisar. No se incluyen en abonos, cargos ni flujo neto y bloquean el cierre. Los totales son provisionales.</p> : null}
      {view.documentSummary ? <p className="finance-note">Documentos emitidos en el período, con saldo a la fecha de consulta o de la fotografía guardada. Cobrado/pagado se calcula sobre esos documentos y no equivale al flujo bancario del mes. Saldo de clientes: {money(view.documentSummary.customers.pendingAmount)} · Saldo de proveedores: {money(view.documentSummary.suppliers.pendingAmount)}. Fuera de los totales: {view.documentSummary.excluded.inactive} anulados/excluidos, {view.documentSummary.excluded.adjustments} notas independientes y {view.documentSummary.excluded.invalid} con datos inconsistentes. No es una reconstrucción histórica de saldos.</p> : null}
      {!view.snapshotId ? <p>Conciliaciones verificadas: <strong>{view.metrics.reconciliations}</strong> · Movimientos pendientes de respaldo: <strong>{view.metrics.unreconciledMovements}</strong> · Vínculos inconsistentes: <strong>{view.metrics.inconsistentReconciliations ?? 0}</strong> · Movimientos excluidos del cierre: <strong>{view.metrics.excludedMovements ?? 0}</strong>. Se comprueban aprobación, vínculo, facturas, comprobantes y montos; una etiqueta de conciliado no basta.</p> : <p>Los indicadores históricos se conservan como fueron guardados; no se certifican nuevamente con las reglas actuales.</p>}
      {view.blockers.length ? <><h3>{view.blockers.length} pendientes por resolver</h3><div className="finance-table">{view.blockers.slice(0, blockerLimit).map((item) => <div key={item.id}><span>{item.title}</span><button type="button" className="secondary-btn" onClick={() => onResolve(item.type)}>Resolver</button></div>)}</div>{blockerLimit < view.blockers.length ? <button type="button" onClick={() => setBlockerLimit((value) => value + 25)}>Mostrar más pendientes</button> : null}</> : <p>Sin pendientes registrados en esta {view.snapshotId ? "fotografía" : "vista previa"}. La presencia de registros no acredita por sí sola cobertura documental completa.</p>}
      <details><summary>Ver los {view.rows.length} registros del resultado</summary><div className="finance-review-table-wrap"><table><thead><tr><th>Fecha</th><th>Documento</th><th>Contraparte</th><th>Monto</th><th>Saldo</th></tr></thead><tbody>{view.rows.slice((rowPage - 1) * 25, rowPage * 25).map((row, index) => <tr key={`${rowPage}-${index}`}><td>{row.fecha}</td><td>{row.documento}<small>{row.tipo}</small></td><td>{row.contraparte}</td><td>{money(row.monto)}</td><td>{money(row.saldo)}</td></tr>)}</tbody></table></div><div className="finance-review-toolbar"><button type="button" disabled={rowPage === 1} onClick={() => setRowPage(rowPage - 1)}>Anterior</button><span>Página {rowPage} de {Math.max(1, Math.ceil(view.rows.length / 25))}</span><button type="button" disabled={rowPage * 25 >= view.rows.length} onClick={() => setRowPage(rowPage + 1)}>Siguiente</button></div></details>
      <button type="button" className="secondary-btn" onClick={download}>Descargar todos los registros (CSV)</button>
    </article> : null}
    <article className="finance-card"><h2>Historial de cierres y reaperturas</h2><p>Cada nuevo cierre conserva sus propios valores y se enlaza con el anterior.</p>{view?.history?.map((event) => <div className="finance-note" key={event.id}><strong>{event.kind === "CLOSE" ? "Cierre" : "Reapertura"}{event.active ? " · activo" : ""}</strong><span>{date(event.at)} · versión {event.version ?? "histórica"}</span><span>{event.note || "Sin nota adicional"}</span>{event.kind === "CLOSE" ? <button type="button" className="finance-link-button" disabled={busy} onClick={() => void refresh(event.id)}>Ver fotografía de este cierre</button> : null}</div>)}{!view?.history?.length ? <p>Todavía no hay cierres registrados para este período.</p> : null}</article>
  </section>;
}
