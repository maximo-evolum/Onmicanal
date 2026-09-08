"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { getBankReviewPage, getBankMappingTemplates, saveBankMappingTemplate, deleteBankMappingTemplate, reanalyzeFinanceBankImport, downloadBankReview,
  type BankReviewConfig, type BankReviewPage, type BankMappingTemplate, type BankReviewRow, type FinanceBankStatementPreview } from "@/lib/api";

const emptyConfig: BankReviewConfig = { mapping: {}, excludedRows: [] };
export function FinanceBankReview({ preview, disabled, onBusy, onDirty, onUpdated }: {
  preview: FinanceBankStatementPreview; disabled: boolean; onBusy: (busy: boolean) => void; onDirty: (dirty: boolean) => void; onUpdated: (preview: FinanceBankStatementPreview) => void;
}) {
  const [config, setConfig] = useState<BankReviewConfig>(preview.reviewConfig || emptyConfig);
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [data, setData] = useState<BankReviewPage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [templates, setTemplates] = useState<BankMappingTemplate[]>([]);
  const [templateId, setTemplateId] = useState("");
  const [expanded, setExpanded] = useState<number | null>(null);
  const identity = `${preview.jobId}:${preview.revision}`;
  const identityRef = useRef(identity); identityRef.current = identity;
  const dirty = JSON.stringify(config) !== JSON.stringify(preview.reviewConfig || emptyConfig);
  useEffect(() => { setConfig(preview.reviewConfig || emptyConfig); setExpanded(null); onDirty(false); }, [identity]);
  useEffect(() => { let alive = true; getBankMappingTemplates().then((result) => { if (alive) setTemplates(result.templates); }).catch((e) => { if (alive) setError(e.message); }); return () => { alive = false; }; }, [preview.jobId]);
  useEffect(() => {
    let alive = true; setLoading(true); setData(null);
    const timer = setTimeout(() => {
      getBankReviewPage(preview.jobId, { revision: preview.revision, page, filter, search }).then((result) => {
        if (!alive) return;
        if (page > result.pages) { setPage(result.pages); return; }
        setData(result);
      }).catch((e) => { if (alive) setError(e.message); }).finally(() => { if (alive) setLoading(false); });
    }, 200);
    return () => { alive = false; clearTimeout(timer); };
  }, [identity, page, filter, search]);

  function editMapping(field: string, value: string) {
    const mapping = { ...config.mapping }; if (value) mapping[field] = value; else delete mapping[field];
    const next = { ...config, mapping }; setConfig(next); onDirty(JSON.stringify(next) !== JSON.stringify(preview.reviewConfig || emptyConfig));
  }
  async function apply(next = config) {
    const originalIdentity = identity; onBusy(true); setError("");
    try {
      const updated = await reanalyzeFinanceBankImport(preview.jobId, undefined, { revision: preview.revision, reviewConfig: next });
      if (identityRef.current !== originalIdentity) return;
      onUpdated(updated); onDirty(false);
    } catch (e) { setError(e instanceof Error ? e.message : "No se pudo guardar la revisión."); }
    finally { onBusy(false); }
  }
  function toggleExclusion(row: BankReviewRow) {
    if (row.excluded) return void apply({ ...config, excludedRows: config.excludedRows.filter((entry) => entry.dataRow !== row.dataRow) });
    const reason = window.prompt(`Motivo para excluir el registro ${row.dataRow} (mínimo 5 caracteres). El original se conservará.`);
    if (reason === null) return;
    if (reason.trim().length < 5) return setError("Indica un motivo de al menos cinco caracteres.");
    void apply({ ...config, excludedRows: [...config.excludedRows, { dataRow: row.dataRow, reason: reason.trim() }] });
  }
  function useTemplate() {
    const template = templates.find((item) => item.id === templateId); if (!template) return;
    if (template.bankKey !== preview.account.bankKey) return setError("La plantilla pertenece a otro banco. Confirma primero el banco de esta cartola.");
    const missing = Object.values(template.mapping).filter((column) => column !== "__IGNORE__" && !preview.columns?.includes(column));
    if (missing.length) return setError(`Esta cartola no tiene las columnas de la plantilla: ${missing.join(", ")}.`);
    const next = { ...config, mapping: template.mapping }; setConfig(next); onDirty(true); setError("Plantilla preparada. Pulsa Aplicar y volver a revisar antes de incorporar.");
  }
  async function saveTemplate() {
    const name = window.prompt("Nombre de la plantilla para este banco:"); if (!name?.trim()) return;
    onBusy(true); setError("");
    try { const result = await saveBankMappingTemplate({ jobId: preview.jobId, revision: preview.revision, name: name.trim() }); setTemplates((current) => [...current, result.template]); setTemplateId(result.template.id); }
    catch (e) { setError(e instanceof Error ? e.message : "No se pudo guardar la plantilla."); } finally { onBusy(false); }
  }
  async function removeTemplate() {
    if (!templateId || !window.confirm("¿Eliminar esta plantilla? Las revisiones anteriores se conservarán.")) return;
    onBusy(true);
    try { await deleteBankMappingTemplate(templateId); setTemplates((current) => current.filter((item) => item.id !== templateId)); setTemplateId(""); }
    catch (e) { setError(e instanceof Error ? e.message : "No se pudo eliminar."); } finally { onBusy(false); }
  }
  async function exportReview() {
    onBusy(true); setError("");
    try { const blob = await downloadBankReview(preview.jobId, { revision: preview.revision, filter, search }); const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = `revision-${preview.sourceFile}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
    catch (e) { setError(e instanceof Error ? e.message : "No se pudo exportar."); } finally { onBusy(false); }
  }
  return <section className="finance-bank-review" aria-label="Revisión completa de la cartola">
    <details className="finance-bank-mapping"><summary>Corregir columnas y usar plantillas</summary><p>Indica dónde aparece cada dato. «Automático» mantiene la detección actual; «No usar» descarta esa columna como fuente del dato. Los originales nunca se modifican.</p>
      <div className="finance-bank-mapping-fields">{preview.fields?.map((field) => <label key={field.key}>{field.label}<select disabled={disabled} value={config.mapping[field.key] || ""} onChange={(e) => editMapping(field.key, e.target.value)}><option value="">Automático</option><option value="__IGNORE__">No usar este dato</option>{preview.columns?.map((name) => <option key={name} value={name}>{name}</option>)}</select></label>)}</div>
      <div className="finance-review-toolbar"><button className="primary-btn" type="button" disabled={disabled || !dirty} onClick={() => void apply()}>Aplicar y volver a revisar</button><button type="button" className="finance-link-button" disabled={disabled || dirty || !Object.keys(config.mapping).length} onClick={() => void saveTemplate()}>Guardar como plantilla</button></div>
      <div className="finance-review-toolbar"><label>Plantillas de este banco<select value={templateId} disabled={disabled} onChange={(e) => setTemplateId(e.target.value)}><option value="">Selecciona una plantilla</option>{templates.filter((item) => item.bankKey === preview.account.bankKey).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><button type="button" className="finance-link-button" disabled={disabled || !templateId} onClick={useTemplate}>Usar plantilla</button><button type="button" className="finance-danger-button" disabled={disabled || !templateId} onClick={() => void removeTemplate()}>Eliminar plantilla</button></div>
    </details>
    {dirty ? <p className="finance-note">Hay cambios sin aplicar. Aplica el mapeo antes de incorporar o excluir registros.</p> : null}
    {error ? <p className="finance-note" role="alert">{error}</p> : null}
    <div className="finance-review-toolbar"><label>Buscar movimientos<input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="Descripción, referencia, RUT o fecha" /></label><label>Mostrar<select value={filter} onChange={(e) => { setFilter(e.target.value); setPage(1); }}><option value="all">Todos</option><option value="review">Por revisar</option><option value="excluded">Excluidos</option><option value="duplicate">Duplicados</option><option value="credit">Abonos</option><option value="debit">Cargos</option></select></label><button className="finance-link-button" type="button" disabled={disabled || loading || dirty} onClick={() => void exportReview()}>Exportar todos los resultados (CSV)</button></div>
    <p>Revisión {preview.revision} · {preview.totalSourceRows ?? preview.summary.totalRows} registros leídos · {preview.excludedRows || 0} excluidos con motivo. Abonos y cargos del resumen corresponden sólo a los registros incluidos.</p>
    <div className="finance-review-table-wrap"><table><thead><tr><th>N°</th><th>Fecha</th><th>Descripción / referencia</th><th>Monto</th><th>Tipo</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>{data?.rows.map((row) => <Fragment key={row.dataRow}><tr><td>{row.dataRow}</td><td>{row.transactionDate || "Sin fecha"}</td><td>{row.description}<small>{row.reference} {row.rut}</small></td><td>{new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 }).format(row.amount)}</td><td>{row.movementType}</td><td>{row.excluded ? "Excluido" : row.needsReview ? "Revisar" : row.duplicate ? "Duplicado" : "Válido"}</td><td><div className="finance-review-row-actions"><button type="button" className="finance-link-button" onClick={() => setExpanded(expanded === row.dataRow ? null : row.dataRow)} aria-expanded={expanded === row.dataRow}>Ver origen</button><button type="button" className="finance-link-button" disabled={disabled || dirty} onClick={() => toggleExclusion(row)}>{row.excluded ? "Volver a incluir" : "Excluir con motivo"}</button></div></td></tr>{expanded === row.dataRow ? <tr><td colSpan={7}><div className="finance-review-source"><strong>{row.origin?.kind === "sheet" ? `Hoja: ${row.origin.sheet} · Fila ${row.origin.row}` : row.origin?.kind === "csv-record" ? `Registro ${row.origin.row} del CSV (no necesariamente línea de texto)` : "Origen extraído: consulta el archivo original para localizar la fila"}</strong>{row.exclusionReason ? <p>Exclusión: {row.exclusionReason}</p> : null}{row.reviewReasons.length ? <p>Revisar: {row.reviewReasons.join(", ")}</p> : null}<dl>{Object.entries(row.source || {}).filter(([key]) => key !== "__financeOrigin").map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{String(value ?? "")}</dd></div>)}</dl></div></td></tr> : null}</Fragment>)}</tbody></table></div>
    {loading ? <p role="status">Cargando registros…</p> : !data?.rows.length ? <p>No hay registros que coincidan con el filtro.</p> : null}
    <div className="finance-review-toolbar"><button type="button" disabled={loading || page <= 1} onClick={() => setPage((current) => current - 1)}>Anterior</button><span>Página {data?.page || page} de {data?.pages || 1} · {data?.total ?? 0} resultados</span><button type="button" disabled={loading || !data || page >= data.pages} onClick={() => setPage((current) => current + 1)}>Siguiente</button></div>
  </section>;
}
