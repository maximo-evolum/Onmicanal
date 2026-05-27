export async function detectIntent({ message }) {
  const text = (message || "").toLowerCase();

  if (!text.trim()) return "other";

  if (text.includes("hola") || text.includes("buenas")) {
    return "greeting";
  }

  if (text.includes("visita") || text.includes("agendar")) {
    return "schedule_visit";
  }

  if (
    text.includes("precio") ||
    text.includes("valor") ||
    text.includes("cuánto cuesta") ||
    text.includes("cuanto cuesta")
  ) {
    return "pricing_request";
  }

  if (
    text.includes("departamento") ||
    text.includes("depto") ||
    text.includes("casa") ||
    text.includes("arriendo") ||
    text.includes("comprar") ||
    text.includes("compra")
  ) {
    return "property_search";
  }

  if (
    text.includes("asesor") ||
    text.includes("humano") ||
    text.includes("ejecutivo")
  ) {
    return "human_handoff";
  }

  return "other";
}