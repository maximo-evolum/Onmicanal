/** Archivo: Implementa el componente de interfaz finance import monitor para la aplicación web. */
import type { FinanceBankImportJob } from "@/lib/api";
import styles from "./finance-usability.module.css";

export type ImportMonitorState = { offline: boolean; checking: boolean; error: string; checkedAt: string | null };

export function FinanceImportMonitor({ jobs, state, onRefresh }: {
  jobs: FinanceBankImportJob[]; state: ImportMonitorState; onRefresh: () => void;
}) {
  const count = (statuses: string[]) => jobs.filter(job => statuses.includes(job.status)).length;
  const message = state.offline
    ? "Sin conexión. Los estados pueden estar desactualizados. Los originales ya recibidos siguen guardados; no vuelvas a subirlos."
    : state.error
      ? "No pudimos actualizar las cargas. Conservamos la última información recibida y volveremos a consultar automáticamente."
      : state.checking ? "Consultando el estado de las cargas…" : "Seguimiento automático activo mientras esta pantalla está visible.";
  const timestamp = state.checkedAt ? Date.parse(state.checkedAt) : NaN;
  return <section className={styles.monitor} aria-label="Seguimiento de cartolas">
    <div className={styles.monitorCounts}>
      {[["En proceso", count(["RECEIVED", "PROCESSING"])], ["Para revisar", count(["READY"])], ["Con errores", count(["FAILED"])], ["Incorporadas", count(["IMPORTED"])]].map(([label, total]) =>
        <div key={label}><strong>{total}</strong><span>{label}</span></div>)}
    </div>
    <p className={state.offline || state.error ? styles.monitorWarning : undefined} role="status">{message}</p>
    <small>Resumen de las cargas consultadas, no del historial completo. Última consulta correcta: {Number.isFinite(timestamp) ? new Date(timestamp).toLocaleString("es-CL", { timeZone: "America/Santiago" }) : "Todavía no confirmada"}.</small>
    <button type="button" className="secondary-btn" disabled={state.offline || state.checking} onClick={onRefresh}>Actualizar cargas</button>
  </section>;
}
