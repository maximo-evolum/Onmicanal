import { prisma } from "../lib/db.js";
import { normalizeIndustry } from "./industry-scripts.service.js";
import { extractEventPreferences, isEventServiceIntent } from "./event-sales.service.js";
import { isAltaBrasaTenant } from "./business-knowledge.service.js";
import { analyzeSalesSignals } from "./sales-brain.service.js";
import { runAiTool, AI_TOOLS } from "./ai-tools.service.js";
import { detectConversationState, detectPaymentReadySignal, buildSalesWorkflowContext, CONVERSATION_STATES, nextActionForState } from "./sales-workflow.service.js";
import { buildReasoningSnapshot, buildReasoningPromptContext } from "./ai-reasoning.service.js";
import { buildAutonomousWorkflow, buildWorkflowPromptContext } from "./autonomous-workflow.service.js";

function includesAny(text, patterns) {
  return patterns.some((pattern) => pattern.test(text));
}

function isRealEstateIndustry(industryText = "") {
  return /(inmobiliaria|propiedad|propiedades|real estate|arriendo|departamento|casa)/i.test(industryText);
}

function isEcommerceIndustry(industryText = "") {
  return /(ecommerce|e-commerce|tienda|retail|producto|productos|despacho|stock)/i.test(industryText);
}

function classifyIndustry(tenant, message = "") {
  const source = `${tenant?.industry || ""} ${tenant?.businessPrompt || ""} ${tenant?.name || ""} ${message}`;
  if (isAltaBrasaTenant(tenant) || isEventServiceIntent(message, { industry: source, businessPrompt: source })) return "parrilladas";
  if (isRealEstateIndustry(source)) return "inmobiliaria";
  if (isEcommerceIndustry(source)) return "ecommerce";
  return normalizeIndustry(source);
}

function getActionPlan({ tenant, userMessage, memory, lead }) {
  const text = String(userMessage || "");
  const lower = text.toLowerCase();
  const industry = classifyIndustry(tenant, text);
  const sales = analyzeSalesSignals({ message: text, memory, industry });
  const prefs = extractEventPreferences(text);
  const paymentReady = detectPaymentReadySignal(text);
  const conversationState = detectConversationState({ message: text, memory, lead, objection: sales.objection });
  const reasoning = buildReasoningSnapshot({ tenant, userMessage: text, memory, lead, industry });
  const autonomousWorkflow = buildAutonomousWorkflow({ reasoning, industry, userMessage: text });
  const actions = [...(autonomousWorkflow.tools || [])];
  const reasons = [];
  if (reasoning.recommendedStrategy) reasons.push(`estrategia IA: ${reasoning.recommendedStrategy}`);
  if (reasoning.priority) reasons.push(`prioridad reasoning: ${reasoning.priority}`);

  const wantsHuman = includesAny(lower, [/humano/i, /persona/i, /asesor/i, /ejecutivo/i, /llamar/i, /tel[eé]fono/i]);
  const wantsBooking = includesAny(lower, [/reservar/i, /agendar/i, /coordinar/i, /fecha/i, /cupo/i, /disponibilidad/i, /visita/i]);
  const wantsQuote = includesAny(lower, [/cotizar/i, /cotizaci[oó]n/i, /precio/i, /valor/i, /cu[aá]nto/i, /presupuesto/i]);
  const wantsPayment = includesAny(lower, [/pagar/i, /pago/i, /link/i, /transfer/i, /abono/i]);
  const wantsProducts = includesAny(lower, [/stock/i, /disponible/i, /despacho/i, /producto/i, /modelo/i, /talla/i, /color/i, /comprar/i]);

  if (wantsHuman || (memory?.sentiment === "negative" && (lead?.closeProbability || 0) >= 45)) {
    actions.push({
      tool: AI_TOOLS.HANDOFF_HUMAN,
      args: { reason: wantsHuman ? "Cliente pidió hablar con humano" : "Riesgo comercial con sentimiento negativo" }
    });
    reasons.push("posible derivación humana");
  }

  if (industry === "parrilladas") {
    if (wantsQuote || prefs.guests) {
      actions.push({ tool: AI_TOOLS.ESTIMATE_EVENT, args: { guests: prefs.guests } });
      reasons.push("estimación de evento");
    }

    if (wantsBooking || sales.mode === "CLOSING") {
      actions.push({
        tool: AI_TOOLS.GET_AVAILABLE_SLOTS,
        args: { date: prefs.date }
      });
      reasons.push("revisión de disponibilidad");

      // Crear reserva solo si hay fecha exacta segura. Si no, la tool dirá qué falta.
      if (prefs.guests && /^\d{4}-\d{2}-\d{2}/.test(String(prefs.date || ""))) {
        actions.push({
          tool: AI_TOOLS.CREATE_BOOKING,
          args: {
            guests: prefs.guests,
            location: prefs.location,
            date: prefs.date
          }
        });
        reasons.push("creación de reserva pendiente");
      }
    }

    if (wantsPayment || paymentReady.ready || conversationState === CONVERSATION_STATES.READY_TO_CLOSE) {
      actions.push({
        tool: AI_TOOLS.MARK_PAYMENT_READY,
        args: {
          reason: paymentReady.reason || "Cliente parece listo para coordinar pago/reserva",
          interest: "Cierre asistido por vendedor humano"
        }
      });
      reasons.push("cliente listo para pago/reserva: avisar vendedor humano");
    }
  }

  if (industry === "ecommerce" && (wantsProducts || wantsQuote || sales.mode === "CLOSING")) {
    actions.push({ tool: AI_TOOLS.LOOKUP_PRODUCTS, args: { take: 3 } });
    reasons.push("búsqueda de productos");
  }

  if (industry === "inmobiliaria") {
    if (wantsQuote || wantsProducts || /departamento|depto|casa|propiedad|arriendo|comprar/i.test(lower)) {
      actions.push({ tool: AI_TOOLS.LOOKUP_PRODUCTS, args: { take: 3 } });
      reasons.push("búsqueda de propiedades");
    }

    if (wantsBooking || /visita/i.test(lower)) {
      actions.push({
        tool: AI_TOOLS.UPDATE_LEAD,
        args: {
          status: "VISIT_SCHEDULED",
          interest: "Visita / coordinación inmobiliaria",
          notes: "Cliente mostró intención de agendar visita."
        }
      });
      reasons.push("actualización de lead inmobiliario");
    }
  }

  if (conversationState !== CONVERSATION_STATES.READY_TO_CLOSE && (sales.mode === "CLOSING" || sales.mode === "QUOTE" || sales.mode === "OBJECTION")) {
    actions.push({
      tool: AI_TOOLS.UPDATE_LEAD,
      args: {
        status: sales.mode === "CLOSING" ? "QUALIFIED" : "CONTACTED",
        interest: sales.recommendedAction,
        urgency: (memory?.urgencyLevel || 0) >= 70 ? "HIGH" : undefined,
        notes: `Sales Brain: ${sales.mode}. ${sales.signals.join(", ") || "sin señales adicionales"}`
      }
    });
    reasons.push("actualización de lead según sales brain");
  }

  if (conversationState === CONVERSATION_STATES.READY_TO_CLOSE && industry !== "parrilladas") {
    actions.push({
      tool: AI_TOOLS.MARK_PAYMENT_READY,
      args: {
        reason: paymentReady.reason || "Cliente listo para cierre comercial",
        interest: "Cliente listo para que vendedor coordine pago/cierre"
      }
    });
    reasons.push("cierre asistido por humano");
  }

  // Si hay interés pero no cierre, programa seguimiento suave.
  if (["DISCOVERY", "QUOTE", "OBJECTION"].includes(sales.mode) && conversationState !== CONVERSATION_STATES.READY_TO_CLOSE) {
    actions.push({
      tool: AI_TOOLS.SCHEDULE_FOLLOW_UP,
      args: { minutes: sales.mode === "OBJECTION" ? 180 : 120 }
    });
    reasons.push("follow-up preventivo");
  }

  // Evitar duplicados exactos por tool manteniendo primera ocurrencia.
  const seen = new Set();
  const uniqueActions = actions.filter((action) => {
    const key = `${action.tool}:${JSON.stringify(action.args || {})}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return {
    industry,
    mode: sales.mode,
    conversationState,
    nextAction: nextActionForState(conversationState),
    paymentReady,
    reasoning,
    autonomousWorkflow,
    sales,
    actions: uniqueActions.slice(0, 6),
    reasons
  };
}

export function buildToolExecutionContext(results = [], workflowContext = "") {
  if (!results.length && !workflowContext) return "";

  return [
    workflowContext ? `Workflow comercial:\n${workflowContext}` : null,
    "Acciones automáticas ejecutadas o evaluadas:",
    ...results.map((r) => {
      const status = r.ok ? "OK" : "PENDIENTE";
      return `- [${status}] ${r.tool}: ${r.message || "sin detalle"}`;
    })
  ].filter(Boolean).join("\n");
}

export async function runActionOrchestrator({ tenant, conversation, contact, userMessage, memory = null }) {
  const lead = conversation?.id
    ? await prisma.lead.findUnique({ where: { conversationId: conversation.id } }).catch(() => null)
    : null;

  const plan = getActionPlan({ tenant, userMessage, memory, lead });
  const results = [];

  for (const action of plan.actions) {
    try {
      const result = await runAiTool({
        name: action.tool,
        args: action.args,
        context: { tenant, conversation, contact, userMessage, memory, lead }
      });
      results.push(result);
    } catch (error) {
      results.push({
        ok: false,
        tool: action.tool,
        message: error?.message || "Error ejecutando tool"
      });
    }
  }

  if (conversation?.id) {
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: {
        aiNextActionCode: results.find((r) => r.ok)?.tool || plan.nextAction || plan.sales.recommendedAction,
        aiNextAction: plan.nextAction || plan.sales.recommendedAction,
        decisionSummary: [
          `Modo agente: ${plan.mode}`,
          `Estado workflow: ${plan.conversationState}`,
          `Rubro: ${plan.industry}`,
          plan.reasoning ? `Reasoning: ${plan.reasoning.priority} ${plan.reasoning.opportunityScore}/100` : null,
          plan.autonomousWorkflow?.summary ? `Workflow: ${plan.autonomousWorkflow.summary}` : null,
          plan.reasons.length ? `Razones: ${plan.reasons.join(", ")}` : null,
          results.length ? `Tools: ${results.map((r) => `${r.tool}:${r.ok ? "ok" : "pending"}`).join(", ")}` : null
        ].filter(Boolean).join(" · ")
      }
    }).catch(() => null);
  }

  const workflowContext = [
    buildSalesWorkflowContext({
      state: plan.conversationState,
      paymentReady: plan.paymentReady
    }),
    buildReasoningPromptContext(plan.reasoning),
    buildWorkflowPromptContext(plan.autonomousWorkflow)
  ].filter(Boolean).join("\n\n");

  return {
    ...plan,
    results,
    workflowContext,
    contextText: buildToolExecutionContext(results, workflowContext)
  };
}
