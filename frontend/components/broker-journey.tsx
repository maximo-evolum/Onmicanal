/** Archivo: Implementa el componente de interfaz broker journey para la aplicación web. */
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getBrokerCatalog, getBrokerOverview, type BrokerOperation, type BrokerJourneyCatalog, type BrokerOperationalReadModel } from "@/lib/api";
import styles from "./broker-journey.module.css";

export function BrokerJourneySummary({ operation, catalog, tracker = false }: { operation: BrokerOperation; catalog?: BrokerJourneyCatalog; tracker?: boolean }) {
  const journey = operation.journey;
  if (!journey) return <p role="status">Contrato de etapas no disponible. Actualiza el backend antes de comparar las vistas.</p>;
  return <section className={styles.summary} aria-label="Estado compartido del negocio">
    <dl><div><dt>Negocio</dt><dd>{journey.commercial?.label || (journey.outcome ? "Finalizado" : "Sin equivalencia comercial")}</dd></div>
      <div><dt>Embudo</dt><dd>{journey.pipeline?.label || "Fuera del embudo activo"}</dd></div>
      <div><dt>Hito procesal</dt><dd>{journey.trackerApplicable ? journey.tracker?.label || "Por revisar" : "No aplica al flujo de venta"}</dd></div></dl>
    {journey.warning ? <p role={journey.needsReview ? "alert" : undefined}>{journey.warning}</p> : null}
    {tracker && journey.trackerApplicable && catalog ? <ol className={styles.tracker}>{catalog.tracker.map(stage => <li key={stage.key} aria-current={stage.key === journey.tracker?.key ? "step" : undefined}>{stage.label}{stage.key === journey.tracker?.key ? " · Posición actual" : ""}</li>)}</ol> : null}
    <small>Operación {operation.id} · Etapa registrada: {journey.sourceStage || "Sin dato"}</small>
    <BrokerConversionSummary operation={operation} />
    {operation.relationStatus === "LEGACY_PENDING" ? <p>Relación histórica pendiente de normalización. Los registros originales se conservan.</p> : null}
  </section>;
}

export function BrokerConversionSummary({ operation }: { operation: BrokerOperation }) {
  const receipt = operation.data.conversion as { convertedAt?: string; convertedBy?: string; prospectId?: string; ownerName?: string; propertyTitle?: string; address?: string; comuna?: string; origin?: string; captureHistory?: Array<{at?: string; action?: string; note?: string; userId?: string}>; terms?: {currency?: string; publicationPrice?: number; commissionPct?: number; exclusivityDays?: number; signedAt?: string; expiresAt?: string; evidenceReference?: string} } | undefined;
  if (!receipt?.terms || !receipt.prospectId) return null;
  const terms = receipt.terms;
  const date = (value?: string) => value && !Number.isNaN(Date.parse(value)) ? new Date(value).toLocaleDateString("es-CL", {timeZone:"UTC"}) : "No informado";
  const names: Record<string,string> = {PROSPECTO_CREADO:"Prospecto creado", ETAPA_ACTUALIZADA:"Avance de captación", NOTA_REGISTRADA:"Nota interna", VALORIZACION_REGISTRADA:"Evaluación registrada", VALORIZACION_GENERADA:"Estimación por comparables", FICHA_ACTUALIZADA:"Ficha actualizada", RESPONSABLE_REASIGNADO:"Responsable reasignado", REFERIDO_CONVERTIDO:"Referido incorporado", PROSPECTO_DESCARTADO:"Descarte", PROSPECTO_REABIERTO:"Reapertura"};
  return <section className={styles.handoff} aria-label="Condiciones de origen del negocio">
    <h4>Mandato y conversión desde Captación</h4>
    <p>{receipt.propertyTitle} · {receipt.address}, {receipt.comuna}</p>
    <dl><div><dt>Propietario</dt><dd>{receipt.ownerName}</dd></div><div><dt>Origen</dt><dd>{receipt.origin}</dd></div><div><dt>Precio pactado de publicación</dt><dd>{new Intl.NumberFormat("es-CL",{maximumFractionDigits:terms.currency === "CLP"?0:2}).format(Number(terms.publicationPrice)||0)} {terms.currency}</dd></div><div><dt>Comisión pactada</dt><dd>{terms.commissionPct}%</dd></div><div><dt>Exclusividad registrada</dt><dd>{terms.exclusivityDays} días</dd></div><div><dt>Firma informada</dt><dd>{date(terms.signedAt)}</dd></div><div><dt>Fin de exclusividad</dt><dd>{date(terms.expiresAt)}</dd></div></dl>
    <p><strong>Evidencia referenciada:</strong> {terms.evidenceReference}</p>
    <p>Conversión registrada: {date(receipt.convertedAt)} · Responsable: {receipt.convertedBy || "Sin identificar"}</p>
    <p>Condiciones conservadas al crear el negocio. El registro no certifica una firma, aprobación jurídica, publicación ni pago de comisión.</p>
    <Link href={`/realty?view=operations&prospectId=${encodeURIComponent(receipt.prospectId)}`}>Ver captación de origen</Link>
    <details><summary>Antecedentes de captación ({receipt.captureHistory?.length || 0})</summary><ol>{(receipt.captureHistory || []).map((event,i)=><li key={i}><strong>{names[event.action || ""] || "Gestión registrada"}</strong> · {date(event.at)}{event.userId ? ` · Responsable: ${event.userId}` : ""}{event.note && <p>{event.note}</p>}</li>)}</ol></details>
  </section>;
}

// Proyección de solo lectura de broker_operation. Aquí no escribe property.data.stage.
export function BrokerCanonicalPipeline() {
  const [operations, setOperations] = useState<BrokerOperation[]>([]);
  const [catalog, setCatalog] = useState<BrokerJourneyCatalog>();
  const [readModel, setReadModel] = useState<BrokerOperationalReadModel>();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true); setError("");
    Promise.all([getBrokerOverview(), getBrokerCatalog()]).then(([overview, c]) => {
      if (!active) return;
      if (!c.journey) throw new Error("El backend todavía no expone el catálogo compartido de etapas.");
      setOperations(overview.operations); setReadModel(overview.readModel); setCatalog(c.journey);
    }).catch(e => { if (active) setError(e instanceof Error ? e.message : "No se pudo cargar el embudo."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [revision]);
  return <BrokerPipelineView operations={operations} catalog={catalog} readModel={readModel} loading={loading} error={error} onRefresh={() => setRevision(v => v + 1)} />;
}

export function BrokerPipelineView({ operations, catalog, readModel, loading = false, error = "", onRefresh }: { operations: BrokerOperation[]; catalog?: BrokerJourneyCatalog; readModel?: BrokerOperationalReadModel; loading?: boolean; error?: string; onRefresh: () => void }) {
  const [healthFilter, setHealthFilter] = useState<"ALL" | "HEALTHY" | "ATTENTION" | "RISK">("ALL");
  const [typeFilter, setTypeFilter] = useState<"ALL" | "SALE" | "RENTAL" | "ADMINISTRATION">("ALL");
  const insightsByOperation = new Map((readModel?.pipeline?.operations || []).map((item) => [item.operationId, item]));
  const pipelineKeyFor = (operation: BrokerOperation) => insightsByOperation.get(operation.id)?.pipelineKey || operation.journey?.pipeline?.key || "";
  const visibleOperations = operations.filter((operation) => {
    const insight = insightsByOperation.get(operation.id);
    if (typeFilter !== "ALL" && operation.data.operationType !== typeFilter) return false;
    if (healthFilter !== "ALL" && insight?.health !== healthFilter) return false;
    return true;
  });
  const healthLabel = (health?: string) => ({ HEALTHY: "En curso", ATTENTION: "Atención", RISK: "En riesgo", TERMINAL: "Terminal" }[health || ""] || "Sin evaluación");
  const card = (operation: BrokerOperation) => {
    const insight = insightsByOperation.get(operation.id);
    return <article className={`${styles.card} ${insight?.health ? styles[`health${insight.health}`] : ""}`} key={operation.id}><h3>{operation.title}</h3><p>{operation.journey?.commercial?.label || operation.journey?.outcome || "Por revisar"}</p><small>{operation.data.operationType === "SALE" ? "Venta" : operation.data.operationType === "RENTAL" ? "Arriendo" : "Administración"}</small>{insight ? <div className={styles.insight}><b>{healthLabel(insight.health)}</b><span>{insight.stageAgeDays} día(s) en etapa · {insight.pipelineLabel}</span>{insight.bottleneck ? <small>{insight.detail}</small> : null}</div> : null}<Link href={`/realty?view=broker_os&tab=operations&operationId=${encodeURIComponent(operation.id)}`}>Abrir negocio y expediente</Link></article>;
  };
  return <section className={styles.panel} aria-label="Pipeline de operaciones Broker OS">
    <header><div><h2>Pipeline de Broker OS</h2><p>Vista de solo lectura de los negocios. Las etapas se modifican en su expediente, no en la propiedad.</p></div><button type="button" disabled={loading} onClick={onRefresh}>Actualizar</button></header>
    {loading ? <p role="status">Cargando operaciones…</p> : error ? <p role="alert">{error}</p> : <>
      <p>{operations.length} operaciones cargadas{operations.length >= 200 ? " (límite de esta consulta: 200; puede haber más registros)" : ""}. Los prospectos CRM anteriores a una operación se mantienen en el tablero superior.</p>
      {readModel ? <p className={styles.readModel}>Lectura operativa compartida: {readModel.pipeline.active} activa(s), {readModel.pipeline.terminal} terminal(es) y {readModel.priorities.length} prioridad(es) en cola. {readModel.scope?.description || "Solo se muestran negocios dentro de tu alcance autorizado."}</p> : null}
      <div className={styles.filters} aria-label="Filtros del pipeline"><label>Salud<select value={healthFilter} onChange={(event) => setHealthFilter(event.target.value as typeof healthFilter)}><option value="ALL">Todas</option><option value="HEALTHY">En curso</option><option value="ATTENTION">Atención</option><option value="RISK">En riesgo</option></select></label><label>Tipo de negocio<select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value as typeof typeFilter)}><option value="ALL">Todos</option><option value="SALE">Ventas</option><option value="RENTAL">Arriendos</option><option value="ADMINISTRATION">Administración</option></select></label><span>{visibleOperations.length} negocio(s) con los filtros actuales</span></div>
      {readModel?.pipeline?.bottlenecks?.length ? <section className={styles.bottlenecks} aria-label="Cuellos de botella detectados"><b>Cuellos de botella</b>{readModel.pipeline.bottlenecks.map((item) => <span key={item.key}>{item.label}: {item.risk ? `${item.risk} en riesgo` : `${item.attention} con atención`} · {item.averageStageAgeDays} día(s) promedio</span>)}</section> : null}
      <div className={styles.board}>{catalog?.pipeline.map(stage => { const stageOperations = visibleOperations.filter((operation) => pipelineKeyFor(operation) === stage.key); const metric = readModel?.pipeline?.columns?.find((item) => item.key === stage.key); return <section className={styles.column} key={stage.key}><h3>{stage.label} · {stageOperations.length}</h3>{metric ? <small className={styles.columnMetric}>{metric.risk ? `${metric.risk} en riesgo` : metric.attention ? `${metric.attention} con atención` : `${metric.averageStageAgeDays} día(s) promedio`}</small> : null}{stageOperations.map(card)}{stageOperations.length === 0 ? <p className={styles.empty}>Sin negocios para este filtro.</p> : null}</section>; })}</div>
      {visibleOperations.some((operation) => !pipelineKeyFor(operation)) ? <section><h3>Fuera del embudo comercial o pendientes de revisión</h3><div className={styles.other}>{visibleOperations.filter((operation) => !pipelineKeyFor(operation)).map(card)}</div></section> : null}
    </>}
  </section>;
}
