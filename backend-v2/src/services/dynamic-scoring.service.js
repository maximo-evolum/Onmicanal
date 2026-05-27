export function calculateDynamicLeadScore({ lead, conversation }) {
  let score = conversation?.priorityScore || 0;
  const now = new Date();

  if (lead?.budget) score += 10;
  if (lead?.commune) score += 8;
  if (lead?.status === "VISIT_SCHEDULED") score += 20;
  if (lead?.status === "NEGOTIATION") score += 25;
  if (lead?.status === "WON") score = 100;
  if (lead?.status === "LOST") score = 0;

  if (lead?.updatedAt && !["WON", "LOST"].includes(lead.status)) {
    const hours = (now.getTime() - new Date(lead.updatedAt).getTime()) / 36e5;
    if (hours > 24) score -= 10;
    if (hours > 72) score -= 20;
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  const label = score >= 70 ? "high" : score >= 40 ? "medium" : "low";
  return { score, label };
}
