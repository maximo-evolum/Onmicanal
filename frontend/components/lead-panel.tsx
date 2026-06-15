"use client";

import { Conversation, Lead } from "@/lib/types";
import { buildAiOpsProfile, getAiBadgeClass, getConversationState, riskLabel } from "@/lib/ai-ops";
import { getCommercialState } from "@/lib/commercial-state";


const UNIVERSAL_CUSTOM_FIELD_PRESETS = [
  { key: "email", label: "Email", placeholder: "correo@empresa.cl", type: "text" },
  { key: "empresa", label: "Empresa / organización", placeholder: "Nombre de empresa", type: "text" },
  { key: "producto_servicio", label: "Producto o servicio de interés", placeholder: "Ej: plan mensual, evento, tratamiento, repuesto", type: "text" },
  { key: "origen", label: "Origen del lead", placeholder: "WhatsApp, Instagram, Web, referido", type: "text" },
  { key: "ubicacion", label: "Ubicación / zona", placeholder: "Ciudad, comuna, sector o dirección", type: "text" },
  { key: "fecha_objetivo", label: "Fecha objetivo", placeholder: "Ej: esta semana, junio, 15/07", type: "text" }
];

const STATUS_OPTIONS = [
  ["NEW", "Nuevo"],
  ["CONTACTED", "Contactado"],
  ["DISCOVERY", "Descubrimiento"],
  ["QUALIFIED", "Calificado"],
  ["PROPOSAL", "Propuesta enviada"],
  ["NEGOTIATION", "Negociación"],
  ["READY_TO_CLOSE", "Listo para cierre"],
  ["PAYMENT_PENDING", "Espera de pago"],
  ["PARTIAL_PAYMENT", "Abono recibido"],
  ["BOOKED", "Reserva"],
  ["PAID", "Pagado"],
  ["ESCALATED", "Escalado a humano"],
  ["WON", "Ganado"],
  ["LOST", "Perdido"]
] as const;

function getCustomFieldValue(lead: Lead, key: string) {
  const value = lead.customFields?.[key];
  return value === undefined || value === null ? "" : String(value);
}

function setCustomField(
  lead: Lead,
  onChange: (field: keyof Lead, value: string | number | null | Record<string, string | number | boolean | null>) => void,
  key: string,
  value: string
) {
  onChange("customFields", {
    ...(lead.customFields || {}),
    [key]: value || null
  });
}

export function LeadPanel({
  lead,
  conversation,
  onChange,
  onSave,
}: {
  lead: Lead | null;
  conversation?: Conversation | null;
  onChange: (field: keyof Lead, value: string | number | null | Record<string, string | number | boolean | null>) => void;
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
  const commercial = getCommercialState(conversation, lead);

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
              <div className="meta-line">Estado: {commercial.label} · IA: {state}</div>
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
          <strong>📋 Datos universales del lead</strong>
          <div className="meta-line" style={{ marginTop: 8 }}>
            Esta ficha sirve para cualquier negocio: ecommerce, clínica, eventos, servicios, inmobiliaria, educación o soporte.
          </div>

          <div className="meta-line" style={{ marginTop: 12 }}>Nombre</div>
          <input value={lead.name || ""} onChange={(e) => onChange("name", e.target.value)} />

          <div className="meta-line" style={{ marginTop: 12 }}>Teléfono / ID contacto</div>
          <input value={lead.phone || ""} onChange={(e) => onChange("phone", e.target.value)} />

          <div className="meta-line" style={{ marginTop: 12 }}>Necesidad / interés principal</div>
          <input
            value={lead.interest || ""}
            placeholder="Ej: cotizar producto, agendar servicio, pedir soporte, reservar, comprar"
            onChange={(e) => onChange("interest", e.target.value || null)}
          />

          <div className="meta-line" style={{ marginTop: 12 }}>Categoría / tipo de solicitud</div>
          <input
            value={lead.propertyType || ""}
            placeholder="Ej: venta, servicio técnico, reserva, tratamiento, plan, evento"
            onChange={(e) => onChange("propertyType", e.target.value || null)}
          />

          <div className="meta-line" style={{ marginTop: 12 }}>Ubicación / zona / sucursal</div>
          <input
            value={lead.commune || ""}
            placeholder="Ej: Santiago, Providencia, online, sucursal norte"
            onChange={(e) => onChange("commune", e.target.value)}
          />

          <div className="meta-line" style={{ marginTop: 12 }}>Valor estimado / presupuesto</div>
          <input
            type="number"
            value={lead.budget ?? ""}
            placeholder="Monto estimado si aplica"
            onChange={(e) => onChange("budget", e.target.value ? Number(e.target.value) : null)}
          />

          <div className="meta-line" style={{ marginTop: 12 }}>Urgencia</div>
          <select value={lead.urgency || ""} onChange={(e) => onChange("urgency", e.target.value || null)}>
            <option value="">Sin definir</option>
            <option value="low">Baja</option>
            <option value="medium">Media</option>
            <option value="high">Alta</option>
            <option value="critical">Crítica</option>
          </select>

          <div className="meta-line" style={{ marginTop: 12 }}>Estado comercial</div>
          <select value={lead.status} onChange={(e) => onChange("status", e.target.value)}>
            {STATUS_OPTIONS.map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>

          <div className="meta-line" style={{ marginTop: 12 }}>Notas internas</div>
          <textarea
            value={lead.notes || ""}
            placeholder="Observaciones del agente, acuerdos, condiciones o próximos pasos."
            onChange={(e) => onChange("notes", e.target.value || null)}
            rows={4}
          />

          <div className="ai-ops-strategy next" style={{ marginTop: 16 }}>
            <small>Campos personalizados por negocio</small>
            <span>Usa estos campos para adaptar el lead al rubro del cliente sin modificar código.</span>
          </div>

          {UNIVERSAL_CUSTOM_FIELD_PRESETS.map((field) => (
            <div key={field.key}>
              <div className="meta-line" style={{ marginTop: 12 }}>{field.label}</div>
              <input
                value={getCustomFieldValue(lead, field.key)}
                placeholder={field.placeholder}
                onChange={(e) => setCustomField(lead, onChange, field.key, e.target.value)}
              />
            </div>
          ))}

          <div style={{ marginTop: 16 }}><button className="primary-btn" onClick={onSave}>Guardar lead</button></div>
        </div>
      </div>
    </aside>
  );
}
