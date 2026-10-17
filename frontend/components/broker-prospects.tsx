/** Archivo: Implementa el componente de interfaz broker prospects para la aplicación web. */
"use client";
import { useCallback, useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { actBrokerProspect, createBrokerProspect, getBrokerProspects, getBrokerProspect, getBrokerProspectOwner, previewBrokerConversion, tenantDocumentDownloadUrl, uploadTenantDocuments, type BrokerConversionPreview, type BrokerProspect, type BrokerAccessProfile } from "@/lib/api";
import { canBroker } from "@/lib/broker-access";
import styles from "./broker-prospects.module.css";

const stages = ["PROSPECCION", "CONTACTO", "TASACION", "NEGOCIACION"];
const labels = ["Prospección", "Contacto", "Tasación preliminar", "Negociación de mandato"];
const fields = [
  ["ownerName", "Nombre del propietario"], ["ownerPhone", "Teléfono"], ["ownerEmail", "Correo electrónico"], ["ownerRut", "RUT"],
  ["title", "Nombre del inmueble"], ["address", "Dirección"], ["comuna", "Comuna"], ["region", "Región"],
  ["ownerExpectedPrice", "Expectativa de precio"], ["usableSquareMeters", "Superficie útil (m²)"], ["totalSquareMeters", "Superficie total (m²)"],
  ["bedrooms", "Dormitorios"], ["bathrooms", "Baños"], ["siteVisitAt", "Fecha de visita"], ["referredBy", "Referido por"], ["photoUrl", "URL foto principal"], ["floorPlanUrl", "URL plano"], ["observations", "Antecedentes y observaciones"],
];
const empty: Record<string, string> = { intendedService: "VENTA", currency: "CLP", propertyType: "casa", captureOrigin: "" };
const eventLabels: Record<string,string> = { PROSPECTO_CREADO:"Prospecto creado", FICHA_ACTUALIZADA:"Ficha actualizada", ETAPA_ACTUALIZADA:"Etapa actualizada", NOTA_REGISTRADA:"Nota interna", VALORIZACION_REGISTRADA:"Evaluación registrada", VALORIZACION_GENERADA:"Estimación por comparables", DOCUMENTOS_VINCULADOS:"Documentos de captación vinculados", MANDATO_FIRMADO:"Mandato registrado y conversión realizada", PROSPECTO_DESCARTADO:"Prospecto descartado", PROSPECTO_REABIERTO:"Prospecto reabierto", REFERIDO_CONVERTIDO:"Referido incorporado al embudo" };
const money = (value: unknown, currency: string) => `${new Intl.NumberFormat("es-CL", { maximumFractionDigits: currency === "CLP" ? 0 : 2 }).format(Number(value) || 0)} ${currency}`;
const documentRoles: Array<[string, string]> = [["FOTOGRAFIA", "Fotografía"], ["PLANO", "Plano o medición"], ["TITULO", "Antecedente de título"], ["MANDATO", "Mandato firmado"], ["OTRO", "Otro antecedente"]];
type CaptureDocument = { id: string; role: string; title?: string; originalName?: string; mimeType?: string; linkedAt?: string };

export function BrokerProspects({ access, brokers, onConverted }: { access: BrokerAccessProfile | null; brokers: Array<{id: string; name: string}>; onConverted: () => Promise<unknown> }) {
  const searchParams = useSearchParams();
  const [items, setItems] = useState<BrokerProspect[]>([]), [selected, setSelected] = useState(searchParams.get("prospectId") || "");
  const [linked, setLinked] = useState<BrokerProspect | null>(null);
  const [form, setForm] = useState<Record<string,string>>({ ...empty }), [showForm, setShowForm] = useState(false), [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(""), [page, setPage] = useState(1), [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true), [loadFailed, setLoadFailed] = useState(false);
  const [filter, setFilter] = useState(""), [search, setSearch] = useState(""), [note, setNote] = useState(""), [reason, setReason] = useState("");
  const [amount, setAmount] = useState(""), [rationale, setRationale] = useState(""), [sign, setSign] = useState(false);
  const [terms, setTerms] = useState({ exclusivityDays: "90", commissionPct: "2", publicationPrice: "", signedAt: "", evidenceReference: "", confirmSigned: false });
  const [preview, setPreview] = useState<BrokerConversionPreview | null>(null);
  useEffect(() => { setPreview(null); }, [terms, selected]);
  const [converted, setConverted] = useState<BrokerProspect | null>(null);
  const [owner, setOwner] = useState<Awaited<ReturnType<typeof getBrokerProspectOwner>> | null>(null);
  const [assignee, setAssignee] = useState("");
  const [documentRole, setDocumentRole] = useState("FOTOGRAFIA");
  const lock = useRef(false), requestKey = useRef("");
  const row = items.find(r => r.id === selected) || (linked?.id === selected ? linked : null), d = row?.data;
  const edit = canBroker(access, "commercial", "EDIT"), create = canBroker(access, "commercial", "CREATE");
  const load = useCallback(async () => {
    setLoading(true); setLoadFailed(false);
    try {
      const result = await getBrokerProspects(page); setItems(result.items); setTotal(result.total);
    } catch (error) { setLoadFailed(true); throw error; }
    finally { setLoading(false); }
  }, [page]);
  async function refresh() {
    setPreview(null);
    await load();
    if (selected) {
      const fresh = await getBrokerProspect(selected);
      setLinked(fresh); setItems(current=>current.map(item=>item.id===fresh.id?fresh:item));
    }
  }
  useEffect(() => { if (canBroker(access, "commercial", "VIEW")) load().catch(e => setMessage(e.message)); }, [access, load]);
  useEffect(() => {
    const id = searchParams.get("prospectId"); let active = true;
    if (id && canBroker(access,"commercial","VIEW")) getBrokerProspect(id).then(r=>{if(active){setLinked(r);setSelected(r.id);}}).catch(e=>{if(active)setMessage(e.message);});
    return ()=>{active=false;};
  }, [access, searchParams]);
  async function run(task: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setMessage("");
    try { await task(); } catch (e) { setMessage(e instanceof Error ? e.message : "No se pudo completar la acción."); }
    finally { lock.current = false; setBusy(false); }
  }
  async function action(actionName: string, input: Record<string,unknown> = {}) {
    if (!row || !edit || (actionName === "SIGN" && !canBroker(access,"operations","CREATE"))) return;
    await run(async () => {
      const saved = await actBrokerProspect(row.id, { ...input, action: actionName, version: row.data.version });
      setItems(current => current.map(r => r.id === saved.id ? saved : r)); setLinked(current=>current?.id===saved.id?saved:current); setMessage("Cambios guardados."); setNote(""); setPreview(null);
      if (actionName === "SIGN") { setConverted(saved); setSign(false); await onConverted(); }
    });
  }
  async function attachCaptureDocuments(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files || []);
    event.target.value = "";
    if (!row || !files.length || !edit) return;
    await run(async () => {
      const uploaded = await uploadTenantDocuments({
        files,
        category: "broker-captacion",
        description: `Antecedentes privados de captación: ${row.title}`
      });
      const saved = await actBrokerProspect(row.id, {
        action: "LINK_DOCUMENTS",
        version: row.data.version,
        documents: uploaded.documents.map((document) => ({ id: document.id, role: documentRole }))
      });
      setItems((current) => current.map((item) => item.id === saved.id ? saved : item));
      setLinked((current) => current?.id === saved.id ? saved : current);
      setMessage(`${uploaded.documents.length} archivo(s) privado(s) vinculado(s) a la captación.`);
    });
  }
  async function save(e: FormEvent) {
    e.preventDefault();
    if (editing ? !edit : !create) return;
    if (editing) { await action("SAVE", { fields: form }); return; }
    await run(async () => {
      const saved = await createBrokerProspect({ ...form, requestKey: requestKey.current, isReferral: form.captureOrigin === "Referido" });
      setSelected(saved.id); setItems(current => [saved, ...current.filter(r => r.id !== saved.id)]); setTotal(n => n+1); setShowForm(false); setMessage("Prospecto creado; aún no forma parte del inventario activo.");
    });
  }
  async function reviewConversion(e: FormEvent) {
    e.preventDefault();
    if (!row || !edit || !canBroker(access,"operations","CREATE")) return;
    if (preview && preview.prospectVersion === row.data.version) { await action("SIGN", terms); return; }
    await run(async () => setPreview(await previewBrokerConversion(row.id, { ...terms, version: row.data.version })));
  }
  if (!canBroker(access, "commercial", "VIEW")) return null;
  const active = items.filter(r => !r.data.outcome && (!r.data.isReferral || r.data.referralConvertedAt));
  const visible = items.filter(r => (!filter || r.data.stage === filter || r.data.outcome === filter) && `${r.title} ${r.data.ownerName} ${r.data.ownerRut || ""}`.toLowerCase().includes(search.toLowerCase()));
  return <section className={styles.root} aria-label="Captación de propietarios">
    <header className={styles.header}><div><h2>Captación de propietarios</h2><p>Desde el primer contacto hasta el mandato. La firma registrada crea propiedad, propietario y negocio.</p></div><button type="button" className="primary-btn" disabled={!create || busy} onClick={() => { requestKey.current = crypto.randomUUID(); setForm({ ...empty }); setEditing(false); setShowForm(true); }}>Nuevo prospecto</button></header>
    {message && <p role="status" className={styles.notice}>{message} <button disabled={busy||loading} onClick={() => run(refresh)}>Actualizar fichas</button></p>}
    {loading && <p role="status">Cargando captaciones…</p>}
    {loadFailed && <p role="alert">No se pudo actualizar la cartera. Los datos anteriores pueden estar desactualizados.</p>}
    {converted && <div className={styles.notice} role="status"><strong>Mandato registrado. Negocio y propietario vinculados.</strong> <Link href={`/realty?view=broker_os&tab=operations&operationId=${converted.data.conversion.operationId}`}>Ver en Negocios</Link> · <button disabled={busy} onClick={()=>run(async()=>setOwner(await getBrokerProspectOwner(converted.id)))}>Ver en Propietarios</button><button onClick={() => {setConverted(null);setOwner(null);}}>Cerrar aviso</button></div>}
    {owner && <section className={styles.panel}><h3>Propietario registrado: {owner.name}</h3><dl><dt>RUT</dt><dd>{owner.rut || "No informado"}</dd><dt>Contacto</dt><dd>{owner.phone} {owner.email}</dd><dt>Propiedad vinculada</dt><dd>{owner.propertyTitle}</dd></dl><button onClick={()=>setOwner(null)}>Cerrar ficha</button></section>}
    <div className={styles.metrics}>{[["Prospectos activos",active.length],["Prioridad alta",active.filter(r=>r.priority==="ALTA").length],["Valorizaciones pendientes",active.filter(r=>!r.data.valuation).length],["Mandatos este mes",items.filter(r=>r.data.convertedAt?.slice(0,7)===new Date().toISOString().slice(0,7)).length],["Referidos en proceso",items.filter(r=>r.data.isReferral&&!r.data.outcome).length]].map(([label,value])=><div key={label}><strong>{value}</strong><span>{label}</span></div>)}</div>
    {total > 100 && <small>Indicadores de esta página de 100 registros. Total visible en tu alcance: {total}.</small>}
    <div className={styles.funnel}>{stages.map((s,i)=><button key={s} onClick={()=>setFilter(filter===s?"":s)} aria-pressed={filter===s}><strong>{active.filter(r=>r.data.stage===s).length}</strong> {labels[i]}<progress max={Math.max(active.length,1)} value={active.filter(r=>r.data.stage===s).length}/></button>)}</div>
    {showForm && <form onSubmit={save} className={styles.panel}><h3>{editing ? "Editar prospecto" : "Nuevo prospecto"}</h3><fieldset disabled={busy || (editing ? !edit : !create)} className={styles.grid}>
      {fields.map(([key,label])=><label key={key}>{label}<input value={form[key] || ""} type={key==="siteVisitAt"?"date":key==="ownerEmail"?"email":["ownerExpectedPrice","usableSquareMeters","totalSquareMeters","bedrooms","bathrooms"].includes(key)?"number":"text"} step="any" min="0" required={["ownerName","title"].includes(key)} onChange={e=>setForm({...form,[key]:e.target.value})}/></label>)}
      <label>Origen (obligatorio)<select required value={form.captureOrigin} onChange={e=>setForm({...form,captureOrigin:e.target.value})}><option value="">Selecciona origen</option>{["Referido","Formulario web","WhatsApp","Instagram","Campaña IA","Cliente actual","Portal","Walk-in"].map(v=><option key={v}>{v}</option>)}</select></label>
      <label>Destino<select value={form.intendedService} onChange={e=>setForm({...form,intendedService:e.target.value})}>{[["VENTA","Venta"],["ARRIENDO","Arriendo"],["ADMINISTRACION","Administración directa"]].map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label>
      <label>Tipo de inmueble<select value={form.propertyType} onChange={e=>setForm({...form,propertyType:e.target.value})}>{["casa","departamento","oficina","local","terreno","parcela","bodega"].map(v=><option key={v}>{v}</option>)}</select></label>
      <label>Moneda<select value={form.currency} onChange={e=>setForm({...form,currency:e.target.value})}>{["CLP","UF","USD"].map(v=><option key={v}>{v}</option>)}</select></label>
      {!editing && canBroker(access,"commercial","ASSIGN") && <label>Responsable<select value={form.assignedToId || ""} onChange={e=>setForm({...form,assignedToId:e.target.value})}><option value="">Mi cuenta</option>{brokers.map(b=><option value={b.id} key={b.id}>{b.name}</option>)}</select></label>}
    </fieldset><div className={styles.actions}><button className="primary-btn" disabled={busy || (editing ? !edit : !create)}>{busy?"Guardando…":"Guardar prospecto"}</button><button type="button" onClick={()=>setShowForm(false)}>Cerrar formulario</button></div></form>}
    <div className={styles.layout}><aside className={styles.panel}><label>Buscar propietario, RUT o inmueble<input type="search" value={search} onChange={e=>setSearch(e.target.value)}/></label><label>Estado<select value={filter} onChange={e=>setFilter(e.target.value)}><option value="">Todos</option>{stages.map((s,i)=><option key={s} value={s}>{labels[i]}</option>)}<option value="DISCARDED">Descartados</option><option value="CONVERTED">Convertidos</option></select></label>
      {visible.map(r=><button className={styles.item} key={r.id} aria-pressed={selected===r.id} onClick={()=>{setSelected(r.id);setShowForm(false);setSign(false);setNote("");setAmount(String(r.data.valuation?.amount||""));setRationale(r.data.valuation?.rationale||"");}}><strong>{r.data.ownerName}</strong><span>{r.title}</span><small>{labels[stages.indexOf(r.data.stage)]} · {r.daysInStage} días · {r.priority === "ALTA" ? "Prioridad alta" : "Seguimiento normal"}{r.data.outcome ? " · Cerrado" : ""}</small><small>Responsable: {brokers.find(b=>b.id===r.assignedToId)?.name || "Cuenta asignada"}</small></button>)}
      {!loading && !loadFailed && !visible.length && <p>No hay prospectos en esta vista.</p>}<div className={styles.actions}><button disabled={page===1||busy} onClick={()=>setPage(p=>p-1)}>Anterior</button><span>Página {page}</span><button disabled={page*100>=total||busy} onClick={()=>setPage(p=>p+1)}>Siguiente</button></div></aside>
      <article className={styles.panel}>{row && d ? <><h3>{d.ownerName} · {row.title}</h3><p>{d.ownerPhone} {d.ownerEmail} · Origen: {d.captureOrigin} · {d.intendedService === "VENTA" ? "Venta" : d.intendedService === "ARRIENDO" ? "Arriendo" : "Administración"}</p><p>{d.address} · {d.comuna}</p><p>Expectativa: {money(d.ownerExpectedPrice,d.currency)} · {row.daysInStage} días en etapa</p><p className={styles.notice}>Próxima acción: {row.nextAction}</p>
        <ol className={styles.steps}>{labels.map((l,i)=><li key={l} aria-current={stages[i]===d.stage?"step":undefined}>{l}</li>)}</ol>
        {!d.outcome && canBroker(access,"commercial","REASSIGN") && <div className={styles.actions}><label>Reasignar responsable<select value={assignee} onChange={e=>setAssignee(e.target.value)}><option value="">Seleccionar corredor</option>{brokers.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select></label><button disabled={busy||!assignee} onClick={()=>action("ASSIGN",{assignedToId:assignee})}>Guardar responsable</button></div>}
        {d.outcome === "CONVERTED" && <div className={styles.actions}><Link href={`/realty?view=broker_os&tab=operations&operationId=${d.conversion.operationId}`}>Abrir negocio</Link><button disabled={busy} onClick={()=>run(async()=>setOwner(await getBrokerProspectOwner(row.id)))}>Ver propietario vinculado</button></div>}
        {!d.outcome && <div className={styles.actions}><button disabled={!edit||busy} onClick={()=>{setForm({...empty,...Object.fromEntries(Object.entries(d).filter(([,v])=>typeof v!=="object").map(([k,v])=>[k,String(v??"")]))});setEditing(true);setShowForm(true);}}>Editar ficha</button>{stages.indexOf(d.stage)<3 && <button disabled={!edit||busy} onClick={()=>action("ADVANCE",{stage:stages[stages.indexOf(d.stage)+1]})}>Avanzar a {labels[stages.indexOf(d.stage)+1]}</button>}{d.ownerPhone && <a target="_blank" rel="noreferrer" href={`https://wa.me/${String(d.ownerPhone).replace(/\D/g,"")}`}>Abrir WhatsApp</a>}</div>}
        <section className={styles.subpanel} aria-label="Documentos privados de captación"><h4>Documentos privados de captación</h4><p>Se almacenan por empresa y quedan asociados a esta ficha. No se publican junto al inmueble.</p>
          {!d.outcome && <div className={styles.documentControls}><label>Tipo de antecedente<select value={documentRole} disabled={!edit || busy} onChange={(event)=>setDocumentRole(event.target.value)}>{documentRoles.map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label><label className={styles.uploadButton}>Adjuntar archivo<input hidden type="file" multiple accept=".pdf,.csv,.xls,.xlsx,.doc,.docx,.txt,.png,.jpg,.jpeg,.webp" disabled={!edit || busy} onChange={attachCaptureDocuments}/></label></div>}
          {Array.isArray(d.captureDocuments) && d.captureDocuments.length > 0 ? <ul className={styles.documentList}>{(d.captureDocuments as CaptureDocument[]).map((document)=><li key={document.id}><span><strong>{documentRoles.find(([value])=>value===document.role)?.[1] || "Antecedente"}</strong><small>{document.originalName || document.title || "Documento"}</small></span><a href={tenantDocumentDownloadUrl(document.id)}>Descargar</a></li>)}</ul> : <p className={styles.muted}>Aún no hay documentos adjuntos a esta captación.</p>}
        </section>
        {(stages.indexOf(d.stage)>=2 || d.valuation) && <section className={styles.subpanel}><h4>Tasación preliminar</h4>{d.valuation && <><strong>{money(d.valuation.amount,d.currency)}</strong><p>{d.valuation.rationale}</p><small>{d.valuation.method === "MEDIANA_COMPARABLES" ? "Estimación estadística de cartera; no es una tasación certificada ni una inferencia de IA." : "Evaluación profesional registrada."}</small></>}{row.priceGapWarning && <p role="alert">Brecha de {row.priceGapPct?.toFixed(1)}% con la expectativa. Alinea el precio antes de negociar.</p>}
        {!d.outcome && <><label>Valor preliminar<input type="number" min="0" step="any" value={amount} onChange={e=>setAmount(e.target.value)}/></label><label>Fundamento y fuentes<textarea value={rationale} onChange={e=>setRationale(e.target.value)}/></label><div className={styles.actions}><button disabled={!edit||busy} onClick={()=>action("VALUE",{amount,rationale})}>Guardar evaluación</button><button disabled={!edit||busy} onClick={()=>action("ESTIMATE")}>Estimar con comparables de mi cartera</button>{d.valuation && d.ownerPhone && <a target="_blank" rel="noreferrer" href={`https://wa.me/${String(d.ownerPhone).replace(/\D/g,"")}?text=${encodeURIComponent(`Hola ${d.ownerName}. La valorización preliminar de ${row.title} es ${money(d.valuation.amount,d.currency)}. ${d.valuation.rationale}. Estimación sujeta a revisión profesional.`)}`}>Preparar envío por WhatsApp</a>}</div><small>WhatsApp abre un borrador; el envío lo confirma el corredor.</small></>}
        </section>}
        {d.isReferral && !d.referralConvertedAt && !d.outcome && <p>Referido por: {d.referredBy || "Sin identificar"} <button disabled={!edit||busy} onClick={()=>action("CONVERT_REFERRAL")}>Incorporar referido al embudo</button></p>}
        {!d.outcome && <><label>Nota interna<textarea value={note} onChange={e=>setNote(e.target.value)} maxLength={5000}/></label><button disabled={!edit||busy||!note.trim()} onClick={()=>action("NOTE",{note})}>Registrar nota</button></>}
        {d.stage === "NEGOCIACION" && !d.outcome && <button className="primary-btn" disabled={!edit||busy||!canBroker(access,"operations","CREATE")} onClick={()=>{setTerms({...terms,publicationPrice:String(d.valuation?.amount||""),confirmSigned:false});setSign(true);}}>Registrar mandato firmado</button>}
        {sign && <form className={styles.subpanel} onSubmit={reviewConversion}><h4>Condiciones del mandato</h4><p>Registra evidencia de un documento ya firmado. No se emite ni certifica una firma electrónica.</p><fieldset disabled={busy} className={styles.grid}><label>Exclusividad (días)<select value={terms.exclusivityDays} onChange={e=>setTerms({...terms,exclusivityDays:e.target.value})}>{[60,90,120,180].map(v=><option key={v}>{v}</option>)}</select></label><label>Comisión (%)<input required type="number" step="0.1" min="0.1" max="100" value={terms.commissionPct} onChange={e=>setTerms({...terms,commissionPct:e.target.value})}/></label><label>Precio de publicación ({d.currency})<input required type="number" min="0.01" step="any" value={terms.publicationPrice} onChange={e=>setTerms({...terms,publicationPrice:e.target.value})}/></label><label>Fecha de firma<input type="date" required value={terms.signedAt} onChange={e=>setTerms({...terms,signedAt:e.target.value})}/></label><label>Referencia del documento firmado<input required value={terms.evidenceReference} onChange={e=>setTerms({...terms,evidenceReference:e.target.value})}/></label></fieldset><label><input type="checkbox" required checked={terms.confirmSigned} onChange={e=>setTerms({...terms,confirmSigned:e.target.checked})}/> Confirmo que cuento con la evidencia de firma.</label>{preview && <section aria-label="Revisión de conversión" className={styles.notice}><h4>Revisa antes de crear el negocio</h4><p>{preview.property.title} · {preview.property.address}, {preview.property.comuna}</p><p>Propietario: {preview.owner.name} · RUT: {preview.owner.rut || "No informado"}</p><p>Destino: {preview.intendedService === "VENTA" ? "Venta" : preview.intendedService === "ARRIENDO" ? "Arriendo" : "Administración"} · {money(preview.terms.publicationPrice,preview.terms.currency)} · Comisión {preview.terms.commissionPct}% · Exclusividad {preview.terms.exclusivityDays} días</p><ul>{preview.creates.map(item=><li key={item}>{item}</li>)}</ul>{preview.warnings.map(w=><p key={w} role="status">{w}</p>)}<p>No se publicará el inmueble, no se enviarán mensajes ni se cobrará la comisión.</p></section>}<button disabled={busy||!edit} className="primary-btn">{busy ? "Procesando…" : preview ? "Confirmar y crear negocio" : "Revisar conversión"}</button><button type="button" onClick={()=>setSign(false)}>Cancelar</button></form>}
        {!d.outcome && <details><summary>Descartar prospecto</summary><label>Motivo<input value={reason} onChange={e=>setReason(e.target.value)}/></label><button disabled={!edit||busy||!reason.trim()} onClick={()=>action("DISCARD",{reason})}>Confirmar descarte</button></details>}
        {d.outcome === "DISCARDED" && <button disabled={!edit||busy} onClick={()=>action("REOPEN")}>Reabrir prospecto</button>}
        <h4>Historial de gestión</h4><ol className={styles.history}>{[...(d.timeline || [])].reverse().map((event,index)=><li key={index}><strong>{eventLabels[event.action] || event.action}</strong><small>{new Date(event.at).toLocaleString("es-CL")} · {brokers.find(b=>b.id===event.userId)?.name || "Usuario registrado"}</small><p>{event.note || event.reason || event.valuation?.rationale}</p>{event.commissionPct && <p>Comisión {event.commissionPct}% · Exclusividad {event.exclusivityDays} días · {money(event.publicationPrice,d.currency)}</p>}</li>)}</ol>
      </> : <p>Selecciona un prospecto para consultar su ficha y continuar la gestión.</p>}</article></div>
  </section>;
}
