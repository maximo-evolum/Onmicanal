"use client";

import { useEffect, useRef, useState } from "react";
import { exportFinanceProcessReport, getFinanceProcessReport, type FinanceProcessReport, type FinanceWorkspaceContext } from "@/lib/api";
import styles from "./finance-process-reports.module.css";

export function FinanceProcessReports({ context, kind, revision }: { context: FinanceWorkspaceContext; kind: "reconciliation" | "exceptions"; revision: boolean }) {
  const [report, setReport] = useState<FinanceProcessReport | null>(null);
  const [status, setStatus] = useState(""); const [search, setSearch] = useState(""); const [term, setTerm] = useState("");
  const [refresh, setRefresh] = useState(0); const [loading, setLoading] = useState(false); const [format, setFormat] = useState(""); const [error, setError] = useState("");
  const lock = useRef(false), generation = useRef(0);
  const query = { period: context.period || "", accountKey: context.accountKey || "", currency: context.currency || "CLP", kind, status, search: term };
  const key = JSON.stringify(query);
  useEffect(() => {
    let active = true; generation.current++; setReport(null); setError("");
    if (revision) return () => { active = false; };
    setLoading(true);
    getFinanceProcessReport(JSON.parse(key)).then((value) => { if (active) setReport(value); }).catch((e) => { if (active) setError(e.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [key, refresh, revision]);
  async function download(next: "pdf" | "xlsx") {
    if (lock.current || !report) return;
    lock.current = true; setFormat(next); setError(""); const started = generation.current;
    try {
      const blob = await exportFinanceProcessReport({ ...query, fingerprint: report.fingerprint }, next);
      if (started !== generation.current) return;
      const url = URL.createObjectURL(blob), a = document.createElement("a");
      a.href = url; a.download = `${kind === "reconciliation" ? "conciliacion" : "excepciones"}-${query.period}.${next}`;
      document.body.appendChild(a); a.click(); a.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 30000);
    } catch (e) { if (started === generation.current) setError(e instanceof Error ? e.message : "No se pudo descargar el reporte."); }
    finally { lock.current = false; setFormat(""); }
  }
  const statuses = kind === "reconciliation" ? { VERIFIED: "Conciliado con evidencia", PENDING: "Pendiente", INCONSISTENT: "Evidencia inconsistente", EXCLUDED: "Excluido" } : { OPEN: "Abierta", IN_REVIEW: "En revisión", RESOLVED: "Resuelta", CLOSED: "Cerrada", OTHER: "Estado sin clasificar" };
  const busy = loading || Boolean(format) || revision;
  return <section className={`finance-card ${styles.report}`} aria-busy={busy}>
    <h2>Reportes de {kind === "reconciliation" ? "conciliación" : "excepciones"}</h2>
    <p>Descarga el detalle y su respaldo en PDF o Excel para la empresa, cuenta, moneda y período seleccionados arriba.</p>
    <form className={styles.controls} onSubmit={(e) => { e.preventDefault(); setTerm(search.trim()); setRefresh((n) => n + 1); }}>
      <label>Estado<select disabled={busy} value={status} onChange={(e) => setStatus(e.target.value)}><option value="">Todos los estados</option>{Object.entries(statuses).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
      <label>Buscar registro<input disabled={busy} value={search} maxLength={120} onChange={(e) => setSearch(e.target.value)} placeholder="Descripción, referencia, archivo o ID" /></label>
      <button disabled={busy} type="submit">Actualizar vista previa</button>
    </form>
    {error && <p role="alert" className={styles.error}>{error}</p>}
    {busy && <div role="status"><progress aria-label={format ? "Generando archivo completo" : "Consultando reporte"} /><span>{format ? `Preparando ${format.toUpperCase()} completo…` : "Consultando datos del período…"}</span></div>}
    {report && <>
      <div className={styles.metrics}><strong>{report.summary.total} registros</strong>{Object.values(report.summary.counts).map((s) => <span key={s.label}>{s.label}: <b>{s.count}</b></span>)}</div>
      <p>Instantánea: {new Date(report.generatedAt).toLocaleString("es-CL")} · {report.company.name}</p>
      <div className={styles.actions}><button disabled={busy} onClick={() => void download("pdf")} type="button">Descargar PDF</button><button disabled={busy} onClick={() => void download("xlsx")} type="button">Descargar Excel</button></div>
      <details><summary>Ver detalle de muestra y alcance del reporte</summary>
        <p>Vista previa de hasta {report.previewLimit} filas. La descarga incluye los {report.summary.total} registros y {report.totalIssues} observaciones del contexto.</p>
        <div className={styles.table}><table><thead><tr><th>Fecha</th><th>Descripción</th><th>Estado</th><th>Monto original</th></tr></thead><tbody>{report.rows.map((r) => <tr key={r.id}><td>{r.date || "Sin fecha"}</td><td>{r.description}<small>{r.sourceFile}</small></td><td>{r.statusLabel}</td><td>{r.amount === null ? "Sin validar" : `${r.amount.toLocaleString("es-CL", { maximumFractionDigits: 4 })} ${r.currency}`}</td></tr>)}</tbody></table></div>
        <ul>{report.notices.map((n, i) => <li key={i}>{n}</li>)}</ul>
        {report.issues.length > 0 && <><h3>Observaciones de evidencia</h3><ul>{report.issues.map((i) => <li key={i.id}>{i.title}</li>)}</ul></>}
      </details>
    </>}
  </section>;
}
