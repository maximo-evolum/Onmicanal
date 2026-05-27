import { getRuleReply } from "./rules.service.js";
import { classifyPriority } from "./priority.service.js";
import { detectIntent } from "./intent.service.js";
import { extractEntities } from "./entity-extractor.service.js";
import { generateSalesReply } from "./ai.service.js";

function buildReasonSummary({ intent, entities, priority, matchedRule, usedAI }) {
  const reasons = [];

  if (matchedRule) reasons.push("aplicó regla");
  if (usedAI) reasons.push("usó IA");
  if (entities?.commune) reasons.push(`comuna: ${entities.commune}`);
  if (entities?.budget) reasons.push(`presupuesto: ${entities.budget}`);
  if (entities?.interest) reasons.push(`interés: ${entities.interest}`);
  if (entities?.propertyType) reasons.push(`tipo: ${entities.propertyType}`);
  reasons.push(`intención: ${intent}`);

  return `Prioridad ${priority.label} (${priority.score}). ${reasons.join(", ")}.`;
}

export async function testBotMessage({ tenant, channel, message }) {
  const matchedRule = await getRuleReply({
    tenantId: tenant.id,
    channel,
    message,
  });

  const intent = await detectIntent({ message });
  const entities = await extractEntities({ message });
  const priority = classifyPriority({ intent, entities, message });

  let reply = matchedRule;
  let usedAI = false;

  if (!reply) {
    usedAI = true;
    reply = await generateSalesReply({
      tenantId: tenant.id,
      tenantName: tenant.name,
      businessPrompt: tenant.businessPrompt,
      userMessage: message,
      tenant,
    });
  }

  return {
    reply,
    debug: {
      channel,
      matchedRule,
      usedAI,
      intent,
      entities,
      priority,
      confidence: 0.8,
      suggestedNextAction:
        priority.label === "high"
          ? "qualify_and_schedule"
          : priority.label === "medium"
          ? "continue_qualification"
          : "nurture",
      reasonSummary: buildReasonSummary({
        intent,
        entities,
        priority,
        matchedRule,
        usedAI,
      }),
    },
  };
}