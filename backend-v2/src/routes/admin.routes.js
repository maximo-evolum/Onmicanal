import bcrypt from "bcryptjs";
import { Router } from "express";
import multer from "multer";
import { prisma } from "../lib/db.js";
import { requireRole } from "../middleware/tenant-access.js";
import { PLAN_DEFINITIONS, normalizePlanCode } from "../lib/modules.js";
import { ensureTenantSubscriptionAndModules, getTenantModules, setTenantModules } from "../services/tenant-modules.service.js";
import { extractOnboardingKnowledge } from "../services/onboarding-intelligence.service.js";

export const adminRouter = Router();

adminRouter.use(requireRole("SUPER_ADMIN"));

function makeSlug(value) {
  return String(value || "workspace")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "") || "workspace";
}

async function uniqueSlug(base) {
  const cleanBase = makeSlug(base);
  let slug = cleanBase;
  let suffix = 1;

  while (await prisma.tenant.findUnique({ where: { slug } })) {
    suffix += 1;
    slug = `${cleanBase}-${suffix}`;
  }

  return slug;
}

async function hashPassword(password) {
  return bcrypt.hash(password, 10);
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024, files: 8 },
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

function cleanManual(body = {}) {
  return {
    businessName: cleanText(body.businessName),
    industry: cleanText(body.industry),
    description: cleanText(body.description),
    tone: cleanText(body.tone),
    objective: cleanText(body.objective),
    restrictions: cleanText(body.restrictions)
  };
}

function includeAdminTenant() {
  return {
    workspaceUsers: {
      select: { id: true, name: true, email: true, role: true, isActive: true },
      orderBy: { createdAt: "desc" }
    },
    tenantModules: { orderBy: { module: "asc" } },
    subscriptions: { orderBy: { createdAt: "desc" }, take: 1 },
    aiProfiles: { orderBy: [{ isActive: "desc" }, { createdAt: "asc" }] },
    channelConfigs: { orderBy: [{ channel: "asc" }, { createdAt: "asc" }] },
    onboardingImports: { orderBy: { createdAt: "desc" }, take: 5 }
  };
}

const VALID_ROLES = new Set(["OWNER", "ADMIN", "AGENT", "SELLER", "VIEWER"]);

function cleanText(value) {
  const text = String(value ?? "").trim();
  return text || null;
}

function cleanEmail(value) {
  return String(value ?? "").trim().toLowerCase();
}

function cleanOptionalUnique(value) {
  const text = cleanText(value);
  return text || null;
}

function adminError(res, error, fallback = "Error en el panel de desarrollador") {
  console.error(fallback, error);

  if (error?.code === "P2002") {
    const fields = Array.isArray(error?.meta?.target) ? error.meta.target.join(", ") : String(error?.meta?.target || "campo único");
    return res.status(409).json({ error: `Ya existe un registro con ese ${fields}` });
  }

  if (error?.code === "P2025") {
    return res.status(404).json({ error: "Registro no encontrado" });
  }

  return res.status(500).json({
    error: fallback,
    detail: process.env.NODE_ENV === "production" ? undefined : error?.message
  });
}

async function getFullTenant(tenantId) {
  return prisma.tenant.findUnique({ where: { id: tenantId }, include: includeAdminTenant() });
}

adminRouter.get("/admin/tenants", async (_req, res) => {
  try {
    const tenants = await prisma.tenant.findMany({
      orderBy: { createdAt: "desc" },
      include: includeAdminTenant()
    });
    res.json(tenants);
  } catch (error) {
    return adminError(res, error, "No se pudieron cargar los clientes");
  }
});

adminRouter.post("/admin/tenants", async (req, res) => {
  try {
    const {
      name,
      slug,
      type = "BUSINESS",
      industry = "",
      plan = "STARTER",
      ownerName,
      ownerEmail,
      ownerPassword,
      whatsappPhoneNumberId,
      whatsappBusinessAccountId,
      whatsappDisplayNumber,
      metaAccessToken,
      metaAppSecret,
      verifyToken,
      instagramBusinessAccountId,
      instagramPageId
    } = req.body || {};

    const tenantName = cleanText(name);
    const ownerFullName = cleanText(ownerName);
    const normalizedEmail = cleanEmail(ownerEmail);

    if (!tenantName || !ownerFullName || !normalizedEmail) {
      return res.status(400).json({ error: "Nombre del negocio, nombre del owner y email del owner son requeridos" });
    }

    if (!normalizedEmail.includes("@")) {
      return res.status(400).json({ error: "El email del owner no es válido" });
    }

    const existingUser = await prisma.workspaceUser.findUnique({ where: { email: normalizedEmail } });
    if (existingUser) return res.status(409).json({ error: "Ya existe un usuario con ese email" });

    const planCode = normalizePlanCode(plan);
    const finalSlug = slug ? await uniqueSlug(slug) : await uniqueSlug(tenantName);

    const tenant = await prisma.$transaction(async (tx) => {
      const createdTenant = await tx.tenant.create({
        data: {
          name: tenantName,
          slug: finalSlug,
          type: cleanText(type) || "BUSINESS",
          industry: cleanText(industry),
          plan: planCode,
          businessPrompt: `Negocio ${tenantName}${cleanText(industry) ? ` del rubro ${cleanText(industry)}` : ""}.`,
          onboardingCompleted: true,
          whatsappPhoneNumberId: cleanOptionalUnique(whatsappPhoneNumberId),
          instagramBusinessAccountId: cleanOptionalUnique(instagramBusinessAccountId)
        }
      });

      await tx.workspaceUser.create({
        data: {
          tenantId: createdTenant.id,
          name: ownerFullName,
          email: normalizedEmail,
          passwordHash: ownerPassword ? await hashPassword(ownerPassword) : null,
          role: "OWNER",
          isActive: true
        }
      });

      await tx.tenantAiProfile.create({
        data: {
          tenantId: createdTenant.id,
          code: "default",
          name: `IA ${tenantName}`,
          industry: cleanText(industry),
          basePersona: "Asistente comercial experto para atención omnicanal",
          tone: "cercano y profesional",
          objective: "resolver dudas, recomendar y avanzar hacia venta/agendamiento",
          responseStyle: "breve, natural y orientado a acción",
          businessRules: []
        }
      });

      if (cleanOptionalUnique(whatsappPhoneNumberId) || cleanText(metaAccessToken) || cleanText(verifyToken) || cleanOptionalUnique(whatsappBusinessAccountId)) {
        await tx.tenantChannelConfig.create({
          data: {
            tenantId: createdTenant.id,
            channel: "whatsapp",
            label: "WhatsApp principal",
            phoneNumberId: cleanOptionalUnique(whatsappPhoneNumberId),
            businessAccountId: cleanOptionalUnique(whatsappBusinessAccountId),
            accessToken: cleanText(metaAccessToken),
            verifyToken: cleanText(verifyToken),
            metadata: {
              ...(cleanText(metaAppSecret) ? { metaAppSecret: cleanText(metaAppSecret) } : {}),
              ...(cleanText(whatsappDisplayNumber) ? { displayNumber: cleanText(whatsappDisplayNumber) } : {})
            },
            isActive: true
          }
        });
      }

      if (cleanOptionalUnique(instagramBusinessAccountId) || cleanText(metaAccessToken) || cleanText(verifyToken) || cleanOptionalUnique(instagramPageId)) {
        await tx.tenantChannelConfig.create({
          data: {
            tenantId: createdTenant.id,
            channel: "instagram",
            label: "Instagram principal",
            externalAccountId: cleanOptionalUnique(instagramBusinessAccountId),
            businessAccountId: cleanOptionalUnique(instagramPageId),
            accessToken: cleanText(metaAccessToken),
            verifyToken: cleanText(verifyToken),
            metadata: { pageId: cleanOptionalUnique(instagramPageId), metaAppSecret: cleanText(metaAppSecret) },
            isActive: true
          }
        });
      }

      return createdTenant;
    });

    await ensureTenantSubscriptionAndModules({ tenantId: tenant.id, planCode });
    const fullTenant = await getFullTenant(tenant.id);
    res.status(201).json(fullTenant);
  } catch (error) {
    return adminError(res, error, "No se pudo crear el cliente");
  }
});

adminRouter.patch("/admin/tenants/:tenantId", async (req, res) => {
  try {
    const { tenantId } = req.params;
    const {
      name,
      slug,
      type,
      industry,
      onboardingCompleted,
      businessPrompt,
      whatsappPhoneNumberId,
      instagramBusinessAccountId
    } = req.body;
    const data = {};
    if (name !== undefined) {
      const nextName = cleanText(name);
      if (!nextName) return res.status(400).json({ error: "El nombre del cliente no puede quedar vacío" });
      data.name = nextName;
    }
    if (type !== undefined) data.type = cleanText(type) || "BUSINESS";
    if (industry !== undefined) data.industry = cleanText(industry);
    if (onboardingCompleted !== undefined) data.onboardingCompleted = Boolean(onboardingCompleted);
    if (businessPrompt !== undefined) data.businessPrompt = cleanText(businessPrompt);
    if (whatsappPhoneNumberId !== undefined) data.whatsappPhoneNumberId = cleanOptionalUnique(whatsappPhoneNumberId);
    if (instagramBusinessAccountId !== undefined) data.instagramBusinessAccountId = cleanOptionalUnique(instagramBusinessAccountId);

    if (slug !== undefined && slug) {
      const cleanSlug = makeSlug(slug);
      const existing = await prisma.tenant.findUnique({ where: { slug: cleanSlug } });
      if (existing && existing.id !== tenantId) return res.status(409).json({ error: "Ese slug ya está en uso" });
      data.slug = cleanSlug;
    }

    await prisma.tenant.update({ where: { id: tenantId }, data });
    const tenant = await getFullTenant(tenantId);
    res.json(tenant);
  } catch (error) {
    return adminError(res, error, "No se pudo actualizar el cliente");
  }
});


adminRouter.put("/admin/tenants/:tenantId/ai-profile", async (req, res) => {
  try {
    const { tenantId } = req.params;
    const {
      code = "default",
      name = "IA principal",
      industry,
      basePersona,
      tone,
      objective,
      responseStyle,
      businessRules = [],
      knowledge = null,
      isActive = true
    } = req.body || {};

    const tenantExists = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true } });
    if (!tenantExists) return res.status(404).json({ error: "Cliente no encontrado" });

    await prisma.tenantAiProfile.upsert({
      where: { tenantId_code: { tenantId, code: cleanText(code) || "default" } },
      update: {
        name: cleanText(name) || "IA principal",
        industry: cleanText(industry),
        basePersona: cleanText(basePersona),
        tone: cleanText(tone),
        objective: cleanText(objective),
        responseStyle: cleanText(responseStyle),
        businessRules: Array.isArray(businessRules) ? businessRules : [],
        knowledge,
        isActive: Boolean(isActive)
      },
      create: {
        tenantId,
        code: cleanText(code) || "default",
        name: cleanText(name) || "IA principal",
        industry: cleanText(industry),
        basePersona: cleanText(basePersona),
        tone: cleanText(tone),
        objective: cleanText(objective),
        responseStyle: cleanText(responseStyle),
        businessRules: Array.isArray(businessRules) ? businessRules : [],
        knowledge,
        isActive: Boolean(isActive)
      }
    });

    const tenant = await getFullTenant(tenantId);
    res.json(tenant);
  } catch (error) {
    return adminError(res, error, "No se pudo guardar el perfil IA del cliente");
  }
});

adminRouter.put("/admin/tenants/:tenantId/channel-configs/:channel", async (req, res) => {
  try {
    const { tenantId, channel } = req.params;
    const normalizedChannel = String(channel || "").trim().toLowerCase();
    if (!["whatsapp", "instagram"].includes(normalizedChannel)) {
      return res.status(400).json({ error: "Canal no soportado" });
    }

    const {
      label,
      phoneNumberId,
      businessAccountId,
      externalAccountId,
      displayNumber,
      accessToken,
      verifyToken,
      metadata = null,
      isActive = true
    } = req.body || {};

    const tenantExists = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true } });
    if (!tenantExists) return res.status(404).json({ error: "Cliente no encontrado" });

    const existingConfig = await prisma.tenantChannelConfig.findUnique({
      where: { tenantId_channel: { tenantId, channel: normalizedChannel } }
    });

    const existingMetadata = existingConfig?.metadata && typeof existingConfig.metadata === "object"
      ? existingConfig.metadata
      : {};

    const nextMetadata = {
      ...existingMetadata,
      ...(metadata && typeof metadata === "object" ? metadata : {}),
      ...(normalizedChannel === "whatsapp" && cleanText(displayNumber)
        ? { displayNumber: cleanText(displayNumber), whatsappDisplayNumber: cleanText(displayNumber) }
        : {})
    };

    const data = {
      label: cleanText(label) || `${normalizedChannel} principal`,
      phoneNumberId: cleanOptionalUnique(phoneNumberId),
      businessAccountId: cleanOptionalUnique(businessAccountId),
      externalAccountId: cleanOptionalUnique(externalAccountId),
      accessToken: cleanText(accessToken),
      verifyToken: cleanText(verifyToken),
      metadata: Object.keys(nextMetadata).length ? nextMetadata : null,
      isActive: Boolean(isActive)
    };

    await prisma.tenantChannelConfig.upsert({
      where: { tenantId_channel: { tenantId, channel: normalizedChannel } },
      update: data,
      create: { tenantId, channel: normalizedChannel, ...data }
    });

    if (normalizedChannel === "whatsapp" && data.phoneNumberId) {
      await prisma.tenant.update({ where: { id: tenantId }, data: { whatsappPhoneNumberId: data.phoneNumberId } });
    }

    if (normalizedChannel === "instagram" && data.externalAccountId) {
      await prisma.tenant.update({ where: { id: tenantId }, data: { instagramBusinessAccountId: data.externalAccountId } });
    }

    const tenant = await getFullTenant(tenantId);
    res.json(tenant);
  } catch (error) {
    return adminError(res, error, "No se pudo guardar la configuración del canal");
  }
});


adminRouter.post("/admin/tenants/:tenantId/onboarding/extract", upload.array("files", 8), async (req, res) => {
  try {
    const { tenantId } = req.params;
    const tenantExists = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true } });
    if (!tenantExists) return res.status(404).json({ error: "Cliente no encontrado" });

    const manual = cleanManual(req.body || {});
    const extraction = await extractOnboardingKnowledge({ files: req.files || [], manual });
    const saved = await prisma.tenantOnboardingImport.create({
      data: {
        tenantId,
        sourceType: "admin-upload",
        fileNames: extraction.fileResults || [],
        rawText: extraction.rawText || null,
        extractedData: extraction,
        status: "DRAFT"
      }
    });

    res.json({ importId: saved.id, extraction });
  } catch (error) {
    return adminError(res, error, "No se pudo extraer información del onboarding IA");
  }
});

adminRouter.post("/admin/tenants/:tenantId/onboarding/apply", async (req, res) => {
  try {
    const { tenantId } = req.params;
    const { importId, extraction, replaceProducts = false, replaceFaqs = false } = req.body || {};
    const data = extraction || (importId
      ? (await prisma.tenantOnboardingImport.findFirst({ where: { id: importId, tenantId } }))?.extractedData
      : null);

    if (!data) return res.status(400).json({ error: "No hay extracción para aplicar" });

    const result = await prisma.$transaction(async (tx) => {
      if (replaceProducts) await tx.product.deleteMany({ where: { tenantId } });
      if (replaceFaqs) await tx.rule.deleteMany({ where: { tenantId, trigger: { startsWith: "FAQ:" } } });

      const business = data.business || {};
      const policies = Array.isArray(data.policies) ? data.policies.filter(Boolean) : [];
      const faqs = Array.isArray(data.faqs) ? data.faqs.filter((x) => x?.question) : [];
      const products = Array.isArray(data.products) ? data.products.filter((x) => x?.name) : [];

      const tenant = await tx.tenant.update({
        where: { id: tenantId },
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
        where: { tenantId_code: { tenantId, code: "default" } },
        create: {
          tenantId,
          code: "default",
          name: `IA ${tenant.name}`,
          industry: business.industry,
          basePersona: business.description || data.summary,
          tone: data.suggestedTone || business.tone,
          objective: business.objective,
          responseStyle: "responder con claridad, brevedad y orientación comercial",
          businessRules: policies,
          knowledge: { faqs, productsSummary: products.slice(0, 20), source: "admin-onboarding" },
          isActive: true
        },
        update: {
          name: `IA ${tenant.name}`,
          industry: business.industry || undefined,
          basePersona: business.description || data.summary || undefined,
          tone: data.suggestedTone || business.tone || undefined,
          objective: business.objective || undefined,
          businessRules: policies,
          knowledge: { faqs, productsSummary: products.slice(0, 20), source: "admin-onboarding" },
          isActive: true
        }
      });

      let createdProducts = 0;
      for (const product of products.slice(0, 200)) {
        await tx.product.create({
          data: {
            tenantId,
            name: String(product.name).trim(),
            description: product.description ? String(product.description).trim() : null,
            price: Number(product.price || 0),
            stock: Number.isFinite(Number(product.stock)) ? Number(product.stock) : 0,
            category: product.category ? String(product.category).trim() : null,
            location: product.location ? String(product.location).trim() : null,
            attributes: product.attributes && typeof product.attributes === "object" ? product.attributes : { source: "admin-onboarding" }
          }
        });
        createdProducts += 1;
      }

      let createdFaqs = 0;
      for (const faq of faqs.slice(0, 100)) {
        await tx.rule.create({
          data: {
            tenantId,
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
          where: { id: importId, tenantId },
          data: { status: "APPLIED", appliedAt: new Date() }
        });
      }

      return { tenant, profile, createdProducts, createdFaqs, policiesCount: policies.length };
    });

    const tenant = await getFullTenant(tenantId);
    res.json({ ...result, tenant });
  } catch (error) {
    return adminError(res, error, "No se pudo aplicar el onboarding IA");
  }
});


adminRouter.patch("/admin/tenants/:tenantId/plan", async (req, res) => {
  try {
    const { tenantId } = req.params;
    const planCode = normalizePlanCode(req.body.plan || "STARTER");
    await prisma.tenant.update({ where: { id: tenantId }, data: { plan: planCode } });
    const modules = await ensureTenantSubscriptionAndModules({ tenantId, planCode });
    const tenant = await getFullTenant(tenantId);
    res.json({ tenant, modules });
  } catch (error) {
    return adminError(res, error, "No se pudo actualizar el plan");
  }
});

adminRouter.get("/admin/tenants/:tenantId/modules", async (req, res) => {
  const modules = await getTenantModules(req.params.tenantId);
  res.json({ tenantId: req.params.tenantId, modules });
});

adminRouter.patch("/admin/tenants/:tenantId/modules", async (req, res) => {
  try {
    const { tenantId } = req.params;
    const modules = Array.isArray(req.body.modules) ? req.body.modules : [];
    const updated = await setTenantModules({ tenantId, modules, source: "MANUAL" });
    const tenant = await getFullTenant(tenantId);
    res.json({ tenant, modules: updated });
  } catch (error) {
    return adminError(res, error, "No se pudieron actualizar los módulos");
  }
});

adminRouter.post("/admin/tenants/:tenantId/users", async (req, res) => {
  try {
    const { tenantId } = req.params;
    const { name, email, role = "AGENT", password, isActive = true } = req.body || {};
    const userName = cleanText(name);
    const normalizedEmail = cleanEmail(email);
    const normalizedRole = String(role || "AGENT").trim().toUpperCase();

    if (!userName || !normalizedEmail) return res.status(400).json({ error: "Nombre y email son requeridos" });
    if (!normalizedEmail.includes("@")) return res.status(400).json({ error: "El email del usuario no es válido" });
    if (!VALID_ROLES.has(normalizedRole)) return res.status(400).json({ error: "Rol inválido para el usuario" });

    const tenantExists = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true } });
    if (!tenantExists) return res.status(404).json({ error: "Cliente no encontrado" });

    const existing = await prisma.workspaceUser.findUnique({ where: { email: normalizedEmail } });
    if (existing) return res.status(409).json({ error: "Ya existe un usuario con ese email" });

    await prisma.workspaceUser.create({
      data: {
        tenantId,
        name: userName,
        email: normalizedEmail,
        role: normalizedRole,
        isActive: Boolean(isActive),
        passwordHash: password ? await hashPassword(password) : null
      }
    });

    const tenant = await getFullTenant(tenantId);
    res.status(201).json(tenant);
  } catch (error) {
    return adminError(res, error, "No se pudo crear el usuario");
  }
});

adminRouter.patch("/admin/users/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const { name, role, isActive, password } = req.body;
    const data = {};
    if (name !== undefined) {
      const userName = cleanText(name);
      if (!userName) return res.status(400).json({ error: "El nombre del usuario no puede quedar vacío" });
      data.name = userName;
    }
    if (role !== undefined) {
      const normalizedRole = String(role || "").trim().toUpperCase();
      if (!VALID_ROLES.has(normalizedRole)) return res.status(400).json({ error: "Rol inválido para el usuario" });
      data.role = normalizedRole;
    }
    if (isActive !== undefined) data.isActive = Boolean(isActive);
    if (password) data.passwordHash = await hashPassword(password);

    const user = await prisma.workspaceUser.update({ where: { id: userId }, data });
    const tenant = await getFullTenant(user.tenantId);
    res.json(tenant);
  } catch (error) {
    return adminError(res, error, "No se pudo actualizar el usuario");
  }
});

adminRouter.get("/admin/plans", (_req, res) => {
  res.json({ plans: PLAN_DEFINITIONS });
});


adminRouter.delete("/admin/tenants/:tenantId", async (req, res) => {
  try {
    const { tenantId } = req.params;
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) return res.status(404).json({ error: "Cliente no encontrado" });

    await prisma.tenant.delete({ where: { id: tenantId } });

    res.json({ ok: true, deletedTenantId: tenantId });
  } catch (error) {
    return adminError(res, error, "No se pudo eliminar el cliente");
  }
});

adminRouter.delete("/admin/users/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const user = await prisma.workspaceUser.findUnique({ where: { id: userId } });
    if (!user) return res.status(404).json({ error: "Usuario no encontrado" });
    if (user.role === "SUPER_ADMIN") {
      return res.status(400).json({ error: "No se puede eliminar el Super Admin desde este panel" });
    }

    await prisma.workspaceUser.delete({ where: { id: userId } });

    const tenant = await getFullTenant(user.tenantId);

    res.json(tenant);
  } catch (error) {
    return adminError(res, error, "No se pudo eliminar el usuario");
  }
});

adminRouter.post("/admin/team-users", async (req, res) => {
  try {
    const { tenantId, name, email, password = "ChangeMe123*", role = "SELLER" } = req.body || {};
    const userName = cleanText(name);
    const normalizedEmail = cleanEmail(email);
    const normalizedRole = String(role || "SELLER").trim().toUpperCase();

    if (!tenantId || !userName || !normalizedEmail) return res.status(400).json({ error: "tenantId, nombre y email son requeridos" });
    if (!VALID_ROLES.has(normalizedRole)) return res.status(400).json({ error: "Rol inválido para el usuario" });

    const user = await prisma.workspaceUser.create({
      data: {
        tenantId,
        name: userName,
        email: normalizedEmail,
        role: normalizedRole,
        passwordHash: await hashPassword(password),
        isActive: true
      }
    });

    res.json({ success: true, user });
  } catch (error) {
    return adminError(res, error, "No se pudo crear el usuario");
  }
});
