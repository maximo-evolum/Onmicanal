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
    query.set("area", priority.area);
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
  maxPriorities = 3
}: {
  model?: BrokerOperationalReadModel | null;
  showPriorities?: boolean;
  maxPriorities?: number;
}) {
  if (!model) return null;
  const generatedAt = new Date(model.generatedAt);
  const generatedLabel = Number.isNaN(generatedAt.getTime()) ? "sin hora disponible" : generatedAt.toLocaleString("es-CL");
  const priorities = model.priorities.slice(0, maxPriorities);

  return <section className="broker-operational-summary" aria-label="Lectura operativa unificada de Broker OS">
    <header>
      <div>
        <span>Lectura operativa única</span>
        <h2>Indicadores coherentes de la cartera</h2>
        <p>Los montos, etapas y prioridades provienen de la misma lectura protegida del backend.</p>
      </div>
      <small>Actualizado: {generatedLabel}</small>
    </header>
    <div className="broker-reporting broker-operational-summary-kpis">
      <article><span>Valor de cartera</span><b>{formatter.format(model.reporting.portfolioValue)}</b><small>Inventario dentro de tu alcance</small></article>
      <article><span>Comisión proyectada</span><b>{formatter.format(model.reporting.projectedCommission)}</b><small>Estimación, no pago ejecutado</small></article>
      <article><span>Salud del pipeline</span><b>{model.pipeline.active}/{model.pipeline.total}</b><small>{model.pipeline.terminal} operación(es) en etapa terminal</small></article>
      <article><span>Fichas preparadas</span><b>{model.reporting.propertyCompleteness}%</b><small>{model.reporting.propertiesReady} listas para operar</small></article>
    </div>
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
