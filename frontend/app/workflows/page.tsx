"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { AccountPill } from "@/components/account-pill";
import { EvolumSidebar } from "@/components/evolum-sidebar";
import { ModuleGate } from "@/components/module-gate";
import {
  createWorkflow,
  getWorkflowDeadLetters,
  getWorkflowRuns,
  getWorkflows,
  getWorkflowVersions,
  retryWorkflowDeadLetter,
  runWorkflow,
  type WorkflowDeadLetter,
  type WorkflowDefinition,
  type WorkflowRun,
} from "@/lib/api";
import { getStoredSession } from "@/lib/auth";

type WorkflowAction = {
  type: "set_status" | "set_field" | "create_record" | "create_notification" | "emit_event";
  status?: string;
  field?: string;
  value?: string;
  recordType?: string;
  title?: string;
  body?: string;
  event?: string;
};

type WorkflowCondition = { field: string; operator: "equals" | "not_equals" | "exists" | "includes"; value: string };

const actionLabels: Record<WorkflowAction["type"], string> = {
  set_status: "Cambiar etapa",
  set_field: "Actualizar un dato",
  create_record: "Crear una ficha",
  create_notification: "Avisar a mi equipo",
  emit_event: "Dejar una nota de actividad",
};

const triggerOptions = [
  { value: "manual", label: "Cuando yo lo ejecute", help: "Útil para una acción puntual." },
  { value: "lead.created", label: "Cuando llega una oportunidad", help: "Para ordenar nuevos contactos." },
  { value: "booking.created", label: "Cuando se agenda una cita o visita", help: "Para avisos y preparación del equipo." },
  { value: "payment.paid", label: "Cuando se confirma un pago", help: "Para informar y continuar el proceso." },
  { value: "conversation.updated", label: "Cuando cambia una conversación", help: "Para seguimientos desde Chat's." }
];

const entityOptions = [
  { value: "industry_record", label: "Una ficha de mi operación" },
  { value: "lead", label: "Una oportunidad" },
  { value: "booking", label: "Una cita, reserva o visita" },
  { value: "payment", label: "Un pago" }
];

const conditionFields = [
  { value: "input.source", label: "Origen de la solicitud" },
  { value: "input.status", label: "Estado informado" },
  { value: "target.status", label: "Estado de la ficha" }
];

function prettyDate(value?: string) {
  if (!value) return "Sin fecha";
  return new Intl.DateTimeFormat("es-CL", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function actionSummary(action: Record<string, unknown>) {
  const type = String(action.type || "");
  if (type === "set_status") return `Cambiar estado a ${String(action.status || "-")}`;
  if (type === "set_field") return `Actualizar ${String(action.field || "dato")}`;
  if (type === "create_record") return `Crear ficha ${String(action.recordType || "-")}`;
  if (type === "create_notification") return `Notificar: ${String(action.title || "-")}`;
  if (type === "emit_event") return `Evento: ${String(action.event || "workflow.event")}`;
  return "Acción sin detalle";
}

function triggerLabel(value: unknown) {
  const selected = triggerOptions.find((item) => item.value === String(value));
  return selected?.label || "Cuando ocurre una acción";
}

function conditionLabel(value: unknown) {
  const selected = conditionFields.find((item) => item.value === String(value));
  return selected?.label || "Una condición";
}

function safeJson(value: string) {
  const input = value.trim();
  if (!input) return {};
  const parsed = JSON.parse(input);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Los datos avanzados deben tener el formato indicado por tu equipo técnico.");
  return parsed as Record<string, unknown>;
}

export default function WorkflowsPage() {
  const agent = getStoredSession();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [workflows, setWorkflows] = useState<WorkflowDefinition[]>([]);
  const [deadLetters, setDeadLetters] = useState<WorkflowDeadLetter[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [runs, setRuns] = useState<WorkflowRun[]>([]);
  const [versions, setVersions] = useState<WorkflowDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [trigger, setTrigger] = useState("manual");
  const [entityType, setEntityType] = useState("industry_record");
  const [conditions, setConditions] = useState<WorkflowCondition[]>([]);
  const [actions, setActions] = useState<WorkflowAction[]>([{ type: "create_notification", title: "Acción requerida", body: "El workflow requiere atención." }]);
  const [runInput, setRunInput] = useState("{}");
  const [runTargetId, setRunTargetId] = useState("");

  const selected = useMemo(() => workflows.find((workflow) => workflow.id === selectedId) || null, [selectedId, workflows]);

  async function load(silent = false) {
    try {
      if (!silent) setLoading(true);
      const [workflowResult, deadLetterResult] = await Promise.all([getWorkflows(), getWorkflowDeadLetters().catch(() => ({ deadLetters: [] }))]);
      setWorkflows(workflowResult.workflows || []);
      setDeadLetters(deadLetterResult.deadLetters || []);
      setSelectedId((current) => current || workflowResult.workflows[0]?.id || null);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudieron cargar los workflows.");
    } finally {
      if (!silent) setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  useEffect(() => {
    if (!selectedId) { setRuns([]); setVersions([]); return; }
    Promise.all([getWorkflowRuns(selectedId), getWorkflowVersions(selectedId)])
      .then(([runsResult, versionsResult]) => {
        setRuns(runsResult.runs || []);
        setVersions(versionsResult.versions || []);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "No se pudo cargar el historial del workflow."));
  }, [selectedId]);

  function resetBuilder() {
    setName("");
    setTrigger("manual");
    setEntityType("industry_record");
    setConditions([]);
    setActions([{ type: "create_notification", title: "Acción requerida", body: "El workflow requiere atención." }]);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) { setError("Escribe un nombre para el flujo."); return; }
    try {
      setSaving(true); setError(null); setNotice(null);
      const result = await createWorkflow({ name: name.trim(), trigger, entityType, conditions, actions, status: "ACTIVE" });
      setNotice(`Workflow “${result.workflow.title}” creado y listo para ejecutar.`);
      resetBuilder();
      await load(true);
      setSelectedId(result.workflow.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo crear el workflow.");
    } finally { setSaving(false); }
  }

  async function executeSelected() {
    if (!selected) return;
    try {
      setSaving(true); setError(null); setNotice(null);
      const input = safeJson(runInput);
      const result = await runWorkflow(selected.id, { input, target: runTargetId.trim() ? { id: runTargetId.trim() } : {} });
      setNotice(`Ejecución ${result.run.status.toLowerCase()} registrada.`);
      const [runResult, deadLetterResult] = await Promise.all([getWorkflowRuns(selected.id), getWorkflowDeadLetters().catch(() => ({ deadLetters: [] }))]);
      setRuns(runResult.runs || []); setDeadLetters(deadLetterResult.deadLetters || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo ejecutar el workflow.");
      if (selectedId) setRuns((await getWorkflowRuns(selectedId).catch(() => ({ runs: [] }))).runs || []);
      setDeadLetters((await getWorkflowDeadLetters().catch(() => ({ deadLetters: [] }))).deadLetters || []);
    } finally { setSaving(false); }
  }

  async function retry(deadLetter: WorkflowDeadLetter) {
    try {
      setSaving(true); setError(null);
      const result = await retryWorkflowDeadLetter(deadLetter.id);
      setNotice(`Reintento ${result.run.status.toLowerCase()} registrado.`);
      await load(true);
      if (selectedId) setRuns((await getWorkflowRuns(selectedId)).runs || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo reintentar la ejecución.");
    } finally { setSaving(false); }
  }

  return (
    <ModuleGate moduleKey="workflows">
      <div className={`workflow-shell ${sidebarOpen ? "" : "nav-collapsed"}`}>
        <EvolumSidebar active="Automatizaciones" isDeveloper={agent?.role === "SUPER_ADMIN"} isOpen={sidebarOpen} onToggle={() => setSidebarOpen((value) => !value)} />
        <main className="workflow-page">
          <header className="workflow-hero">
            <div>
              <p className="eyebrow">AUTOMATIZACIONES</p>
              <h1>Deja que EVOLUM haga el seguimiento</h1>
              <p>Elige cuándo debe ocurrir algo y qué tarea quieres que EVOLUM realice. Puedes empezar simple y mejorarla después.</p>
            </div>
            <AccountPill fallbackName={agent?.name || "Usuario"} />
          </header>

          {error ? <div className="workflow-notice error">{error}</div> : null}
          {notice ? <div className="workflow-notice success">{notice}</div> : null}

          <section className="workflow-overview">
            <article><strong>{workflows.length}</strong><span>Automatizaciones creadas</span></article>
            <article><strong>{workflows.filter((item) => item.status === "ACTIVE").length}</strong><span>Trabajando ahora</span></article>
            <article><strong>{deadLetters.length}</strong><span>Necesitan revisión</span></article>
            <article><strong>{runs.filter((item) => item.status === "COMPLETED").length}</strong><span>Tareas realizadas</span></article>
          </section>

          <section className="workflow-grid">
            <article className="workflow-card builder-card">
              <div className="workflow-card-header"><div><p className="eyebrow">CREAR UNA AUTOMATIZACIÓN</p><h2>¿Qué quieres delegar?</h2></div><span>1 · 2 · 3</span></div>
              <form onSubmit={submit} className="workflow-form">
                <label>Nombre para reconocerla<input value={name} onChange={(event) => setName(event.target.value)} placeholder="Ej. Avisar cuando llega una oportunidad" /></label>
                <div className="workflow-form-row">
                  <label>¿Cuándo debe actuar EVOLUM?<select value={trigger} onChange={(event) => setTrigger(event.target.value)}>{triggerOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select><small>{triggerOptions.find((option) => option.value === trigger)?.help}</small></label>
                  <label>¿Sobre qué trabajará?<select value={entityType} onChange={(event) => setEntityType(event.target.value)}>{entityOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
                </div>

                <div className="workflow-stage">
                  <div><strong>1. Solo si se cumple algo (opcional)</strong><button type="button" className="text-btn" onClick={() => setConditions((items) => [...items, { field: "input.source", operator: "equals", value: "" }])}>+ Agregar regla</button></div>
                  {!conditions.length ? <p>Sin reglas: se realizará cada vez que ocurra el evento seleccionado.</p> : null}
                  {conditions.map((condition, index) => <div className="workflow-row" key={`${condition.field}-${index}`}>
                    <select aria-label="Dato a revisar" value={condition.field} onChange={(event) => setConditions((items) => items.map((item, current) => current === index ? { ...item, field: event.target.value } : item))}>{conditionFields.map((field) => <option key={field.value} value={field.value}>{field.label}</option>)}</select>
                    <select aria-label="Operador" value={condition.operator} onChange={(event) => setConditions((items) => items.map((item, current) => current === index ? { ...item, operator: event.target.value as WorkflowCondition["operator"] } : item))}><option value="equals">es igual a</option><option value="not_equals">no es igual a</option><option value="exists">existe</option><option value="includes">contiene</option></select>
                    <input aria-label="Valor de condición" value={condition.value} onChange={(event) => setConditions((items) => items.map((item, current) => current === index ? { ...item, value: event.target.value } : item))} placeholder="Ej. WhatsApp o Prioritario" />
                    <button type="button" className="icon-btn" aria-label="Eliminar condición" onClick={() => setConditions((items) => items.filter((_, current) => current !== index))}>×</button>
                  </div>)}
                </div>

                <div className="workflow-stage">
                  <div><strong>2. ¿Qué debe hacer EVOLUM?</strong><button type="button" className="text-btn" onClick={() => setActions((items) => [...items, { type: "create_notification", title: "Acción requerida" }])}>+ Agregar tarea</button></div>
                  {actions.map((action, index) => <div className="workflow-action" key={`${action.type}-${index}`}>
                    <select aria-label="Tipo de acción" value={action.type} onChange={(event) => setActions((items) => items.map((item, current) => current === index ? { type: event.target.value as WorkflowAction["type"] } : item))}>{Object.entries(actionLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
                    {action.type === "set_status" ? <input value={action.status || ""} onChange={(event) => setActions((items) => items.map((item, current) => current === index ? { ...item, status: event.target.value } : item))} placeholder="Estado, ej. QUALIFIED" /> : null}
                    {action.type === "set_field" ? <><input value={action.field || ""} onChange={(event) => setActions((items) => items.map((item, current) => current === index ? { ...item, field: event.target.value } : item))} placeholder="campo, ej. priority" /><input value={action.value || ""} onChange={(event) => setActions((items) => items.map((item, current) => current === index ? { ...item, value: event.target.value } : item))} placeholder="Valor" /></> : null}
                    {action.type === "create_record" ? <><input value={action.recordType || ""} onChange={(event) => setActions((items) => items.map((item, current) => current === index ? { ...item, recordType: event.target.value } : item))} placeholder="Tipo de ficha" /><input value={action.title || ""} onChange={(event) => setActions((items) => items.map((item, current) => current === index ? { ...item, title: event.target.value } : item))} placeholder="Título" /></> : null}
                    {action.type === "create_notification" ? <><input value={action.title || ""} onChange={(event) => setActions((items) => items.map((item, current) => current === index ? { ...item, title: event.target.value } : item))} placeholder="Título de aviso" /><input value={action.body || ""} onChange={(event) => setActions((items) => items.map((item, current) => current === index ? { ...item, body: event.target.value } : item))} placeholder="Mensaje" /></> : null}
                    {action.type === "emit_event" ? <input value={action.event || ""} onChange={(event) => setActions((items) => items.map((item, current) => current === index ? { ...item, event: event.target.value } : item))} placeholder="Evento, ej. lead.qualified" /> : null}
                    <button type="button" className="icon-btn" aria-label="Eliminar acción" onClick={() => setActions((items) => items.filter((_, current) => current !== index))}>×</button>
                  </div>)}
                </div>
                <button className="primary-btn" type="submit" disabled={saving}>{saving ? "Guardando..." : "Guardar y activar"}</button>
              </form>
            </article>

            <article className="workflow-card library-card">
              <div className="workflow-card-header"><div><p className="eyebrow">TUS AUTOMATIZACIONES</p><h2>Lo que EVOLUM hace por ti</h2></div><button className="ghost-btn" type="button" onClick={() => load()} disabled={loading}>Actualizar</button></div>
              {loading ? <p className="workflow-empty">Cargando automatizaciones...</p> : null}
              <div className="workflow-list">
                {workflows.map((workflow) => <button type="button" key={workflow.id} className={`workflow-list-item ${selectedId === workflow.id ? "selected" : ""}`} onClick={() => setSelectedId(workflow.id)}>
                  <span className={`workflow-status ${workflow.status === "ACTIVE" ? "active" : ""}`} />
                  <span><strong>{workflow.title}</strong><small>{triggerLabel(workflow.data?.trigger)} · versión {String(workflow.data?.version || 1)}</small></span>
                </button>)}
                {!loading && !workflows.length ? <p className="workflow-empty">Aún no hay automatizaciones. Crea la primera desde arriba.</p> : null}
              </div>
            </article>
          </section>

          <section className="workflow-grid detail-grid">
            <article className="workflow-card execution-card">
              <div className="workflow-card-header"><div><p className="eyebrow">REVISAR Y PROBAR</p><h2>{selected?.title || "Selecciona una automatización"}</h2></div>{selected ? <span className="workflow-tag">{selected.status === "ACTIVE" ? "ACTIVA" : "PAUSADA"}</span> : null}</div>
              {selected ? <>
                <div className="workflow-preview">
                  <strong>{triggerLabel(selected.data?.trigger)}</strong>
                  <span>→</span>
                  {(Array.isArray(selected.data?.conditions) ? selected.data?.conditions : []).map((condition: any, index: number) => <em key={`condition-${index}`}>{conditionLabel(condition.field)}</em>)}
                  <span>→</span>
                  {(Array.isArray(selected.data?.actions) ? selected.data?.actions : []).map((action: any, index: number) => <em key={`action-${index}`}>{actionSummary(action)}</em>)}
                </div>
                <label>Datos adicionales (opcional)<textarea value={runInput} onChange={(event) => setRunInput(event.target.value)} rows={3} spellCheck={false} placeholder="Déjalo vacío para una prueba simple" /><small>Solo úsalo si tu equipo te indicó información específica para probar.</small></label>
                <label>Ficha específica (opcional)<input value={runTargetId} onChange={(event) => setRunTargetId(event.target.value)} placeholder="Déjalo vacío para una prueba simple" /><small>Úsalo únicamente si quieres probar una ficha ya creada.</small></label>
                <button className="primary-btn" type="button" onClick={executeSelected} disabled={saving}>Probar automatización</button>
                <div className="workflow-history"><h3>Últimas veces que se ejecutó</h3>{runs.slice(0, 5).map((run) => <div key={run.id}><span className={`run-pill ${run.status.toLowerCase()}`}>{run.status === "SUCCESS" ? "LISTO" : run.status}</span><p>{prettyDate(run.createdAt)}</p></div>)}{!runs.length ? <p className="workflow-empty">Esta automatización todavía no se ha usado.</p> : null}</div>
                <div className="workflow-history"><h3>Cambios anteriores</h3>{versions.slice(0, 4).map((version) => <div key={version.id}><span className="run-pill">versión {String(version.data?.version || "-")}</span><p>{prettyDate(version.createdAt)}</p></div>)}{!versions.length ? <p className="workflow-empty">Aún no hay cambios anteriores guardados.</p> : null}</div>
              </> : <p className="workflow-empty">Elige una automatización de la lista para verla y probarla.</p>}
            </article>

            <article className="workflow-card dlq-card">
              <div className="workflow-card-header"><div><p className="eyebrow">NECESITA ATENCIÓN</p><h2>Automatizaciones por revisar</h2></div><span className="workflow-tag error">{deadLetters.length} pendientes</span></div>
              <p>Si algo no resulta, EVOLUM no lo pierde. Queda aquí para que puedas revisarlo e intentarlo otra vez.</p>
              <div className="workflow-dlq-list">
                {deadLetters.map((item) => <article key={item.id}><div><strong>{item.title}</strong><small>{String(item.data?.error || "Error sin detalle")} · {prettyDate(item.createdAt)}</small></div><button type="button" className="ghost-btn" onClick={() => retry(item)} disabled={saving}>Reintentar</button></article>)}
                {!deadLetters.length ? <p className="workflow-empty">Todo está funcionando correctamente.</p> : null}
              </div>
            </article>
          </section>
        </main>
      </div>
    </ModuleGate>
  );
}
