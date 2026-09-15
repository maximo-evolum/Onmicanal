"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { saveFinanceCase, type IndustryRecord } from "@/lib/api";
import styles from "./finance-case-editor.module.css";

export function FinanceCaseEditor({ record, canReopen, onClose, onSaved }: { record: IndustryRecord; canReopen: boolean; onClose: () => void; onSaved: () => Promise<void> }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const exception = record.recordType === "finance_exception";
  const [status, setStatus] = useState(record.status || (exception ? "OPEN" : "PENDING"));
  const [reason, setReason] = useState(""); const [due, setDue] = useState(String(record.data?.promiseDueDate || "")); const [amount, setAmount] = useState(String(record.data?.promiseAmount || ""));
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const submitting = useRef(false);
  useEffect(() => { dialog.current?.showModal(); }, []);
  const labels: Record<string, string> = { OPEN: "Abierta", IN_REVIEW: "En revisión", RESOLVED: "Resuelta", CLOSED: "Cerrada", MONITORING: "Monitoreo", PENDING: "Pendiente", CONTACTED: "Contactado", PROMISE: "Promesa de pago", PAID: "Pagada (requiere saldo cero)", ESCALATED: "Escalada" };
  const terminal = exception ? ["RESOLVED", "CLOSED"].includes(record.status) : ["PAID", "CLOSED"].includes(record.status);
  const statuses = exception ? ["OPEN", "IN_REVIEW", "RESOLVED", "CLOSED"] : ["MONITORING", "PENDING", "CONTACTED", "PROMISE", "PAID", "ESCALATED", "CLOSED"];
  const availableStatuses = statuses.filter((s) => {
    if (s === record.status) return true;
    if (terminal) return exception ? (record.status === "RESOLVED" && s === "CLOSED") || (canReopen && s === "OPEN") : canReopen && ["PENDING", "MONITORING"].includes(s);
    return !exception || s !== "CLOSED";
  });
  async function submit(event: FormEvent) {
    event.preventDefault(); if (submitting.current) return; submitting.current = true; setBusy(true); setError("");
    try {
      await saveFinanceCase(record, exception ? { status, resolution: reason } : { status, note: reason, channel: "manual", ...(status === "PROMISE" ? { promiseDueDate: due, promiseAmount: Number(amount) } : {}) });
      await onSaved(); onClose();
    } catch (e) { setError(e instanceof Error ? e.message : "No se pudo guardar."); } finally { submitting.current = false; setBusy(false); }
  }
  return <dialog ref={dialog} className={styles.dialog} onCancel={(e) => { e.preventDefault(); if (!busy) onClose(); }} aria-labelledby="finance-case-title">
    <form onSubmit={submit}><header><h2 id="finance-case-title">{exception ? "Revisar excepción" : "Gestionar cobranza"}</h2><button type="button" aria-label="Cerrar" disabled={busy} onClick={onClose}>×</button></header>
      <p>{record.title}</p><p className={styles.note}>Esta acción conserva la trazabilidad. No envía mensajes ni modifica el pago de una factura.</p>
      <fieldset disabled={busy}><label>Estado<select value={status} onChange={(e) => setStatus(e.target.value)}>{availableStatuses.map((s) => <option key={s} value={s}>{labels[s]}</option>)}</select></label>
        {status === "PROMISE" && !exception ? <><label>Fecha de compromiso<input type="date" required value={due} onChange={(e) => setDue(e.target.value)} /></label><label>Monto comprometido (CLP)<input type="number" min="1" step="1" required value={amount} onChange={(e) => setAmount(e.target.value)} /></label></> : null}
        <label>{exception ? "Explicación / resolución" : "Motivo del cambio"}<textarea required minLength={10} maxLength={2000} rows={4} value={reason} onChange={(e) => setReason(e.target.value)} /></label>
      </fieldset>{error ? <p role="alert">{error}</p> : null}<footer><button type="button" disabled={busy} onClick={onClose}>Cancelar</button><button className="primary-btn" disabled={busy || reason.trim().length < 10}>{busy ? "Guardando…" : "Guardar cambio"}</button></footer>
    </form>
  </dialog>;
}
