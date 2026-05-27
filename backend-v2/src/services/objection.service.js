import { detectSalesObjection, salesBrainFallbackReply } from "./sales-brain.service.js";

export function detectObjection(message = "") {
  const detected = detectSalesObjection(message);
  if (detected) return detected.type;
  return null;
}

export function objectionLabel(type) {
  const labels = {
    price: "Objeción por precio",
    doubt: "Duda o indecisión",
    delay: "Postergación",
    location: "Objeción por ubicación/despacho",
    availability: "Disponibilidad",
    comparison: "Comparación con alternativa",
    trust: "Confianza o prueba social"
  };
  return labels[type] || "Sin objeción";
}

export function handleObjection(type, context = {}) {
  const businessType = context.businessType || "general";
  const message = context.message || "";
  const brainReply = salesBrainFallbackReply({ message, industry: businessType });
  if (brainReply) return brainReply;

  switch (type) {
    case "price":
      return "Te entiendo 🙌 más que solo precio, la idea es que recibas una solución completa y sin complicarte. Podemos ajustar la opción según tu presupuesto. ¿En qué rango te gustaría mantenerte?";
    case "doubt":
      return "Totalmente válido 👍 si quieres te explico simple cómo funciona y qué incluye, para que decidas con tranquilidad. ¿Qué parte te genera más duda?";
    case "delay":
      return "Perfecto, no hay problema. Te puedo dejar una opción guardada o enviarte la info resumida para que la revises después. ¿Para cuándo lo estás evaluando?";
    case "location":
      return "Lo revisamos 🙌 dependiendo de la zona podemos coordinar despacho, atención o alternativa cercana. ¿En qué comuna o lugar sería?";
    case "availability":
      return "Te ayudo a revisar disponibilidad real 🙌 si esa opción no está, puedo recomendarte una alternativa parecida. ¿Quieres que busque una opción similar?";
    case "comparison":
      return "Tiene sentido comparar 😊 Lo importante es revisar qué incluye realmente cada opción y qué tan completa es la experiencia. ¿Qué alternativa estás comparando?";
    case "trust":
      return "Buena pregunta 🙌 te puedo explicar cómo trabajamos y qué incluye el proceso para que avances con seguridad. ¿Quieres que te cuente el paso a paso?";
    default:
      return null;
  }
}
