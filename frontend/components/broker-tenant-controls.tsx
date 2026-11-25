/** Editores de políticas operativas, preferencias de avisos y límites de agentes de la empresa. */
"use client";
import styles from "./broker-tenant-controls.module.css";
import { useEffect, useState, type FormEvent } from "react";
import { fetchBrokerControls, saveBrokerControls, saveBrokerAgentControl, getBrokerNoticePreference, setBrokerNoticePreference,
  type BrokerTenantControl, type BrokerOperationControls, type BrokerAiGovernanceSnapshot } from "@/lib/api";

const numeric = [
  ["priceGapPct","Brecha de tasación para advertir (%)",0,100],
  ["draftDays","Antigüedad máxima del borrador (días)",1,365],
  ["incompleteDays","Revisar fichas y documentos sin evidencia tras (días; 0 = inmediato)",0,365],
  ["matchScore","Puntaje mínimo para recomendar una propiedad",0,100],
  ["reminderLimit","Recordatorios internos por actividad antes del límite",1,30]
] as const;
const toggles = [
  ["trackerNotices","Permitir preparar borradores de aviso en el Tracker"],
  ["showInfoNotices","Mostrar avisos informativos de Broker en la campana web"],
  ["blockDuplicateContacts","Bloquear prospectos de marketing con teléfono o correo repetido"],
  ["blockDuplicateCampaigns","Bloquear campañas repetidas por propiedad y nombre"]
] as const;
const labels:Record<string,string> = { EVALUATE:"Registrar evaluaciones", SCAN:"Generar alertas internas", DRAFT:"Preparar borradores", SUGGEST:"Sugerir propiedades",
  projects:"Marketing y proyectos",commercial:"Comercial",operations:"Operaciones",documents:"Documentación",rentals:"Arriendos",maintenance:"Mantenciones",post_sale:"Postventa",financing:"Financiamiento",administration:"Administración",commissions:"Comisiones",ai:"Inteligencia" };
const message = (e:unknown) => e instanceof Error ? e.message : "No se pudo completar la solicitud.";
function reverting(e:FormEvent<HTMLFormElement>) {return ((e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement|null)?.value === "revert";}
export function BrokerPolicyEditor({canEdit}:{canEdit:boolean}) {
  const [row,setRow]=useState<BrokerTenantControl<BrokerOperationControls>|null>(null), [busy,setBusy]=useState(false),[notice,setNotice]=useState("");
  async function reload(){setBusy(true);try{setRow(await fetchBrokerControls());setNotice("");}catch(e){setNotice(message(e));}finally{setBusy(false);}}
  useEffect(()=>{void reload();},[]);
  async function submit(e:FormEvent<HTMLFormElement>){
    e.preventDefault(); if(!row || busy) return;
    const form=new FormData(e.currentTarget),value={...row.value};
    for(const [k] of numeric) value[k]=Number(form.get(k));
    for(const [k] of toggles) value[k]=form.has(k);
    value.onReminderLimit=form.get("limit")==="BLOCK"?"BLOCK":"ESCALATE";
    const revert=reverting(e);
    setBusy(true);try{setRow(await saveBrokerControls({revision:row.revision,reason:String(form.get("reason")),value,revert}));setNotice(revert?"Política anterior restaurada.":"Política operativa guardada.");}catch(err){setNotice(message(err));}finally{setBusy(false);}
  }
  return <section className="broker-training-panel"><header className="broker-list-heading"><span>Política de la empresa</span><h2>Controles de operación</h2><p>Se aplican a las próximas consultas y gestiones. No alteran movimientos históricos ni envían mensajes.</p><button className="secondary-btn" type="button" disabled={busy} onClick={reload}>Actualizar política</button></header>
    <p role="status">{notice || (!row?"Consultando política…":"")}</p>{row && <form key={row.revision} onSubmit={submit} className={styles.policy}><fieldset disabled={!canEdit || busy}><legend>Versión {row.revision} · {row.reason || "Valores iniciales"}</legend>
    {numeric.map(([k,label,min,max])=><label key={k}>{label}<input name={k} type="number" min={min} max={max} step="1" defaultValue={row.value[k]} required/></label>)}
    <label>Al superar el límite de recordatorios<select name="limit" defaultValue={row.value.onReminderLimit}><option value="ESCALATE">Derivar a revisión interna</option><option value="BLOCK">Bloquear otro intento</option></select></label>
    {toggles.map(([k,label])=><label key={k}><input name={k} type="checkbox" defaultChecked={row.value[k]}/> {label}</label>)}
    {canEdit && <><label>Motivo del cambio<input name="reason" required minLength={5} maxLength={500}/></label><button className="primary-btn">Guardar política</button> {row.previous && <button className="secondary-btn" type="submit" value="revert">Restaurar versión anterior</button>}</>}</fieldset></form>}</section>;
}

export function BrokerAgentEditor({agent,canManage,onChange}:{agent:BrokerAiGovernanceSnapshot["agents"][number];canManage:boolean;onChange:()=>Promise<void>}) {
  const [busy,setBusy]=useState(false),[notice,setNotice]=useState("");
  const row=agent.control;
  if(!row || !agent.supportedActions?.length) return null;
  async function save(e:FormEvent<HTMLFormElement>){e.preventDefault();if(!row || busy)return;
    const f=new FormData(e.currentTarget),revert=reverting(e);setBusy(true);
    try{await saveBrokerAgentControl(agent.key,{revision:row.revision,reason:String(f.get("reason")),revert,value:{enabled:f.has("enabled"),approverOnly:f.has("approverOnly"),actions:f.getAll("actions").map(String),areas:f.getAll("areas").map(String)}});await onChange();}
    catch(err){setNotice(message(err));}finally{setBusy(false);}
  }
  return <><b>{row.value.enabled?"Habilitado en la empresa":"Pausado en la empresa"}</b><small>Tu perfil: {(agent.permittedActions||[]).map(a=>labels[a]).join(", ") || "sin acciones habilitadas"}</small>
    {canManage && <details className={styles.agent}><summary>Administrar agente</summary><form key={row.revision} onSubmit={save}><fieldset disabled={busy}><legend>Versión {row.revision}</legend>
    <label><input type="checkbox" name="enabled" defaultChecked={row.value.enabled}/> Agente habilitado</label>
    <label><input type="checkbox" name="approverOnly" defaultChecked={row.value.approverOnly}/> Solo perfiles con permiso de aprobación IA</label><small>Si se exige este permiso, las sugerencias sin una persona autorizada también quedan bloqueadas.</small>
    <fieldset><legend>Acciones permitidas</legend>{agent.supportedActions.map(a=><label key={a}><input type="checkbox" name="actions" value={a} defaultChecked={row.value.actions.includes(a)}/> {labels[a]}</label>)}</fieldset>
    <fieldset><legend>Áreas de actuación</legend>{agent.supportedAreas?.map(a=><label key={a}><input type="checkbox" name="areas" value={a} defaultChecked={row.value.areas.includes(a)}/> {labels[a]}</label>)}</fieldset>
    <small>{row.reason && "Último cambio: "+row.reason}</small><label>Motivo<input name="reason" minLength={5} maxLength={500} required/></label>
    <button className="primary-btn">Guardar agente</button> {row.previous && <button type="submit" value="revert" className="secondary-btn">Revertir cambio</button>}</fieldset></form></details>}
    {notice && <p role="status">{notice}</p>}</>;
}

export function BrokerNoticePreference() {
  const [row,setRow]=useState<BrokerTenantControl<{showInfoNotices:boolean}>|null>(null),[notice,setNotice]=useState(""),[busy,setBusy]=useState(false);
  useEffect(()=>{getBrokerNoticePreference().then(setRow).catch(e=>setNotice(message(e)));},[]);
  async function toggle(){if(!row||busy)return;setBusy(true);try{setRow(await setBrokerNoticePreference({value:{showInfoNotices:!row.value.showInfoNotices},revision:row.revision,reason:"Preferencia personal de avisos"}));setNotice("");}
    catch(e){setNotice(message(e));getBrokerNoticePreference().then(setRow).catch(()=>{});}finally{setBusy(false);}}
  return <section className="broker-human-note"><b>Mi campana web</b><p>Los avisos importantes se conservan. Los informativos también requieren que la empresa los permita.</p>{row && <button type="button" className="secondary-btn" aria-pressed={row.value.showInfoNotices} disabled={busy} onClick={toggle}>Avisos informativos: {row.value.showInfoNotices?"activados":"desactivados"}</button>}{notice && <p role="status">{notice}</p>}</section>;
}
