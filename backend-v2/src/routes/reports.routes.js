import { Router } from "express";
import { getIndustryReports } from "../services/reporting.service.js";

export const reportsRouter = Router();

reportsRouter.get("/reports/overview", async (req, res, next) => {
  try {
    const tenantId = req.user?.role === "SUPER_ADMIN" && req.query?.tenantId
      ? String(req.query.tenantId)
      : req.tenantId;
    if (!tenantId) return res.status(401).json({ error: "Tenant requerido" });
    res.json(await getIndustryReports({ tenantId }));
  } catch (error) {
    next(error);
  }
});
