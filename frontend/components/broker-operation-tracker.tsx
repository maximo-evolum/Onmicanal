/** Archivo: Presenta y controla el tracker de ventas usando la misma línea de tiempo de la operación. */
"use client";

import { useEffect, useMemo, useState } from "react";
import { completeBrokerOperationTrackerStage, getBrokerOperationTracker, prepareBrokerOperationTrackerNotification, updateBrokerOperationTrackerChecklist, type BrokerOperation, type BrokerOperationTracker } from "@/lib/api";

const actorOptions = ["PROPIETARIO", "COMPRADOR", "CORREDOR", "GERENCIA"] as const;

function human(value: string) {
  return String(value || "").replaceAll("_", " ").toLowerCase().replace(/(^|\s)\S/g, (letter) => letter.toUpperCase());
}

export function BrokerOperationTrackerPanel({ operations, requestedOperationId, canEdit }: { operations: BrokerOperation[]; requestedOperationId?: string | null; canEdit: boolean }) {
  const sales = useMemo(() => operations.filter((operation) => String(operation.data.operationType).toUpperCase() === "SALE"), [operations]);
  const [operationId, setOperationId] = useState("");
  const [tracker, setTracker] = useState<BrokerOperationTracker | null>(null);
  const [actor, setActor] = useState<(typeof actorOptions)[number]>("PROPIETARIO");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [completionNote, setCompletionNote] = useState("");
  const [checklistNotes, setChecklistNotes] = useState<Record<string, string>>({});

  function applyTracker(next: BrokerOperationTracker) {
    setTracker(next);
    setChecklistNotes(Object.fromEntries((next.current?.checklist || []).map((item) => [item.key, item.note || ""])));
  }

  useEffect(() => {
    if (!sales.length) { setOperationId(""); return; }
    setOperationId((current) => sales.some((operation) => operation.id === requestedOperationId) ? String(requestedOperationId) : (sales.some((operation) => operation.id === current) ? current : sales[0].id));
  }, [sales, requestedOperationId]);

  const load = async (id = operationId, selectedActor?: string) => {
    if (!id) return;
    setBusy(true);
    try { applyTracker(await getBrokerOperationTracker(id, selectedActor)); }
    catch (error) { setNotice(error instanceof Error ? error.message : "No se pudo cargar el tracker de la venta."); }
    finally { setBusy(false); }
  };

  useEffect(() => { if (operationId) load(operationId); }, [operationId]);

  async function updateChecklist(checklistKey: string, completed: boolean) {
    if (!operationId || !canEdit) return;
    setBusy(true); setNotice("");
    try {
      await updateBrokerOperationTrackerChecklist(operationId, { checklistKey, completed, note: checklistNotes[checklistKey]?.trim() || undefined });
      applyTracker(await getBrokerOperationTracker(operationId, tracker?.actorView?.actor));
    }
    catch (error) { setNotice(error instanceof Error ? error.message : "No se pudo actualizar el checklist."); }
    finally { setBusy(false); }
  }

  async function completeCurrentStage() {
    if (!operationId || !canEdit) return;
    setBusy(true); setNotice("");
    try {
      await completeBrokerOperationTrackerStage(operationId, completionNote.trim() || undefined);
      applyTracker(await getBrokerOperationTracker(operationId, tracker?.actorView?.actor));
      setCompletionNote("");
      setNotice("Hito registrado en la misma línea de tiempo de la operación.");
    } catch (error) { setNotice(error instanceof Error ? error.message : "No se pudo completar el hito."); }
    finally { setBusy(false); }
  }

  async function previewActor() {
    if (!operationId) return;
    setNotice("");
    await load(operationId, actor);
  }

  async function prepareNotification() {
    if (!operationId || !canEdit || !["PROPIETARIO", "COMPRADOR"].includes(actor)) return;
    setBusy(true); setNotice("");
    try {
      const result = await prepareBrokerOperationTrackerNotification(operationId, actor as "PROPIETARIO" | "COMPRADOR");
      setNotice(`${result.notice} Borrador: ${result.draft}`);
    } catch (error) { setNotice(error instanceof Error ? error.message : "No se pudo preparar el aviso."); }
    finally { setBusy(false); }
  }

  return <section className="broker-operation-tracker" aria-label="Operation Tracker de ventas">
    <header className="broker-tracker-header">
      <div><span>Operation Tracker</span><h2>Venta de punta a punta, sin duplicar etapas</h2><p>La línea de tiempo, la etapa comercial y el checklist provienen de la misma operación. La posición no acredita por sí sola una firma, pago, inscripción o revisión legal.</p></div>
      <label>Venta activa<select value={operationId} onChange={(event) => setOperationId(event.target.value)} disabled={busy}>{sales.map((operation) => <option value={operation.id} key={operation.id}>{operation.title}</option>)}</select></label>
    </header>
    {notice ? <p className="broker-os-notice" role="status">{notice}</p> : null}
    {!sales.length ? <p className="broker-empty">No hay operaciones de venta visibles en tu alcance. Crea o abre una operación de venta para usar el Tracker.</p> : !tracker ? <p className="broker-empty">Cargando tracker…</p> : <>
      <section className="broker-tracker-summary">
        <article><span>Etapa comercial</span><b>{tracker.source.commercialStage?.label || "Sin equivalencia"}</b><small>Pipeline: {tracker.source.pipelineStage?.label || "Sin equivalencia"}</small></article>
        <article><span>Hito actual</span><b>{tracker.current?.label || "Sin hito activo"}</b><small>{tracker.current?.allChecklistComplete ? "Checklist completo" : "Checklist pendiente"}</small></article>
        <article><span>Expediente de venta</span><b>{tracker.saleCase?.buyerName || "Comprador pendiente"}</b><small>Oferta: {human(tracker.saleCase?.offerStatus || "PENDIENTE")}</small></article>
        <article><span>Responsable y riesgo</span><b>{tracker.context.responsible}</b><small>{human(tracker.context.risk.level)} · {tracker.context.stageAgeDays} días en etapa</small></article>
      </section>
      <section className="broker-tracker-context" aria-label="Contexto operativo de la etapa">
        <article><span>Inicio de etapa</span><b>{tracker.context.stageStartedAt ? new Date(tracker.context.stageStartedAt).toLocaleDateString("es-CL") : "Sin fecha trazable"}</b><small>{tracker.context.risk.detail}</small></article>
        <article><span>Próxima acción</span><b>{tracker.context.nextStep}</b><small>La transición se habilita solo al completar el checklist actual.</small></article>
        <article><span>Documentos asociados</span><b>{tracker.context.documents.total} registrados · {tracker.context.documents.pending} pendientes</b><small>{tracker.context.documents.items.length ? tracker.context.documents.items.map((document) => `${document.title} (${human(document.status)})`).join(" · ") : "No hay documentos asociados a esta propiedad."}</small></article>
      </section>
      <section className="broker-tracker-timeline"><header><div><span>9 hitos de venta</span><h3>Progreso trazable</h3></div><small>{tracker.notice}</small></header><ol>{tracker.milestones.map((milestone) => <li key={milestone.key} className={`${milestone.status.toLowerCase()} ${milestone.isCurrent ? "current" : ""}`}><span className="broker-tracker-step">{milestone.status === "COMPLETADA" ? "✓" : milestone.isCurrent ? "●" : "○"}</span><div><b>{milestone.label}</b><small>{human(milestone.status)}{milestone.completedAt ? ` · ${new Date(milestone.completedAt).toLocaleDateString("es-CL")}` : ""}</small><p>{milestone.summary}</p></div></li>)}</ol></section>
      {tracker.current ? <section className="broker-tracker-current"><header><div><span>Control de etapa</span><h3>{tracker.current.label}</h3><p>Marca solo los controles que la persona responsable revisó. Cada cambio se registra en la operación y no envía avisos externos.</p></div><b>{tracker.current.checklist.filter((item) => item.completed).length}/{tracker.current.checklist.length}</b></header><div className="broker-tracker-checklist">{tracker.current.checklist.map((item) => <article key={item.key}><label><input type="checkbox" checked={item.completed} disabled={busy || !canEdit} onChange={(event) => updateChecklist(item.key, event.target.checked)} /><span><b>{item.label}</b><small>{item.completedAt ? `Registrado ${new Date(item.completedAt).toLocaleString("es-CL")}` : "Pendiente de confirmar"}</small></span></label><textarea aria-label={`Observación de ${item.label}`} value={checklistNotes[item.key] || ""} onChange={(event) => setChecklistNotes((current) => ({ ...current, [item.key]: event.target.value }))} placeholder="Observación o evidencia interna (opcional)" maxLength={1200} rows={2} disabled={busy || !canEdit} /></article>)}</div><div className="broker-tracker-complete"><label>Observación de avance<textarea value={completionNote} onChange={(event) => setCompletionNote(event.target.value)} placeholder="Contexto interno del avance (opcional)" rows={2} disabled={busy || !canEdit} /></label><button type="button" className="primary-btn" disabled={busy || !canEdit || !tracker.current.allChecklistComplete} onClick={completeCurrentStage}>{tracker.current.allChecklistComplete ? "Completar hito y avanzar" : "Completa el checklist para avanzar"}</button></div></section> : null}
      <section className="broker-tracker-actor"><header><div><span>Vista por actor</span><h3>Simula lo que debería ver cada contraparte</h3><p>Es una vista de diseño y no crea acceso externo ni reemplaza los permisos reales de un portal de cliente.</p></div><div><select value={actor} onChange={(event) => setActor(event.target.value as (typeof actorOptions)[number])}>{actorOptions.map((item) => <option key={item}>{human(item)}</option>)}</select><button type="button" className="secondary-btn" disabled={busy} onClick={previewActor}>Ver simulación</button>{["PROPIETARIO", "COMPRADOR"].includes(actor) ? <button type="button" className="secondary-btn" disabled={busy || !canEdit} onClick={prepareNotification}>Preparar aviso</button> : null}</div></header>{tracker.actorView ? <div className="broker-tracker-actor-view"><p>{tracker.actorView.visibilityNotice}</p><b>{tracker.actorView.operation.title}</b><span>Estado actual: {tracker.actorView.operation.currentStage}</span>{tracker.actorView.timeline.map((item) => <div key={item.key}><strong>{item.label}</strong><small>{human(item.status)} · {item.visibleDetail}</small></div>)}</div> : <p className="broker-empty">Selecciona un actor y presiona “Ver simulación”.</p>}</section>
      <section className="broker-tracker-map"><span>Mapa comercial → Tracker</span><div>{tracker.commercialMapping.map((item) => <p key={item.commercial}><b>{item.commercial}</b><span>{item.tracker}</span></p>)}</div></section>
    </>}
  </section>;
}
