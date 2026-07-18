import { prisma } from "../lib/db.js";

function dataOf(record) {
  return record?.data && typeof record.data === "object" && !Array.isArray(record.data) ? record.data : {};
}

function text(value, fallback = "") {
  const normalized = String(value ?? "").trim();
  return normalized || fallback;
}

function number(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = Number(String(value ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalized(value) {
  return text(value).toLocaleLowerCase("es").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function propertyPrice(property) {
  const data = dataOf(property);
  return number(data.price) || number(data.value) || number(data.askingPrice);
}

function propertyOperation(property) {
  const value = normalized(dataOf(property).operation);
  return value.includes("arriend") || value.includes("rental") ? "RENT" : "SALE";
}

function propertyStage(property) {
  return text(dataOf(property).stage || property.status, "LEAD").toUpperCase();
}

function propertyCommune(property) {
  const data = dataOf(property);
  return text(data.commune || data.comuna || data.address).split(",")[0].trim();
}

function propertyType(property) {
  return normalized(dataOf(property).propertyType || dataOf(property).type || "");
}

function propertyNumber(property, key) {
  return number(dataOf(property)[key]);
}

function propertyIsAvailable(property) {
  return !["ARCHIVED", "CLOSING", "POSTSALE", "SOLD", "RENTED"].includes(propertyStage(property));
}

function leadFields(lead) {
  return lead?.customFields && typeof lead.customFields === "object" && !Array.isArray(lead.customFields)
    ? lead.customFields
    : {};
}

function leadOperation(lead) {
  const fields = leadFields(lead);
  const value = normalized(lead?.interest || fields.operation || fields.interestType || "");
  if (value.includes("arriend") || value.includes("alquil")) return "RENT";
  return value.includes("compr") || value.includes("venta") || value.includes("invert") ? "SALE" : null;
}

function leadText(lead) {
  const fields = leadFields(lead);
  return normalized(`${lead?.interest || ""} ${lead?.notes || ""} ${lead?.commune || ""} ${lead?.propertyType || ""} ${JSON.stringify(fields)}`);
}

function leadNumber(lead, key) {
  const fields = leadFields(lead);
  return number(fields[key] || fields[`min${key[0].toUpperCase()}${key.slice(1)}`]);
}

function completion(property) {
  const data = dataOf(property);
  const checks = [
    Boolean(propertyPrice(property)),
    Boolean(propertyCommune(property)),
    Boolean(text(data.photoUrl) || (Array.isArray(data.gallery) && data.gallery.length)),
    Boolean(number(data.meters)),
    Boolean(text(data.assignedBrokerId || property.assignedToId)),
    Boolean(text(data.ownerName))
  ];
  return Math.round((checks.filter(Boolean).length / checks.length) * 100);
}

function aggregate(items, keyOf) {
  const map = new Map();
  for (const item of items) {
    const key = keyOf(item) || "Sin clasificar";
    map.set(key, (map.get(key) || 0) + 1);
  }
  return [...map.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

function propertyMatchPayload(property) {
  const data = dataOf(property);
  return {
    id: property.id,
    title: property.title,
    status: property.status,
    price: propertyPrice(property),
    commune: propertyCommune(property),
    operation: propertyOperation(property),
    propertyType: propertyType(property),
    bedrooms: propertyNumber(property, "bedrooms"),
    bathrooms: propertyNumber(property, "bathrooms"),
    parking: propertyNumber(property, "parking"),
    photoUrl: text(data.photoUrl),
    assignedToId: property.assignedToId
  };
}

export function scoreRealtyLeadMatch(lead, property) {
  const fields = leadFields(lead);
  const interest = leadText(lead);
  const price = propertyPrice(property);
  const budget = number(lead?.budget || fields.budget || fields.maxBudget);
  const commune = normalized(propertyCommune(property));
  const type = propertyType(property);
  const operation = leadOperation(lead);
  const bedrooms = leadNumber(lead, "bedrooms");
  const bathrooms = leadNumber(lead, "bathrooms");
  const parking = leadNumber(lead, "parking");
  let score = 10;
  const reasons = [];

  if (budget > 0 && price > 0) {
    const difference = (price - budget) / budget;
    if (difference <= 0 && difference >= -0.15) { score += 42; reasons.push("precio dentro del presupuesto"); }
    else if (Math.abs(difference) <= 0.1) { score += 36; reasons.push("precio muy cercano al presupuesto"); }
    else if (Math.abs(difference) <= 0.25) { score += 20; reasons.push("precio cercano al presupuesto"); }
  }
  if (commune && interest.includes(commune)) { score += 22; reasons.push(`interés por ${propertyCommune(property)}`); }
  if (type && interest.includes(type)) { score += 16; reasons.push(`tipo ${type}`); }
  if (bedrooms && propertyNumber(property, "bedrooms") >= bedrooms) { score += 8; reasons.push(`${bedrooms}+ dormitorios`); }
  if (bathrooms && propertyNumber(property, "bathrooms") >= bathrooms) { score += 4; reasons.push(`${bathrooms}+ baños`); }
  if (parking && propertyNumber(property, "parking") >= parking) { score += 4; reasons.push("estacionamiento incluido"); }
  if (propertyIsAvailable(property)) { score += 8; reasons.push("propiedad disponible"); }
  if (operation && propertyOperation(property) === operation) { score += 12; reasons.push(operation === "RENT" ? "arriendo compatible" : "compra compatible"); }

  return { score: Math.min(100, score), reasons };
}

export async function getRealtyIntelligence({ tenantId, sampleLimit = 12 }) {
  const [properties, visits, owners, brokers, leads, campaigns] = await Promise.all([
    prisma.industryRecord.findMany({ where: { tenantId, recordType: "property", status: { not: "ARCHIVED" } }, include: { assignedTo: { select: { id: true, name: true } } }, orderBy: { updatedAt: "desc" }, take: 2000 }),
    prisma.industryRecord.findMany({ where: { tenantId, recordType: "visit" }, orderBy: { updatedAt: "desc" }, take: 1000 }),
    prisma.industryRecord.findMany({ where: { tenantId, recordType: "owner" }, take: 1000 }),
    prisma.workspaceUser.findMany({ where: { tenantId, isActive: true, role: { in: ["SELLER", "AGENT", "ADMIN", "OWNER"] } }, select: { id: true, name: true, role: true } }),
    prisma.lead.findMany({ where: { tenantId, status: { notIn: ["WON", "LOST"] } }, orderBy: { closeProbability: "desc" }, take: 500 }),
    prisma.campaign.findMany({ where: { tenantId }, orderBy: { updatedAt: "desc" }, take: 200 })
  ]);

  const prices = properties.map(propertyPrice).filter(Boolean);
  const portfolioValue = prices.reduce((total, value) => total + value, 0);
  const completed = properties.map(completion);
  const assigned = properties.filter((property) => text(dataOf(property).assignedBrokerId || property.assignedToId)).length;
  const photosMissing = properties.filter((property) => !text(dataOf(property).photoUrl) && !(Array.isArray(dataOf(property).gallery) && dataOf(property).gallery.length));
  const stale = properties.filter((property) => Date.now() - new Date(property.updatedAt).getTime() > 14 * 24 * 60 * 60 * 1000);
  const unassigned = properties.filter((property) => !text(dataOf(property).assignedBrokerId || property.assignedToId));
  const brokerPerformance = brokers.map((broker) => {
    const portfolio = properties.filter((property) => text(dataOf(property).assignedBrokerId || property.assignedToId) === broker.id);
    const value = portfolio.reduce((total, property) => total + propertyPrice(property), 0);
    const activeVisits = visits.filter((visit) => text(dataOf(visit).assignedBrokerId || visit.assignedToId) === broker.id && !["DONE", "CANCELED"].includes(String(visit.status).toUpperCase())).length;
    return { brokerId: broker.id, name: broker.name, role: broker.role, properties: portfolio.length, portfolioValue: value, activeVisits };
  }).filter((broker) => broker.properties || broker.activeVisits).sort((a, b) => b.portfolioValue - a.portfolioValue || b.properties - a.properties);
  const marketAudiences = [
    { key: "available_inventory", label: "Interesados en inventario disponible", count: properties.filter(propertyIsAvailable).length, recommendedChannel: "instagram" },
    { key: "hot_buyers", label: "Compradores de alta intención", count: leads.filter((lead) => Number(lead.closeProbability || 0) >= 70).length, recommendedChannel: "whatsapp" },
    { key: "remarketing_visits", label: "Seguimiento de visitas", count: visits.filter((visit) => !["DONE", "CANCELED"].includes(String(visit.status).toUpperCase())).length, recommendedChannel: "whatsapp" }
  ];
  const recommendations = [];
  if (unassigned.length) recommendations.push({ priority: "high", code: "ASSIGN_PROPERTIES", message: `${unassigned.length} propiedades no tienen corredor asignado.` });
  if (photosMissing.length) recommendations.push({ priority: "high", code: "PROPERTY_MEDIA", message: `${photosMissing.length} propiedades no tienen foto principal ni galería.` });
  if (stale.length) recommendations.push({ priority: "medium", code: "STALE_INVENTORY", message: `${stale.length} propiedades llevan más de 14 días sin actualización.` });
  if (leads.filter((lead) => Number(lead.closeProbability || 0) >= 70).length) recommendations.push({ priority: "medium", code: "HOT_LEAD_MATCHING", message: "Hay compradores de alta intención para cruzar con el inventario disponible." });
  if (!recommendations.length) recommendations.push({ priority: "low", code: "OPERATING_NORMALLY", message: "Inventario y cartera sin alertas operativas críticas." });

  return {
    generatedAt: new Date().toISOString(),
    inventory: { total: properties.length, portfolioValue, averagePrice: prices.length ? Math.round(portfolioValue / prices.length) : 0, averageCompleteness: completed.length ? Math.round(completed.reduce((total, value) => total + value, 0) / completed.length) : 0, assigned, unassigned: unassigned.length, missingMedia: photosMissing.length, stale: stale.length, byOperation: aggregate(properties, (property) => propertyOperation(property) === "RENT" ? "Arriendo" : "Venta"), byStage: aggregate(properties, propertyStage), topCommunes: aggregate(properties, propertyCommune).slice(0, 8) },
    visits: { total: visits.length, pending: visits.filter((visit) => !["DONE", "CANCELED"].includes(String(visit.status).toUpperCase())).length },
    owners: owners.length,
    brokers: brokerPerformance.slice(0, sampleLimit),
    marketing: { campaigns: campaigns.length, published: campaigns.filter((campaign) => ["PUBLISHED", "PARTIAL"].includes(String(campaign.status).toUpperCase())).length, audiences: marketAudiences },
    priorities: recommendations,
    actionQueue: [...unassigned.slice(0, sampleLimit).map((property) => ({ type: "ASSIGNMENT", recordId: property.id, title: property.title, message: "Asignar corredor responsable" })), ...photosMissing.slice(0, Math.max(0, sampleLimit - unassigned.length)).map((property) => ({ type: "MEDIA", recordId: property.id, title: property.title, message: "Completar foto principal o galería" }))].slice(0, sampleLimit)
  };
}

export async function getRealtyLeadMatches({ tenantId, leadId, limit = 8 }) {
  const [lead, properties] = await Promise.all([
    prisma.lead.findFirst({ where: { id: leadId, tenantId } }),
    prisma.industryRecord.findMany({ where: { tenantId, recordType: "property", status: { not: "ARCHIVED" } }, select: { id: true, title: true, status: true, data: true, assignedToId: true, updatedAt: true }, take: 1000 })
  ]);
  if (!lead) return null;
  return {
    lead: { id: lead.id, name: lead.name, status: lead.status, budget: lead.budget, commune: lead.commune, propertyType: lead.propertyType, interest: lead.interest, closeProbability: lead.closeProbability },
    matches: properties.filter(propertyIsAvailable).map((property) => ({ property: propertyMatchPayload(property), ...scoreRealtyLeadMatch(lead, property) })).filter((match) => match.score >= 30).sort((a, b) => b.score - a.score || a.property.price - b.property.price).slice(0, Math.max(1, Math.min(Number(limit) || 8, 20)))
  };
}

export async function getRealtyPropertyMatches({ tenantId, propertyId, limit = 8 }) {
  const [property, leads] = await Promise.all([
    prisma.industryRecord.findFirst({ where: { id: propertyId, tenantId, recordType: "property", status: { not: "ARCHIVED" } } }),
    prisma.lead.findMany({ where: { tenantId, status: { notIn: ["WON", "LOST"] } }, orderBy: [{ closeProbability: "desc" }, { updatedAt: "desc" }], take: 1000 })
  ]);
  if (!property) return null;
  return {
    property: propertyMatchPayload(property),
    matches: leads.map((lead) => ({ buyer: { id: lead.id, name: lead.name || lead.phone || "Comprador sin nombre", phone: lead.phone, budget: lead.budget, commune: lead.commune, propertyType: lead.propertyType, interest: lead.interest, closeProbability: lead.closeProbability, conversationId: lead.conversationId }, ...scoreRealtyLeadMatch(lead, property) })).filter((match) => match.score >= 30).sort((a, b) => b.score - a.score || Number(b.buyer.closeProbability || 0) - Number(a.buyer.closeProbability || 0)).slice(0, Math.max(1, Math.min(Number(limit) || 8, 20)))
  };
}

export async function buildRealtyBuyerReply({ tenantId, conversationId, detectedBudget }) {
  if (!detectedBudget) return null;
  const lead = await prisma.lead.findUnique({ where: { conversationId } });
  if (!lead || lead.tenantId !== tenantId || !lead.budget) return null;
  const result = await getRealtyLeadMatches({ tenantId, leadId: lead.id, limit: 3 });
  if (!result?.matches.length) return "Gracias, ya registré tu presupuesto. Por ahora no veo una propiedad disponible que calce bien; si me indicas la comuna y el tipo de propiedad que buscas, puedo afinar la búsqueda.";
  const suggestions = result.matches.map((match, index) => {
    const property = match.property;
    const price = property.price ? `$${property.price.toLocaleString("es-CL")}` : "precio por confirmar";
    const location = property.commune ? ` en ${property.commune}` : "";
    const detail = [property.bedrooms ? `${property.bedrooms} dorm.` : "", property.bathrooms ? `${property.bathrooms} baños` : ""].filter(Boolean).join(", ");
    return `${index + 1}. ${property.title}${location} — ${price}${detail ? ` (${detail})` : ""}`;
  });
  return `Con el presupuesto que me indicaste encontré ${result.matches.length} ${result.matches.length === 1 ? "opción" : "opciones"} que podrían calzar contigo:\n${suggestions.join("\n")}\n\n¿Quieres que te envíe el detalle de alguna o coordinamos una visita?`;
}
