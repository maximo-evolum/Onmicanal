"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { registerFinanceInvoiceReceipt, registerFinancePayablePayment } from "@/lib/api";
import styles from "./finance-manual-payment.module.css";

export type ManualPaymentTarget = { id: string; title: string; kind: "RECEIPT" | "PAYMENT"; balance: number };
export function FinanceManualPayment({ target, onClose, onSaved, onBusy }: {
  target: ManualPaymentTarget; onClose: () => void; onSaved: () => void; onBusy: (busy: boolean) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const alive = useRef(true);
  const inFlight = useRef(false);
  const requestKey = useRef("");
  const [value, setValue] = useState(String(target.balance));
  const [date, setDate] = useState(() => { const now = new Date(); return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`; });
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");
  const incoming = target.kind === "RECEIPT";
  useEffect(() => { alive.current = true; dialog.current?.showModal(); return () => { alive.current = false; }; }, []);
  async function submit(event: FormEvent) {
    event.preventDefault(); if (inFlight.current) return;
    const amount = Number(value);
    if (!Number.isSafeInteger(amount) || amount <= 0 || amount > target.balance) return setError("Ingresa un monto entero mayor que cero y no superior al saldo mostrado.");
    if (!requestKey.current) requestKey.current = crypto.randomUUID();
    inFlight.current = true; setBusy(true); onBusy(true); setError(""); setSubmitted(true);
    try {
      const input = { amount, paymentDate: date, reference, idempotencyKey: requestKey.current };
      if (incoming) await registerFinanceInvoiceReceipt(target.id, input); else await registerFinancePayablePayment(target.id, input);
      if (alive.current) onSaved();
    } catch (e) { if (alive.current) setError(e instanceof Error ? e.message : "No se pudo confirmar. Reintenta esta misma operación para evitar duplicados."); }
    finally { inFlight.current = false; if (alive.current) setBusy(false); onBusy(false); }
  }
  return <dialog className={styles.dialog} ref={dialog} aria-labelledby="manual-payment-title" onCancel={(event) => { event.preventDefault(); if (!inFlight.current) onClose(); }}>
    <form onSubmit={submit}>
      <header><h2 id="manual-payment-title">Registrar {incoming ? "cobro" : "pago"}</h2><button type="button" aria-label="Cerrar" disabled={busy} onClick={onClose}>×</button></header>
      <p>{target.title}</p>
      <p>Saldo: <strong>{new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP" }).format(target.balance)}</strong></p>
      <label>Monto en pesos chilenos<input autoFocus type="number" min="1" max={target.balance} step="1" required value={value} disabled={submitted} onChange={(event) => setValue(event.target.value)} /></label>
      <label>Fecha efectiva del {incoming ? "cobro" : "pago"}<input type="date" required value={date} disabled={submitted} onChange={(event) => setDate(event.target.value)} /></label>
      <label>Referencia o comprobante (opcional)<input maxLength={240} value={reference} disabled={submitted} onChange={(event) => setReference(event.target.value)} /></label>
      <p className={styles.note}>Se validará que el mes de esta fecha esté abierto, aunque la factura sea de un mes anterior. Este registro es interno: no realiza transferencias bancarias ni modifica el ERP.</p>
      {error ? <p role="alert" className={styles.error}>{error}</p> : null}
      {submitted && !busy ? <p className={styles.note}>El reintento conserva el mismo identificador. Antes de cerrar e iniciar otro registro, verifica si éste ya quedó guardado.</p> : null}
      <footer><button type="button" disabled={busy} onClick={onClose}>Cerrar</button><button className="primary-btn" disabled={busy} type="submit">{busy ? "Registrando…" : submitted ? "Reintentar sin duplicar" : "Confirmar registro"}</button></footer>
    </form>
  </dialog>;
}
