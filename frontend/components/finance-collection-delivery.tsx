"use client";

import { useEffect, useRef, useState } from "react";
import { getFinanceCollectionDeliveries, previewFinanceCollectionDelivery, sendFinanceCollectionDelivery, type FinanceCollectionDelivery, type IndustryRecord } from "@/lib/api";
import styles from "./finance-collection-delivery.module.css";

const labels: Record<string, string> = { DRAFT: "Pendiente de aprobación", SENDING: "En proceso · no reenviar", ACCEPTED: "Aceptado por el proveedor", REJECTED: "Rechazado por el proveedor", UNKNOWN: "Por verificar · no reenviar" };
const when = (s: string | null) => s ? new Date(s).toLocaleString("es-CL") : "—";

export function FinanceCollectionDeliveryPanel({ cases, canPrepare, canSend, onChanged }: { cases: IndustryRecord[]; canPrepare: boolean; canSend: boolean; onChanged: () => Promise<void> }) {
  const [caseId, setCaseId] = useState("");
  const [channel, setChannel] = useState("gmail");
  const [recipient, setRecipient] = useState("");
  const [consent, setConsent] = useState(false);
  const [consentNote, setConsentNote] = useState("");
  const [templateName, setTemplateName] = useState("");
  const [language, setLanguage] = useState("es");
  const [preview, setPreview] = useState<FinanceCollectionDelivery | null>(null);
  const [approved, setApproved] = useState(false);
  const [history, setHistory] = useState<FinanceCollectionDelivery[]>([]);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const lock = useRef(false);
  const activeCase = useRef(caseId);
  activeCase.current = caseId;

  async function refresh(id = caseId) {
    if (!id) return;
    const result = await getFinanceCollectionDeliveries(id);
    if (activeCase.current === id) setHistory(result.deliveries);
  }
  useEffect(() => {
    setPreview(null); setApproved(false); setHistory([]); setRecipient(""); setConsent(false); setConsentNote(""); setNotice("");
    if (!caseId) return;
    let live = true;
    const read = () => getFinanceCollectionDeliveries(caseId).then((r) => { if (live) setHistory(r.deliveries); }).catch(() => { if (live) setNotice("No se pudo consultar el historial. Actualiza antes de enviar."); });
    void read();
    const timer = setInterval(() => { if (!document.hidden && navigator.onLine) void read(); }, 15000);
    return () => { live = false; clearInterval(timer); };
  }, [caseId]);
  function invalidate() { setPreview(null); setApproved(false); }
  async function act(send: boolean) {
    if (lock.current) return;
    if (!navigator.onLine) { setNotice("El envío requiere conexión. No quedará en cola ni se enviará al reconectar."); return; }
    lock.current = true; setBusy(send ? "Enviando y registrando resultado…" : "Verificando canal y saldo…"); setNotice("");
    try {
      if (send && preview && approved) {
        const result = await sendFinanceCollectionDelivery(preview);
        setPreview(null); setApproved(false); setNotice(result.detail);
        await onChanged();
      } else if (!send) {
        const result = await previewFinanceCollectionDelivery({ caseId, channel, recipient, consentConfirmed: consent, consentNote, templateName, language });
        setPreview(result); setApproved(false);
      }
      await refresh();
    } catch (e) {
      setNotice(`${e instanceof Error ? e.message : "No se pudo completar la operación."}${send ? " Consulta el historial y el proveedor antes de preparar otro envío." : ""}`);
      if (send) { setPreview(null); setApproved(false); await refresh().catch(() => {}); }
    } finally { lock.current = false; setBusy(""); }
  }
  return <section className={`finance-card ${styles.panel}`} aria-busy={Boolean(busy)}>
    <header><span className="finance-eyebrow">Comunicación con el cliente</span><h2>Envío efectivo de cobranza</h2><p>Revisa el saldo y aprueba cada mensaje. Un envío no registra un pago ni confirma entrega o lectura.</p></header>
    <label>Caso de cobranza<select value={caseId} disabled={Boolean(busy)} onChange={(e) => setCaseId(e.target.value)}><option value="">Selecciona un caso</option>{cases.filter((r) => r.recordType === "finance_collection_case").map((r) => <option key={r.id} value={r.id}>{r.title}</option>)}</select></label>
    {!cases.length ? <p>Primero genera los casos de cobranza o revisa el filtro de período.</p> : null}
    {caseId && canPrepare ? <fieldset disabled={Boolean(busy)} className={styles.form}>
      <label>Canal<select value={channel} onChange={(e) => { setChannel(e.target.value); invalidate(); }}><option value="gmail">Correo · Gmail conectado</option><option value="whatsapp">WhatsApp · plantilla aprobada</option></select></label>
      <label>Destinatario del cliente<input value={recipient} type={channel === "gmail" ? "email" : "tel"} placeholder={channel === "gmail" ? "cliente@empresa.cl" : "+56912345678"} onChange={(e) => { setRecipient(e.target.value); invalidate(); }} /></label>
      {channel === "whatsapp" ? <><label>Nombre de plantilla aprobada<input value={templateName} onChange={(e) => { setTemplateName(e.target.value); invalidate(); }} /></label><label>Idioma de plantilla<input value={language} onChange={(e) => { setLanguage(e.target.value); invalidate(); }} /></label><p className={styles.wide}>Plantilla de texto con cuatro variables: cliente, documento, saldo y vencimiento. Se comprueba directamente en Meta. Sin botones ni encabezados.</p></> : null}
      <label className={styles.wide}>Respaldo de autorización de contacto<textarea maxLength={1000} value={consentNote} placeholder="Indica dónde consta la autorización del cliente para este canal." onChange={(e) => { setConsentNote(e.target.value); invalidate(); }} /></label>
      <label className={`${styles.check} ${styles.wide}`}><input type="checkbox" checked={consent} onChange={(e) => { setConsent(e.target.checked); invalidate(); }} />Verifiqué el destinatario y el respaldo de autorización para contactarlo.</label>
      <button className="secondary-btn" type="button" disabled={!recipient || !consent || consentNote.trim().length < 10} onClick={() => void act(false)}>Preparar vista previa</button>
    </fieldset> : null}
    {preview ? <article className={styles.preview}><h3>Revisa antes de enviar</h3><p><strong>De:</strong> {preview.sender}<br /><strong>Para:</strong> {preview.recipient}<br /><strong>Asunto:</strong> {preview.subject}</p><pre>{preview.body}</pre><p>Vista previa válida hasta {when(preview.expiresAt)}. El saldo se vuelve a comprobar al enviar.</p>{canSend ? <><label className={styles.check}><input type="checkbox" checked={approved} disabled={Boolean(busy)} onChange={(e) => setApproved(e.target.checked)} />Apruebo este destinatario, saldo y mensaje para envío real.</label><button className="primary-btn" type="button" disabled={!approved || Boolean(busy)} onClick={() => void act(true)}>Aprobar y enviar ahora</button></> : <p>Un administrador debe revisar y aprobar el envío.</p>}</article> : null}
    {busy ? <p role="status">{busy} No repitas la acción.</p> : null}
    {notice ? <p role="status" className={styles.notice}>{notice}</p> : null}
    {caseId ? <><div className={styles.heading}><h3>Historial de envíos</h3><button className="secondary-btn" type="button" disabled={Boolean(busy)} onClick={() => void refresh().catch(() => setNotice("No se pudo actualizar el historial."))}>Actualizar estado</button></div>{history.length ? <ul className={styles.history}>{history.map((r) => <li key={r.id}><strong>{labels[r.status] || r.status}</strong><span>{r.recipient} · {when(r.finishedAt || r.approvedAt || r.createdAt)}</span><p>{r.detail}</p>{r.providerMessageId ? <small>Referencia del proveedor: {r.providerMessageId}</small> : null}{r.status === "DRAFT" && canSend && Date.parse(r.expiresAt) > Date.now() ? <button className="secondary-btn" type="button" disabled={Boolean(busy)} onClick={() => { setPreview(r); setApproved(false); }}>Revisar para aprobar</button> : null}</li>)}</ul> : <p>No hay envíos preparados para este caso.</p>}</> : null}
  </section>;
}
