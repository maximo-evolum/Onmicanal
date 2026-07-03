import { Router } from "express";
import { prisma } from "../lib/db.js";
import { MODULES } from "../lib/modules.js";
import { getTenantModules } from "../services/tenant-modules.service.js";

export const searchRouter = Router();

function textContains(value) {
  return { contains: value };
}

function result(type, item) {
  return { type, ...item };
}

function contactLabel(contact) {
  if (!contact) return "Sin contacto";
  return contact.name || contact.username || contact.externalId || "Sin contacto";
}

searchRouter.get("/search", async (req, res) => {
  try {
    const query = String(req.query.q || "").trim();
    const limit = Math.min(Math.max(Number(req.query.limit || 8), 1), 25);

    if (!query) return res.json({ query, results: [] });

    const tenantId = req.tenantId;
    const enabledModules = req.user?.role === "SUPER_ADMIN"
      ? Object.values(MODULES)
      : await getTenantModules(tenantId);
    const canUse = (module) => enabledModules.includes(module);

    const jobs = [];

    if (canUse(MODULES.INBOX)) {
      jobs.push(
        prisma.contact.findMany({
          where: {
            tenantId,
            OR: [
              { name: textContains(query) },
              { externalId: textContains(query) },
              { username: textContains(query) },
              { channel: textContains(query) }
            ]
          },
          orderBy: { updatedAt: "desc" },
          take: limit
        }).then((items) => items.map((contact) => result("contact", {
          id: contact.id,
          title: contactLabel(contact),
          subtitle: `${contact.channel} / ${contact.externalId}`,
          href: `/inbox?contactId=${contact.id}`,
          metadata: { channel: contact.channel, externalId: contact.externalId }
        }))),
        prisma.message.findMany({
          where: { tenantId, content: textContains(query) },
          include: {
            conversation: {
              select: {
                id: true,
                status: true,
                contact: { select: { id: true, name: true, username: true, externalId: true, channel: true } }
              }
            }
          },
          orderBy: { createdAt: "desc" },
          take: limit
        }).then((items) => items.map((message) => result("message", {
          id: message.id,
          title: contactLabel(message.conversation?.contact),
          subtitle: message.content.slice(0, 140),
          href: `/inbox?conversationId=${message.conversationId}`,
          metadata: {
            conversationId: message.conversationId,
            channel: message.channel,
            direction: message.direction,
            status: message.status
          }
        })))
      );
    }

    if (canUse(MODULES.SALES)) {
      jobs.push(
        prisma.lead.findMany({
          where: {
            tenantId,
            OR: [
              { name: textContains(query) },
              { phone: textContains(query) },
              { interest: textContains(query) },
              { propertyType: textContains(query) },
              { commune: textContains(query) },
              { urgency: textContains(query) },
              { status: textContains(query) },
              { notes: textContains(query) }
            ]
          },
          orderBy: { updatedAt: "desc" },
          take: limit
        }).then((items) => items.map((lead) => result("lead", {
          id: lead.id,
          title: lead.name || lead.phone || lead.interest || "Lead",
          subtitle: `${lead.status} / ${lead.commune || "sin comuna"}`,
          href: `/pipeline?leadId=${lead.id}`,
          metadata: { status: lead.status, closeProbability: lead.closeProbability }
        })))
      );
    }

    if (canUse(MODULES.BOOKINGS)) {
      jobs.push(
        prisma.booking.findMany({
          where: {
            tenantId,
            OR: [
              { name: textContains(query) },
              { phone: textContains(query) },
              { email: textContains(query) },
              { location: textContains(query) },
              { status: textContains(query) },
              { notes: textContains(query) }
            ]
          },
          orderBy: { date: "asc" },
          take: limit
        }).then((items) => items.map((booking) => result("booking", {
          id: booking.id,
          title: booking.name || "Reserva",
          subtitle: `${booking.status} / ${booking.location || "sin lugar"}`,
          href: `/agenda?bookingId=${booking.id}`,
          metadata: { date: booking.date, guests: booking.guests, status: booking.status }
        })))
      );
    }

    if (canUse(MODULES.PAYMENTS)) {
      jobs.push(
        prisma.payment.findMany({
          where: {
            tenantId,
            OR: [
              { provider: textContains(query) },
              { status: textContains(query) },
              { currency: textContains(query) },
              { description: textContains(query) },
              { externalId: textContains(query) }
            ]
          },
          orderBy: { createdAt: "desc" },
          take: limit
        }).then((items) => items.map((payment) => result("payment", {
          id: payment.id,
          title: payment.description || `Pago ${payment.status}`,
          subtitle: `${payment.currency} ${payment.amount} / ${payment.provider}`,
          href: `/pagos?paymentId=${payment.id}`,
          metadata: { status: payment.status, amount: payment.amount, currency: payment.currency }
        })))
      );
    }

    if (canUse(MODULES.MARKETING)) {
      jobs.push(
        prisma.campaign.findMany({
          where: {
            tenantId,
            OR: [
              { name: textContains(query) },
              { segment: textContains(query) },
              { template: textContains(query) },
              { status: textContains(query) }
            ]
          },
          orderBy: { updatedAt: "desc" },
          take: limit
        }).then((items) => items.map((campaign) => result("campaign", {
          id: campaign.id,
          title: campaign.name,
          subtitle: `${campaign.status} / ${campaign.segment}`,
          href: `/campanas?campaignId=${campaign.id}`,
          metadata: { status: campaign.status, scheduledAt: campaign.scheduledAt }
        })))
      );
    }

    jobs.push(
      prisma.industryRecord.findMany({
        where: {
          tenantId,
          NOT: { recordType: "notification" },
          OR: [
            { title: textContains(query) },
            { recordType: textContains(query) },
            { status: textContains(query) }
          ]
        },
        orderBy: { updatedAt: "desc" },
        take: limit
      }).then((items) => items.map((recordItem) => result("industry_record", {
        id: recordItem.id,
        title: recordItem.title,
        subtitle: `${recordItem.recordType} / ${recordItem.status}`,
        href: `/crm-principal?recordId=${recordItem.id}`,
        metadata: {
          recordType: recordItem.recordType,
          status: recordItem.status,
          assignedToId: recordItem.assignedToId
        }
      })))
    );

    const groups = await Promise.all(jobs);
    const results = groups
      .flat()
      .sort((a, b) => String(a.title).localeCompare(String(b.title)))
      .slice(0, limit * 6);

    res.json({ query, results });
  } catch (error) {
    console.error("Search error:", error);
    res.status(500).json({ error: "No se pudo ejecutar la busqueda" });
  }
});
