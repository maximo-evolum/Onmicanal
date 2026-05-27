import { prisma } from "../lib/db.js";

const STOP_WORDS = new Set([
  "hola", "buenas", "busco", "quiero", "necesito", "tienes", "tienen", "algo",
  "para", "con", "por", "de", "del", "el", "la", "los", "las", "un", "una", "unos", "unas",
  "precio", "valor", "cuanto", "cuánto", "disponible", "stock", "despacho", "comprar",
  "cotizar", "info", "informacion", "información", "me", "puedes", "mostrar", "ver"
]);

function normalize(text = "") {
  return String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function parseBudget(text = "") {
  const normalized = normalize(text);
  const matches = [...normalized.matchAll(/(?:\$\s*)?(\d[\d\.,]{1,12}|\d{1,3})\s*(millones|millon|m|mil|k)?/gi)];

  for (const match of matches) {
    const rawToken = match[1];
    const suffix = match[2] || "";
    const numeric = Number(String(rawToken).replace(/[\.,]/g, ""));
    if (!Number.isFinite(numeric) || numeric <= 0) continue;

    if (suffix === "mil" || suffix === "k") return Math.round(numeric * 1000);
    if (suffix === "m" || suffix === "millon" || suffix === "millones") return Math.round(numeric * 1000000);

    // Si el usuario escribió 500 y habla de presupuesto/precio, en Chile suele significar 500 mil.
    if (numeric >= 100 && numeric <= 999 && /(presupuesto|precio|valor|cuesta|hasta|barato|economico|económico)/i.test(normalized)) {
      return numeric * 1000;
    }

    return numeric;
  }

  return null;
}

export function extractProductPreferences(message = "") {
  const text = normalize(message);
  const budget = parseBudget(text);
  const wantedInStock = /(stock|disponible|disponibles|queda|quedan|entrega|despacho)/i.test(text);
  const categoryHints = [];

  if (/(casa|departamento|depto|propiedad|arriendo|inmobiliaria)/i.test(text)) categoryHints.push("inmobiliaria");
  if (/(zapatilla|ropa|polera|pantalon|pantalón|tienda|producto)/i.test(text)) categoryHints.push("ecommerce");
  if (/(servicio|asesoria|asesoría|consulta|plan|mensualidad)/i.test(text)) categoryHints.push("servicios");
  if (/(asado|asados|parrillada|parrilladas|parrillero|evento|cumple|matrimonio|empresa|corporativo)/i.test(text)) categoryHints.push("parrilladas");

  const keywords = text
    .replace(/[^a-z0-9ñ\s]/gi, " ")
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 3 && !STOP_WORDS.has(w) && !/^\d+$/.test(w));

  return {
    budget,
    wantedInStock,
    categoryHints: [...new Set(categoryHints)],
    keywords: [...new Set(keywords)].slice(0, 8)
  };
}

function productText(product) {
  return [product.name, product.description, product.category, product.location]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

export function rankProducts(products, preferences) {
  return products
    .map((product) => {
      let score = 0;
      const text = productText(product);

      for (const keyword of preferences.keywords || []) {
        if (text.includes(keyword)) score += 12;
      }

      for (const hint of preferences.categoryHints || []) {
        if (String(product.category || "").toLowerCase().includes(hint)) score += 18;
      }

      if (preferences.budget && Number(product.price) > 0) {
        const price = Number(product.price);
        if (price <= preferences.budget) score += 25;
        else if (price <= preferences.budget * 1.2) score += 12;
        else score -= 10;
      }

      if (preferences.wantedInStock && product.stock > 0) score += 10;
      if (product.stock > 0) score += 5;
      if (product.stock <= 0) score -= 20;

      return { ...product, recommendationScore: Math.max(0, Math.round(score)) };
    })
    .sort((a, b) => b.recommendationScore - a.recommendationScore);
}

export async function searchProducts({ tenantId, query, take = 5 }) {
  if (!tenantId) return [];

  const preferences = extractProductPreferences(query);
  const or = [];

  for (const keyword of preferences.keywords || []) {
    or.push({ name: { contains: keyword, mode: "insensitive" } });
    or.push({ description: { contains: keyword, mode: "insensitive" } });
    or.push({ category: { contains: keyword, mode: "insensitive" } });
    or.push({ location: { contains: keyword, mode: "insensitive" } });
  }

  for (const hint of preferences.categoryHints || []) {
    or.push({ category: { contains: hint, mode: "insensitive" } });
  }

  const where = {
    tenantId,
    ...(or.length ? { OR: or } : {})
  };

  let products = await prisma.product.findMany({
    where,
    orderBy: [{ stock: "desc" }, { updatedAt: "desc" }],
    take: Math.max(take * 3, 15)
  });

  if (!products.length) {
    products = await prisma.product.findMany({
      where: { tenantId },
      orderBy: [{ stock: "desc" }, { updatedAt: "desc" }],
      take: Math.max(take * 3, 15)
    });
  }

  return rankProducts(products, preferences).slice(0, take);
}

export function buildProductContext(products = []) {
  if (!products.length) return "No hay productos cargados todavía.";

  return products.map((p, index) => {
    const price = Number(p.price || 0).toLocaleString("es-CL", { maximumFractionDigits: 0 });
    return `${index + 1}. ${p.name}\n   Precio: $${price}\n   Stock: ${p.stock}\n   Categoría: ${p.category || "N/A"}\n   Ubicación/despacho: ${p.location || "N/A"}\n   Detalles: ${p.description || "Sin descripción"}\n   Score recomendación: ${p.recommendationScore ?? 0}`;
  }).join("\n");
}
