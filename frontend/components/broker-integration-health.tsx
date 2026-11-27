/** Muestra la evidencia de conexiones guardadas sin iniciar pruebas con terceros. */
"use client";
import {useEffect,useState} from "react";
import {getBrokerIntegrationHealth,type BrokerIntegrationHealth} from "@/lib/api";
import {getStoredSession} from "@/lib/auth";
import styles from "./broker-integration-health.module.css";

const formatter=new Intl.DateTimeFormat("es-CL",{dateStyle:"short",timeStyle:"short",timeZone:"America/Santiago"});
const date=(v:string|null)=>v?formatter.format(new Date(v)):"Sin registro";
const commercial:Record<string,string>={PENDING_PROVIDER:"Pendiente del proveedor",CONTACTED:"Contactado",CONTRACTED:"Contrato registrado",TECHNICAL_REVIEW:"En revisión técnica",READY_FOR_TEST:"Preparado para pruebas",ACTIVE:"Activo en registro comercial",PAUSED:"En pausa",UNAVAILABLE:"No disponible",INTERNAL:"Interno"};

export default function BrokerIntegrationHealthPanel(){
  const [snapshot,setSnapshot]=useState<BrokerIntegrationHealth|null>(null),[error,setError]=useState(false);
  const [revision,setRevision]=useState(0),[loading,setLoading]=useState(true);
  useEffect(()=>{
    let active=true;
    const identity=()=>{const s=getStoredSession();return [s?.id,s?.tenantId].join(":");},key=identity();
    const changed=()=>{if(key!==identity()){active=false;setSnapshot(null);setRevision(n=>n+1);}};
    window.addEventListener("storage",changed);
    window.addEventListener("evolum-session-updated",changed);
    setLoading(true);setError(false);
    getBrokerIntegrationHealth().then(s=>{
      if(!active||identity()!==key)return;
      const tenantId=getStoredSession()?.tenantId;
      if(tenantId&&s.tenantId!==tenantId)throw new Error("Cuenta distinta");
      setSnapshot(s);
    }).catch(()=>{if(active){setSnapshot(null);setError(true);}})
      .finally(()=>{if(active)setLoading(false);});
    return ()=>{active=false;window.removeEventListener("storage",changed);window.removeEventListener("evolum-session-updated",changed);};
  },[revision]);
  const registered=snapshot?.items.filter(i=>i.registered)||[],absent=snapshot?.items.filter(i=>!i.registered)||[];
  return <section aria-label="Estado real de integraciones" className={`broker-account-section ${styles.panel}`} aria-busy={loading}>
    <header><div><span>Conexiones de esta empresa</span><h3>Estado real de integraciones</h3>
      <p>Consulta las pruebas guardadas. Actualizar esta vista no contacta al proveedor ni publica contenido.</p></div>
      <button type="button" disabled={loading} onClick={()=>setRevision(n=>n+1)}>Actualizar estado</button></header>
    <p role="status">{loading?"Consultando registros…":error?"No se pudo consultar el estado. Puedes volver a intentarlo.":snapshot?`${registered.length} conexiones registradas · Consulta: ${date(snapshot.asOf)} (hora de Chile)`:""}</p>
    {snapshot&&<><p>Una verificación de más de {snapshot.freshnessHours} horas se muestra como antigua. Sin una prueba remota, guardar credenciales no demuestra que funcionen.</p>
      {!registered.length&&<p>Esta empresa aún no tiene conexiones Broker registradas.</p>}
      <div className={styles.grid}>{registered.map(i=><article key={i.key}><small>{i.group}</small><h4>{i.label}</h4><strong>{i.stateLabel}</strong>
        <dl>{[["Última comprobación",date(i.lastCheckedAt)],["Último éxito remoto",date(i.lastSuccessAt)],["Último error",i.lastErrorAt?date(i.lastErrorAt)+" · "+i.lastError:"Sin registro"],["Vencimiento de la credencial",i.expiresAt?date(i.expiresAt):"No informado"]].map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
      </article>)}</div>
      {absent.length>0&&<details><summary>Conectores sin registro ({absent.length})</summary><p>{absent.map(i=>i.label).join(" · ")}</p></details>}
      <details><summary>Estado de los portales de publicación</summary><p>El acuerdo comercial y la verificación técnica se evalúan por separado. La publicación externa no está habilitada desde esta consulta.</p>
        <ul>{snapshot.portals.map(p=><li key={p.key}><b>{p.label}</b> · {commercial[p.providerStatus]||"Sin información comercial"} · {p.technicalConnectionKey?snapshot.items.find(i=>i.key===p.technicalConnectionKey)?.stateLabel:"Sin conector técnico autorizado"}</li>)}</ul></details></>}
  </section>;
}
