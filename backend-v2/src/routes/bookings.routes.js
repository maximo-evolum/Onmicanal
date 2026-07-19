import { Router } from "express";
import { prisma } from "../lib/db.js";
import { createBooking, getAvailableSlots } from "../services/booking.service.js";
import { requireRole, ROLE_GROUPS } from "../middleware/tenant-access.js";
import { redactCoreMetadataForViewer } from "../services/core-metadata-access.service.js";
import { createTenantNotification } from "../lib/notifications.js";

export const bookingsRouter = Router();

bookingsRouter.get("/bookings", async (req, res) => {
  try {
    const bookings = await prisma.booking.findMany({
      where: { tenantId: req.tenantId },
      orderBy: { date: "asc" },
      take: 100
    });
    res.json(await Promise.all(bookings.map((booking) => redactCoreMetadataForViewer({ tenantId: req.tenantId, role: req.user?.role, recordType: "booking", record: booking, key: "metadata" }))));
  } catch (error) {
    console.error("List bookings error:", error);
    res.status(500).json({ error: "No se pudieron obtener reservas" });
  }
});

bookingsRouter.get("/bookings/slots", async (req, res) => {
  const date = String(req.query.date || new Date().toISOString().slice(0, 10));
  res.json({ date, slots: getAvailableSlots({ date }) });
});

bookingsRouter.post("/bookings", requireRole(ROLE_GROUPS.STAFF), async (req, res) => {
  try {
    const { conversationId, name, phone, email, date, guests, location, total, notes, metadata } = req.body;
    if (!date || !guests) return res.status(400).json({ error: "date y guests son requeridos" });

    const booking = await createBooking({
      tenantId: req.tenantId,
      conversationId,
      name,
      phone,
      email,
      date,
      guests,
      location,
      total,
      notes,
      metadata
    });

    void createTenantNotification({
      tenantId: req.tenantId,
      title: "Nueva reserva o cita",
      body: `${name || "Cliente"} agendó para ${new Date(date).toLocaleString("es-CL")}.`,
      severity: "info",
      targetUrl: "/agenda",
      metadata: { notificationType: "booking", screen: "agenda", bookingId: booking.id }
    });

    res.json(await redactCoreMetadataForViewer({ tenantId: req.tenantId, role: req.user?.role, recordType: "booking", record: booking, key: "metadata" }));
  } catch (error) {
    console.error("Create booking error:", error);
    res.status(500).json({ error: "No se pudo crear la reserva" });
  }
});

bookingsRouter.patch("/bookings/:id", requireRole(ROLE_GROUPS.STAFF), async (req, res) => {
  try {
    const existing = await prisma.booking.findFirst({ where: { id: req.params.id, tenantId: req.tenantId } });
    if (!existing) return res.status(404).json({ error: "Reserva no encontrada" });

    const allowed = ["status", "name", "phone", "email", "date", "guests", "location", "total", "notes", "metadata"];
    const data = Object.fromEntries(Object.entries(req.body || {}).filter(([key]) => allowed.includes(key)));
    if (data.date) data.date = new Date(data.date);
    if (data.guests !== undefined) data.guests = Number(data.guests);
    if (data.total !== undefined) data.total = Number(data.total);
    if (data.metadata !== undefined) {
      const { resolveCoreMetadata } = await import("../services/core-metadata.service.js");
      const resolved = await resolveCoreMetadata({ tenantId: req.tenantId, recordType: "booking", metadata: data.metadata });
      data.metadata = resolved.metadata;
      data.schemaVersion = resolved.schemaVersion;
    }

    const updated = await prisma.booking.update({ where: { id: req.params.id }, data });
    res.json(await redactCoreMetadataForViewer({ tenantId: req.tenantId, role: req.user?.role, recordType: "booking", record: updated, key: "metadata" }));
  } catch (error) {
    console.error("Update booking error:", error);
    res.status(500).json({ error: "No se pudo actualizar la reserva" });
  }
});

// La IA no cobra ni genera links automáticamente. Este endpoint solo marca
// la reserva como lista para que un vendedor humano coordine el pago.
bookingsRouter.post("/bookings/:id/payment-ready", requireRole(ROLE_GROUPS.STAFF), async (req, res) => {
  try {
    const booking = await prisma.booking.findFirst({ where: { id: req.params.id, tenantId: req.tenantId } });
    if (!booking) return res.status(404).json({ error: "Reserva no encontrada" });

    const updated = await prisma.booking.update({
      where: { id: booking.id },
      data: {
        status: "READY_TO_PAY",
        notes: [booking.notes || "", "Cliente listo para coordinar pago. Vendedor humano debe continuar."].filter(Boolean).join("\n")
      }
    });

    if (booking.conversationId) {
      await prisma.conversation.update({
        where: { id: booking.conversationId },
        data: {
          mode: "HYBRID",
          priorityLabel: "high",
          priorityScore: 95,
          aiHandoffRequired: true,
          aiHandoffReason: "Reserva lista para pago: requiere vendedor humano",
          aiNextActionCode: "notify_seller_ready_to_close",
          aiNextAction: "Vendedor debe coordinar pago/reserva"
        }
      }).catch(() => null);
    }

    res.json({ booking: updated, message: "Reserva marcada como lista para pago humano." });
  } catch (error) {
    console.error("Payment ready error:", error);
    res.status(500).json({ error: "No se pudo marcar como listo para pago" });
  }
});
