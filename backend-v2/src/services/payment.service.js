
import { prisma } from "../lib/db.js";
import { env } from "../lib/env.js";

export const PAYMENT_STATUS = Object.freeze({
  PENDING: "PENDING",
  PARTIAL: "PARTIAL",
  PAID: "PAID",
  FAILED: "FAILED",
  CANCELED: "CANCELED",
  REFUNDED: "REFUNDED"
});

export const FINANCIAL_STAGES = Object.freeze({
  QUOTE_SENT: "QUOTE_SENT",
  PAYMENT_PENDING: "PAYMENT_PENDING",
  PARTIAL_PAYMENT: "PARTIAL_PAYMENT",
  PAID: "PAID",
  BOOKED: "BOOKED",
  CANCELED: "CANCELED",
  REFUNDED: "REFUNDED"
});

function cleanText(value) {
  const text = String(value ?? "").trim();
  return text || null;
}

function toNumber(value, fallback = 0) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function buildManualPaymentUrl(payment) {
  const base = process.env.PAYMENT_BASE_URL || process.env.FRONTEND_ORIGIN || "";
  if (!base || base === "*") return null;
  return `${String(base).replace(/\/$/, "")}/pay/${payment.id}`;
}

function normalizeProvider(provider) {
  return String(provider || env.paymentProvider || "manual").trim().toLowerCase();
}

function assertProviderAvailable(provider) {
  const normalized = normalizeProvider(provider);
  if (normalized === "manual") return normalized;

  const configured = {
    mercadopago: Boolean(process.env.MERCADOPAGO_ACCESS_TOKEN),
    stripe: Boolean(process.env.STRIPE_SECRET_KEY),
    transbank: Boolean(process.env.TRANSBANK_COMMERCE_CODE && process.env.TRANSBANK_API_KEY)
  };

  if (!configured[normalized]) {
    throw new Error(`Proveedor de pago "${normalized}" no configurado. Usa provider=manual o configura el conector real.`);
  }

  throw new Error(`Proveedor de pago "${normalized}" tiene credenciales, pero el conector de cobro real aún no está implementado.`);
}

export async function ensureBookingForPayment({ tenantId, conversationId = null, lead = null, quote = null, input = {} }) {
  if (input.bookingId) {
    return prisma.booking.findFirst({ where: { id: input.bookingId, tenantId } });
  }

  const guests = Number(input.guests || quote?.guests || 0);
  const rawDate = input.date || quote?.date || null;
  const location = input.location || quote?.location || lead?.commune || null;
  const total = toNumber(input.amount || quote?.total || lead?.budget || 0);

  if (!guests || !rawDate) return null;

  let date = new Date(rawDate);
  if (Number.isNaN(date.getTime())) {
    // Si viene "sábado 13", usamos fecha futura aproximada para no romper. El vendedor puede corregir.
    date = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  }

  const existing = conversationId ? await prisma.booking.findFirst({
    where: { tenantId, conversationId, status: { in: ["PENDING", "PAYMENT_PENDING", "PARTIAL", "CONFIRMED"] } },
    orderBy: { createdAt: "desc" }
  }).catch(() => null) : null;

  if (existing) return existing;

  return prisma.booking.create({
    data: {
      tenantId,
      conversationId,
      name: input.name || lead?.name || null,
      phone: input.phone || lead?.phone || null,
      email: input.email || null,
      date,
      guests,
      location,
      total,
      status: "PAYMENT_PENDING",
      notes: input.notes || "Reserva preliminar creada para portal de pagos"
    }
  });
}

export async function createPaymentIntent({
  tenantId,
  conversationId = null,
  leadId = null,
  bookingId = null,
  amount,
  currency = "CLP",
  provider = null,
  description = null,
  metadata = null,
  expiresAt = null
}) {
  if (!tenantId) throw new Error("tenantId requerido");
  const numericAmount = toNumber(amount);
  if (!numericAmount || numericAmount <= 0) throw new Error("Monto inválido para pago");

  const normalizedProvider = assertProviderAvailable(provider);

  const lead = leadId
    ? await prisma.lead.findFirst({ where: { id: leadId, tenantId } }).catch(() => null)
    : conversationId
      ? await prisma.lead.findUnique({ where: { conversationId } }).catch(() => null)
      : null;

  const booking = await ensureBookingForPayment({
    tenantId,
    conversationId,
    lead,
    input: { bookingId, amount: numericAmount }
  }).catch(() => null);

  const payment = await prisma.payment.create({
    data: {
      tenantId,
      conversationId,
      leadId: lead?.id || leadId || null,
      bookingId: booking?.id || bookingId || null,
      amount: numericAmount,
      currency,
      provider: normalizedProvider,
      status: PAYMENT_STATUS.PENDING,
      description: cleanText(description) || "Pago pendiente",
      expiresAt: expiresAt ? new Date(expiresAt) : null,
      metadata: { ...(metadata || {}), providerMode: normalizedProvider === "manual" ? "manual" : "external" }
    },
    include: { tenant: true, conversation: { include: { contact: true } }, lead: true, booking: true }
  });

  const paymentUrl = buildManualPaymentUrl(payment);
  const updated = paymentUrl
    ? await prisma.payment.update({
        where: { id: payment.id },
        data: { paymentUrl },
        include: { tenant: true, conversation: { include: { contact: true } }, lead: true, booking: true }
      })
    : payment;

  await markPaymentPending({ payment: updated });

  return updated;
}

export async function markPaymentPending({ payment }) {
  const notes = `Pago pendiente generado por $${Number(payment.amount || 0).toLocaleString("es-CL")} ${payment.currency || "CLP"}`;

  if (payment.leadId) {
    await prisma.lead.update({
      where: { id: payment.leadId },
      data: {
        status: FINANCIAL_STAGES.PAYMENT_PENDING,
        budget: Math.round(Number(payment.amount || 0)),
        closeProbability: 92,
        closeReason: notes,
        notes
      }
    }).catch(() => null);
  }

  if (payment.conversationId) {
    await prisma.conversation.update({
      where: { id: payment.conversationId },
      data: {
        aiNextActionCode: FINANCIAL_STAGES.PAYMENT_PENDING,
        aiNextAction: "Enviar link de pago y dar seguimiento hasta confirmar reserva.",
        aiDecisionLabel: "PAYMENT_PENDING",
        aiCloseScore: 95,
        aiHandoffRequired: true,
        aiHandoffReason: "Pago pendiente generado",
        decisionSummary: notes
      }
    }).catch(() => null);
  }

  if (payment.bookingId) {
    await prisma.booking.update({
      where: { id: payment.bookingId },
      data: { status: "PAYMENT_PENDING", total: payment.amount }
    }).catch(() => null);
  }
}

export async function confirmPayment({ paymentId, externalId = null, metadata = null, status = PAYMENT_STATUS.PAID }) {
  const payment = await prisma.payment.update({
    where: { id: paymentId },
    data: {
      status,
      externalId: externalId || undefined,
      paidAt: status === PAYMENT_STATUS.PAID ? new Date() : undefined,
      metadata: metadata || undefined
    },
    include: { tenant: true, conversation: { include: { contact: true } }, lead: true, booking: true }
  });

  if (status === PAYMENT_STATUS.PAID) {
    if (payment.leadId) {
      await prisma.lead.update({
        where: { id: payment.leadId },
        data: {
          status: FINANCIAL_STAGES.PAID,
          closeProbability: 100,
          closeReason: "Pago confirmado",
          nextFollowUpAt: null
        }
      }).catch(() => null);
    }

    if (payment.conversationId) {
      await prisma.conversation.update({
        where: { id: payment.conversationId },
        data: {
          aiNextActionCode: FINANCIAL_STAGES.PAID,
          aiNextAction: "Confirmar reserva y enviar detalles finales al cliente.",
          aiDecisionLabel: "PAID",
          aiCloseScore: 100,
          aiHandoffRequired: false,
          aiHandoffReason: null,
          decisionSummary: "Pago confirmado"
        }
      }).catch(() => null);
    }

    if (payment.bookingId) {
      await prisma.booking.update({
        where: { id: payment.bookingId },
        data: { status: "CONFIRMED", total: payment.amount }
      }).catch(() => null);
    }

    await prisma.salesOutcome.create({
      data: {
        tenantId: payment.tenantId,
        conversationId: payment.conversationId || "",
        leadId: payment.leadId || null,
        outcome: "PAID",
        reason: "Pago confirmado desde Payment Engine",
        closeScore: 100,
        industry: "payments"
      }
    }).catch(() => null);
  }

  return payment;
}

export async function listPayments({ tenantId, status = null, take = 100 } = {}) {
  return prisma.payment.findMany({
    where: {
      tenantId,
      ...(status && status !== "all" ? { status } : {})
    },
    include: {
      conversation: { include: { contact: true } },
      lead: true,
      booking: true
    },
    orderBy: { createdAt: "desc" },
    take
  });
}

export async function getPaymentMetrics({ tenantId }) {
  const payments = await prisma.payment.findMany({ where: { tenantId } });
  const total = payments.reduce((sum, p) => sum + Number(p.amount || 0), 0);
  const paid = payments.filter((p) => p.status === PAYMENT_STATUS.PAID);
  const pending = payments.filter((p) => p.status === PAYMENT_STATUS.PENDING);
  const paidTotal = paid.reduce((sum, p) => sum + Number(p.amount || 0), 0);
  const pendingTotal = pending.reduce((sum, p) => sum + Number(p.amount || 0), 0);

  return {
    count: payments.length,
    total,
    paid: paid.length,
    paidTotal,
    pending: pending.length,
    pendingTotal,
    conversionRate: payments.length ? Math.round((paid.length / payments.length) * 100) : 0
  };
}
