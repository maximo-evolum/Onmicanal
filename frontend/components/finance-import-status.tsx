/** Archivo: Implementa el componente de interfaz finance import status para la aplicación web. */
import type { FinanceBankImportJob } from "@/lib/api";
import styles from "./finance-usability.module.css";

const stages: Record<string, { label: string; help: string; tone: string }> = {
  RECEIVED: { label: "En cola", help: "Original guardado. El servidor comenzará el análisis; no necesitas volver a subirlo.", tone: "info" },
  PROCESSING: { label: "Analizando", help: "Puedes salir de esta pantalla. Si el proceso se interrumpe, el servidor intentará recuperarlo tras cinco minutos, con un máximo de tres intentos automáticos.", tone: "info" },
  READY: { label: "Lista para revisar", help: "Abre la revisión y comprueba los datos. Todavía no se han incorporado los movimientos.", tone: "warning" },
  FAILED: { label: "Necesita atención", help: "El original está guardado. Revisa el motivo y reanaliza o cambia la selección del archivo; no se incorpora automáticamente.", tone: "error" },
  IMPORTED: { label: "Incorporada", help: "Los movimientos ya están guardados. Consulta su estado en Conciliación.", tone: "success" },
  CANCELLED: { label: "Cancelada", help: "Esta carga no se incorporará. El original permanece disponible para consulta.", tone: "info" }
};
export function FinanceImportStatus({ job }: { job: Pick<FinanceBankImportJob, "status" | "updatedAt" | "revision" | "attempts" | "error"> }) {
  const stage = stages[job.status] || { label: "Estado por verificar", help: "Actualiza el estado antes de continuar.", tone: "warning" };
  const timestamp = Date.parse(job.updatedAt);
  return <div className={styles.importStatus}>
    <strong className={`${styles.badge} ${styles[stage.tone]}`}>{stage.label}</strong>
    <p>{stage.help}</p>
    <small>Última actualización: {Number.isFinite(timestamp) ? new Date(timestamp).toLocaleString("es-CL", { timeZone: "America/Santiago" }) : "Fecha no disponible"} · Intentos: {job.attempts || 0} · Revisión: {job.revision}</small>
    {job.error && <p className={styles.importError}><strong>Detalle:</strong> {job.error}</p>}
  </div>;
}
