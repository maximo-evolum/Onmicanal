import { Router } from "express";
import { prisma } from "../lib/db.js";
import { getSalesQueue } from "../services/sales-engine.service.js";

export const dashboardRouter = Router();

function startOfMonth(date = new Date()) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function startOfWeek(date = new Date()) {
  const d = new Date(date);
  const day = d.getDay() || 7;
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - day + 1);
  return d;
}

function tenantWhere(req) {
  const requestedTenantId = req.query?.tenantId ? String(req.query.tenantId) : null;
  if (req.user?.role === "SUPER_ADMIN" && requestedTenantId) return { tenantId: requestedTenantId };
  if (req.user?.role === "SUPER_ADMIN") return {};
  return { tenantId: req.tenantId };
}

dashboardRouter.get("/dashboard/sales", async (req, res) => {
  try {
    const baseWhere = tenantWhere(req);
    const tenantId = baseWhere.tenantId || req.tenantId || null;

    const [bookings, leads, conversations, outcomes] = await Promise.all([
      prisma.booking.findMany({ where: baseWhere, orderBy: { createdAt: "desc" } }),
      prisma.lead.findMany({ where: baseWhere }),
      prisma.conversation.findMany({
        where: baseWhere,
        include: { lead: true }
      }),
      prisma.salesOutcome.findMany({
        where: baseWhere,
        orderBy: { createdAt: "desc" },
        take: 200
      }).catch(() => [])
    ]);

    const now = new Date();
    const month = startOfMonth(now);
    const week = startOfWeek(now);

    const confirmed = bookings.filter((b) => b.status === "CONFIRMED" || b.status === "PAID");
    const sum = (items) => items.reduce((acc, b) => acc + Number(b.total || 0), 0);

    const pendingBookings = bookings.filter((b) => b.status === "PENDING").length;
    const readyToClose = conversations.filter((c) =>
      c.aiHandoffRequired ||
      c.aiNextActionCode === "READY_TO_CLOSE" ||
      c.aiNextActionCode === "HANDOFF_REQUIRED" ||
      c.aiNextActionCode === "QUOTE_SENT" ||
      c.lead?.status === "READY_TO_CLOSE" ||
      c.lead?.status === "QUOTE_SENT" ||
      Number(c.aiCloseScore || 0) >= 75
    );

    const hotLeads = leads.filter((l) =>
      (l.closeProbability || 0) >= 75 ||
      ["QUALIFIED", "QUOTE_SENT", "READY_TO_CLOSE", "NEGOTIATION"].includes(l.status)
    ).length;

    const estimatedRevenue = leads.reduce((acc, l) => acc + Number(l.budget || 0), 0);

    res.json({
      revenue: {
        total: sum(confirmed),
        month: sum(confirmed.filter((b) => new Date(b.createdAt) >= month)),
        week: sum(confirmed.filter((b) => new Date(b.createdAt) >= week)),
        estimated: estimatedRevenue
      },
      bookings: {
        total: bookings.length,
        confirmed: confirmed.length,
        pending: pendingBookings,
        upcoming: bookings.filter((b) => new Date(b.date) >= now && !["CANCELED"].includes(b.status)).slice(0, 8)
      },
      leads: {
        total: leads.length,
        hot: hotLeads,
        closeRate: leads.length ? Number(((confirmed.length / leads.length) * 100).toFixed(1)) : 0,
        readyToClose: readyToClose.length,
        quoteSent: leads.filter((l) => l.status === "QUOTE_SENT").length
      },
      ai: {
        hot: conversations.filter((c) => c.aiDecisionLabel === "HOT" || c.aiDecisionLabel === "READY_TO_CLOSE").length,
        warm: conversations.filter((c) => c.aiDecisionLabel === "WARM").length,
        low: conversations.filter((c) => c.aiDecisionLabel === "LOW").length,
        handoffRequired: conversations.filter((c) => c.aiHandoffRequired).length,
        readyToClose: readyToClose.length,
        quoteSent: conversations.filter((c) => c.aiNextActionCode === "QUOTE_SENT").length,
        outcomes: outcomes.length,
        averageCloseScore: conversations.length
          ? Math.round(conversations.reduce((acc, c) => acc + Number(c.aiCloseScore || 0), 0) / conversations.length)
          : 0
      }
    });
  } catch (error) {
    console.error("Sales dashboard error:", error);
    res.status(500).json({ error: "No se pudo obtener dashboard de ventas" });
  }
});

dashboardRouter.get("/sales/queue", async (req, res) => {
  try {
    const tenantId = req.user?.role === "SUPER_ADMIN" && req.query?.tenantId
      ? String(req.query.tenantId)
      : req.tenantId;

    if (!tenantId && req.user?.role !== "SUPER_ADMIN") {
      return res.status(401).json({ error: "Tenant requerido" });
    }

    if (req.user?.role === "SUPER_ADMIN" && !tenantId) {
      const conversations = await prisma.conversation.findMany({
        where: {
          OR: [
            { aiHandoffRequired: true },
            { aiNextActionCode: { in: ["READY_TO_CLOSE", "HANDOFF_REQUIRED", "QUOTE_SENT"] } },
            { aiCloseScore: { gte: 75 } },
            { lead: { status: { in: ["READY_TO_CLOSE", "QUOTE_SENT", "NEGOTIATION"] } } }
          ]
        },
        include: { contact: true, assignedTo: true, lead: true, tenant: true },
        orderBy: [{ aiCloseScore: "desc" }, { priorityScore: "desc" }, { lastMessageAt: "desc" }],
        take: 100
      });
      return res.json(conversations);
    }

    const queue = await getSalesQueue({ tenantId });
    res.json(queue);
  } catch (error) {
    console.error("Sales queue error:", error);
    res.status(500).json({ error: "No se pudieron obtener cierres IA" });
  }
});
