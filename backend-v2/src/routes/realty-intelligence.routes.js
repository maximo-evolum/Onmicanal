/** Archivo: Expone las rutas HTTP del dominio realty intelligence y delega su lógica a servicios protegidos. */
import { Router } from "express";
import { loadBrokerAccessContext, requireBrokerAction } from "../services/broker-access.service.js";
import { randomUUID } from "node:crypto";
import { requireRole, ROLE_GROUPS } from "../middleware/tenant-access.js";
import { prisma } from "../lib/db.js";
import { recordAuditLog } from "../lib/audit.js";
import { brokerRecordWhere } from "../services/broker-access.service.js";
import { realtyLeadScope, getRealtyIntelligence, getRealtyLeadMatches, getRealtyPropertyMatches, scoreRealtyLeadMatch } from "../services/realty-intelligence.service.js";
import { brokerMatchActionPayload, buildBrokerMatchActionData, validateBrokerMatchAction } from "../services/broker-match-actions.service.js";

export const realtyIntelligenceRouter = Router();

function dataOf(record) {
  return record?.data && typeof record.data === "object" && !Array.isArray(record.data) ? record.data : {};
}

async function resolveMatchContext(req, { leadId, propertyId }) {
  const [lead, property] = await Promise.all([
    prisma.lead.findFirst({ where: realtyLeadScope(req.tenantId, req.brokerAccess, { id: String(leadId) }) }),
    prisma.industryRecord.findFirst({ where: brokerRecordWhere({ tenantId: req.tenantId, brokerAccess: req.brokerAccess, method: "POST" }, { id: String(propertyId), recordType: "property", status: { not: "ARCHIVED" } }) })
  ]);
  if (!lead || !property) {
    const error = new Error("El comprador o la propiedad no pertenecen a tu alcance autorizado.");
    error.status = 404;
    throw error;
  }
  return { lead, property, match: scoreRealtyLeadMatch(lead, property) };
}
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

// Historial interno de acciones sobre las coincidencias de un comprador. No
// consulta acciones de otro lead aunque el usuario conozca un identificador.
realtyIntelligenceRouter.get("/realty/leads/:leadId/match-actions", requireRole(ROLE_GROUPS.STAFF), async (req, res) => {
  try {
    const lead = await prisma.lead.findFirst({ where: realtyLeadScope(req.tenantId, req.brokerAccess, { id: req.params.leadId }), select: { id: true } });
    if (!lead) return res.status(404).json({ error: "Comprador no encontrado dentro de tu alcance." });
    const records = await prisma.industryRecord.findMany({
      where: brokerRecordWhere(req, { recordType: "broker_match_action" }),
      orderBy: { createdAt: "desc" },
      take: 500
    });
    return res.json({ actions: records.filter((record) => String(dataOf(record).leadId || "") === lead.id).map(brokerMatchActionPayload) });
  } catch (error) {
    console.error("Broker match actions list error:", error);
    return res.status(500).json({ error: "No se pudo cargar el historial de matching." });
  }
});

// Registra una intención o decisión interna. La solicitud de visita queda
// pendiente de confirmación humana: no agenda ni contacta a nadie.
realtyIntelligenceRouter.post("/realty/matches/actions", requireRole(ROLE_GROUPS.STAFF), async (req, res) => {
  try {
    const leadId = String(req.body?.leadId || "").trim();
    const propertyId = String(req.body?.propertyId || "").trim();
    const { lead, property, match } = await resolveMatchContext(req, { leadId, propertyId });
    const validation = validateBrokerMatchAction(req.body, match);
    if (!validation.ok) return res.status(422).json({ error: validation.error });
    const data = buildBrokerMatchActionData({ leadId: lead.id, propertyId: property.id, validation, match, userId: req.user.id });
    const record = await prisma.industryRecord.create({
      data: {
        tenantId: req.tenantId,
        assignedToId: req.user.id,
        recordType: "broker_match_action",
        title: `${validation.label} · ${lead.name || "Comprador"} · ${property.title}`.slice(0, 240),
        status: validation.status,
        data
      }
    });
    await recordAuditLog(req, "BROKER_MATCH_ACTION_RECORDED", "broker_match_action", record.id, {
      leadId: lead.id,
      propertyId: property.id,
      action: validation.action,
      score: data.score,
      externalContactExecuted: false,
      visitConfirmed: false
    });
    return res.status(201).json({
      action: brokerMatchActionPayload(record),
      notice: validation.action === "REQUEST_VISIT"
        ? "La solicitud quedó registrada para revisión interna. No se agendó una visita ni se contactó al comprador."
        : "La acción de matching quedó registrada internamente; no se envió ningún mensaje externo."
    });
  } catch (error) {
    if (error?.status === 404) return res.status(404).json({ error: error.message });
    console.error("Broker match action error:", error);
    return res.status(500).json({ error: "No se pudo registrar la acción de matching." });
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
