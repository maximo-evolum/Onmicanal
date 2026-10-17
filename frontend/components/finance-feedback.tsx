/** Archivo: Implementa el componente de interfaz finance feedback para la aplicación web. */
"use client";
import styles from "./finance-usability.module.css";

export type FinanceFeedbackKind = "info" | "success" | "warning" | "error";
const headings = { info: "Información", success: "Operación completada", warning: "Revisa antes de continuar", error: "No se pudo completar la operación" };
export function FinanceFeedback({ message, kind = "info", onDismiss }: { message: string; kind?: FinanceFeedbackKind; onDismiss?: () => void }) {
  return <section className={`${styles.notice} ${styles[kind]}`} role={kind === "error" ? "alert" : "status"} aria-atomic="true">
    <span className={styles.symbol} aria-hidden="true">{kind === "error" ? "!" : kind === "success" ? "✓" : kind === "warning" ? "!" : "i"}</span>
    <div><strong>{headings[kind]}</strong><p>{message}</p></div>
    {onDismiss && <button type="button" className={styles.dismiss} aria-label="Cerrar mensaje" onClick={onDismiss}>×</button>}
  </section>;
}

export function FinanceLoading({ label = "Actualizando información financiera…" }: { label?: string }) {
  return <div className={styles.loading} role="status"><span className={styles.spinner} aria-hidden="true" />{label}</div>;
}
