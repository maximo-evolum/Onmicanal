import { Router } from "express";
import {
  buildBalancedAssignments,
} from "../lib/industries.js";
import { getAnyIndustryTemplate, getTemplateModules, listAllIndustryTemplates } from "../services/industry-templates.service.js";

export const industriesRouter = Router();

industriesRouter.get("/industries/templates", async (_req, res) => {
  res.json({ templates: await listAllIndustryTemplates() });
});

industriesRouter.get("/industries/current", async (req, res) => {
  const tenant = req.tenant || {};
  const template = await getAnyIndustryTemplate(tenant.industry);
  res.json({
    tenantId: req.tenantId,
    industry: tenant.industry || template.name,
    template,
    modulesForPlan: getTemplateModules(template, tenant.plan || "STARTER")
  });
});

industriesRouter.post("/industries/assignments/balance", (req, res) => {
  const items = Array.isArray(req.body?.items) ? req.body.items : [];
  const assignees = Array.isArray(req.body?.assignees) ? req.body.assignees : [];
  res.json({
    mode: "balanced_round_robin",
    assignments: buildBalancedAssignments(items, assignees)
  });
});
