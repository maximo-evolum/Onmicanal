"use client";
import { useEffect, useRef, useState } from "react";
import { getFinanceMovementTrace, type FinanceMovementTrace } from "@/lib/api";
import styles from "./finance-movement-trace.module.css";
const labels: Record<string, string> = { FINANCE_MOVEMENT_OWNER_CHANGED: "Responsable del movimiento actualizado", finance_invoice: "Factura", finance_invoice_receipt: "Registro de cobro", finance_exception: "Excepción", finance_reconciliation: "Conciliación", APPROVED: "Aprobada", REVERSED: "Revertida", OPEN: "Abierta", CLOSED: "Cerrada", RESOLVED: "Resuelta", REVIEW: "En revisión", IN_REVIEW: "En revisión", PAID: "Pagada", PARTIAL: "Pago parcial", ISSUED: "Emitida", RECONCILED: "Conciliado", REGISTERED: "Registrado", FINANCE_RECONCILIATION_APPROVED: "Conciliación aprobada", FINANCE_RECONCILIATION_REVERSED: "Conciliación revertida", FINANCE_RECONCILIATION_REJECTED: "Movimiento enviado a revisión", INDUSTRY_RECORD_CREATED: "Registro creado", INDUSTRY_RECORD_UPDATED: "Registro actualizado", FINANCE_EXCEPTION_UPDATED: "Excepción actualizada" };
const date = (value: string) => {
  const parsed = new Date(value?.length === 10 ? value + "T12:00:00Z" : value);
  return Number.isFinite(parsed.getTime()) ? new Intl.DateTimeFormat("es-CL", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Santiago" }).format(parsed) : "Sin fecha válida registrada";
};
export function FinanceMovementTracePanel({ movementId }: { movementId: string }) {
  const [trace, setTrace] = useState<FinanceMovementTrace | null>(null), [error, setError] = useState(""), [busy, setBusy] = useState(false), [selected, setSelected] = useState<string | null>(null);
  const mounted = useRef(false), locked = useRef(false);
  useEffect(() => { let active = true; mounted.current = true; setBusy(true); getFinanceMovementTrace(movementId).then((r) => { if (active) setTrace(r); }).catch((e) => { if (active) setError(e.message); }).finally(() => { if (active) setBusy(false); }); return () => { active = false; mounted.current = false; }; }, [movementId]);
  async function more() {
    if (!trace?.nextCursor || locked.current) return; locked.current = true; setBusy(true); setError("");
    try { const r = await getFinanceMovementTrace(movementId, trace.nextCursor); if (mounted.current) setTrace((old) => old ? { ...r, events: [...old.events, ...r.events.filter((event) => !old.events.some((a) => a.id === event.id))] } : r); }
    catch (e) { if (mounted.current) setError(e instanceof Error ? e.message : "No se pudo cargar el historial."); }
    finally { locked.current = false; if (mounted.current) setBusy(false); }
  }
  const record = trace?.records.find((r) => r.id === selected);
  return <section className={styles.panel} aria-label="Historial y documentos relacionados"><h4>Documentos e historial relacionados</h4>
    {busy && <p role="status">Consultando historial…</p>}{error && <p role="alert">{error}</p>}
    {trace && <>
      {(!trace.access.invoices || !trace.access.reconciliation || !trace.access.exceptions) && <p>Algunas secciones están restringidas por los módulos habilitados de tu cuenta.</p>}
      <p>Solo se muestran vínculos registrados. Los importes similares no crean una relación automática.</p>
      <ul>{trace.records.map((r) => <li key={r.id}><button type="button" aria-pressed={selected === r.id} onClick={() => setSelected(selected === r.id ? null : r.id)}>{labels[r.kind] || "Registro relacionado"}: {r.title} · {labels[r.status] || "Estado registrado"}</button></li>)}</ul>
      {!trace.records.length && <p>No hay registros relacionados disponibles para esta cuenta.</p>}
      {record && <article><h4>{record.title}</h4><p>{labels[record.status] || "Estado registrado"} · {date(record.date)}</p><p>{record.party} {record.reference}</p><p>Monto: {record.amount === null ? "No registrado" : `${record.amount.toLocaleString("es-CL")} ${record.currency}`}{record.balance !== null ? ` · Saldo actual: ${record.balance.toLocaleString("es-CL")} ${record.currency}` : ""}</p>{record.reason && <p>Motivo: {record.reason}</p>}{record.reversedAt && <p>Reversa: {date(record.reversedAt)}</p>}{record.allocations.map((a) => <p key={a.invoiceId}><button type="button" onClick={() => setSelected(a.invoiceId)}>Ver factura vinculada · {a.amount.toLocaleString("es-CL")} {record.currency}</button></p>)}</article>}
      <h4>Actividad registrada</h4><p>Fechas y horas de Chile. Este historial muestra eventos disponibles; no reconstruye acciones antiguas sin auditoría.</p>
      <ol>{trace.events.map((event) => <li key={event.id}><strong>{labels[event.action] || "Actualización registrada"}</strong> · {date(event.date)} · {event.actor}{event.reason && <p>{event.reason}</p>}</li>)}</ol>
      {!trace.events.length && <p>No hay eventos de auditoría disponibles para este movimiento.</p>}
      {trace.nextCursor && <button type="button" disabled={busy} onClick={() => void more()}>Ver eventos anteriores</button>}
    </>}
  </section>;
}
