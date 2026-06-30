import { prisma } from "../lib/db.js";
import {
  getIndustryTemplate,
  getTemplateModulesForPlan,
  listIndustryTemplates,
  normalizeIndustryCode
} from "../lib/industries.js";

function slugCode(value) {
  return String(value || "CUSTOM")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/(^_|_$)/g, "")
    .toUpperCase() || "CUSTOM";
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

export function normalizeTemplateModule(item) {
  if (typeof item === "string") {
    return { key: item, label: item, description: "", minPlan: "STARTER" };
  }
  return {
    key: String(item?.key || "").trim(),
    label: String(item?.label || item?.key || "").trim(),
    description: String(item?.description || "").trim(),
    minPlan: String(item?.minPlan || "STARTER").trim().toUpperCase()
  };
}

export function normalizeCustomIndustryTemplate(row) {
  return {
    code: row.code,
    name: row.name,
    summary: row.summary || "",
    custom: true,
    modules: asArray(row.modules).map(normalizeTemplateModule).filter((item) => item.key),
    entities: asArray(row.entities),
    workflows: asArray(row.workflows)
  };
}

export async function listAllIndustryTemplates() {
  const custom = await prisma.customIndustryTemplate.findMany({
    where: { isActive: true },
    orderBy: { name: "asc" }
  }).catch(() => []);
  return [
    ...listIndustryTemplates().map((template) => ({ ...template, custom: false })),
    ...custom.map(normalizeCustomIndustryTemplate)
  ];
}

export async function getAnyIndustryTemplate(value) {
  const code = slugCode(value);
  const staticTemplate = getIndustryTemplate(value);
  if (staticTemplate.code === normalizeIndustryCode(value)) {
    return { ...staticTemplate, custom: false };
  }

  const custom = await prisma.customIndustryTemplate.findFirst({
    where: {
      isActive: true,
      OR: [
        { code },
        { name: { equals: String(value || "").trim(), mode: "insensitive" } }
      ]
    }
  }).catch(() => null);

  return custom ? normalizeCustomIndustryTemplate(custom) : { ...staticTemplate, custom: false };
}

export function getTemplateModules(template, plan) {
  return getTemplateModulesForPlan(template, plan);
}

export async function createCustomIndustryTemplate(input = {}) {
  const name = String(input.name || "").trim();
  if (!name) {
    const error = new Error("El nombre del rubro es requerido");
    error.statusCode = 400;
    throw error;
  }

  const code = slugCode(input.code || name);
  const modules = asArray(input.modules).map(normalizeTemplateModule).filter((item) => item.key);
  if (!modules.length) {
    const error = new Error("Selecciona al menos un modulo para el rubro");
    error.statusCode = 400;
    throw error;
  }

  const row = await prisma.customIndustryTemplate.upsert({
    where: { code },
    update: {
      name,
      summary: String(input.summary || "").trim(),
      modules,
      entities: asArray(input.entities),
      workflows: asArray(input.workflows),
      isActive: true
    },
    create: {
      code,
      name,
      summary: String(input.summary || "").trim(),
      modules,
      entities: asArray(input.entities),
      workflows: asArray(input.workflows),
      isActive: true
    }
  });

  return normalizeCustomIndustryTemplate(row);
}
