
import { Router } from "express";
import { prisma } from "../lib/db.js";
import { requireRole, ROLE_GROUPS } from "../middleware/tenant-access.js";
import {
  confirmPayment,
  createPaymentIntent,
  getPaymentMetrics,
  listPayments,
  PAYMENT_STATUS
} from "../services/payment.service.js";

export const paymentsRouter = Router();

function tenantWhere(req) {
  const requestedTenantId = req.query?.tenantId ? String(req.query.tenantId) : null;
  if (req.user?.role === "SUPER_ADMIN" && requestedTenantId) return requestedTenantId;
  return req.tenantId;
}

paymentsRouter.get("/payments", async (req, res, next) => {
  try {
    const tenantId = tenantWhere(req);
    const status = req.query?.status ? String(req.query.status) : null;
    const payments = await listPayments({ tenantId, status });
    res.json(payments);
  } catch (error) { next(error); }
});

paymentsRouter.get("/payments/metrics", async (req, res, next) => {
  try {
    const tenantId = tenantWhere(req);
    res.json(await getPaymentMetrics({ tenantId }));
  } catch (error) { next(error); }
});

paymentsRouter.post("/payments", requireRole(ROLE_GROUPS.MANAGERS), async (req, res, next) => {
  try {
    const tenantId = tenantWhere(req);
    const payment = await createPaymentIntent({
      tenantId,
      conversationId: req.body?.conversationId || null,
      leadId: req.body?.leadId || null,
      bookingId: req.body?.bookingId || null,
      amount: req.body?.amount,
      currency: req.body?.currency || "CLP",
      provider: req.body?.provider || "manual",
      description: req.body?.description || null,
      metadata: req.body?.metadata || null,
      expiresAt: req.body?.expiresAt || null
    });
    res.status(201).json(payment);
  } catch (error) { next(error); }
});

paymentsRouter.get("/payments/:paymentId", async (req, res, next) => {
  try {
    const tenantId = tenantWhere(req);
    const payment = await prisma.payment.findFirst({
      where: { id: req.params.paymentId, tenantId },
      include: { conversation: { include: { contact: true } }, lead: true, booking: true }
    });
    if (!payment) return res.status(404).json({ error: "Pago no encontrado" });
    res.json(payment);
  } catch (error) { next(error); }
});

paymentsRouter.post("/payments/:paymentId/confirm", requireRole(ROLE_GROUPS.MANAGERS), async (req, res, next) => {
  try {
    const tenantId = tenantWhere(req);
    const payment = await prisma.payment.findFirst({ where: { id: req.params.paymentId, tenantId } });
    if (!payment) return res.status(404).json({ error: "Pago no encontrado" });

    const updated = await confirmPayment({
      paymentId: payment.id,
      externalId: req.body?.externalId || null,
      metadata: req.body?.metadata || { confirmedBy: req.user?.id || null },
      status: req.body?.status || PAYMENT_STATUS.PAID
    });
    res.json(updated);
  } catch (error) { next(error); }
});

paymentsRouter.post("/payments/:paymentId/cancel", requireRole(ROLE_GROUPS.MANAGERS), async (req, res, next) => {
  try {
    const tenantId = tenantWhere(req);
    const payment = await prisma.payment.findFirst({ where: { id: req.params.paymentId, tenantId } });
    if (!payment) return res.status(404).json({ error: "Pago no encontrado" });

    const updated = await prisma.payment.update({
      where: { id: payment.id },
      data: { status: "CANCELED", metadata: { ...(payment.metadata || {}), canceledBy: req.user?.id || null } }
    });

    if (payment.leadId) {
      await prisma.lead.update({ where: { id: payment.leadId }, data: { status: "NEGOTIATION" } }).catch(() => null);
    }
    if (payment.bookingId) {
      await prisma.booking.update({ where: { id: payment.bookingId }, data: { status: "CANCELED" } }).catch(() => null);
    }

    res.json(updated);
  } catch (error) { next(error); }
});

// Webhook genérico preparado para proveedores reales.
// Para MercadoPago/Stripe/Transbank se debe mapear externalId -> payment.id o metadata.providerPaymentId.
paymentsRouter.post("/payments/webhook/:provider", async (req, res, next) => {
  try {
    const provider = String(req.params.provider || "manual").toLowerCase();
    const externalId = req.body?.externalId || req.body?.id || req.body?.data?.id || null;
    const status = String(req.body?.status || req.body?.type || "").toLowerCase();

    const payment = externalId
      ? await prisma.payment.findFirst({ where: { provider, externalId } })
      : req.body?.paymentId
        ? await prisma.payment.findUnique({ where: { id: req.body.paymentId } })
        : null;

    if (!payment) {
      return res.json({ ok: true, ignored: true, reason: "payment_not_found" });
    }

    if (["approved", "paid", "payment_intent.succeeded", "success"].includes(status)) {
      const updated = await confirmPayment({
        paymentId: payment.id,
        externalId,
        metadata: { webhook: req.body, provider },
        status: PAYMENT_STATUS.PAID
      });
      return res.json({ ok: true, payment: updated });
    }

    res.json({ ok: true, ignored: true, status });
  } catch (error) { next(error); }
});
