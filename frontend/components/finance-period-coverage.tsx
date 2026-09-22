"use client";
import { useRef, useState } from "react";
import { reviewFinanceCoverage, type FinancePeriodCoverage, type FinanceCoverageDeclaration } from "@/lib/api";

export function FinancePeriodCoveragePanel({ coverage, version, editable, onSaved, onBusy }: {
  coverage: FinancePeriodCoverage; version: number; editable: boolean; onSaved: () => Promise<void>; onBusy: (busy: boolean) => void;
}) {
  const [entries, setEntries] = useState<Record<string, Partial<FinanceCoverageDeclaration>>>(() => Object.fromEntries(coverage.sources.map((s) => [s.id, { sourceId: s.id, from: coverage.from, to: coverage.to, evidence: "" }])));
  const [inventory, setInventory] = useState(false), [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const lock = useRef(false);
  function update(id: string, field: keyof FinanceCoverageDeclaration, value: string | number | undefined) { setEntries((old) => ({ ...old, [id]: { ...old[id], [field]: value } })); }
  async function save() {
    if (lock.current || !editable || coverage.blockers.length || !inventory || confirmation !== "VERIFICAR") return;
    lock.current = true; setBusy(true); onBusy(true); setError("");
    try {
      await reviewFinanceCoverage({ period: coverage.period, expectedVersion: version, fingerprint: coverage.fingerprint, declarations: coverage.sources.map((s) => entries[s.id] as FinanceCoverageDeclaration), inventoryConfirmed: inventory, confirmation: "VERIFICAR" });
      await onSaved();
    } catch (e) { setError(e instanceof Error ? e.message : "No se pudo guardar la revisión."); }
    finally { lock.current = false; setBusy(false); onBusy(false); }
  }
  const canEdit = editable && !coverage.complete;
  return <article className="finance-card finance-coverage-panel" aria-label="Verificación de cobertura del período">
    <h2>¿Está completo el período?</h2>
    <p><strong>{coverage.complete ? "Cobertura revisada y vigente" : coverage.status === "STALE" ? "Revisión desactualizada: vuelve a verificar" : "Cobertura pendiente de verificación"}</strong> · {coverage.from} al {coverage.to}</p>
    <p>{coverage.basis}</p>
    <p>Compara con las cartolas originales y los reportes completos de ventas y compras del banco, ERP o SII. Las fechas de los registros que ves abajo no son el rango de cobertura de esos reportes. Si falta una cuenta, regístrala en Centro de Conexiones o carga su cartola antes de confirmar.</p>
    {coverage.blockers.length ? <div role="alert" className="finance-note"><strong>Antes de verificar:</strong><ul>{coverage.blockers.map((b) => <li key={b.id}>{b.title}</li>)}</ul></div> : null}
    {coverage.sources.map((source) => {
      const saved = coverage.review?.declarations.find((d) => d.sourceId === source.id);
      const entry = entries[source.id];
      return <fieldset key={source.id} className="finance-coverage-source" disabled={busy}>
        <legend>{source.label}</legend>
        <p>{source.count} registro(s) del mes{source.kind === "BANK" ? ` · ${source.statements} cartola(s) relacionadas` : ""}. {source.firstMovementOrDocumentDate ? `Fechas observadas: ${source.firstMovementOrDocumentDate} a ${source.lastMovementOrDocumentDate}.` : "Sin registros fechados en este mes."}</p>
        {canEdit ? <div className="finance-coverage-fields">
          <label>Resultado de la revisión<select value={entry.status || ""} onChange={(e) => update(source.id, "status", e.target.value)}><option value="">Selecciona un resultado</option><option value="COMPLETE">Todos los datos están cargados</option><option value="NO_ACTIVITY" disabled={source.count > 0}>Sin actividad: comprobado con la fuente</option>{source.kind === "BANK" ? <option value="NOT_APPLICABLE" disabled={source.count > 0}>Cuenta fuera de alcance en este mes</option> : null}</select></label>
          <label>Cobertura revisada desde<input type="date" value={entry.from} onChange={(e) => update(source.id, "from", e.target.value)} /></label>
          <label>Cobertura revisada hasta<input type="date" value={entry.to} onChange={(e) => update(source.id, "to", e.target.value)} /></label>
          <label>{source.kind === "BANK" ? "Movimientos del mes en la fuente original" : "Documentos del mes en la fuente original"}<input type="number" min={0} step={1} value={entry.expectedCount ?? ""} onChange={(e) => update(source.id, "expectedCount", e.target.value === "" ? undefined : Number(e.target.value))} />{entry.expectedCount !== undefined && entry.expectedCount !== source.count ? <small role="alert">No coincide con los {source.count} registros cargados.</small> : null}</label>
          <label className="finance-coverage-evidence">Referencia del reporte y explicación<textarea maxLength={1500} minLength={10} value={entry.evidence} placeholder="Ej.: cartola N.º 42, reporte mensual de ventas; comprobé páginas y documentos. No incluyas contraseñas." onChange={(e) => update(source.id, "evidence", e.target.value)} /></label>
        </div> : saved ? <p><strong>{saved.status === "COMPLETE" ? "Carga completa declarada" : saved.status === "NO_ACTIVITY" ? "Sin actividad declarada" : "Fuera de alcance con justificación"}</strong> · {saved.from} al {saved.to} · {saved.expectedCount} registros en la fuente original<br />{saved.evidence}</p> : <p>Sin revisión guardada.</p>}
      </fieldset>;
    })}
    {coverage.review ? <p>Última revisión: {new Date(coverage.review.reviewedAt).toLocaleString("es-CL")} · Usuario: {coverage.review.reviewedById}. Los cambios en datos o una reapertura invalidan la revisión anterior.</p> : null}
    {canEdit ? <div className="finance-form">
      <label className="finance-coverage-confirm"><input type="checkbox" checked={inventory} disabled={busy} onChange={(e) => setInventory(e.target.checked)} /><span>Confirmo que revisé todas las cuentas bancarias y fuentes de documentos de esta empresa para el mes; no omití cuentas o archivos pendientes.</span></label>
      <label>Escribe VERIFICAR para registrar tu revisión<input value={confirmation} disabled={busy} autoComplete="off" onChange={(e) => setConfirmation(e.target.value)} /></label>
      <button type="button" className="primary-btn" disabled={busy || !inventory || confirmation !== "VERIFICAR" || coverage.blockers.length > 0 || coverage.sources.some((s) => !entries[s.id]?.status || entries[s.id]?.expectedCount !== s.count || (entries[s.id]?.evidence?.trim().length || 0) < 10)} onClick={() => void save()}>{busy ? "Guardando revisión…" : "Guardar revisión de cobertura"}</button>
      {error ? <p role="alert">{error}</p> : null}
    </div> : !editable && !coverage.complete ? <p>La verificación requiere una cuenta autorizada para cerrar períodos y un período abierto.</p> : null}
  </article>;
}
