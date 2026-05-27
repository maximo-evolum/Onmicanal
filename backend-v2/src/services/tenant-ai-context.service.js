import { prisma } from "../lib/db.js";

function normalizeList(value) {
  if (Array.isArray(value)) return value.filter(Boolean).map((item) => String(item).trim()).filter(Boolean);
  if (typeof value === "string" && value.trim()) return value.split(/\n|;/).map((item) => item.trim()).filter(Boolean);
  return [];
}

export async function getActiveTenantAiProfile(tenantId) {
  if (!tenantId) return null;
  return prisma.tenantAiProfile.findFirst({
    where: { tenantId, isActive: true },
    orderBy: [{ code: "asc" }, { createdAt: "asc" }]
  }).catch(() => null);
}

export async function buildTenantAiContext({ tenant, tenantId }) {
  const resolvedTenant = tenant || (tenantId ? await prisma.tenant.findUnique({ where: { id: tenantId } }) : null);
  if (!resolvedTenant) return { tenant: null, profile: null, promptContext: "" };

  const profile = await getActiveTenantAiProfile(resolvedTenant.id);
  const settings = resolvedTenant.aiSettings || {};

  const merged = {
    industry: profile?.industry || resolvedTenant.industry || settings.industry || "general",
    basePersona: profile?.basePersona || settings.personality || "Asistente comercial experto",
    tone: profile?.tone || settings.tone || "cercano y profesional",
    objective: profile?.objective || settings.objective || "ayudar, vender y derivar cuando corresponda",
    responseStyle: profile?.responseStyle || settings.responseStyle || "respuestas breves y claras",
    businessRules: [
      ...normalizeList(profile?.businessRules),
      ...normalizeList(settings.businessRules)
    ],
    knowledge: profile?.knowledge || settings.knowledge || null
  };

  const rules = merged.businessRules.length ? merged.businessRules.map((rule) => `- ${rule}`).join("\n") : "- Sin reglas específicas cargadas.";
  const knowledge = merged.knowledge ? `\nConocimiento adicional del tenant:\n${JSON.stringify(merged.knowledge).slice(0, 2500)}` : "";

  return {
    tenant: resolvedTenant,
    profile,
    merged,
    promptContext: `\nPerfil IA del cliente/tenant:\n- Tenant: ${resolvedTenant.name} (${resolvedTenant.slug})\n- Rubro: ${merged.industry}\n- Personalidad: ${merged.basePersona}\n- Tono: ${merged.tone}\n- Objetivo: ${merged.objective}\n- Estilo: ${merged.responseStyle}\nReglas del negocio:\n${rules}${knowledge}\n`
  };
}
