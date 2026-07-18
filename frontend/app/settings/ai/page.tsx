"use client";

import { useEffect, useState, type FormEvent } from "react";
import { AccountPill } from "@/components/account-pill";
import { EvolumSidebar } from "@/components/evolum-sidebar";
import { ModuleGate } from "@/components/module-gate";
import { approveAiAction, createAiEvaluation, getAiGovernance, getAIConfig, rejectAiAction, updateAIConfig, type AiGovernanceRecord } from "@/lib/api";
import { getStoredSession } from "@/lib/auth";

const controlledActions = [
  { key: "create_booking", label: "Crear una reserva" },
  { key: "mark_payment_ready", label: "Preparar un cobro" },
  { key: "update_lead", label: "Modificar una oportunidad" },
  { key: "schedule_follow_up", label: "Programar seguimiento" },
];

function formatDate(value?: string) {
  return value ? new Intl.DateTimeFormat("es-CL", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "Sin fecha";
}

function asText(value: unknown) {
  return Array.isArray(value) ? value.map(String).join(", ") : "";
}

export default function AiGovernancePage() {
  const agent = getStoredSession();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [approvalActions, setApprovalActions] = useState<string[]>(["create_booking", "mark_payment_ready"]);
  const [maxActions, setMaxActions] = useState(3);
  const [blockedTerms, setBlockedTerms] = useState("");
  const [recordEvaluations, setRecordEvaluations] = useState(true);
  const [maxRepliesPerDay, setMaxRepliesPerDay] = useState<number | "">("");
  const [monthlyCostLimit, setMonthlyCostLimit] = useState<number | "">("");
  const [usageStatus, setUsageStatus] = useState<{ allowed: boolean; reason: string | null; dailyReplies: number; monthlyReplies: number; monthlyCost: number } | null>(null);
  const [approvals, setApprovals] = useState<AiGovernanceRecord[]>([]);
  const [evaluations, setEvaluations] = useState<AiGovernanceRecord[]>([]);
  const [scenario, setScenario] = useState("");
  const [output, setOutput] = useState("");
  const [expected, setExpected] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      setLoading(true);
      const [config, governance] = await Promise.all([getAIConfig(), getAiGovernance()]);
      const policy = governance.governance || config.settings.governance;
      setApprovalActions(policy?.requireApprovalFor || []);
      setMaxActions(policy?.maxAutonomousActions ?? 3);
      setBlockedTerms((policy?.blockedTerms || []).join("\n"));
      setRecordEvaluations(policy?.recordEvaluations ?? true);
      setMaxRepliesPerDay(policy?.maxAiRepliesPerDay ?? "");
      setMonthlyCostLimit(policy?.monthlyCostLimit ?? "");
      setUsageStatus(governance.usageLimits ? {
        allowed: governance.usageLimits.allowed,
        reason: governance.usageLimits.reason,
        dailyReplies: governance.usageLimits.usage.dailyReplies,
        monthlyReplies: governance.usageLimits.usage.monthlyReplies,
        monthlyCost: governance.usageLimits.usage.monthlyCost
      } : null);
      setApprovals(governance.approvals || []);
      setEvaluations(governance.evaluations || []);
      setError(null);
    } catch (err) { setError(err instanceof Error ? err.message : "No se pudo cargar el gobierno IA."); }
    finally { setLoading(false); }
  }

  useEffect(() => { void load(); }, []);

  function toggleAction(key: string) {
    setApprovalActions((items) => items.includes(key) ? items.filter((item) => item !== key) : [...items, key]);
  }

  async function savePolicy(event: FormEvent) {
    event.preventDefault();
    try {
      setSaving(true); setError(null);
      await updateAIConfig({ governance: {
        requireApprovalFor: approvalActions,
        maxAutonomousActions: Number(maxActions),
        blockedTerms: blockedTerms.split(/\n|,/).map((item) => item.trim()).filter(Boolean),
        recordEvaluations,
        maxAiRepliesPerDay: maxRepliesPerDay === "" ? null : Number(maxRepliesPerDay),
        monthlyCostLimit: monthlyCostLimit === "" ? null : Number(monthlyCostLimit)
      } });
      setNotice("Política de gobierno IA guardada. Las nuevas acciones respetarán esta configuración.");
      await load();
    } catch (err) { setError(err instanceof Error ? err.message : "No se pudo guardar la política."); }
    finally { setSaving(false); }
  }

  async function evaluate(event: FormEvent) {
    event.preventDefault();
    if (!scenario.trim() || !output.trim()) { setError("Escribe el escenario y la respuesta que deseas evaluar."); return; }
    try {
      setSaving(true); setError(null);
      const result = await createAiEvaluation({ scenario, output, expected });
      setNotice(result.result.passed ? `Evaluación aprobada: ${result.result.score}/100.` : `Evaluación requiere revisión: detectó ${result.result.matches.join(", ")}.`);
      setScenario(""); setOutput(""); setExpected("");
      await load();
    } catch (err) { setError(err instanceof Error ? err.message : "No se pudo registrar la evaluación."); }
    finally { setSaving(false); }
  }

  async function decide(approval: AiGovernanceRecord, approved: boolean) {
    try {
      setSaving(true); setError(null);
      if (approved) await approveAiAction(approval.id); else await rejectAiAction(approval.id, "Rechazado por revisión humana");
      setNotice(approved ? "Acción aprobada y ejecutada con trazabilidad." : "Acción IA rechazada y registrada.");
      await load();
    } catch (err) { setError(err instanceof Error ? err.message : "No se pudo resolver la acción."); }
    finally { setSaving(false); }
  }

  return <ModuleGate moduleKey="ai_ops"><div className={`workflow-shell ${sidebarOpen ? "" : "nav-collapsed"}`}>
    <EvolumSidebar active="Control de IA" isDeveloper={agent?.role === "SUPER_ADMIN"} isOpen={sidebarOpen} onToggle={() => setSidebarOpen((value) => !value)} />
    <main className="workflow-page ai-governance-page">
      <header className="workflow-hero"><div><p className="eyebrow">CONTROL DE IA</p><h1>Decide cómo te ayuda la IA</h1><p>Indica qué tareas puede preparar sola, cuándo debe pedir aprobación y qué temas prefieres revisar antes de responder.</p></div><AccountPill fallbackName={agent?.name || "Usuario"} /></header>
      {error ? <div className="workflow-notice error">{error}</div> : null}{notice ? <div className="workflow-notice success">{notice}</div> : null}
      <section className="workflow-overview"><article><strong>{approvals.length}</strong><span>Tareas esperando tu visto bueno</span></article><article><strong>{maxActions}</strong><span>Tareas que puede preparar por conversación</span></article><article><strong>{blockedTerms.split(/\n|,/).filter(Boolean).length}</strong><span>Temas que requieren cuidado</span></article><article><strong>{evaluations.filter((item) => item.status === "PASSED").length}</strong><span>Respuestas revisadas correctamente</span></article></section>
      <section className="workflow-grid">
        <article className="workflow-card builder-card"><div className="workflow-card-header"><div><p className="eyebrow">REGLAS DE AYUDA</p><h2>Qué puede hacer la IA</h2></div></div>
          <form className="workflow-form" onSubmit={savePolicy}>
            <p className="workflow-empty">Marca las tareas que quieres revisar. La IA las dejará preparadas y esperará tu aprobación antes de realizarlas.</p>
            <div className="governance-check-grid">{controlledActions.map((item) => <label key={item.key} className="governance-check"><input type="checkbox" checked={approvalActions.includes(item.key)} onChange={() => toggleAction(item.key)} /> <span><strong>{item.label}</strong><small>La IA esperará tu aprobación antes de hacerlo.</small></span></label>)}</div>
            <label>Máximo de tareas que puede preparar por conversación<input type="number" min="0" max="10" value={maxActions} onChange={(event) => setMaxActions(Math.min(10, Math.max(0, Number(event.target.value))))} /><small>Recomendado: 3. Así evita hacer demasiadas cosas a la vez.</small></label>
            <label>Máximo de respuestas por día (opcional)<input type="number" min="1" max="100000" value={maxRepliesPerDay} onChange={(event) => setMaxRepliesPerDay(event.target.value === "" ? "" : Math.max(1, Number(event.target.value)))} placeholder="Sin límite" /></label>
            <label>Presupuesto mensual para IA (opcional)<input type="number" min="0" step="0.01" value={monthlyCostLimit} onChange={(event) => setMonthlyCostLimit(event.target.value === "" ? "" : Math.max(0, Number(event.target.value)))} placeholder="Sin límite" /></label>
            {usageStatus ? <p className={`workflow-empty ${usageStatus.allowed ? "" : "workflow-notice error"}`}>Uso actual: {usageStatus.dailyReplies} respuestas hoy · {usageStatus.monthlyReplies} este mes. {!usageStatus.allowed ? "La IA está pausada hasta que revises este límite." : ""}</p> : null}
            <label>Temas que prefieres revisar antes<textarea rows={4} value={blockedTerms} onChange={(event) => setBlockedTerms(event.target.value)} placeholder="Uno por línea. Ej.: diagnóstico definitivo" /><small>La IA detectará estas palabras y evitará responderlas por su cuenta.</small></label>
            <label className="governance-check"><input type="checkbox" checked={recordEvaluations} onChange={(event) => setRecordEvaluations(event.target.checked)} /><span><strong>Guardar ejemplos revisados</strong><small>Sirve para ver cómo está respondiendo la IA y mejorarla con el tiempo.</small></span></label>
            <button className="primary-btn" type="submit" disabled={saving || loading}>{saving ? "Guardando..." : "Guardar estas reglas"}</button>
          </form>
        </article>
        <article className="workflow-card dlq-card"><div className="workflow-card-header"><div><p className="eyebrow">TU REVISIÓN</p><h2>Tareas que la IA preparó</h2></div><span className="workflow-tag error">{approvals.length}</span></div><p>Revisa la propuesta. Al aprobarla, EVOLUM realizará solo esa tarea y quedará registrada.</p><div className="workflow-dlq-list">{approvals.map((item) => <article key={item.id}><div><strong>{String(item.data?.tool || item.title)}</strong><small>{String(item.data?.reason || "Sin detalle")} · {formatDate(item.createdAt)}</small><small>Información: {asText(item.data?.args) || "revisar detalles"}</small></div><div className="governance-actions"><button className="primary-btn" type="button" onClick={() => decide(item, true)} disabled={saving}>Aprobar</button><button className="ghost-btn" type="button" onClick={() => decide(item, false)} disabled={saving}>Rechazar</button></div></article>)}{!loading && !approvals.length ? <p className="workflow-empty">No hay tareas esperando tu revisión.</p> : null}</div></article>
      </section>
      <section className="workflow-grid detail-grid"><article className="workflow-card execution-card"><div className="workflow-card-header"><div><p className="eyebrow">Evaluación</p><h2>Probar una respuesta</h2></div></div><form className="workflow-form" onSubmit={evaluate}><label>Escenario<input value={scenario} onChange={(event) => setScenario(event.target.value)} placeholder="Ej. Solicitud de datos clínicos" /></label><label>Respuesta de la IA<textarea rows={5} value={output} onChange={(event) => setOutput(event.target.value)} placeholder="Pega aquí la respuesta a revisar" /></label><label>Comportamiento esperado (opcional)<textarea rows={3} value={expected} onChange={(event) => setExpected(event.target.value)} placeholder="Ej. Derivar a un profesional y no entregar diagnóstico" /></label><button className="primary-btn" type="submit" disabled={saving}>Evaluar respuesta</button></form></article><article className="workflow-card library-card"><div className="workflow-card-header"><div><p className="eyebrow">Evidencia</p><h2>Últimas evaluaciones</h2></div></div><div className="workflow-list">{evaluations.map((item) => <div className="workflow-list-item" key={item.id}><span className={`workflow-status ${item.status === "PASSED" ? "active" : ""}`} /><span><strong>{item.title}</strong><small>{item.status} · {String((item.data?.result as Record<string, unknown>)?.score ?? "-")}/100 · {formatDate(item.createdAt)}</small></span></div>)}{!loading && !evaluations.length ? <p className="workflow-empty">Aún no hay evaluaciones registradas.</p> : null}</div></article></section>
    </main>
  </div></ModuleGate>;
}
