/** Archivo: Implementa el componente de interfaz broker journey para la aplicación web. */
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getBrokerCatalog, getBrokerOperations, type BrokerOperation, type BrokerJourneyCatalog } from "@/lib/api";
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
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true); setError("");
    Promise.all([getBrokerOperations(), getBrokerCatalog()]).then(([items, c]) => {
      if (!active) return;
      if (!c.journey) throw new Error("El backend todavía no expone el catálogo compartido de etapas.");
      setOperations(items); setCatalog(c.journey);
    }).catch(e => { if (active) setError(e instanceof Error ? e.message : "No se pudo cargar el embudo."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [revision]);
  return <BrokerPipelineView operations={operations} catalog={catalog} loading={loading} error={error} onRefresh={() => setRevision(v => v + 1)} />;
}

export function BrokerPipelineView({ operations, catalog, loading = false, error = "", onRefresh }: { operations: BrokerOperation[]; catalog?: BrokerJourneyCatalog; loading?: boolean; error?: string; onRefresh: () => void }) {
  const card = (operation: BrokerOperation) => <article className={styles.card} key={operation.id}><h3>{operation.title}</h3><p>{operation.journey?.commercial?.label || operation.journey?.outcome || "Por revisar"}</p><small>{operation.data.operationType === "SALE" ? "Venta" : operation.data.operationType === "RENTAL" ? "Arriendo" : "Administración"}</small><Link href={`/realty?view=broker_os&tab=operations&operationId=${encodeURIComponent(operation.id)}`}>Abrir negocio y expediente</Link></article>;
  return <section className={styles.panel} aria-label="Pipeline de operaciones Broker OS">
    <header><div><h2>Pipeline de Broker OS</h2><p>Vista de solo lectura de los negocios. Las etapas se modifican en su expediente, no en la propiedad.</p></div><button type="button" disabled={loading} onClick={onRefresh}>Actualizar</button></header>
    {loading ? <p role="status">Cargando operaciones…</p> : error ? <p role="alert">{error}</p> : <>
      <p>{operations.length} operaciones cargadas{operations.length >= 200 ? " (límite de esta consulta: 200; puede haber más registros)" : ""}. Los prospectos CRM anteriores a una operación se mantienen en el tablero superior.</p>
      <div className={styles.board}>{catalog?.pipeline.map(stage => <section className={styles.column} key={stage.key}><h3>{stage.label} · {operations.filter(o => o.journey?.pipeline?.key === stage.key).length}</h3>{operations.filter(o => o.journey?.pipeline?.key === stage.key).map(card)}</section>)}</div>
      {operations.some(o => !o.journey?.pipeline) ? <section><h3>Fuera del embudo comercial o pendientes de revisión</h3><div className={styles.other}>{operations.filter(o => !o.journey?.pipeline).map(card)}</div></section> : null}
    </>}
  </section>;
}
