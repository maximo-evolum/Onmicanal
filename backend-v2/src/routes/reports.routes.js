import { Router } from "express";
import { getIndustryReports } from "../services/reporting.service.js";
import { buildExecutiveReportPdf } from "../lib/executive-report-pdf.js";

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

reportsRouter.get("/reports/executive.pdf", async (req, res, next) => {
  try {
    const tenantId = req.user?.role === "SUPER_ADMIN" && req.query?.tenantId
      ? String(req.query.tenantId)
      : req.tenantId;
    if (!tenantId) return res.status(401).json({ error: "Tenant requerido" });

    const report = await getIndustryReports({ tenantId });
    const pdf = buildExecutiveReportPdf(report);
    const date = new Date().toISOString().slice(0, 10);
    res.set({
      "Content-Type": "application/pdf",
      "Content-Length": String(pdf.length),
      "Content-Disposition": `attachment; filename=\"evolum-reporte-ejecutivo-${date}.pdf\"`,
      "Cache-Control": "private, no-store"
    });
    res.send(pdf);
  } catch (error) {
    next(error);
  }
});
