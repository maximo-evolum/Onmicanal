"use client";
import { useRef, useState } from "react";
import { exportFinanceOverview, type FinanceOverview } from "@/lib/api";
import { formatFinanceMoney } from "@/lib/finance-money";
export function FinanceOverviewEvidence({ overview }: { overview: FinanceOverview }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState(""); const lock = useRef(false);
  async function download() {
    if (lock.current) return; lock.current = true; setBusy(true); setError("");
    try { const blob = await exportFinanceOverview(overview.context); const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = "indicadores-financieros.csv"; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
    catch (e) { setError(e instanceof Error ? e.message : "No se pudo exportar."); }
    finally { lock.current = false; setBusy(false); }
  }
  return <section className="finance-card" aria-label="Alcance y evidencia de indicadores">
    <p>{overview.scopeNote}</p>
    <p>Diferencias justificadas de estas facturas: <strong>{formatFinanceMoney(overview.invoices.justifiedDifferences || 0, overview.context.currency)}</strong>. Se presentan separadas de lo cobrado y del saldo pendiente.</p>
    {overview.documentQuality ? <p>Documentos de clientes fuera de totales: {overview.documentQuality.inactive} anulados/excluidos, {overview.documentQuality.adjustments} notas independientes y {overview.documentQuality.invalid} con datos inconsistentes. Revisa estos últimos en Facturas; no se consideran saldos verificados.</p> : null}
    <p>Conciliación: {overview.reconciliation.matchedMovements} confirmados de {overview.reconciliation.totalMovements} movimientos activos con fecha. {overview.reconciliation.excludedMovements} excluidos fuera del cálculo. {overview.reconciliation.inconsistentMovements} con vínculos inconsistentes requieren revisión.</p>
    <p>El archivo se calcula al descargarlo con este mismo contexto; puede cambiar si hubo operaciones nuevas. No sustituye un cierre contable.</p>
    <button type="button" disabled={busy || !overview.context} onClick={() => void download()}>{busy ? "Preparando informe…" : "Descargar indicadores y calendario CSV"}</button>{error && <p role="alert">{error}</p>}
  </section>;
}
