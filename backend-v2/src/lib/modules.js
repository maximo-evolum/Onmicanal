export const MODULES = Object.freeze({
  INBOX: "inbox",
  SALES: "sales",
  MARKETING: "marketing",
  BOOKINGS: "bookings",
  PAYMENTS: "payments",
  FOLLOWUPS: "followups",
  ANALYTICS: "analytics",
  BOT_LAB: "bot_lab"
});

export const PLAN_DEFINITIONS = Object.freeze({
  STARTER: {
    code: "STARTER",
    name: "Starter",
    description: "Bot de atención e inbox para responder mensajes.",
    priceMonthly: 0,
    currency: "CLP",
    modules: [MODULES.INBOX, MODULES.BOT_LAB],
    limits: { messagesMonthly: 500, users: 2 }
  },
  PRO: {
    code: "PRO",
    name: "Pro",
    description: "Ventas, pipeline, scoring, follow-up y reservas.",
    priceMonthly: 49000,
    currency: "CLP",
    modules: [MODULES.INBOX, MODULES.SALES, MODULES.BOOKINGS, MODULES.FOLLOWUPS, MODULES.ANALYTICS, MODULES.BOT_LAB],
    limits: { messagesMonthly: 3000, users: 5 }
  },
  BUSINESS: {
    code: "BUSINESS",
    name: "Business",
    description: "Automatización completa con marketing, pagos y analítica.",
    priceMonthly: 99000,
    currency: "CLP",
    modules: [MODULES.INBOX, MODULES.SALES, MODULES.MARKETING, MODULES.BOOKINGS, MODULES.PAYMENTS, MODULES.FOLLOWUPS, MODULES.ANALYTICS, MODULES.BOT_LAB],
    limits: { messagesMonthly: 10000, users: 15 }
  },
  ENTERPRISE: {
    code: "ENTERPRISE",
    name: "Enterprise",
    description: "Todo activado, límites personalizados y soporte avanzado.",
    priceMonthly: 0,
    currency: "CLP",
    modules: Object.values(MODULES),
    limits: { messagesMonthly: null, users: null }
  }
});

export function normalizePlanCode(plan) {
  const code = String(plan || "STARTER").toUpperCase();
  // Compatibilidad con tenants antiguos del MVP.
  if (["MVP", "FREE", "DEMO"].includes(code)) return "BUSINESS";
  return PLAN_DEFINITIONS[code] ? code : "STARTER";
}

export function getModulesForPlan(plan) {
  return PLAN_DEFINITIONS[normalizePlanCode(plan)].modules;
}
