function extractBudget(text) {
  const normalized = text
    .toLowerCase()
    .replace(/\./g, "")
    .replace(/,/g, ".");

  const matchMiles = normalized.match(/(\d{2,4})\s*(mil|k)/i);
  if (matchMiles) {
    return Number(matchMiles[1]) * 1000;
  }

  const matchPlain = normalized.match(/\b(\d{5,8})\b/);
  if (matchPlain) {
    return Number(matchPlain[1]);
  }

  return null;
}

function extractInterest(text) {
  const normalized = text.toLowerCase();

  if (/(asado|asados|parrillada|parrilladas|evento|cumple|matrimonio|empresa|corporativo)/i.test(normalized)) {
    return "evento";
  }

  if (normalized.includes("arriendo") || normalized.includes("arrendar")) {
    return "arriendo";
  }

  if (
    normalized.includes("compra") ||
    normalized.includes("comprar") ||
    normalized.includes("venta")
  ) {
    return "compra";
  }

  return null;
}

function extractPropertyType(text) {
  const normalized = text.toLowerCase();

  if (normalized.includes("departamento") || normalized.includes("depto")) {
    return "departamento";
  }

  if (normalized.includes("casa")) {
    return "casa";
  }

  if (/(asado|asados|parrillada|parrilladas)/i.test(normalized)) {
    return "parrillada";
  }

  if (/(evento|cumple|matrimonio|empresa|corporativo)/i.test(normalized)) {
    return "evento";
  }

  return null;
}

function extractUrgency(text) {
  const normalized = text.toLowerCase();

  if (
    normalized.includes("urgente") ||
    normalized.includes("hoy") ||
    normalized.includes("lo antes posible")
  ) {
    return "high";
  }

  if (
    normalized.includes("esta semana") ||
    normalized.includes("pronto")
  ) {
    return "medium";
  }

  return "low";
}

function extractCommune(text) {
  const normalized = text.toLowerCase();

  const communes = [
    "ñuñoa",
    "nunoa",
    "providencia",
    "las condes",
    "vitacura",
    "la reina",
    "peñalolén",
    "penalolen",
    "santiago centro",
    "maipú",
    "maipu",
    "san miguel",
    "la florida",
    "puente alto",
    "quilicura",
    "pudahuel",
    "renca",
  ];

  for (const commune of communes) {
    if (normalized.includes(commune)) {
      if (commune === "nunoa") return "Ñuñoa";
      if (commune === "penalolen") return "Peñalolén";
      if (commune === "maipu") return "Maipú";
      return commune
        .split(" ")
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" ");
    }
  }

  return null;
}

export async function extractEntities({ message }) {
  const text = message || "";

  return {
    commune: extractCommune(text),
    budget: extractBudget(text),
    interest: extractInterest(text),
    propertyType: extractPropertyType(text),
    urgency: extractUrgency(text),
  };
}