import { prisma } from "../lib/db.js";

function startOfDay(date = new Date()) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function startOfMonth(date = new Date()) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function sum(items, field = "total") {
  return items.reduce((acc, item) => acc + Number(item?.[field] || 0), 0);
}

function moneyFromLead(lead) {
  return Number(lead?.budget || 0);
}

function normalizeStage(status = "NEW") {
  const value = String(status || "NEW").toUpperCase();
  if (["PAYMENT_PENDING", "PARTIAL_PAYMENT", "PAID", "BOOKED", "REFUNDED", "CANCELED"].includes(value)) return value;
  if (["QUOTE_SENT", "READY_TO_CLOSE", "NEGOTIATION", "QUALIFIED", "CONTACTED", "NEW"].includes(value)) return value;
  return value || "NEW";
}

function statusFromRecords({ lead, booking, payment, conversation }) {
  if (payment?.status === "PAID") return "PAID";
  if (booking?.status === "CONFIRMED") return "BOOKED";
  if (payment?.status === "PENDING") return "PAYMENT_PENDING";
  if (payment?.status === "PARTIAL") return "PARTIAL_PAYMENT";
  if (lead?.status) return normalizeStage(lead.status);
  if (conversation?.aiNextActionCode) return normalizeStage(conversation.aiNextActionCode);
  return "NEW";
}

function scoreOf({ lead, conversation }) {
  return Math.max(
    Number(lead?.closeProbability || 0),
    Number(conversation?.aiCloseScore || 0),
    Number(conversation?.priorityScore || 0)
  );
}

function nextActionFor(stage) {
  const map = {
    NEW: "Responder y calificar necesidad.",
    CONTACTED: "Continuar discovery y obtener datos faltantes.",
    QUALIFIED: "Preparar recomendación y cotización.",
    QUOTE_SENT: "Dar seguimiento y resolver objeciones.",
    READY_TO_CLOSE: "Tomar conversación y cerrar reserva/pago.",
    NEGOTIATION: "Ajustar propuesta y confirmar intención.",
    PAYMENT_PENDING: "Enviar recordatorio de pago y confirmar reserva.",
    PARTIAL_PAYMENT: "Confirmar abono y coordinar saldo pendiente.",
    PAID: "Enviar confirmación final y detalles operativos.",
    BOOKED: "Coordinar logística previa al evento.",
    CANCELED: "Revisar motivo y posible recuperación.",
    REFUNDED: "Cerrar caso administrativo."
  };
  return map[stage] || "Revisar manualmente.";
}

function buildActivity({ conversations, leads, bookings, payments, outcomes }) {
  const rows = [];
  for (const p of payments) {
    rows.push({
      id: `payment-${p.id}`,
      type: p.status === "PAID" ? "PAYMENT_PAID" : "PAYMENT_PENDING",
      title: p.status === "PAID" ? "Pago confirmado" : "Pago pendiente creado",
      description: `${p.description || "Pago"} · $${Number(p.amount || 0).toLocaleString("es-CL")}`,
      createdAt: p.paidAt || p.createdAt,
      conversationId: p.conversationId || null,
      amount: Number(p.amount || 0)
    });
  }
  for (const b of bookings) {
    rows.push({
      id: `booking-${b.id}`,
      type: b.status === "CONFIRMED" ? "BOOKING_CONFIRMED" : "BOOKING_PENDING",
      title: b.status === "CONFIRMED" ? "Reserva confirmada" : "Reserva pendiente",
      description: `${b.guests || 0} personas · ${b.location || "Lugar por confirmar"}`,
      createdAt: b.updatedAt || b.createdAt,
      conversationId: b.conversationId || null,
      amount: Number(b.total || 0)
    });
  }
  for (const o of outcomes) {
    rows.push({
      id: `outcome-${o.id}`,
      type: `OUTCOME_${o.outcome}`,
      title: `Resultado comercial: ${o.outcome}`,
      description: o.reason || "Resultado registrado por IA",
      createdAt: o.createdAt,
      conversationId: o.conversationId || null,
      amount: 0
    });
  }
  for (const c of conversations.slice(0, 30)) {
    if (c.aiNextActionCode || c.aiHandoffRequired) {
      rows.push({
        id: `conversation-${c.id}`,
        type: c.aiHandoffRequired ? "HANDOFF_REQUIRED" : "AI_ACTION",
        title: c.aiHandoffRequired ? "Intervención humana requerida" : "Acción IA detectada",
        description: c.aiNextAction || c.aiRecommendedAction || c.aiDecisionReason || "Revisar conversación",
        createdAt: c.updatedAt || c.lastMessageAt,
        conversationId: c.id,
        amount: Number(c.lead?.budget || 0)
      });
    }
  }
  for (const l of leads.slice(0, 30)) {
    rows.push({
      id: `lead-${l.id}`,
      type: `LEAD_${normalizeStage(l.status)}`,
      title: `Lead ${normalizeStage(l.status)}`,
      description: `${l.name || l.phone || "Cliente"} · ${l.interest || "Interés comercial"}`,
      createdAt: l.updatedAt || l.createdAt,
      conversationId: l.conversationId,
      amount: Number(l.budget || 0)
    });
  }
  return rows
    .filter((item) => item.createdAt)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 30);
}

export async function getCrmOperationalDashboard({ tenantId = null, superAdmin = false } = {}) {
  if (!tenantId && !superAdmin) {
    return {
      kpis: {}, revenue: {}, pipeline: [], priorities: [], activity: [], upcomingBookings: [], alerts: [], forecasts: {}
    };
  }

  const where = tenantId ? { tenantId } : {};
  const [conversations, leads, bookings, payments, outcomes] = await Promise.all([
    prisma.conversation.findMany({
      where,
      include: { contact: true, lead: true, tenant: true, assignedTo: true },
      orderBy: { updatedAt: "desc" },
      take: 250
    }),
    prisma.lead.findMany({ where, orderBy: { updatedAt: "desc" }, take: 250 }),
    prisma.booking.findMany({ where, orderBy: { date: "asc" }, take: 250 }),
    prisma.payment.findMany({ where, include: { lead: true, booking: true, conversation: { include: { contact: true } } }, orderBy: { createdAt: "desc" }, take: 250 }).catch(() => []),
    prisma.salesOutcome.findMany({ where, orderBy: { createdAt: "desc" }, take: 250 }).catch(() => [])
  ]);

  const now = new Date();
  const today = startOfDay(now);
  const month = startOfMonth(now);

  const paidPayments = payments.filter((p) => p.status === "PAID");
  const pendingPayments = payments.filter((p) => p.status === "PENDING");
  const confirmedBookings = bookings.filter((b) => ["CONFIRMED", "PAID", "BOOKED"].includes(String(b.status).toUpperCase()));
  const pendingBookings = bookings.filter((b) => ["PENDING", "PAYMENT_PENDING", "PARTIAL"].includes(String(b.status).toUpperCase()));

  const paidRevenue = sum(paidPayments, "amount");
  const pendingRevenue = sum(pendingPayments, "amount");
  const bookingRevenue = sum(bookings, "total");
  const leadRevenue = leads.reduce((acc, lead) => acc + moneyFromLead(lead), 0);
  const estimatedRevenue = Math.max(leadRevenue, bookingRevenue + pendingRevenue);

  const stageMap = new Map();
  const latestPaymentByLead = new Map();
  const latestBookingByConversation = new Map();
  for (const payment of payments) {
    if (payment.leadId && !latestPaymentByLead.has(payment.leadId)) latestPaymentByLead.set(payment.leadId, payment);
  }
  for (const booking of bookings) {
    if (booking.conversationId && !latestBookingByConversation.has(booking.conversationId)) latestBookingByConversation.set(booking.conversationId, booking);
  }

  const priorityRows = conversations.map((conversation) => {
    const lead = conversation.lead || leads.find((l) => l.conversationId === conversation.id) || null;
    const payment = lead?.id ? latestPaymentByLead.get(lead.id) : null;
    const booking = latestBookingByConversation.get(conversation.id) || null;
    const stage = statusFromRecords({ lead, booking, payment, conversation });
    const score = scoreOf({ lead, conversation });
    const amount = Number(payment?.amount || booking?.total || lead?.budget || 0);
    stageMap.set(stage, (stageMap.get(stage) || 0) + 1);
    return {
      conversationId: conversation.id,
      leadId: lead?.id || null,
      customer: conversation.contact?.name || conversation.contact?.username || conversation.contact?.externalId || lead?.name || "Cliente",
      channel: conversation.contact?.channel || "whatsapp",
      stage,
      score,
      amount,
      risk: conversation.aiHandoffRequired || score >= 85 ? "high" : score >= 60 ? "medium" : "low",
      nextAction: conversation.aiNextAction || conversation.aiRecommendedAction || nextActionFor(stage),
      lastMessageAt: conversation.lastMessageAt || conversation.updatedAt,
      paymentStatus: payment?.status || null,
      bookingStatus: booking?.status || null
    };
  }).sort((a, b) => (b.score - a.score) || (b.amount - a.amount));

  for (const lead of leads) {
    if (!conversations.some((c) => c.id === lead.conversationId)) {
      const stage = normalizeStage(lead.status);
      stageMap.set(stage, (stageMap.get(stage) || 0) + 1);
    }
  }

  const pipelineOrder = ["NEW", "CONTACTED", "QUALIFIED", "QUOTE_SENT", "NEGOTIATION", "READY_TO_CLOSE", "PAYMENT_PENDING", "PARTIAL_PAYMENT", "BOOKED", "PAID", "CANCELED", "REFUNDED"];
  const pipeline = pipelineOrder.map((stage) => ({
    stage,
    count: stageMap.get(stage) || 0,
    value: priorityRows.filter((row) => row.stage === stage).reduce((acc, row) => acc + Number(row.amount || 0), 0)
  })).filter((item) => item.count || ["QUOTE_SENT", "READY_TO_CLOSE", "PAYMENT_PENDING", "BOOKED", "PAID"].includes(item.stage));

  const activity = buildActivity({ conversations, leads, bookings, payments, outcomes });
  const hot = priorityRows.filter((row) => row.score >= 75 || ["READY_TO_CLOSE", "PAYMENT_PENDING", "QUOTE_SENT"].includes(row.stage));
  const atRisk = priorityRows.filter((row) => row.risk === "high");
  const stale = priorityRows.filter((row) => row.lastMessageAt && (now - new Date(row.lastMessageAt)) > 24 * 60 * 60 * 1000 && !["PAID", "BOOKED"].includes(row.stage));

  const alerts = [];
  if (pendingPayments.length) alerts.push({ type: "PAYMENT_PENDING", title: "Pagos pendientes", count: pendingPayments.length, message: "Dar seguimiento a links de pago pendientes." });
  if (pendingBookings.length) alerts.push({ type: "BOOKING_PENDING", title: "Reservas pendientes", count: pendingBookings.length, message: "Confirmar disponibilidad o pago asociado." });
  if (stale.length) alerts.push({ type: "STALE_LEADS", title: "Leads estancados", count: stale.length, message: "Ejecutar follow-up automático o intervención humana." });
  if (atRisk.length) alerts.push({ type: "HIGH_RISK", title: "Riesgo comercial alto", count: atRisk.length, message: "Priorizar conversaciones calientes con posible abandono." });

  return {
    kpis: {
      leads: leads.length,
      hotLeads: hot.length,
      conversations: conversations.length,
      readyToClose: priorityRows.filter((row) => row.stage === "READY_TO_CLOSE").length,
      paymentPending: pendingPayments.length,
      bookingsPending: pendingBookings.length,
      bookingsConfirmed: confirmedBookings.length,
      paidCount: paidPayments.length,
      averageCloseScore: priorityRows.length ? Math.round(priorityRows.reduce((acc, row) => acc + Number(row.score || 0), 0) / priorityRows.length) : 0,
      conversionRate: leads.length ? Number(((paidPayments.length + confirmedBookings.length) / leads.length * 100).toFixed(1)) : 0
    },
    revenue: {
      paid: paidRevenue,
      paidToday: sum(paidPayments.filter((p) => new Date(p.paidAt || p.createdAt) >= today), "amount"),
      paidMonth: sum(paidPayments.filter((p) => new Date(p.paidAt || p.createdAt) >= month), "amount"),
      pending: pendingRevenue,
      estimated: estimatedRevenue,
      bookings: bookingRevenue,
      pipeline: priorityRows.reduce((acc, row) => acc + Number(row.amount || 0), 0)
    },
    pipeline,
    priorities: priorityRows.slice(0, 12),
    activity,
    upcomingBookings: bookings.filter((b) => new Date(b.date) >= now && !["CANCELED", "REFUNDED"].includes(String(b.status).toUpperCase())).slice(0, 10),
    alerts,
    forecasts: {
      expectedRevenue: paidRevenue + pendingRevenue + hot.reduce((acc, row) => acc + Number(row.amount || 0) * Math.min(Number(row.score || 0), 100) / 100, 0),
      recoveryOpportunities: stale.length,
      humanActionsRequired: priorityRows.filter((row) => row.risk === "high" || row.stage === "READY_TO_CLOSE").length
    }
  };
}
