import { AI_TOOLS } from "./ai-tools.service.js";
import { CONVERSATION_STATES } from "./sales-workflow.service.js";

export const WORKFLOW_STEPS = {
  ANALYZE: "ANALYZE",
  ASK_MISSING_DATA: "ASK_MISSING_DATA",
  QUOTE: "QUOTE",
  RECOMMEND: "RECOMMEND",
  UPDATE_CRM: "UPDATE_CRM",
  SCHEDULE_FOLLOW_UP: "SCHEDULE_FOLLOW_UP",
  HANDOFF: "HANDOFF",
  READY_TO_CLOSE: "READY_TO_CLOSE"
};

export function buildAutonomousWorkflow({ reasoning, industry = "general", userMessage = "" } = {}) {
  const steps = [{ type: WORKFLOW_STEPS.ANALYZE, reason: "analizar intención, memoria y señales comerciales" }];
  const tools = [];

  if (reasoning?.missingData?.length) {
    steps.push({
      type: WORKFLOW_STEPS.ASK_MISSING_DATA,
      reason: `pedir solo: ${reasoning.missingData[0]}`,
      askOnly: reasoning.missingData[0]
    });
  }

  if (reasoning?.state === CONVERSATION_STATES.READY_TO_CLOSE || reasoning?.priority === "CRITICAL") {
    steps.push({ type: WORKFLOW_STEPS.READY_TO_CLOSE, reason: "cliente con intención fuerte de avanzar" });
    steps.push({ type: WORKFLOW_STEPS.HANDOFF, reason: "vendedor humano debe coordinar pago/reserva/cierre" });
    tools.push({
      tool: AI_TOOLS.MARK_PAYMENT_READY,
      args: { reason: "Reasoning Engine detectó lead listo para cierre", interest: "Cierre asistido por humano" }
    });
    return { steps, tools, summary: "Lead listo para cierre asistido por vendedor humano." };
  }

  if (reasoning?.salesMode === "QUOTE") {
    steps.push({ type: WORKFLOW_STEPS.QUOTE, reason: "cliente pidió precio/cotización" });
    if (industry === "parrilladas") tools.push({ tool: AI_TOOLS.ESTIMATE_EVENT, args: {} });
    if (industry === "ecommerce" || industry === "inmobiliaria") tools.push({ tool: AI_TOOLS.LOOKUP_PRODUCTS, args: { take: 3 } });
  }

  if (reasoning?.salesMode === "OBJECTION") {
    steps.push({ type: WORKFLOW_STEPS.RECOMMEND, reason: "resolver objeción antes de avanzar" });
    tools.push({
      tool: AI_TOOLS.UPDATE_LEAD,
      args: {
        status: "NEGOTIATION",
        interest: `Objeción activa: ${reasoning.sales?.objectionLabel || "general"}`,
        notes: `Estrategia IA: ${reasoning.recommendedStrategy}`
      }
    });
  }

  if (["HIGH", "CRITICAL"].includes(reasoning?.priority)) {
    steps.push({ type: WORKFLOW_STEPS.UPDATE_CRM, reason: "prioridad comercial alta" });
    tools.push({
      tool: AI_TOOLS.UPDATE_LEAD,
      args: {
        status: reasoning.priority === "CRITICAL" ? "HOT" : "QUALIFIED",
        urgency: reasoning.priority === "CRITICAL" ? "HIGH" : "MEDIUM",
        interest: reasoning.recommendedStrategy,
        notes: `Reasoning score ${reasoning.opportunityScore}/100. ${(reasoning.reasons || []).join(", ")}`
      }
    });
  }

  if (![CONVERSATION_STATES.READY_TO_CLOSE, CONVERSATION_STATES.ESCALATED].includes(reasoning?.state)) {
    steps.push({ type: WORKFLOW_STEPS.SCHEDULE_FOLLOW_UP, reason: "mantener lead activo sin presionar" });
    tools.push({
      tool: AI_TOOLS.SCHEDULE_FOLLOW_UP,
      args: { minutes: reasoning?.priority === "HIGH" ? 60 : 180 }
    });
  }

  return {
    steps,
    tools,
    summary: steps.map((s) => s.type).join(" → ")
  };
}

export function buildWorkflowPromptContext(workflow) {
  if (!workflow?.steps?.length) return "Sin workflow autónomo.";
  return `
Workflow autónomo sugerido:
${workflow.steps.map((s, i) => `${i + 1}. ${s.type}: ${s.reason}`).join("\n")}
Resumen: ${workflow.summary}
`.trim();
}
