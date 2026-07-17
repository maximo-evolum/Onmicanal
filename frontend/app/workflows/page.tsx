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
  set_status: "Cambiar estado",
  set_field: "Actualizar un dato",
  create_record: "Crear una ficha",
  create_notification: "Crear notificación",
  emit_event: "Registrar evento",
};

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

function safeJson(value: string) {
  const input = value.trim();
  if (!input) return {};
  const parsed = JSON.parse(input);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("El contexto debe ser un objeto JSON.");
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
        <EvolumSidebar active="Flujos de trabajo" isDeveloper={agent?.role === "SUPER_ADMIN"} isOpen={sidebarOpen} onToggle={() => setSidebarOpen((value) => !value)} />
        <main className="workflow-page">
          <header className="workflow-hero">
            <div>
              <p className="eyebrow">Workflow Engine</p>
              <h1>Flujos de trabajo</h1>
              <p>Crea automatizaciones con pasos visuales, condiciones, trazabilidad y recuperación de errores.</p>
            </div>
            <AccountPill fallbackName={agent?.name || "Usuario"} />
          </header>

          {error ? <div className="workflow-notice error">{error}</div> : null}
          {notice ? <div className="workflow-notice success">{notice}</div> : null}

          <section className="workflow-overview">
            <article><strong>{workflows.length}</strong><span>Flujos configurados</span></article>
            <article><strong>{workflows.filter((item) => item.status === "ACTIVE").length}</strong><span>Flujos activos</span></article>
            <article><strong>{deadLetters.length}</strong><span>Errores pendientes</span></article>
            <article><strong>{runs.filter((item) => item.status === "COMPLETED").length}</strong><span>Ejecuciones correctas</span></article>
          </section>

          <section className="workflow-grid">
            <article className="workflow-card builder-card">
              <div className="workflow-card-header"><div><p className="eyebrow">Constructor visual</p><h2>Nuevo flujo</h2></div><span>1 · 2 · 3</span></div>
              <form onSubmit={submit} className="workflow-form">
                <label>Nombre del flujo<input value={name} onChange={(event) => setName(event.target.value)} placeholder="Ej. Seguimiento de lead prioritario" /></label>
                <div className="workflow-form-row">
                  <label>Disparador<input value={trigger} onChange={(event) => setTrigger(event.target.value)} placeholder="manual o lead.created" /></label>
                  <label>Tipo de ficha<input value={entityType} onChange={(event) => setEntityType(event.target.value)} placeholder="industry_record" /></label>
                </div>

                <div className="workflow-stage">
                  <div><strong>1. Condiciones</strong><button type="button" className="text-btn" onClick={() => setConditions((items) => [...items, { field: "input.source", operator: "equals", value: "" }])}>+ Agregar</button></div>
                  {!conditions.length ? <p>Sin condiciones: el flujo se ejecutará siempre que sea activado.</p> : null}
                  {conditions.map((condition, index) => <div className="workflow-row" key={`${condition.field}-${index}`}>
                    <input aria-label="Campo de condición" value={condition.field} onChange={(event) => setConditions((items) => items.map((item, current) => current === index ? { ...item, field: event.target.value } : item))} placeholder="input.source" />
                    <select aria-label="Operador" value={condition.operator} onChange={(event) => setConditions((items) => items.map((item, current) => current === index ? { ...item, operator: event.target.value as WorkflowCondition["operator"] } : item))}><option value="equals">es igual a</option><option value="not_equals">no es igual a</option><option value="exists">existe</option><option value="includes">contiene</option></select>
                    <input aria-label="Valor de condición" value={condition.value} onChange={(event) => setConditions((items) => items.map((item, current) => current === index ? { ...item, value: event.target.value } : item))} placeholder="Valor" />
                    <button type="button" className="icon-btn" aria-label="Eliminar condición" onClick={() => setConditions((items) => items.filter((_, current) => current !== index))}>×</button>
                  </div>)}
                </div>

                <div className="workflow-stage">
                  <div><strong>2. Acciones</strong><button type="button" className="text-btn" onClick={() => setActions((items) => [...items, { type: "create_notification", title: "Acción requerida" }])}>+ Agregar</button></div>
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
                <button className="primary-btn" type="submit" disabled={saving}>{saving ? "Guardando..." : "Activar workflow"}</button>
              </form>
            </article>

            <article className="workflow-card library-card">
              <div className="workflow-card-header"><div><p className="eyebrow">Biblioteca</p><h2>Flujos activos</h2></div><button className="ghost-btn" type="button" onClick={() => load()} disabled={loading}>Actualizar</button></div>
              {loading ? <p className="workflow-empty">Cargando workflows...</p> : null}
              <div className="workflow-list">
                {workflows.map((workflow) => <button type="button" key={workflow.id} className={`workflow-list-item ${selectedId === workflow.id ? "selected" : ""}`} onClick={() => setSelectedId(workflow.id)}>
                  <span className={`workflow-status ${workflow.status === "ACTIVE" ? "active" : ""}`} />
                  <span><strong>{workflow.title}</strong><small>{String(workflow.data?.trigger || "manual")} · v{String(workflow.data?.version || 1)}</small></span>
                </button>)}
                {!loading && !workflows.length ? <p className="workflow-empty">Aún no hay flujos. Crea el primero desde el constructor.</p> : null}
              </div>
            </article>
          </section>

          <section className="workflow-grid detail-grid">
            <article className="workflow-card execution-card">
              <div className="workflow-card-header"><div><p className="eyebrow">Ejecución y trazabilidad</p><h2>{selected?.title || "Selecciona un flujo"}</h2></div>{selected ? <span className="workflow-tag">{selected.status}</span> : null}</div>
              {selected ? <>
                <div className="workflow-preview">
                  <strong>{String(selected.data?.trigger || "manual")}</strong>
                  <span>→</span>
                  {(Array.isArray(selected.data?.conditions) ? selected.data?.conditions : []).map((condition: any, index: number) => <em key={`condition-${index}`}>{condition.field} {condition.operator}</em>)}
                  <span>→</span>
                  {(Array.isArray(selected.data?.actions) ? selected.data?.actions : []).map((action: any, index: number) => <em key={`action-${index}`}>{actionSummary(action)}</em>)}
                </div>
                <label>Contexto de prueba (JSON)<textarea value={runInput} onChange={(event) => setRunInput(event.target.value)} rows={3} spellCheck={false} /></label>
                <label>Ficha objetivo (opcional; necesaria para cambiar estado o datos)<input value={runTargetId} onChange={(event) => setRunTargetId(event.target.value)} placeholder="ID de la ficha" /></label>
                <button className="primary-btn" type="button" onClick={executeSelected} disabled={saving}>Ejecutar prueba</button>
                <div className="workflow-history"><h3>Últimas ejecuciones</h3>{runs.slice(0, 5).map((run) => <div key={run.id}><span className={`run-pill ${run.status.toLowerCase()}`}>{run.status}</span><p>{prettyDate(run.createdAt)}</p></div>)}{!runs.length ? <p className="workflow-empty">Todavía no se ha ejecutado este flujo.</p> : null}</div>
                <div className="workflow-history"><h3>Versiones anteriores</h3>{versions.slice(0, 4).map((version) => <div key={version.id}><span className="run-pill">v{String(version.data?.version || "-")}</span><p>{prettyDate(version.createdAt)}</p></div>)}{!versions.length ? <p className="workflow-empty">Aún no hay versiones archivadas.</p> : null}</div>
              </> : <p className="workflow-empty">Selecciona un flujo de la biblioteca para revisar su trazabilidad.</p>}
            </article>

            <article className="workflow-card dlq-card">
              <div className="workflow-card-header"><div><p className="eyebrow">Recuperación</p><h2>Cola de errores</h2></div><span className="workflow-tag error">{deadLetters.length} pendientes</span></div>
              <p>Si una automatización falla, no se pierde: queda registrada aquí para corregirla y reintentarla.</p>
              <div className="workflow-dlq-list">
                {deadLetters.map((item) => <article key={item.id}><div><strong>{item.title}</strong><small>{String(item.data?.error || "Error sin detalle")} · {prettyDate(item.createdAt)}</small></div><button type="button" className="ghost-btn" onClick={() => retry(item)} disabled={saving}>Reintentar</button></article>)}
                {!deadLetters.length ? <p className="workflow-empty">No hay errores pendientes. La operación está limpia.</p> : null}
              </div>
            </article>
          </section>
        </main>
      </div>
    </ModuleGate>
  );
}
