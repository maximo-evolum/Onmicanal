/** Archivo: Presenta AI Ops de Broker como una lectura explicable y sin acciones automáticas. */
"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getBrokerAiOps, type BrokerAiOpsSnapshot } from "@/lib/api";

function displayImpact(value: string) {
  return String(value || "control operativo").replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function BrokerAiOpsPanel() {
  const [data, setData] = useState<BrokerAiOpsSnapshot | null>(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    setBusy(true); setNotice("");
    try { setData(await getBrokerAiOps()); }
    catch (error) { setNotice(error instanceof Error ? error.message : "No se pudo cargar AI Ops de Broker OS."); }
    finally { setBusy(false); }
  }

  useEffect(() => { load(); }, []);

  if (!data) return <section className="broker-ai-ops" aria-label="AI Ops de Broker OS"><p className="broker-empty">{notice || "Preparando prioridades explicables…"}</p></section>;

  return <section className="broker-ai-ops" aria-label="AI Ops de Broker OS">
    <header className="broker-ai-ops-header">
      <div><span>AI Ops</span><h2>Prioridades explicables, no acciones automáticas</h2><p>{data.notice}</p></div>
      <div className="broker-ai-ops-scope"><small>{data.scope.description}</small><button type="button" className="secondary-btn" onClick={load} disabled={busy}>{busy ? "Actualizando…" : "Actualizar"}</button></div>
    </header>
    {notice ? <p className="broker-os-notice" role="status">{notice}</p> : null}
    <section className="broker-ai-ops-kpis" aria-label="Resumen de AI Ops">
      <article><span>Prioridades visibles</span><b>{data.summary.totalPriorities}</b><small>Dentro de tu alcance</small></article>
      <article><span>Prioridad alta</span><b>{data.summary.highPriorities}</b><small>Requieren revisión humana</small></article>
      <article><span>Operaciones analizadas</span><b>{data.summary.operationsVisible}</b><small>Fuente del mismo modelo operativo</small></article>
      <article><span>Revisiones IA</span><b>{data.summary.pendingHumanReview}</b><small>Sin decisión humana registrada</small></article>
    </section>
    <section className="broker-ai-ops-section broker-ai-ops-alerts">
      <header><div><span>Alertas internas activadas</span><h3>Conectadas al Centro Operacional</h3></div><small>AI Ops las explica y enlaza a su origen; no las crea ni las resuelve.</small></header>
      {data.triggeredAlerts.length ? <div className="broker-ai-ops-alert-list">{data.triggeredAlerts.map((item) => <article key={item.id} className={item.priority.toLowerCase()}>
        <div><b>{item.priority === "HIGH" ? "Prioridad alta" : item.priority === "LOW" ? "Informativa" : "Prioridad media"}</b><h4>{item.title}</h4><p>{item.detail}</p><small>{item.requiresApproval ? "Requiere revisión humana" : "Control interno"}</small></div>
        <Link className="secondary-btn" href={item.href}>Abrir origen</Link>
      </article>)}</div> : <p className="broker-empty">No hay alertas internas activas dentro de tu alcance.</p>}
    </section>
    <section className="broker-ai-ops-section">
      <header><div><span>Prioridades</span><h3>Qué revisar y por qué</h3></div><small>Las tarjetas enlazan al expediente o módulo que conserva el dato de origen.</small></header>
      {data.priorities.length ? <div className="broker-ai-priority-grid">{data.priorities.map((item) => <article key={item.id} className={`broker-ai-priority ${item.priority.toLowerCase()}`}>
        <header><b>{item.priorityLabel}</b><small>{displayImpact(item.impact)}</small></header>
        <h4>{item.title}</h4><p><strong>Acción sugerida:</strong> {item.action}</p><p><strong>Motivo:</strong> {item.reason}</p>
        <dl><div><dt>Responsable</dt><dd>{item.responsible}</dd></div><div><dt>Plazo</dt><dd>{item.dueLabel}</dd></div></dl>
        <footer><small>{item.evidence}</small><Link className="secondary-btn" href={item.href}>{item.requiresApproval ? "Revisar y confirmar" : "Abrir origen"}</Link></footer>
      </article>)}</div> : <p className="broker-empty">No hay prioridades pendientes en los registros que puedes consultar.</p>}
    </section>
    <section className="broker-ai-ops-section">
      <header><div><span>Patrones de aprendizaje</span><h3>Información para el equipo</h3></div><small>Son observaciones; no ejecutan automatizaciones.</small></header>
      <div className="broker-ai-pattern-grid">{data.patterns.map((pattern) => <article key={pattern.key} className={pattern.status === "INSUFFICIENT_DATA" ? "insufficient" : "informational"}>
        <b>{pattern.status === "INSUFFICIENT_DATA" ? "Datos insuficientes" : "Informativo"}</b><h4>{pattern.title}</h4><p>{pattern.detail}</p>
        <small>Muestra: {pattern.evidence.sampleSize} operación(es) · {pattern.evidence.period} · {pattern.evidence.activity} actualización(es).</small>
      </article>)}</div>
    </section>
  </section>;
}
