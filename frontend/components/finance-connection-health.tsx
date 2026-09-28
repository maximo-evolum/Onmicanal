"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { getFinanceConnectionHealth, type FinanceConnectionHealth as Health } from "@/lib/api";
import styles from "./finance-connection-health.module.css";

function date(value: string | null) { return value ? new Date(value).toLocaleString("es-CL", { dateStyle: "short", timeStyle: "short" }) : "Sin registro"; }
const syncLabels: Record<string, string> = { NOT_RUN: "Sin ejecución confirmada", OK: "Última sincronización completada", ERROR: "Última sincronización fallida", RUNNING: "En curso", STALLED: "Resultado sin confirmar" };

export function FinanceConnectionHealth() {
  const [health, setHealth] = useState<Health | null>(null), [busy, setBusy] = useState(true), [error, setError] = useState("");
  const refresh = useRef<() => void>(() => {});
  useEffect(() => {
    let active = true, inFlight = false;
    async function load() {
      if (inFlight || document.visibilityState === "hidden") return;
      inFlight = true; setBusy(true);
      try { const result = await getFinanceConnectionHealth(); if (active) { setHealth(result); setError(""); } }
      catch (e) { if (active) { setHealth(null); setError(e instanceof Error ? e.message : "No se pudo consultar el estado de las conexiones."); } }
      finally { inFlight = false; if (active) setBusy(false); }
    }
    refresh.current = () => { void load(); };
    const timer = window.setInterval(() => void load(), 60000);
    const onVisible = () => { if (document.visibilityState === "visible") void load(); };
    document.addEventListener("visibilitychange", onVisible); window.addEventListener("focus", onVisible); void load();
    return () => { active = false; window.clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); window.removeEventListener("focus", onVisible); refresh.current = () => {}; };
  }, []);
  return <article className={`finance-card ${styles.panel}`} aria-busy={busy}>
    <div className="finance-card-heading"><div><span className="finance-eyebrow">Conexiones</span><h2>Estado real de las integraciones</h2></div><button className="finance-link-button" type="button" disabled={busy} onClick={() => refresh.current()}>{busy ? "Consultando…" : "Actualizar estado"}</button></div>
    {error && <p role="alert" className={styles.error}>{error} No se muestra el último resultado como si fuera una consulta actual.</p>}
    {!health && busy && <p role="status">Consultando verificaciones y sincronizaciones registradas…</p>}
    {health && <>
      <p className={styles.scope}>{health.scope}</p>
      <p className={styles.scope}>Consultado: {date(health.checkedAt)} · Una verificación pierde vigencia visual después de {health.maxVerificationAgeHours} horas.</p>
      <div className={styles.cards}>{health.items.map((item) => <section className={styles.item} key={item.key}>
        <div className={styles.heading}><h3>{item.label}</h3><span className={`${styles.badge} ${item.status === "VERIFIED" ? styles.good : ["ERROR", "EXPIRED", "SYNC_STALLED"].includes(item.status) ? styles.bad : styles.neutral}`}>{item.statusLabel}</span></div>
        <p>{item.note}</p>
        {!["MANUAL", "COMING_SOON", "NOT_CONFIGURED"].includes(item.status) && <dl><dt>Última prueba registrada</dt><dd>{date(item.lastCheckedAt)}</dd><dt>Última respuesta exitosa</dt><dd>{date(item.lastSuccessAt)}</dd>{item.expiresAt && <><dt>Vencimiento registrado</dt><dd>{date(item.expiresAt)}</dd></>}</dl>}
        {item.key === "finance_nubox" && <div className={styles.sync}><strong>{syncLabels[item.sync.status] || "Estado sin confirmar"}</strong><p>Última sincronización exitosa: {date(item.sync.lastSuccessAt)}</p>{item.sync.period && <p>Período solicitado: {item.sync.period} (no acredita cobertura completa).</p>}{item.sync.startedAt && <p>Inicio: {date(item.sync.startedAt)}</p>}{item.sync.completedAt && <p>Resultado registrado: {date(item.sync.completedAt)}</p>}</div>}
        {item.banking && <p>Consentimientos: {item.banking.total} · Pendientes: {item.banking.pending} · Lotes recibidos: {item.banking.received} · Con incidencias: {item.banking.failed}<br />Última recepción: {date(item.banking.lastReceivedAt)}</p>}
        {item.status === "MANUAL" ? <Link href={item.targetUrl}>Abrir cartolas</Link> : health.canManage && item.status !== "COMING_SOON" ? <Link href={item.targetUrl}>Gestionar o probar conexión</Link> : item.status !== "COMING_SOON" ? <small>La configuración y las pruebas las gestiona un administrador.</small> : null}
      </section>)}</div>
      {!health.items.length && <p>No tienes fuentes de integración habilitadas para consultar en este Dashboard.</p>}
    </>}
  </article>;
}
