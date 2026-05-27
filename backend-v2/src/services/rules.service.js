import { prisma } from "../lib/db.js";

export async function getRuleReply({ tenantId, channel, message }) {
  const normalizedMessage = (message || "").toLowerCase().trim();
  if (!normalizedMessage) return null;

  const rules = await prisma.rule.findMany({
    where: {
      tenantId,
      isActive: true,
      OR: [{ channel: null }, { channel }]
    },
    orderBy: { priority: "asc" }
  });

  const matchedRule = rules.find((rule) =>
    normalizedMessage.includes(rule.trigger.toLowerCase())
  );

  return matchedRule?.response || null;
}
