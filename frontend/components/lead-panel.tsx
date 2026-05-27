"use client";

import { Conversation, Lead } from "@/lib/types";
import { buildAiOpsProfile, getAiBadgeClass, getConversationState, riskLabel } from "@/lib/ai-ops";

export function LeadPanel({
  lead,
  conversation,
  onChange,
  onSave,
}: {
  lead: Lead | null;
  conversation?: Conversation | null;
  onChange: (field: keyof Lead, value: string | number | null) => void;
  onSave: () => Promise<void>;
}) {
  if (!lead) {
    return (
      <aside className="sidebar" style={{ borderRight: 0, borderLeft: "1px solid rgba(255,255,255,0.10)" }}>
        <div className="topbar"><div><h2 className="brand-title">Lead</h2><div className="meta-line">Ficha comercial</div></div></div>
        <div className="empty-state">No hay lead asociado a esta conversación.</div>
      </aside>
    );
  }

  const profile = buildAiOpsProfile(conversation, lead);
  const state = getConversationState(conversation, lead);

  return (
    <aside className="sidebar" style={{ borderRight: 0, borderLeft: "1px solid rgba(255,255,255,0.10)" }}>
      <div className="topbar">
        <div>
          <h2 className="brand-title">Lead</h2>
          <div className="meta-line">Ficha comercial inteligente</div>
        </div>
        <span className={conversation?.aiHandoffRequired ? "badge sales-alert-critical" : "badge accent"}>{conversation?.aiHandoffRequired ? "Requiere cierre" : "Datos IA"}</span>
      </div>

      <div className="sidebar-list sales-panel-list">
        <div className="ai-ops-card premium">
          <div className="ai-ops-card-top">
            <div>
              <strong>🧠 Operación IA</strong>
              <div className="meta-line">Estado: {state}</div>
            </div>
            <span className={`badge ${getAiBadgeClass(profile)}`}>{profile.score}%</span>
          </div>
          <div className="ai-ops-profile-title">{profile.label}</div>
          <p>{profile.reason}</p>
          <div className="ai-ops-matrix">
            <span><small>Urgencia</small><strong>{riskLabel(profile.urgency)}</strong></span>
            <span><small>Riesgo</small><strong>{riskLabel(profile.risk)}</strong></span>
            <span><small>Sens. precio</small><strong>{riskLabel(profile.priceSensitivity)}</strong></span>
          </div>
          <div className="ai-ops-strategy">
            <small>Estrategia recomendada</small>
            <span>{conversation?.aiStrategy || lead.aiStrategy || profile.strategy}</span>
          </div>
          <div className="ai-ops-strategy next">
            <small>Próxima mejor acción</small>
            <span>{conversation?.aiRecommendedAction || lead.aiRecommendedAction || profile.nextBestAction}</span>
          </div>
        </div>

        {conversation?.aiReasoningSummary || lead.aiReasoningSummary ? (
          <div className="ai-ops-card">
            <strong>🔎 Razonamiento IA</strong>
            <p>{conversation?.aiReasoningSummary || lead.aiReasoningSummary}</p>
          </div>
        ) : null}

        {conversation?.aiFeedbackSummary || conversation?.aiRecoveryPlan ? (
          <div className="ai-ops-card">
            <strong>📈 Aprendizaje y recuperación</strong>
            {conversation?.aiFeedbackSummary ? <p>{conversation.aiFeedbackSummary}</p> : null}
            {conversation?.aiRecoveryPlan ? <div className="ai-ops-strategy next"><small>Plan autónomo</small><span>{conversation.aiRecoveryPlan}</span></div> : null}
          </div>
        ) : null}

        {conversation?.aiHandoffRequired ? (
          <div className="sales-ops-card urgent">
            <div className="sales-ops-card-top">
              <strong>🚨 Intervención humana</strong>
              <span className="badge sales-alert-critical">READY</span>
            </div>
            <p>{conversation.aiHandoffReason || "La IA detectó que el cliente está listo para avanzar. El vendedor debe tomar el cierre."}</p>
            <div className="sales-next-steps">
              <span>1. Tomar conversación</span>
              <span>2. Confirmar datos</span>
              <span>3. Coordinar pago/reserva</span>
            </div>
          </div>
        ) : null}

        {conversation?.aiSummary ? (
          <div className="conversation-card active">
            <strong>🧠 Resumen IA</strong>
            <p>{conversation.aiSummary}</p>
            {conversation.aiNextAction ? <div className="badge">🎯 {conversation.aiNextAction}</div> : null}
            {conversation.aiLeadScore ? <div className="badge">📊 Score {conversation.aiLeadScore}/100</div> : null}
            {conversation.aiReason ? <div className="meta-line" style={{ marginTop: 8 }}>{conversation.aiReason}</div> : null}
          </div>
        ) : null}


        {conversation?.aiDecisionLabel || conversation?.aiCloseScore !== undefined ? (
          <div className="conversation-card active">
            <strong>🧠 Decisión IA</strong>
            <div className="badges" style={{ marginTop: 8 }}>
              {conversation?.aiDecisionLabel ? <span className="badge">{conversation.aiDecisionLabel}</span> : null}
              {typeof conversation?.aiCloseScore === "number" ? <span className="badge">🔮 {conversation.aiCloseScore}% cierre</span> : null}
              {conversation?.aiHandoffRequired ? <span className="badge priority-high">👤 Requiere humano</span> : null}
            </div>
            {conversation?.aiNextActionCode ? <div className="meta-line" style={{ marginTop: 8 }}>Acción: {conversation.aiNextActionCode}</div> : null}
            {conversation?.aiDecisionReason ? <div className="meta-line" style={{ marginTop: 8 }}>{conversation.aiDecisionReason}</div> : null}
            {conversation?.aiHandoffReason ? <div className="meta-line" style={{ marginTop: 8 }}>Motivo handoff: {conversation.aiHandoffReason}</div> : null}
          </div>
        ) : null}

        <div className="conversation-card active">
          <strong>🔮 Predicción de cierre</strong>
          <h2>{lead.closeProbability ?? 0}%</h2>
          <div className="meta-line">{lead.closeReason || "Sin suficientes señales todavía."}</div>
        </div>

        <div className="conversation-card active">
          <div className="meta-line">Nombre</div>
          <input value={lead.name || ""} onChange={(e) => onChange("name", e.target.value)} />

          <div className="meta-line" style={{ marginTop: 12 }}>Teléfono</div>
          <input value={lead.phone || ""} onChange={(e) => onChange("phone", e.target.value)} />

          <div className="meta-line" style={{ marginTop: 12 }}>Interés</div>
          <select value={lead.interest || ""} onChange={(e) => onChange("interest", e.target.value || null)}>
            <option value="">Sin definir</option>
            <option value="compra">Compra</option>
            <option value="arriendo">Arriendo</option>
          </select>

          <div className="meta-line" style={{ marginTop: 12 }}>Tipo propiedad</div>
          <select value={lead.propertyType || ""} onChange={(e) => onChange("propertyType", e.target.value || null)}>
            <option value="">Sin definir</option>
            <option value="departamento">Departamento</option>
            <option value="casa">Casa</option>
          </select>

          <div className="meta-line" style={{ marginTop: 12 }}>Comuna</div>
          <input value={lead.commune || ""} onChange={(e) => onChange("commune", e.target.value)} />

          <div className="meta-line" style={{ marginTop: 12 }}>Presupuesto</div>
          <input type="number" value={lead.budget ?? ""} onChange={(e) => onChange("budget", e.target.value ? Number(e.target.value) : null)} />

          <div className="meta-line" style={{ marginTop: 12 }}>Urgencia</div>
          <select value={lead.urgency || ""} onChange={(e) => onChange("urgency", e.target.value || null)}>
            <option value="">Sin definir</option>
            <option value="low">Baja</option>
            <option value="medium">Media</option>
            <option value="high">Alta</option>
          </select>

          <div className="meta-line" style={{ marginTop: 12 }}>Estado comercial</div>
          <select value={lead.status} onChange={(e) => onChange("status", e.target.value)}>
            <option value="NEW">Nuevo</option>
            <option value="CONTACTED">Contactado</option>
            <option value="QUALIFIED">Calificado</option>
            <option value="VISIT_SCHEDULED">Visita agendada</option>
            <option value="NEGOTIATION">Negociación</option>
            <option value="READY_TO_CLOSE">Listo para cierre</option>
            <option value="ESCALATED">Escalado a humano</option>
            <option value="WON">Ganado</option>
            <option value="LOST">Perdido</option>
          </select>

          <div style={{ marginTop: 16 }}><button className="primary-btn" onClick={onSave}>Guardar lead</button></div>
        </div>
      </div>
    </aside>
  );
}
