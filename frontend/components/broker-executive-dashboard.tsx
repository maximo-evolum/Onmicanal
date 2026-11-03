/** Archivo: Presenta indicadores de jefatura de Broker OS calculados exclusivamente en el backend. */
"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { getBrokerExecutiveDashboard, saveBrokerForecastAssumptions, type BrokerExecutiveDashboardResponse } from "@/lib/api";

const currency = new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 });

function stageLabel(value: string) {
  return String(value || "").replaceAll("_", " ").toLowerCase().replace(/(^|\s)\S/g, (letter) => letter.toUpperCase());
}

export function BrokerExecutiveDashboardPanel({ canConfigure }: { canConfigure: boolean }) {
  const [data, setData] = useState<BrokerExecutiveDashboardResponse | null>(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setBusy(true);
    try { setData(await getBrokerExecutiveDashboard()); }
    catch (error) { setNotice(error instanceof Error ? error.message : "No se pudo cargar el Dashboard Ejecutivo."); }
    finally { setBusy(false); }
  };

  useEffect(() => { load(); }, []);

  async function saveAssumptions(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const probabilities = Object.fromEntries(Object.keys(data?.assumptions.probabilities || {}).map((key) => [key, Number(form.get(key))]));
    setBusy(true); setNotice("");
    try {
      await saveBrokerForecastAssumptions(probabilities);
      await load();
      setNotice("Supuestos de proyección actualizados y auditados para esta empresa.");
    } catch (error) { setNotice(error instanceof Error ? error.message : "No se pudieron guardar los supuestos."); }
    finally { setBusy(false); }
  }

  if (!data) return <section className="broker-executive-dashboard" aria-label="Dashboard Ejecutivo"><p className="broker-empty">{notice || "Cargando indicadores ejecutivos…"}</p></section>;
  const { dashboard, assumptions } = data;

  return <section className="broker-executive-dashboard" aria-label="Dashboard Ejecutivo de Broker OS">
    <header className="broker-executive-header">
      <div><span>Dashboard Ejecutivo</span><h2>Decisiones con datos del negocio real</h2><p>Indicadores calculados desde las operaciones y expedientes dentro del alcance autorizado. No ejecuta publicaciones, cobros, firmas ni comunicaciones.</p></div>
      <div><small>{dashboard.scope.description}</small><button type="button" className="secondary-btn" disabled={busy} onClick={load}>Actualizar</button></div>
    </header>
    {notice ? <p className="broker-os-notice" role="status">{notice}</p> : null}
    <section className="broker-executive-kpis">
      <article><span>Efectividad operativa</span><b>{dashboard.kpis.effectivenessPct}%</b><small>Operaciones activas que ya superaron la calificación inicial</small></article>
      <article><span>Forecast ponderado</span><b>{currency.format(dashboard.kpis.weightedForecast)}</b><small>Valor potencial según etapa y probabilidad</small></article>
      <article><span>Comisión proyectada</span><b>{currency.format(dashboard.kpis.weightedCommission)}</b><small>Estimación ponderada, no liquidación</small></article>
      <article><span>Tiempo de cierre</span><b>{dashboard.kpis.averageCloseTimeDays === null ? "Sin cierres" : `${dashboard.kpis.averageCloseTimeDays} días`}</b><small>{dashboard.kpis.closedOperations} operación(es) terminal(es) en el alcance</small></article>
    </section>

    <section className="broker-executive-grid">
      <article className="broker-executive-card broker-executive-forecast">
        <header><div><span>Forecast explicable</span><h3>Proyección por operación</h3></div><small>{dashboard.forecast.lines.length} negocio(s) activo(s)</small></header>
        <p>{dashboard.forecast.notice}</p>
        {dashboard.forecast.lines.length ? <div className="broker-executive-table"><div className="broker-executive-table-head"><span>Negocio</span><span>Etapa</span><span>Prob.</span><span>Forecast</span></div>{dashboard.forecast.lines.slice(0, 8).map((line) => <Link key={line.operationId} href={`/realty?view=broker_os&tab=operation_tracker&operationId=${encodeURIComponent(line.operationId)}`}><span><b>{line.title}</b><small>{line.responsible}</small></span><span>{stageLabel(line.commercialStage)}</span><span>{line.probabilityPct}%</span><strong>{currency.format(line.weightedAmount)}</strong></Link>)}</div> : <p className="broker-empty">No hay operaciones activas dentro de este alcance.</p>}
      </article>

      <article className="broker-executive-card">
        <header><div><span>Cuellos de botella y riesgos</span><h3>Qué requiere jefatura</h3></div></header>
        <div className="broker-executive-bottlenecks">{dashboard.bottlenecks.length ? dashboard.bottlenecks.map((item) => <div key={item.key}><b>{item.label}</b><span>{item.count} operación(es) · {item.averageStageAgeDays} días promedio</span><small className={item.kind.toLowerCase()}>{item.kind === "RISK" ? `${item.risk} en riesgo` : `${item.attention} en atención`}</small></div>) : <p className="broker-empty">No hay etapas con alertas de antigüedad.</p>}</div>
        {dashboard.risks.length ? <div className="broker-executive-risks">{dashboard.risks.slice(0, 4).map((risk) => <Link key={risk.operationId} href={`/realty?view=broker_os&tab=operation_tracker&operationId=${encodeURIComponent(risk.operationId)}`}><b>{risk.title}</b><span>{risk.stage} · {risk.responsible}</span><small>{risk.detail}</small></Link>)}</div> : null}
      </article>
    </section>

    <section className="broker-executive-grid broker-executive-three">
      <article className="broker-executive-card"><header><div><span>Conversión por comuna</span><h3>Demanda y avance</h3></div></header><div className="broker-executive-rank">{dashboard.conversion.byCommune.length ? dashboard.conversion.byCommune.slice(0, 6).map((item) => <div key={item.label}><b>{item.label}</b><span>{item.advanced}/{item.total} avanzadas</span><strong>{item.conversionPct}%</strong></div>) : <p className="broker-empty">Sin operaciones para segmentar.</p>}</div></article>
      <article className="broker-executive-card"><header><div><span>Ranking operativo</span><h3>Carga por responsable</h3></div></header><div className="broker-executive-rank">{dashboard.teamRanking.length ? dashboard.teamRanking.map((item) => <div key={item.userId}><b>{item.name}</b><span>{item.activeOperations} activas · {item.riskOperations} en riesgo</span><strong>{item.conversionPct}%</strong></div>) : <p className="broker-empty">Sin responsables con operaciones activas.</p>}</div></article>
      <article className="broker-executive-card"><header><div><span>ROI potencial de campañas</span><h3>Marketing proyectado</h3></div></header><div className="broker-executive-rank">{dashboard.campaigns.length ? dashboard.campaigns.slice(0, 6).map((item) => <div key={item.id}><b>{item.name}</b><span>{currency.format(item.investment)} · {item.expectedLeads} lead(s)</span><strong>{item.potentialRoiPct === null ? "Sin base" : item.potentialRoiPct + "%"}</strong></div>) : <p className="broker-empty">No hay campañas con proyección registrada.</p>}</div></article>
    </section>

    <section className="broker-executive-assumptions">
      <header><div><span>Supuestos por empresa</span><h3>Probabilidad por etapa comercial</h3><p>{assumptions.notice}</p></div><small>{assumptions.updatedAt ? `Actualizados: ${new Date(assumptions.updatedAt).toLocaleString("es-CL")}` : "Usando valores iniciales"}</small></header>
      <form onSubmit={saveAssumptions}>{Object.entries(assumptions.probabilities).map(([stage, value]) => <label key={stage}>{stageLabel(stage)}<input name={stage} type="number" min="0" max="100" step="0.01" defaultValue={value} disabled={!canConfigure || busy} /><small>%</small></label>)}<button className="primary-btn" disabled={!canConfigure || busy}>{canConfigure ? "Guardar supuestos" : "Solo lectura"}</button></form>
    </section>
  </section>;
}
