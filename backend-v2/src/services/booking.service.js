import { prisma } from "../lib/db.js";
export function getAvailableSlots({ date }) {
  // MVP: slots fijos. Luego se puede conectar a Google Calendar/Calendly.
  return ["12:00", "14:00", "16:00", "18:00", "20:00"].map((time) => ({ date, time, available: true }));
}

export async function createBooking({ tenantId, conversationId, name, phone, email, date, guests, location, total, notes }) {
  const booking = await prisma.booking.create({
    data: {
      tenantId,
      conversationId: conversationId || null,
      name: name || null,
      phone: phone || null,
      email: email || null,
      date: new Date(date),
      guests: Number(guests || 0),
      location: location || null,
      total: Number(total || 0),
      notes: notes || null,
      status: "PENDING"
    }
  });

  return booking;
}
