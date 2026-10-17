/** Archivo: Expone las rutas HTTP del dominio realty intelligence y delega su lógica a servicios protegidos. */
import { Router } from "express";
import { loadBrokerAccessContext, requireBrokerAction } from "../services/broker-access.service.js";
import { randomUUID } from "node:crypto";
import { requireRole, ROLE_GROUPS } from "../middleware/tenant-access.js";
import { prisma } from "../lib/db.js";
import { realtyLeadScope, getRealtyIntelligence, getRealtyLeadMatches, getRealtyPropertyMatches } from "../services/realty-intelligence.service.js";

export const realtyIntelligenceRouter = Router();
realtyIntelligenceRouter.use(async (req, res, next) => {
  if (!/^\/realty\//i.test(req.path)) return next();
  try {
    req.brokerAccess = await loadBrokerAccessContext({ prisma, tenantId: req.tenantId, user: req.user });
    return requireBrokerAction("commercial", ["GET", "HEAD"].includes(req.method) ? "VIEW" : "CREATE")(req, res, next);
  } catch (error) { next(error); }
});

realtyIntelligenceRouter.get("/realty/intelligence", async (req, res) => {
  try {
    return res.json(await getRealtyIntelligence({ tenantId: req.tenantId, access: req.brokerAccess, sampleLimit: req.query.limit }));
  } catch (error) {
    console.error("Realty intelligence error:", error);
    return res.status(500).json({ error: "No se pudo generar la inteligencia inmobiliaria" });
  }
});

realtyIntelligenceRouter.get("/realty/leads/:leadId/matches", requireRole(ROLE_GROUPS.STAFF), async (req, res) => {
  try {
    const result = await getRealtyLeadMatches({ tenantId: req.tenantId, access: req.brokerAccess, leadId: req.params.leadId, limit: req.query.limit });
    if (!result) return res.status(404).json({ error: "Lead no encontrado" });
    return res.json(result);
  } catch (error) {
    console.error("Realty lead matching error:", error);
    return res.status(500).json({ error: "No se pudieron encontrar propiedades compatibles" });
  }
});

realtyIntelligenceRouter.get("/realty/properties/:propertyId/buyers", requireRole(ROLE_GROUPS.STAFF), async (req, res) => {
  try {
    const result = await getRealtyPropertyMatches({ tenantId: req.tenantId, access: req.brokerAccess, propertyId: req.params.propertyId, limit: req.query.limit });
    if (!result) return res.status(404).json({ error: "Propiedad no encontrada" });
    return res.json(result);
  } catch (error) {
    console.error("Realty property matching error:", error);
    return res.status(500).json({ error: "No se pudieron encontrar compradores compatibles" });
  }
});

realtyIntelligenceRouter.get("/realty/buyers", async (req, res, next) => {
  try {
    const buyers = await prisma.lead.findMany({ where: realtyLeadScope(req.tenantId, req.brokerAccess), orderBy: { updatedAt: "desc" }, take: 500 });
    res.set("Cache-Control", "no-store").json(buyers);
  } catch (error) { next(error); }
});

realtyIntelligenceRouter.post("/realty/buyers", requireRole(ROLE_GROUPS.STAFF), async (req, res) => {
  try {
    const name = String(req.body?.name || "").trim();
    const phone = String(req.body?.phone || "").trim();
    const email = String(req.body?.email || "").trim();
    const budget = Number(req.body?.budget || 0);
    const commune = String(req.body?.commune || "").trim();
    const propertyType = String(req.body?.propertyType || "").trim();
    const interest = String(req.body?.interest || "compra").trim();
    if (!name) return res.status(400).json({ error: "El nombre del comprador es requerido" });
    if (!Number.isFinite(budget) || budget <= 0) return res.status(400).json({ error: "El presupuesto debe ser un número mayor a cero" });

    const externalId = phone || email || `manual-buyer:${randomUUID()}`;
    const buyer = await prisma.$transaction(async (tx) => {
      const contact = await tx.contact.upsert({
        where: { tenantId_externalId_channel: { tenantId: req.tenantId, externalId, channel: "manual" } },
        update: {},
        create: { tenantId: req.tenantId, externalId, channel: "manual", name }
      });
      const conversation = await tx.conversation.create({
        data: { tenantId: req.tenantId, contactId: contact.id, assignedToId: req.user.id, status: "OPEN", mode: "HUMAN", priorityLabel: "medium", priorityScore: 40 }
      });
      return tx.lead.create({
        data: {
          tenantId: req.tenantId,
          conversationId: conversation.id,
          name,
          phone: phone || null,
          interest: interest || null,
          propertyType: propertyType || null,
          commune: commune || null,
          budget: budget || null,
          status: "NEW",
          customFields: { source: "manual_buyer_profile", email: email || null }
        }
      });
    });
    return res.status(201).json({ buyer });
  } catch (error) {
    console.error("Create realty buyer error:", error);
    return res.status(500).json({ error: "No se pudo crear el comprador" });
  }
});
