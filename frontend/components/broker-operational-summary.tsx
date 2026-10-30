/** Archivo: Presenta la lectura operativa única compartida por los módulos de Broker OS. */
"use client";

import Link from "next/link";
import type { BrokerOperationalReadModel, BrokerRecommendation } from "@/lib/api";

const formatter = new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 });

function destinationFor(priority: BrokerRecommendation) {
  const query = new URLSearchParams();
  if (priority.operationId) {
    query.set("tab", "operations");
    query.set("operationId", priority.operationId);
  } else if (priority.propertyId) {
    query.set("tab", "operations");
    query.set("propertyId", priority.propertyId);
  } else if (priority.area) {
    if (priority.area === "ai") query.set("tab", "training");
    else if (priority.area === "overview") query.set("tab", "operations");
    else if (priority.area === "operations") query.set("tab", "operations");
    else query.set("area", priority.area);
  }
  return `/realty?view=broker_os${query.size ? `&${query.toString()}` : ""}`;
}

function priorityLabel(priority: BrokerRecommendation) {
  if (priority.priority === "HIGH") return "Prioridad alta";
  if (priority.priority === "MEDIUM") return "Prioridad media";
  return "Informativa";
}

/**
 * Muestra datos calculados exclusivamente por el contrato readModel del
 * backend. No recalcula montos, etapas ni prioridades en la interfaz.
 */
export function BrokerOperationalSummary({
  model,
  showPriorities = true,
  maxPriorities = 3,
  showWelcome = false
}: {
  model?: BrokerOperationalReadModel | null;
  showPriorities?: boolean;
  maxPriorities?: number;
  showWelcome?: boolean;
}) {
  if (!model) return null;
  const generatedAt = new Date(model.generatedAt);
  const generatedLabel = Number.isNaN(generatedAt.getTime()) ? "sin hora disponible" : generatedAt.toLocaleString("es-CL");
  const priorities = model.priorities.slice(0, maxPriorities);

  return <section className="broker-operational-summary" aria-label="Lectura operativa unificada de Broker OS">
    <header>
      <div>
        <span>Lectura operativa única</span>
        <h2>{showWelcome ? "Buen día. Este es el estado de tu cartera." : "Indicadores coherentes de la cartera"}</h2>
        <p>{showWelcome ? "Prioriza el trabajo de hoy con los mismos datos protegidos que usa el Centro Operacional, el Pipeline y cada expediente." : "Los montos, etapas y prioridades provienen de la misma lectura protegida del backend."}</p>
      </div>
      <small>Actualizado: {generatedLabel}</small>
    </header>
    <p className="broker-operational-scope">Alcance: <b>{model.scope?.description || "Solo se muestran registros dentro de tu alcance autorizado."}</b></p>
    <div className="broker-reporting broker-operational-summary-kpis">
      <article><span>Valor de cartera</span><b>{formatter.format(model.reporting.portfolioValue)}</b><small>Inventario dentro de tu alcance</small></article>
      <article><span>Comisión proyectada</span><b>{formatter.format(model.reporting.projectedCommission)}</b><small>Estimación, no pago ejecutado</small></article>
      <article><span>Salud del pipeline</span><b>{model.pipeline.active}/{model.pipeline.total}</b><small>{model.pipeline.terminal} operación(es) en etapa terminal</small></article>
      <article><span>Fichas preparadas</span><b>{model.reporting.propertyCompleteness}%</b><small>{model.reporting.propertiesReady} listas para operar</small></article>
    </div>
    {showWelcome || model.onboarding?.isFirstUse ? <section className="broker-onboarding" aria-label="Checklist de inicio Broker OS"><div><span>Primeros pasos</span><h3>{model.onboarding?.isFirstUse ? "Configura tu primer flujo operativo" : `${model.onboarding?.completed || 0} de ${model.onboarding?.total || 0} controles iniciales completados`}</h3></div><div>{(model.onboarding?.checklist || []).map((item) => <Link key={item.key} href={item.href} className={item.done ? "done" : "pending"}><b>{item.done ? "✓" : "○"}</b><span>{item.label}</span><small>{item.done ? "Listo" : "Pendiente"}</small></Link>)}</div></section> : null}
    <section className="broker-operational-center" aria-label="Centro operacional Broker OS">
      <div><span>Centro operacional</span><h3>Riesgos y controles del día</h3><p>Las cifras no ejecutan acciones: señalan lo que debe revisar una persona autorizada.</p></div>
      <div className="broker-operational-center-grid">
        <Link href="/realty?view=broker_os&tab=operations"><b>{model.operationalCenter?.risks || 0}</b><span>riesgos del pipeline</span></Link>
        <Link href="/realty?view=broker_os&tab=operations"><b>{model.operationalCenter?.deadlines || 0}</b><span>plazos controlados</span></Link>
        <Link href="/realty?view=broker_os&area=documents"><b>{model.operationalCenter?.documentsPending || 0}</b><span>documentos pendientes</span></Link>
        <Link href="/realty?view=broker_os&area=rentals"><b>{model.operationalCenter?.collectionsPending || 0}</b><span>cobros por revisar</span></Link>
        <Link href="/realty?view=broker_os&tab=training"><b>{model.operationalCenter?.aiApprovalsPending || 0}</b><span>revisiones IA pendientes</span></Link>
      </div>
    </section>
    <section className="broker-operational-activity" aria-label="Actividad y distribución de cartera">
      <article><span>Actividad reciente</span><h3>{model.activity?.updatedLast7Days || 0} operaciones actualizadas en 7 días</h3><p>{model.activity?.updatedLast30Days || 0} actualizadas en los últimos 30 días.</p></article>
      <article><span>Distribución del equipo</span><h3>Ranking operativo visible</h3>{model.team?.length ? <ol>{model.team.slice(0, 5).map((member) => <li key={member.userId}><b>{member.name}</b><span>{member.activeOperations} activas · {member.riskOperations} en riesgo</span></li>)}</ol> : <p>Sin operaciones activas con responsable para este alcance.</p>}</article>
    </section>
    {showPriorities ? <div className="broker-operational-summary-priorities">
      <div><span>Cola de atención</span><h3>Prioridades con origen trazable</h3></div>
      {priorities.length ? <div className="broker-recommendation-grid">{priorities.map((priority) => <article key={priority.id} className={`broker-recommendation ${priority.priority.toLowerCase()}`}>
        <b>{priorityLabel(priority)}</b><h3>{priority.title}</h3><p>{priority.detail}</p>
        <small>{priority.impact ? priority.impact.replaceAll("_", " ") : "Control operativo"}{priority.dueAt ? ` · Vence: ${new Date(priority.dueAt).toLocaleDateString("es-CL")}` : ""}</small>
        <Link className="secondary-btn" href={destinationFor(priority)}>{priority.requiresApproval ? "Revisar y confirmar" : "Abrir antecedente"}</Link>
      </article>)}</div> : <p className="broker-empty">No hay prioridades pendientes para este alcance.</p>}
    </div> : null}
  </section>;
}
