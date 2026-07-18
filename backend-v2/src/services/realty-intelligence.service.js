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

export function scoreRealtyLeadMatch(lead, property) {
  const fields = lead?.customFields && typeof lead.customFields === "object" ? lead.customFields : {};
  const source = `${lead?.interest || ""} ${lead?.notes || ""} ${JSON.stringify(fields)}`;
  const interest = normalized(source);
  const price = propertyPrice(property);
  const budget = number(lead?.budget || fields.budget || fields.maxBudget);
  const commune = normalized(propertyCommune(property));
  const type = propertyType(property);
  let score = 20;
  const reasons = [];

  if (budget > 0 && price > 0) {
    const difference = Math.abs(price - budget) / budget;
    if (difference <= 0.1) { score += 40; reasons.push("precio dentro del 10% del presupuesto"); }
    else if (difference <= 0.25) { score += 22; reasons.push("precio cercano al presupuesto"); }
  }
  if (commune && interest.includes(commune)) { score += 22; reasons.push(`interés por ${propertyCommune(property)}`); }
  if (type && interest.includes(type)) { score += 16; reasons.push(`tipo ${type}`); }
  if (propertyStage(property) === "AVAILABLE" || propertyStage(property) === "ACTIVE") { score += 8; reasons.push("propiedad disponible"); }
  if (propertyOperation(property) === "RENT" && /(arriend|alquil)/.test(interest)) { score += 12; reasons.push("operación de arriendo compatible"); }
  if (propertyOperation(property) === "SALE" && /(compr|venta|invert)/.test(interest)) { score += 12; reasons.push("operación de compra compatible"); }

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
    { key: "available_inventory", label: "Interesados en inventario disponible", count: properties.filter((property) => ["ACTIVE", "AVAILABLE", "LEAD", "CONTACT"].includes(propertyStage(property))).length, recommendedChannel: "instagram" },
    { key: "hot_buyers", label: "Leads inmobiliarios de alta intención", count: leads.filter((lead) => Number(lead.closeProbability || 0) >= 70).length, recommendedChannel: "whatsapp" },
    { key: "remarketing_visits", label: "Seguimiento de visitas", count: visits.filter((visit) => !["DONE", "CANCELED"].includes(String(visit.status).toUpperCase())).length, recommendedChannel: "whatsapp" }
  ];

  const recommendations = [];
  if (unassigned.length) recommendations.push({ priority: "high", code: "ASSIGN_PROPERTIES", message: `${unassigned.length} propiedades no tienen corredor asignado.` });
  if (photosMissing.length) recommendations.push({ priority: "high", code: "PROPERTY_MEDIA", message: `${photosMissing.length} propiedades no tienen foto principal ni galería.` });
  if (stale.length) recommendations.push({ priority: "medium", code: "STALE_INVENTORY", message: `${stale.length} propiedades llevan más de 14 días sin actualización.` });
  if (leads.filter((lead) => Number(lead.closeProbability || 0) >= 70).length) recommendations.push({ priority: "medium", code: "HOT_LEAD_MATCHING", message: "Hay leads de alta intención para cruzar con el inventario disponible." });
  if (!recommendations.length) recommendations.push({ priority: "low", code: "OPERATING_NORMALLY", message: "Inventario y cartera sin alertas operativas críticas." });

  return {
    generatedAt: new Date().toISOString(),
    inventory: {
      total: properties.length,
      portfolioValue,
      averagePrice: prices.length ? Math.round(portfolioValue / prices.length) : 0,
      averageCompleteness: completed.length ? Math.round(completed.reduce((total, value) => total + value, 0) / completed.length) : 0,
      assigned,
      unassigned: unassigned.length,
      missingMedia: photosMissing.length,
      stale: stale.length,
      byOperation: aggregate(properties, (property) => propertyOperation(property) === "RENT" ? "Arriendo" : "Venta"),
      byStage: aggregate(properties, propertyStage),
      topCommunes: aggregate(properties, propertyCommune).slice(0, 8)
    },
    visits: { total: visits.length, pending: visits.filter((visit) => !["DONE", "CANCELED"].includes(String(visit.status).toUpperCase())).length },
    owners: owners.length,
    brokers: brokerPerformance.slice(0, sampleLimit),
    marketing: {
      campaigns: campaigns.length,
      published: campaigns.filter((campaign) => ["PUBLISHED", "PARTIAL"].includes(String(campaign.status).toUpperCase())).length,
      audiences: marketAudiences
    },
    priorities: recommendations,
    actionQueue: [
      ...unassigned.slice(0, sampleLimit).map((property) => ({ type: "ASSIGNMENT", recordId: property.id, title: property.title, message: "Asignar corredor responsable" })),
      ...photosMissing.slice(0, Math.max(0, sampleLimit - unassigned.length)).map((property) => ({ type: "MEDIA", recordId: property.id, title: property.title, message: "Completar foto principal o galería" }))
    ].slice(0, sampleLimit)
  };
}

export async function getRealtyLeadMatches({ tenantId, leadId, limit = 8 }) {
  const [lead, properties] = await Promise.all([
    prisma.lead.findFirst({ where: { id: leadId, tenantId } }),
    prisma.industryRecord.findMany({ where: { tenantId, recordType: "property", status: { not: "ARCHIVED" } }, select: { id: true, title: true, status: true, data: true, assignedToId: true, updatedAt: true }, take: 1000 })
  ]);
  if (!lead) return null;
  return {
    lead: { id: lead.id, name: lead.name, status: lead.status, budget: lead.budget, closeProbability: lead.closeProbability },
    matches: properties
      .map((property) => ({ property: { id: property.id, title: property.title, status: property.status, price: propertyPrice(property), commune: propertyCommune(property), operation: propertyOperation(property), assignedToId: property.assignedToId }, ...scoreRealtyLeadMatch(lead, property) }))
      .filter((match) => match.score >= 25)
      .sort((a, b) => b.score - a.score || a.property.price - b.property.price)
      .slice(0, Math.max(1, Math.min(Number(limit) || 8, 20)))
  };
}
