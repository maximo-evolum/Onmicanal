/** Vista previa, filtros y descargas del reporte de negocios autorizado para la jefatura. */
"use client";
import {useState,type FormEvent} from "react";
import Link from "next/link";
import {exportBrokerExecutiveReport,getBrokerExecutiveReport,type BrokerExecutiveReport,type BrokerReportFilters} from "@/lib/api";
import styles from "./broker-executive-report.module.css";

const empty:BrokerReportFilters={from:"",to:"",office:"",broker:"",state:"",type:""};
const types:Record<string,string>={SALE:"Venta",RENTAL:"Arriendo",ADMINISTRATION:"Administración",UNKNOWN:"Sin clasificar"};
const states:Record<string,string>={OPEN:"En curso",CLOSED:"Finalizada",LOST:"Perdida o cancelada",REVIEW:"Por revisar"};
const number=new Intl.NumberFormat("es-CL",{maximumFractionDigits:6});
export default function BrokerExecutiveReportPanel(){
  const [filters,setFilters]=useState(empty),[report,setReport]=useState<BrokerExecutiveReport|null>(null),[page,setPage]=useState(0);
  const [busy,setBusy]=useState(""),[notice,setNotice]=useState(""),[outdated,setOutdated]=useState(false);
  const dirty=report&&Object.keys(empty).some(k=>filters[k as keyof BrokerReportFilters]!==report.filters[k as keyof BrokerReportFilters]);
  function field(k:keyof BrokerReportFilters){return {value:filters[k],onChange:(e:{target:{value:string}})=>setFilters({...filters,[k]:e.target.value})};}
  async function submit(e:FormEvent){e.preventDefault();setBusy("preview");setNotice("");setOutdated(true);
    try{const next=await getBrokerExecutiveReport(filters);setReport(next);setFilters(next.filters);setPage(0);setOutdated(false);}
    catch(err){setNotice(err instanceof Error?err.message:"No se pudo consultar la cartera.");}finally{setBusy("");}}
  async function download(format:"pdf"|"csv"){
    if(!report||dirty||outdated||busy)return;setBusy(format);setNotice("");
    try{const blob=await exportBrokerExecutiveReport(report,format),url=URL.createObjectURL(blob),a=document.createElement("a");
      a.href=url;a.download="broker-reporte-ejecutivo-"+report.filters.from+"-"+report.filters.to+"."+format;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);}
    catch(err){setNotice(err instanceof Error?err.message:"No se pudo descargar.");setOutdated(true);}finally{setBusy("");}
  }
  return <section className={"broker-executive-card "+styles.panel} aria-label="Reporte ejecutivo de negocios">
    <header><div><span>Reportes de Broker OS</span><h3>Reporte ejecutivo de negocios</h3></div></header>
    <p>Consulta las operaciones creadas en el período y descarga la misma selección. Si dejas las fechas vacías se consultan los últimos 90 días.</p>
    <form onSubmit={submit}><fieldset disabled={!!busy} className={styles.filters}><legend>Filtros del reporte</legend>
      <label>Desde<input type="date" {...field("from")}/></label><label>Hasta<input type="date" min={filters.from||undefined} {...field("to")}/></label>
      <label>Corredor<select aria-label="Corredor" {...field("broker")}><option value="">Todos los corredores</option><option value="__none__">Sin corredor</option>{report?.options.brokers.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
      <label>Oficina<select aria-label="Oficina" {...field("office")}><option value="">Todas las oficinas</option><option value="__none__">Sin oficina</option>{report?.options.offices.map(o=><option key={o}>{o}</option>)}</select></label>
      <label>Tipo de operación<select aria-label="Tipo de operación" {...field("type")}><option value="">Todos los tipos</option>{Object.entries(types).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label>
      <label>Estado<select aria-label="Estado" {...field("state")}><option value="">Todos los estados</option>{Object.entries(states).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label>
      <button className="primary-btn">{busy==="preview"?"Consultando…":"Consultar reporte"}</button></fieldset></form>
    {!report && <small>Consulta el período para ver los corredores y oficinas de la cartera autorizada.</small>}
    <div role="status">{notice||(dirty?"Filtros modificados. Consulta de nuevo para actualizar las cifras y descargar.":"")}</div>
    {report&&!dirty&&!outdated&&<><p><b>{report.scope}</b> · {report.filters.from} al {report.filters.to}</p>
      <p>{report.notice}</p><div className={styles.figures}>{[["Negocios",report.summary.total],...Object.entries(report.summary.counts).map(([k,n])=>[states[k],n]),["Con datos incompletos",report.summary.incomplete]].map(([k,n])=><div key={k}><small>{k}</small><strong>{n}</strong></div>)}</div>
      <p>Monto declarado en curso: <b>{report.summary.openAmounts.map(a=>a.basis+": "+a.currency+" "+number.format(a.amount)).join(" · ")||"Sin montos con moneda informada"}</b></p>
      <div className={styles.actions}>{report.canExport?(["pdf","csv"] as const).map(f=><button key={f} type="button" className="secondary-btn" disabled={!!busy} onClick={()=>download(f)}>{busy===f?"Preparando…":"Descargar "+f.toUpperCase()}</button>):<small>Tu perfil permite consultar, pero no descargar este reporte.</small>}</div>
      <h4>Operaciones que sustentan el informe</h4>{!report.rows.length?<p>No hay negocios para estos filtros dentro de tu alcance.</p>:<>
      <ol className={styles.rows} start={page*10+1}>{report.rows.slice(page*10,page*10+10).map(r=><li key={r.id}><div><Link href={"/realty?view=broker_os&tab=operations&operationId="+encodeURIComponent(r.id)+"&operationType="+encodeURIComponent(r.type)}>{r.title}</Link><small>{r.company} · {r.opened} · {types[r.type]} · {states[r.state]} · {(r.stage||"Sin etapa").replaceAll("_"," ")}</small></div>
        <div>{r.broker} · {r.office||"Sin oficina"}<small>{r.amount===null?"Sin monto":r.amountSource+": "+number.format(r.amount)+" "+(r.currency||"(sin moneda)")}</small></div>
        <small>ID fuente: {r.id} · Actualizado: {new Date(r.updated).toLocaleString("es-CL",{timeZone:"America/Santiago"})}</small>
        {r.warnings.length>0&&<small><b>Revisar:</b> {r.warnings.join("; ")}</small>}</li>)}</ol>
      {report.rows.length>10&&<div className={styles.actions}><button type="button" disabled={!page} onClick={()=>setPage(page-1)}>Anterior</button><span>Página {page+1} de {Math.ceil(report.rows.length/10)}</span><button type="button" disabled={(page+1)*10>=report.rows.length} onClick={()=>setPage(page+1)}>Siguiente</button></div>}</>}</>}
  </section>;
}
