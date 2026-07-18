import { Router } from "express";
import { requireRole, ROLE_GROUPS } from "../middleware/tenant-access.js";
import { getRealtyIntelligence, getRealtyLeadMatches } from "../services/realty-intelligence.service.js";

export const realtyIntelligenceRouter = Router();

realtyIntelligenceRouter.get("/realty/intelligence", async (req, res) => {
  try {
    return res.json(await getRealtyIntelligence({ tenantId: req.tenantId, sampleLimit: req.query.limit }));
  } catch (error) {
    console.error("Realty intelligence error:", error);
    return res.status(500).json({ error: "No se pudo generar la inteligencia inmobiliaria" });
  }
});

realtyIntelligenceRouter.get("/realty/leads/:leadId/matches", requireRole(ROLE_GROUPS.STAFF), async (req, res) => {
  try {
    const result = await getRealtyLeadMatches({ tenantId: req.tenantId, leadId: req.params.leadId, limit: req.query.limit });
    if (!result) return res.status(404).json({ error: "Lead no encontrado" });
    return res.json(result);
  } catch (error) {
    console.error("Realty lead matching error:", error);
    return res.status(500).json({ error: "No se pudieron encontrar propiedades compatibles" });
  }
});
