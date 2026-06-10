
function getUploadLimitByPlan(plan) {
  const normalized = String(plan || "").toUpperCase();

  // FREE = 150MB
  if (normalized.includes("FREE")) {
    return 150 * 1024 * 1024;
  }

  // BUSINESS = 350MB
  if (normalized.includes("BUSINESS")) {
    return 350 * 1024 * 1024;
  }

  // ENTERPRISE = 850MB
  if (normalized.includes("ENTERPRISE")) {
    return 850 * 1024 * 1024;
  }

  // Default
  return 150 * 1024 * 1024;
}

import { Router } from "express";
import multer from "multer";
import { prisma } from "../lib/db.js";
import { requireRole, ROLE_GROUPS } from "../middleware/tenant-access.js";
import { extractOnboardingKnowledge } from "../services/onboarding-intelligence.service.js";

export const onboardingRouter = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: getUploadLimitByPlan(plan), files: 8 },
  fileFilter(_req, file, cb) {
    const allowed = [
      "text/csv",
      "text/plain",
      "application/pdf",
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    ];
    const name = file.originalname.toLowerCase();
    if (allowed.includes(file.mimetype) || /\.(csv|txt|pdf|xls|xlsx)$/i.test(name)) return cb(null, true);
    cb(new Error("Formato no soportado. Usa CSV, Excel, PDF o TXT."));
  }
});

function cleanString(value) {
  const text = String(value ?? "").trim();
  return text || null;
}

function cleanManual(body = {}) {
  return {
    businessName: cleanString(body.businessName),
    industry: cleanString(body.industry),
    description: cleanString(body.description),
    tone: cleanString(body.tone),
    objective: cleanString(body.objective),
    restrictions: cleanString(body.restrictions)
  };
}

onboardingRouter.get("/onboarding/knowledge", requireRole(ROLE_GROUPS.MANAGERS), async (req, res) => {
  try {
    const [tenant, profile, products, rules, imports] = await Promise.all([
      prisma.tenant.findUnique({ where: { id: req.tenantId } }),
      prisma.tenantAiProfile.findFirst({ where: { tenantId: req.tenantId, isActive: true }, orderBy: { createdAt: "asc" } }),
      prisma.product.findMany({ where: { tenantId: req.tenantId }, orderBy: { updatedAt: "desc" }, take: 100 }),
      prisma.rule.findMany({ where: { tenantId: req.tenantId, isActive: true }, orderBy: [{ priority: "asc" }, { createdAt: "desc" }], take: 100 }),
      prisma.tenantOnboardingImport.findMany({ where: { tenantId: req.tenantId }, orderBy: { createdAt: "desc" }, take: 10 })
    ]);
    res.json({ tenant, profile, products, rules, imports });
  } catch (error) {
    console.error("Get onboarding knowledge error:", error);
    res.status(500).json({ error: "No se pudo cargar el onboarding" });
  }
});

onboardingRouter.post("/onboarding/profile", requireRole(ROLE_GROUPS.MANAGERS), async (req, res) => {
  try {
    const manual = cleanManual(req.body || {});
    const tenant = await prisma.tenant.update({
      where: { id: req.tenantId },
      data: {
        name: manual.businessName || undefined,
        industry: manual.industry || undefined,
        businessPrompt: manual.description || undefined,
        aiSettings: {
          tone: manual.tone,
          objective: manual.objective,
          restrictions: manual.restrictions
        }
      }
    });

    const profile = await prisma.tenantAiProfile.upsert({
      where: { tenantId_code: { tenantId: req.tenantId, code: "default" } },
      create: {
        tenantId: req.tenantId,
        code: "default",
        name: `IA ${tenant.name}`,
        industry: manual.industry,
        basePersona: manual.description,
        tone: manual.tone,
        objective: manual.objective,
        responseStyle: "breve, natural y orientado a acción",
        businessRules: manual.restrictions ? [manual.restrictions] : []
      },
      update: {
        name: `IA ${tenant.name}`,
        industry: manual.industry || undefined,
        basePersona: manual.description || undefined,
        tone: manual.tone || undefined,
        objective: manual.objective || undefined,
        businessRules: manual.restrictions ? [manual.restrictions] : undefined,
        isActive: true
      }
    });

    res.json({ tenant, profile });
  } catch (error) {
    console.error("Save onboarding profile error:", error);
    res.status(500).json({ error: "No se pudo guardar el perfil IA" });
  }
});

onboardingRouter.post("/onboarding/extract", requireRole(ROLE_GROUPS.MANAGERS), upload.array("files", 8), async (req, res) => {
  try {
    const manual = cleanManual(req.body || {});
    const extraction = await extractOnboardingKnowledge({ files: req.files || [], manual });
    const saved = await prisma.tenantOnboardingImport.create({
      data: {
        tenantId: req.tenantId,
        sourceType: "upload",
        fileNames: extraction.fileResults || [],
        rawText: extraction.rawText || null,
        extractedData: extraction,
        status: "DRAFT"
      }
    });
    res.json({ importId: saved.id, extraction });
  } catch (error) {
    console.error("Onboarding extract error:", error);
    res.status(500).json({ error: error.message || "No se pudo extraer información" });
  }
});

onboardingRouter.post("/onboarding/apply", requireRole(ROLE_GROUPS.MANAGERS), async (req, res) => {
  try {
    const { importId, extraction, replaceProducts = false, replaceFaqs = false } = req.body || {};
    const data = extraction || (importId
      ? (await prisma.tenantOnboardingImport.findFirst({ where: { id: importId, tenantId: req.tenantId } }))?.extractedData
      : null);

    if (!data) return res.status(400).json({ error: "No hay extracción para aplicar" });

    const result = await prisma.$transaction(async (tx) => {
      if (replaceProducts) await tx.product.deleteMany({ where: { tenantId: req.tenantId } });
      if (replaceFaqs) await tx.rule.deleteMany({ where: { tenantId: req.tenantId, trigger: { startsWith: "FAQ:" } } });

      const business = data.business || {};
      const policies = Array.isArray(data.policies) ? data.policies.filter(Boolean) : [];
      const faqs = Array.isArray(data.faqs) ? data.faqs.filter((x) => x?.question) : [];
      const products = Array.isArray(data.products) ? data.products.filter((x) => x?.name) : [];

      const tenant = await tx.tenant.update({
        where: { id: req.tenantId },
        data: {
          name: business.name || undefined,
          industry: business.industry || undefined,
          businessPrompt: business.description || data.summary || undefined,
          onboardingCompleted: true,
          onboardingState: data,
          aiSettings: {
            tone: data.suggestedTone || business.tone || null,
            objective: business.objective || null,
            policies
          }
        }
      });

      const profile = await tx.tenantAiProfile.upsert({
        where: { tenantId_code: { tenantId: req.tenantId, code: "default" } },
        create: {
          tenantId: req.tenantId,
          code: "default",
          name: `IA ${tenant.name}`,
          industry: business.industry,
          basePersona: business.description || data.summary,
          tone: data.suggestedTone || business.tone,
          objective: business.objective,
          responseStyle: "responder con claridad, brevedad y orientación comercial",
          businessRules: policies,
          knowledge: { faqs, productsSummary: products.slice(0, 20), source: "onboarding" },
          isActive: true
        },
        update: {
          name: `IA ${tenant.name}`,
          industry: business.industry || undefined,
          basePersona: business.description || data.summary || undefined,
          tone: data.suggestedTone || business.tone || undefined,
          objective: business.objective || undefined,
          businessRules: policies,
          knowledge: { faqs, productsSummary: products.slice(0, 20), source: "onboarding" },
          isActive: true
        }
      });

      let createdProducts = 0;
      for (const product of products.slice(0, 200)) {
        await tx.product.create({
          data: {
            tenantId: req.tenantId,
            name: String(product.name).trim(),
            description: product.description ? String(product.description).trim() : null,
            price: Number(product.price || 0),
            stock: Number.isFinite(Number(product.stock)) ? Number(product.stock) : 0,
            category: product.category ? String(product.category).trim() : null,
            location: product.location ? String(product.location).trim() : null,
            attributes: product.attributes && typeof product.attributes === "object" ? product.attributes : { source: "onboarding" }
          }
        });
        createdProducts += 1;
      }

      let createdFaqs = 0;
      for (const faq of faqs.slice(0, 100)) {
        await tx.rule.create({
          data: {
            tenantId: req.tenantId,
            name: `FAQ: ${String(faq.question).slice(0, 80)}`,
            trigger: `FAQ: ${String(faq.question).trim()}`,
            response: String(faq.answer || "Responder según información del negocio.").trim(),
            priority: 20,
            isActive: true
          }
        });
        createdFaqs += 1;
      }

      if (importId) {
        await tx.tenantOnboardingImport.updateMany({
          where: { id: importId, tenantId: req.tenantId },
          data: { status: "APPLIED", appliedAt: new Date() }
        });
      }

      return { tenant, profile, createdProducts, createdFaqs, policiesCount: policies.length };
    });

    res.json(result);
  } catch (error) {
    console.error("Apply onboarding error:", error);
    res.status(500).json({ error: "No se pudo aplicar el onboarding" });
  }
});
