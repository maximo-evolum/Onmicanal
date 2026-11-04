/** Archivo: Presenta reglas, límites y simulaciones seguras del gobierno IA de Broker OS. */
"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import {
  createBrokerAiGovernanceRule,
  getBrokerAiGovernance,
  simulateBrokerAiGovernance,
  updateBrokerAiGovernanceRule,
  type BrokerAiGovernanceSnapshot,
} from "@/lib/api";

function statusClass(status: string) {
  return String(status || "NOT_ENABLED").toLowerCase().replaceAll("_", "-");
}

function formatDate(value: string | null) {
  if (!value) return "Sin fecha registrada";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Sin fecha registrada" : date.toLocaleString("es-CL");
}

export function BrokerAiGovernancePanel({ canConfigure }: { canConfigure: boolean }) {
  const [data, setData] = useState<BrokerAiGovernanceSnapshot | null>(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [conditionKey, setConditionKey] = useState("");

  async function load() {
    setBusy(true); setNotice("");
    try { setData(await getBrokerAiGovernance()); }
    catch (error) { setNotice(error instanceof Error ? error.message : "No se pudo cargar el gobierno IA de Broker OS."); }
    finally { setBusy(false); }
  }

  useEffect(() => { load(); }, []);

  async function simulate() {
    setBusy(true); setNotice("");
    try {
      const next = await simulateBrokerAiGovernance();
      setData(next);
      setNotice("Simulación completada. No se creó una alerta, no se contactó a nadie y no se modificó ningún registro.");
    } catch (error) { setNotice(error instanceof Error ? error.message : "No se pudo ejecutar el simulador."); }
    finally { setBusy(false); }
  }

  async function createRule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setNotice("");
    try {
      const result = await createBrokerAiGovernanceRule({ title, description, conditionKey, isActive: true });
      setTitle(""); setDescription(""); setConditionKey("");
      await load();
      setNotice(result.notice);
    } catch (error) { setNotice(error instanceof Error ? error.message : "No se pudo crear la regla personalizada."); }
    finally { setBusy(false); }
  }

  async function toggleRule(id: string, active: boolean) {
    setBusy(true); setNotice("");
    try {
      const result = await updateBrokerAiGovernanceRule(id, { isActive: !active });
      await load();
      setNotice(result.notice);
    } catch (error) { setNotice(error instanceof Error ? error.message : "No se pudo actualizar la regla personalizada."); }
    finally { setBusy(false); }
  }

  if (!data) return <section className="broker-ai-governance" aria-label="Gobierno IA de Broker OS"><p className="broker-empty">{notice || "Cargando reglas y límites de IA…"}</p></section>;

  const customRules = data.rules.filter((rule) => rule.kind === "CUSTOM");
  const officialRules = data.rules.filter((rule) => rule.kind === "OFFICIAL");

  return <section className="broker-ai-governance" aria-label="Gobierno IA de Broker OS">
    <header className="broker-ai-governance-header">
      <div><span>Gobierno IA</span><h2>Reglas configurables con límites verificables</h2><p>{data.policy.notice}</p></div>
      <div><small>{data.scope.description}</small><button type="button" className="secondary-btn" onClick={load} disabled={busy}>{busy ? "Actualizando…" : "Actualizar"}</button></div>
    </header>
    {notice ? <p className="broker-os-notice" role="status">{notice}</p> : null}

    <section className="broker-ai-governance-kpis" aria-label="Resumen de gobierno IA">
      <article><span>Reglas oficiales</span><b>{data.summary.officialRules}</b><small>Solo lectura y controladas por producto</small></article>
      <article><span>Reglas personalizadas</span><b>{data.summary.customRules}</b><small>Auditables por empresa</small></article>
      <article><span>Coincidencias</span><b>{data.summary.matchingRules}</b><small>Dentro de tu alcance actual</small></article>
      <article><span>Alertas activadas</span><b>{data.summary.triggeredAlerts}</b><small>Visibles también en operación y gobierno</small></article>
    </section>

    <section className="broker-ai-governance-section broker-ai-simulator">
      <header><div><span>Simulador controlado</span><h3>Evalúa sin enviar ni cambiar datos</h3></div><button type="button" className="primary-btn" onClick={simulate} disabled={busy}>{busy ? "Simulando…" : "Simular reglas sin envío"}</button></header>
      <p>{data.simulation.notice}</p>
      <div className="broker-ai-simulation-list">{data.simulation.executions.map((execution) => <article key={execution.ruleId}>
        <div><b>{execution.title}</b><span>{execution.matched} coincidencia(s)</span></div>
        <p>{execution.notice}</p>
        {execution.evidence.length ? <ul>{execution.evidence.slice(0, 2).map((item) => <li key={item.id || item.title}><strong>{item.title}</strong> · {item.detail}</li>)}</ul> : null}
      </article>)}</div>
    </section>

    <section className="broker-ai-governance-section">
      <header><div><span>Estado técnico</span><h3>Los trece agentes sin promesas falsas</h3></div><small>Todos tienen contacto externo bloqueado y no ejecutan acciones autónomas.</small></header>
      <div className="broker-ai-agent-grid">{data.agents.map((agent) => <article key={agent.key} className={`broker-ai-agent ${statusClass(agent.status)}`}>
        <span>{agent.statusLabel}</span><h4>{agent.name}</h4><p>{agent.description}</p><small><b>Límite:</b> {agent.limitation}</small>
      </article>)}</div>
    </section>

    <section className="broker-ai-governance-section">
      <header><div><span>Biblioteca oficial</span><h3>Reglas que estructuran las prioridades</h3></div><small>Estas reglas no se editan desde una empresa.</small></header>
      <div className="broker-ai-rule-grid">{officialRules.map((rule) => <article key={rule.id} className="broker-ai-rule-card official">
        <span>Oficial · {rule.matched} coincidencia(s)</span><h4>{rule.title}</h4><p><b>Disparador:</b> {rule.trigger}</p><p><b>Acción:</b> {rule.action}</p><small>{rule.approval}</small><footer><span>{rule.externalContactLabel}</span><span>{rule.simulatorLabel}</span></footer>
      </article>)}</div>
    </section>

    <section className="broker-ai-governance-section">
      <header><div><span>Reglas por empresa</span><h3>Condiciones internas y auditables</h3></div><small>Solo Dirección o Gerencia Comercial puede configurar estas reglas.</small></header>
      {canConfigure ? <form className="broker-ai-rule-form" onSubmit={createRule}>
        <label>Nombre de la regla<input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Ej.: Priorizar mandatos con expediente pendiente" minLength={4} maxLength={120} required /></label>
        <label>Condición<select value={conditionKey} onChange={(event) => setConditionKey(event.target.value)} required><option value="">Selecciona una condición</option>{data.conditions.map((condition) => <option key={condition.key} value={condition.key}>{condition.label}</option>)}</select></label>
        <label>Contexto interno (opcional)<input value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Qué debe revisar el equipo" maxLength={500} /></label>
        <div><p>La regla solo podrá preparar alertas internas en simulación. No puede enviar mensajes, publicar, firmar, aprobar, cobrar ni cambiar estados.</p><button className="primary-btn" disabled={busy}>Crear regla segura</button></div>
      </form> : <p className="broker-human-note">Tu perfil puede consultar y simular reglas, pero no crear ni activar configuraciones IA.</p>}
      {customRules.length ? <div className="broker-ai-rule-grid">{customRules.map((rule) => <article key={rule.id} className={`broker-ai-rule-card custom ${rule.active ? "active" : "inactive"}`}>
        <span>Personalizada · {rule.active ? "Activa" : "Inactiva"}</span><h4>{rule.title}</h4>{rule.description ? <p>{rule.description}</p> : null}<p><b>Condición:</b> {rule.conditionLabel}</p><p><b>Resultado permitido:</b> {rule.action}</p><footer><span>{rule.matched} coincidencia(s)</span>{canConfigure ? <button type="button" className="secondary-btn" disabled={busy} onClick={() => toggleRule(rule.id, rule.active)}>{rule.active ? "Desactivar" : "Activar"}</button> : null}</footer>
      </article>)}</div> : <p className="broker-empty">Aún no hay reglas personalizadas. Las reglas oficiales continúan activas y visibles.</p>}
    </section>

    <section className="broker-ai-governance-section broker-ai-triggered-alerts">
      <header><div><span>Trazabilidad compartida</span><h3>Alertas internas ya disparadas</h3></div><small>Las mismas alertas se consultan en Centro Operacional y Gobierno y alertas.</small></header>
      {data.triggeredAlerts.length ? <div>{data.triggeredAlerts.map((alert) => <article key={alert.id}><div><span>{alert.priority === "HIGH" ? "Prioridad alta" : alert.priority === "LOW" ? "Informativa" : "Prioridad media"}</span><h4>{alert.title}</h4><p>{alert.detail}</p><small>{alert.requiresHumanApproval ? "Requiere revisión humana" : "Control interno"} · {formatDate(alert.createdAt)}</small></div><Link className="secondary-btn" href={alert.href}>Abrir origen</Link></article>)}</div> : <p className="broker-empty">No hay alertas internas activas dentro de tu alcance.</p>}
    </section>
  </section>;
}

