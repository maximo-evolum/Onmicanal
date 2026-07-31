export const MODULES = Object.freeze({
  INBOX: "inbox",
  SALES: "sales",
  MARKETING: "marketing",
  BOOKINGS: "bookings",
  PAYMENTS: "payments",
  FOLLOWUPS: "followups",
  ANALYTICS: "analytics",
  REPORTS: "reports",
  AI_OPS: "ai_ops",
  BOT_LAB: "bot_lab",
  DOCUMENTS: "documents",
  WORKFLOWS: "workflows",
  INTEGRATIONS: "integrations",
  GMAIL: "gmail",
  EMAIL_IMAP: "email_imap",
  GOOGLE_DRIVE: "google_drive",
  SHAREPOINT: "sharepoint",
  BACKUP_PROVIDER: "backup_provider",
  OFFLINE_SYNC: "offline_sync",
  SECURITY_REPLICA: "security_replica",
  PROPERTIES: "properties",
  PROPERTY_ASSIGNMENTS: "property_assignments",
  REALTY_LOADS: "realty_loads",
  REALTY_ACTIVITY: "realty_activity",
  BROKER_PORTAL: "broker_portal",
  BROKERS: "brokers",
  CUSTOMERS: "customers",
  REALTY_CLIENTS: "realty_clients",
  PATIENTS: "patients",
  EXAMS: "exams",
  REVENUE: "revenue",
  VEHICLES: "vehicles",
  VEHICLE_OWNERS: "vehicle_owners",
  PARTS_INVENTORY: "parts_inventory",
  MECHANIC_ASSIGNMENTS: "mechanic_assignments",
  READY_NOTIFICATIONS: "ready_notifications",
  // Dotación por vertical: profesionales clínicos o equipo de local. No es la
  // agenda de clientes; registra disponibilidad y cobertura de turnos.
  SHIFT_MANAGEMENT: "shift_management",
  // Operaciones exclusivas por vertical. Cada una persiste tipos de registro
  // propios para evitar que datos de salud, veterinaria y gastronomía se
  // interpreten como si fueran parte del mismo flujo.
  GASTRONOMY_OPERATIONS: "gastronomy_operations",
  DENTAL_CARE: "dental_care",
  HEALTH_CARE: "health_care",
  VETERINARY_CARE: "veterinary_care",
  // EVOLUM Finance OS: capacidades propias de cuentas por cobrar. Estas no
  // reemplazan Pagos ni el Dashboard del Core; agregan el ciclo financiero
  // posterior a la emision de una factura.
  FINANCE_INVOICES: "finance_invoices",
  FINANCE_BANK_SYNC: "finance_bank_sync",
  FINANCE_RECONCILIATION: "finance_reconciliation",
  FINANCE_EXCEPTIONS: "finance_exceptions",
  FINANCE_COLLECTIONS: "finance_collections",
  FINANCE_ANALYTICS: "finance_analytics"
});

export const PLAN_DEFINITIONS = Object.freeze({
  STARTER: {
    code: "STARTER",
    name: "Starter",
    description: "Bot de atención e inbox para responder mensajes.",
    priceMonthly: 0,
    currency: "CLP",
    modules: [MODULES.INBOX, MODULES.DOCUMENTS],
    limits: { messagesMonthly: 500, users: 2 }
  },
  PRO: {
    code: "PRO",
    name: "Pro",
    description: "Ventas, pipeline, scoring, follow-up y reservas.",
    priceMonthly: 49000,
    currency: "CLP",
    modules: [MODULES.INBOX, MODULES.SALES, MODULES.BOOKINGS, MODULES.FOLLOWUPS, MODULES.ANALYTICS, MODULES.AI_OPS, MODULES.DOCUMENTS, MODULES.WORKFLOWS],
    limits: { messagesMonthly: 3000, users: 5 }
  },
  BUSINESS: {
    code: "BUSINESS",
    name: "Business",
    description: "Automatización completa con marketing, pagos y analítica.",
    priceMonthly: 99000,
    currency: "CLP",
    modules: [MODULES.INBOX, MODULES.SALES, MODULES.MARKETING, MODULES.BOOKINGS, MODULES.PAYMENTS, MODULES.FOLLOWUPS, MODULES.ANALYTICS, MODULES.AI_OPS, MODULES.DOCUMENTS, MODULES.WORKFLOWS, MODULES.INTEGRATIONS, MODULES.GMAIL, MODULES.EMAIL_IMAP, MODULES.GOOGLE_DRIVE],
    limits: { messagesMonthly: 10000, users: 15 }
  },
  ENTERPRISE: {
    code: "ENTERPRISE",
    name: "Enterprise",
    description: "Todo activado, límites personalizados y soporte avanzado.",
    priceMonthly: 0,
    currency: "CLP",
    // Bot Lab y Reportes no son módulos de cliente: Reportes se integró al
    // Dashboard. SUPER_ADMIN conserva sus herramientas por rol.
    modules: Object.values(MODULES).filter((module) => ![MODULES.BOT_LAB, MODULES.REPORTS].includes(module)),
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
