import { Router } from "express";
import { prisma } from "../lib/db.js";

export const dashboardRouter = Router();

function startOfMonth(date = new Date()) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function startOfWeek(date = new Date()) {
  const d = new Date(date);
  const day = d.getDay() || 7;
  d.setHours(0,0,0,0);
  d.setDate(d.getDate() - day + 1);
  return d;
}

dashboardRouter.get("/dashboard/sales", async (req, res) => {
  try {
    const tenantId = req.tenantId;
    const [bookings, leads, conversations] = await Promise.all([
      prisma.booking.findMany({ where: { tenantId }, orderBy: { createdAt: "desc" } }),
      prisma.lead.findMany({ where: { tenantId } }),
      prisma.conversation.findMany({ where: { tenantId } })
    ]);

    const now = new Date();
    const month = startOfMonth(now);
    const week = startOfWeek(now);

    const confirmed = bookings.filter((b) => b.status === "CONFIRMED" || b.status === "PAID");
    const sum = (items) => items.reduce((acc, b) => acc + Number(b.total || 0), 0);

    const pendingBookings = bookings.filter((b) => b.status === "PENDING").length;
    const hotLeads = leads.filter((l) => (l.closeProbability || 0) >= 75 || ["QUALIFIED", "VISIT_SCHEDULED", "NEGOTIATION"].includes(l.status)).length;

    res.json({
      revenue: {
        total: sum(confirmed),
        month: sum(confirmed.filter((b) => new Date(b.createdAt) >= month)),
        week: sum(confirmed.filter((b) => new Date(b.createdAt) >= week))
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
        closeRate: leads.length ? Number(((confirmed.length / leads.length) * 100).toFixed(1)) : 0
      },
      ai: {
        hot: conversations.filter((c) => c.aiDecisionLabel === "HOT").length,
        warm: conversations.filter((c) => c.aiDecisionLabel === "WARM").length,
        low: conversations.filter((c) => c.aiDecisionLabel === "LOW").length,
        handoffRequired: conversations.filter((c) => c.aiHandoffRequired).length,
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
