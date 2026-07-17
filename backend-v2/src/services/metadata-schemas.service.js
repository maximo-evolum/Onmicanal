import { prisma } from "../lib/db.js";
import { normalizeMetadata } from "../lib/metadata.js";
import { validateMetadataSchemaDefinition } from "../lib/metadata-governance.js";
import { getAnyIndustryTemplate } from "./industry-templates.service.js";

const ENTITY_ALIASES = Object.freeze({
  customer: ["customer", "patient"],
  exam: ["exam"],
  property: ["property"],
  vehicle: ["vehicle"],
  part: ["part"],
  work_order: ["work_order"],
  appointment: ["appointment", "booking"],
  booking: ["booking", "appointment"],
  deal: ["deal"],
  visit: ["visit"],
  owner: ["owner"],
  broker_profile: ["broker_profile"],
  seller_assignment: ["seller_assignment"]
});

function cleanKey(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, "_");
}

function entityList(template) {
  if (Array.isArray(template?.entities)) return template.entities;
  return Object.entries(template?.entities || {}).map(([type, entity]) => ({ type, ...(entity || {}) }));
}

function entityType(entity) {
  return cleanKey(entity?.type || entity?.key || entity?.code || entity?.name);
}

function inferredType(name, config) {
  if (typeof config === "object" && config?.type) return String(config.type).toLowerCase();
  const key = cleanKey(name);
  if (/(price|value|amount|monto|metros|bedrooms|bathrooms|kilometraje|score|commission|cantidad|personas)/.test(key)) return "number";
  if (/(date|fecha|at|hora)/.test(key)) return "date";
  if (/(active|locked|confirm|pagad|bool)/.test(key)) return "boolean";
  return "string";
}

function inferredCare(name) {
  const key = cleanKey(name);
  if (/(anteced|historial|diagnost|tratamiento|examen|resultado|mascota)/.test(key)) return "SENSITIVE";
  if (/(phone|telefono|email|correo|name|nombre|address|direccion|tutor|paciente|cliente)/.test(key)) return "PERSONAL";
  if (/(price|value|amount|monto|commission|pago|costo|presupuesto)/.test(key)) return "CONFIDENTIAL";
  return "INTERNAL";
}

function governance(care) {
  if (care === "SENSITIVE") return { purpose: "Atención clínica y continuidad del servicio", retentionDays: 3650 };
  if (care === "PERSONAL") return { purpose: "Atención y seguimiento del servicio", retentionDays: 1825 };
  if (care === "CONFIDENTIAL") return { purpose: "Gestión comercial, cobros y administración", retentionDays: 2555 };
  return { purpose: "Operación del servicio", retentionDays: 1825 };
}

function relationTarget(name, config) {
  if (String(config?.relationRecordType || "").trim()) return String(config.relationRecordType).trim();
  const key = cleanKey(name);
  if (key.includes("property")) return "property";
  if (key.includes("vehicle")) return "vehicle";
  if (key.includes("owner")) return "owner";
  if (key.includes("broker")) return "broker_profile";
  return "customer";
}

function entityFields(entity) {
  const source = entity?.fields || {};
  const entries = Array.isArray(source)
    ? source.map((name) => [name, {}])
    : Object.entries(source);
  return Object.fromEntries(entries.map(([name, raw]) => {
    const config = typeof raw === "string" ? { type: raw } : (typeof raw === "object" && raw ? raw : {});
    const care = inferredCare(name);
    const type = inferredType(name, config);
    return [cleanKey(name), {
      type,
      required: Boolean(config.required),
      ...(Array.isArray(config.options) ? { options: config.options } : {}),
      ...(type === "relation" ? { relationRecordType: relationTarget(name, config) } : {}),
      sensitivity: care,
      ...governance(care)
    }];
  }).filter(([name]) => Boolean(name)));
}

export async function listMetadataSchemas(tenantId, recordType = "") {
  return prisma.metadataSchema.findMany({
    where: { tenantId, ...(recordType ? { recordType } : {}) },
    orderBy: [{ recordType: "asc" }, { version: "desc" }]
  });
}

export async function getPublishedMetadataSchema(tenantId, recordType) {
  return prisma.metadataSchema.findFirst({
    where: { tenantId, recordType, status: "PUBLISHED" },
    orderBy: { version: "desc" }
  });
}

/**
 * Crea una primera versión editable cuando la operación genera por primera
 * vez una entidad conocida del rubro. Nunca pisa una configuración creada o
 * publicada por el cliente y se mantiene en modo compatible hasta activarla.
 */
export async function ensureAutomatedMetadataDraft({ tenantId, industry, recordType }) {
  const normalizedRecordType = cleanKey(recordType);
  if (!tenantId || !normalizedRecordType) return null;

  const existing = await prisma.metadataSchema.findFirst({
    where: { tenantId, recordType: normalizedRecordType },
    select: { id: true }
  });
  if (existing) return null;

  const template = await getAnyIndustryTemplate(industry || "GENERAL");
  const aliases = ENTITY_ALIASES[normalizedRecordType] || [normalizedRecordType];
  const entity = entityList(template).find((item) => aliases.includes(entityType(item)));
  if (!entity) return null;

  const fields = entityFields(entity);
  if (!Object.keys(fields).length) return null;
  if (validateMetadataSchemaDefinition(fields).length) return null;

  const label = String(entity.label || normalizedRecordType.replaceAll("_", " ")).trim();
  return prisma.metadataSchema.create({
    data: {
      tenantId,
      recordType: normalizedRecordType,
      version: 1,
      label,
      fields,
      policies: {
        enforcement: "COMPATIBLE",
        allowUnknown: true,
        generatedBy: "industry_template",
        generatedAt: new Date().toISOString(),
        industry: template?.code || industry || "GENERAL"
      }
    }
  }).catch(async (error) => {
    // Dos acciones concurrentes pueden intentar crear el mismo borrador. La
    // segunda no debe impedir la creación del registro operativo.
    if (error?.code === "P2002") return null;
    throw error;
  });
}

export async function createMetadataSchemaDraft({ tenantId, recordType, label, fields, policies }) {
  const normalizedFields = normalizeMetadata(fields, {});
  const definitionErrors = validateMetadataSchemaDefinition(normalizedFields);
  if (definitionErrors.length) {
    const error = new Error("La definicion de campos no es valida");
    error.statusCode = 400;
    error.details = definitionErrors;
    throw error;
  }
  const latest = await prisma.metadataSchema.findFirst({
    where: { tenantId, recordType },
    orderBy: { version: "desc" }
  });
  return prisma.metadataSchema.create({
    data: {
      tenantId,
      recordType,
      version: (latest?.version || 0) + 1,
      label,
      fields: normalizedFields,
      policies: normalizeMetadata(policies, {})
    }
  });
}

export async function publishMetadataSchema({ tenantId, id }) {
  return prisma.$transaction(async (tx) => {
    const draft = await tx.metadataSchema.findFirst({ where: { id, tenantId, status: "DRAFT" } });
    if (!draft) return null;
    await tx.metadataSchema.updateMany({
      where: { tenantId, recordType: draft.recordType, status: "PUBLISHED" },
      data: { status: "ARCHIVED" }
    });
    return tx.metadataSchema.update({
      where: { id: draft.id },
      data: { status: "PUBLISHED", publishedAt: new Date() }
    });
  });
}
