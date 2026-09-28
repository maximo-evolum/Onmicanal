"use client";
import { useEffect, useRef, useState } from "react";
import { getBankFileLayout, reanalyzeFinanceBankImport, type BankFileLayout, type BankFileSelection, type FinanceBankStatementPreview } from "@/lib/api";

export function FinanceBankLayout({ jobId, revision, selection = {}, disabled, onBusy, onDirty, onUpdated }: {
  jobId: string; revision: number; selection?: BankFileSelection; disabled: boolean; onBusy: (v: boolean) => void; onDirty?: (v: boolean) => void; onUpdated: (p: FinanceBankStatementPreview) => void;
}) {
  const [open, setOpen] = useState(false), [sheet, setSheet] = useState(selection.sheet || ""), [delimiter, setDelimiter] = useState(selection.delimiter || "");
  const [header, setHeader] = useState(String(selection.headerRow || "")), [end, setEnd] = useState(String(selection.endRow || ""));
  const [page, setPage] = useState(1), [layout, setLayout] = useState<BankFileLayout | null>(null), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const lock = useRef(false), identity = `${jobId}:${revision}`, identityRef = useRef(identity); identityRef.current = identity;
  useEffect(() => { setOpen(false); setLayout(null); setSheet(selection.sheet || ""); setDelimiter(selection.delimiter || ""); setHeader(String(selection.headerRow || "")); setEnd(String(selection.endRow || "")); setPage(1); onDirty?.(false); }, [identity]);
  useEffect(() => {
    if (!open) return;
    let alive = true; setLayout(null); setError("");
    getBankFileLayout(jobId, { sheet, delimiter, page }).then((r) => {
      if (!alive) return;
      if (r.revision !== revision) throw new Error("La revisión cambió. Recupera la carga antes de cambiar su estructura.");
      setLayout(r);
    }).catch((e) => { if (alive) setError(e instanceof Error ? e.message : "No se pudo leer el original."); });
    return () => { alive = false; };
  }, [open, identity, sheet, delimiter, page]);
  async function apply() {
    if (lock.current || disabled || !layout?.supported) return;
    const selected: BankFileSelection = { ...(sheet ? { sheet } : {}), ...(delimiter ? { delimiter } : {}), ...(header ? { headerRow: Number(header) } : {}), ...(end ? { endRow: Number(end) } : {}) };
    if ([selected.headerRow, selected.endRow].some((n) => n !== undefined && (!Number.isSafeInteger(n) || n < 1)) || (selected.headerRow && selected.endRow && selected.endRow <= selected.headerRow)) { setError("Revisa los números de fila: el final debe estar después del encabezado."); return; }
    if (!window.confirm("Se volverá a leer el original. Se limpiarán las columnas asignadas y las exclusiones anteriores; revisa de nuevo todos los movimientos antes de incorporar. ¿Continuar?")) return;
    const current = identity; lock.current = true; setBusy(true); onBusy(true); setError("");
    try {
      const result = await reanalyzeFinanceBankImport(jobId, undefined, { revision, reviewConfig: { mapping: {}, excludedRows: [], selection: selected } });
      if (identityRef.current === current) { onUpdated(result); setOpen(false); onDirty?.(false); }
    } catch (e) { setError(`${e instanceof Error ? e.message : "No se pudo cambiar la lectura."} Si el análisis falló, usa Actualizar estado en Importaciones guardadas y vuelve a elegir la tabla desde esa carga. No se incorporaron movimientos por esta acción.`); }
    finally { lock.current = false; setBusy(false); onBusy(false); }
  }
  return <section className="finance-bank-mapping" aria-label="Hoja y rango del archivo original">
    <button type="button" className="finance-link-button" disabled={disabled || busy} aria-expanded={open} onClick={() => { setOpen(!open); onDirty?.(!open); }}>{open ? "Cerrar selección de tabla" : "Elegir hoja, encabezado y final de tabla"}</button>
    {open && <><p>Consulta el original sin modificarlo. Los números de Excel son filas reales; en CSV son registros, no necesariamente líneas de texto. Sólo se incorporará la tabla seleccionada, no todo el libro.</p>
      <div className="finance-bank-mapping-fields">
        <label>Hoja de Excel<select value={sheet} disabled={disabled || busy} onChange={(e) => { setSheet(e.target.value); setHeader(""); setEnd(""); setPage(1); }}><option value="">Detección automática</option>{layout?.sheets.map((s) => <option key={s.name} value={s.name}>{s.name} ({s.rows} filas)</option>)}{sheet && !layout?.sheets.some((s) => s.name === sheet) && <option value={sheet}>{sheet}</option>}</select></label>
        {layout?.kind !== "sheet" && <label>Separador CSV / TXT<select value={delimiter} disabled={disabled || busy} onChange={(e) => { setDelimiter(e.target.value); setHeader(""); setEnd(""); setPage(1); }}><option value="">Automático</option><option value=";">Punto y coma</option><option value=",">Coma</option><option value={"\t"}>Tabulación</option><option value="|">Barra vertical</option></select></label>}
        <label>Fila de encabezado<input type="number" min="1" max="100000" value={header} placeholder={String(layout?.detectedHeaderRow || "Automático")} disabled={disabled || busy} onChange={(e) => setHeader(e.target.value)} /></label>
        <label>Última fila de datos (opcional)<input type="number" min="1" max="100000" value={end} placeholder="Hasta el final" disabled={disabled || busy} onChange={(e) => setEnd(e.target.value)} /></label>
      </div>
      {error && <p role="alert" className="finance-note">{error}</p>}
      {!layout && !error && <p role="status">Leyendo estructura del original…</p>}
      {layout && !layout.supported && <p>{layout.message}</p>}
      {layout?.supported && <><p>Hoja: {layout.sheet || "texto"} · Encabezado detectado: {layout.detectedHeaderRow || "ninguno"} · Última fila: {layout.lastRow}. Esta vista incluye carátula y totales para que puedas dejarlos fuera de la tabla.</p>
        <div className="finance-review-table-wrap"><table><thead><tr><th>Fila / registro</th><th>Contenido original (máximo 80 columnas)</th></tr></thead><tbody>{layout.rows.map((r) => <tr key={r.number}><td>{r.number}</td><td><div style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", maxWidth: 850 }}>{r.cells.map((cell, i) => `${i + 1}: ${cell || "—"}`).join("  |  ")}{r.truncatedColumns && " … Más columnas no mostradas"}</div></td></tr>)}</tbody></table></div>
        <div className="finance-review-toolbar"><button type="button" disabled={disabled || busy || (layout.page || 1) <= 1} onClick={() => setPage((layout.page || 1) - 1)}>Anterior</button><span>Página {layout.page} de {layout.pages}</span><button type="button" disabled={disabled || busy || (layout.page || 1) >= (layout.pages || 1)} onClick={() => setPage((layout.page || 1) + 1)}>Siguiente</button><button type="button" className="primary-btn" disabled={disabled || busy} onClick={() => void apply()}>{busy ? "Volviendo a analizar…" : "Aplicar tabla y revisar"}</button></div>
      </>}
    </>}
  </section>;
}
