"use client";
import { useRef, useState } from "react";
import { exportFinanceOverview, type FinanceOverview } from "@/lib/api";
export function FinanceOverviewEvidence({ overview }: { overview: FinanceOverview }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState(""); const lock = useRef(false);
  async function download() {
    if (lock.current) return; lock.current = true; setBusy(true); setError("");
    try { const blob = await exportFinanceOverview(overview.context); const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = "indicadores-financieros.csv"; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
    catch (e) { setError(e instanceof Error ? e.message : "No se pudo exportar."); }
    finally { lock.current = false; setBusy(false); }
  }
  return <section className="finance-card" aria-label="Alcance y evidencia de indicadores"><p>{overview.scopeNote}</p><p>Conciliación: {overview.reconciliation.matchedMovements} confirmados de {overview.reconciliation.totalMovements} movimientos activos con fecha. {overview.reconciliation.excludedMovements} excluidos fuera del cálculo. {overview.reconciliation.inconsistentMovements} con vínculos inconsistentes requieren revisión.</p><p>El archivo se calcula al descargarlo con este mismo contexto; puede cambiar si hubo operaciones nuevas. No sustituye un cierre contable.</p><button type="button" disabled={busy || !overview.context} onClick={() => void download()}>{busy ? "Preparando informe…" : "Descargar indicadores y calendario CSV"}</button>{error && <p role="alert">{error}</p>}</section>;
}
