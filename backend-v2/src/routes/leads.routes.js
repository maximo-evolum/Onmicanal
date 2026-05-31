import { Router } from "express";
import { prisma } from "../lib/db.js";
import { updateLead } from "../services/lead.service.js";
import { requireRole, ROLE_GROUPS } from "../middleware/tenant-access.js";

export const leadsRouter = Router();

function tenantWhere(req) {
  if (req.user?.role === "SUPER_ADMIN" && req.query?.tenantId) {
    return { tenantId: String(req.query.tenantId) };
  }
  if (req.user?.role === "SUPER_ADMIN") {
    return {};
  }
  return { tenantId: req.tenantId };
}

async function findAccessibleConversation(req, conversationId) {
  const where = { id: conversationId };
  if (req.user?.role !== "SUPER_ADMIN") where.tenantId = req.tenantId;
  return prisma.conversation.findFirst({ where, include: { lead: true } });
}

leadsRouter.get("/leads/metrics", async (req, res) => {
  try {
    const leads = await prisma.lead.findMany({
      where: tenantWhere(req),
      include: { conversation: true }
    });

    const now = new Date();
    const byStatus = {};
    const byPriority = { high: 0, medium: 0, low: 0 };
    let estimatedRevenue = 0;
    let hotLeads = 0;
    let staleLeads = 0;
    let urgentUnanswered = 0;
    let closeProbabilitySum = 0;

    for (const lead of leads) {
      byStatus[lead.status] = (byStatus[lead.status] || 0) + 1;
      const priority = lead.conversation?.priorityLabel || "low";
      byPriority[priority] = (byPriority[priority] || 0) + 1;
      if (priority === "high") hotLeads++;
      if (lead.budget) estimatedRevenue += lead.budget;
      closeProbabilitySum += lead.closeProbability || 0;

      const hours = (now - new Date(lead.updatedAt)) / 36e5;
      if (hours > 24 && !["WON", "LOST"].includes(lead.status)) staleLeads++;
      if (priority === "high" && lead.status === "NEW") urgentUnanswered++;
    }

    const total = leads.length;
    const won = byStatus.WON || 0;

    res.json({
      total,
      byStatus,
      byPriority,
      conversionRate: total ? Number(((won / total) * 100).toFixed(1)) : 0,
      estimatedRevenue,
      averageCloseProbability: total ? Math.round(closeProbabilitySum / total) : 0,
      alerts: { hotLeads, staleLeads, urgentUnanswered }
    });
  } catch (error) {
    console.error("Lead metrics error:", error);
    res.status(500).json({ error: "No se pudieron obtener métricas" });
  }
});

leadsRouter.get("/leads", async (req, res) => {
  try {
    const leads = await prisma.lead.findMany({
      where: tenantWhere(req),
      include: {
        conversation: { include: { contact: true, assignedTo: true } }
      },
      orderBy: [{ closeProbability: "desc" }, { updatedAt: "desc" }]
    });
    res.json(leads);
  } catch (error) {
    console.error("List leads error:", error);
    res.status(500).json({ error: "No se pudieron obtener leads" });
  }
});

leadsRouter.get("/leads/:conversationId", async (req, res) => {
  try {
    const conversation = await findAccessibleConversation(req, req.params.conversationId);

    if (!conversation?.lead) return res.status(404).json({ error: "Lead no encontrado" });
    res.json(conversation.lead);
  } catch (error) {
    console.error("Get lead error:", error);
    res.status(500).json({ error: "No se pudo obtener el lead" });
  }
});

leadsRouter.patch("/leads/:conversationId", requireRole(ROLE_GROUPS.STAFF), async (req, res) => {
  try {
    const conversation = await findAccessibleConversation(req, req.params.conversationId);
    if (!conversation) return res.status(404).json({ error: "Conversación no encontrada" });

    const updated = await updateLead({ conversationId: req.params.conversationId, data: req.body });
    res.json(updated);
  } catch (error) {
    console.error("Update lead error:", error);
    res.status(500).json({ error: "No se pudo actualizar el lead" });
  }
});
