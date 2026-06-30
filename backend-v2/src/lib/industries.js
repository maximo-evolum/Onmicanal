import { MODULES, normalizePlanCode } from "./modules.js";

export const PLAN_RANK = Object.freeze({
  STARTER: 1,
  PRO: 2,
  BUSINESS: 3,
  ENTERPRISE: 4
});

function moduleItem(key, label, description, minPlan = "STARTER") {
  return { key, label, description, minPlan };
}

export const INDUSTRY_TEMPLATES = Object.freeze({
  GENERAL: {
    code: "GENERAL",
    name: "General",
    summary: "Operacion comercial omnicanal para negocios sin vertical exclusiva.",
    modules: [
      moduleItem(MODULES.INBOX, "Inbox omnicanal", "Atencion por WhatsApp, Instagram y canales conectados."),
      moduleItem(MODULES.BOOKINGS, "Agenda", "Reservas, citas y disponibilidad por negocio.", "PRO"),
      moduleItem(MODULES.SALES, "Pipeline", "Leads, oportunidades y cierres asistidos.", "PRO"),
      moduleItem(MODULES.MARKETING, "Campanas", "Contenido y destinatarios conectados al inbox.", "BUSINESS"),
      moduleItem(MODULES.PAYMENTS, "Pagos", "Links de pago y seguimiento comercial.", "BUSINESS"),
      moduleItem(MODULES.ANALYTICS, "Dashboard", "Metricas operativas y rendimiento.", "PRO")
    ],
    entities: [
      { key: "conversation", label: "Conversacion", purpose: "Historial comercial por canal." },
      { key: "lead", label: "Lead", purpose: "Interes detectado por IA o equipo." },
      { key: "booking", label: "Reserva", purpose: "Fecha, hora, lugar y responsable." }
    ],
    workflows: ["captura", "calificacion", "agenda/pago", "cierre", "postventa"]
  },
  REAL_ESTATE: {
    code: "REAL_ESTATE",
    name: "Inmobiliaria",
    summary: "Propiedades, vendedores, visitas, pipeline inmobiliario y campanas.",
    modules: [
      moduleItem(MODULES.INBOX, "Inbox inmobiliario", "Consultas y seguimientos por propiedad."),
      moduleItem(MODULES.PROPERTIES, "Propiedades", "Ficha con fotos, material, banos, piezas, estacionamientos, m2 y observaciones.", "PRO"),
      moduleItem(MODULES.PROPERTY_ASSIGNMENTS, "Asignacion de ventas", "Distribucion automatica o manual de propiedades entre vendedores.", "PRO"),
      moduleItem(MODULES.BOOKINGS, "Agenda de visitas", "Visitas por propiedad, sucursal o direccion.", "PRO"),
      moduleItem(MODULES.SALES, "Pipeline inmobiliario", "Estados comerciales por propiedad y comprador.", "PRO"),
      moduleItem(MODULES.MARKETING, "Campanas inmobiliarias", "Publicaciones y mensajes por propiedad.", "BUSINESS"),
      moduleItem(MODULES.PAYMENTS, "Pagos y reservas", "Reservas, abonos y compromisos de compra.", "BUSINESS"),
      moduleItem(MODULES.ANALYTICS, "Dashboard", "Ventas, visitas, conversion y rendimiento de vendedores.", "PRO")
    ],
    entities: [
      {
        key: "property",
        label: "Vivienda / propiedad",
        fields: ["fotos", "material", "banos", "piezas", "estacionamientos", "m2", "precio", "direccion", "observaciones"]
      },
      { key: "seller_assignment", label: "Asignacion vendedor-propiedad", fields: ["vendedor", "propiedad", "estado", "carga_actual"] },
      { key: "visit", label: "Visita", fields: ["cliente", "propiedad", "fecha", "hora", "direccion"] }
    ],
    workflows: ["cargar propiedad", "asignar vendedor", "publicar campana", "agendar visita", "negociar", "cerrar"]
  },
  GASTRONOMY: {
    code: "GASTRONOMY",
    name: "Gastronomia",
    summary: "Reservas, eventos, ganancias, inbox y campanas para negocios gastronomicos.",
    modules: [
      moduleItem(MODULES.INBOX, "Inbox gastronomico", "Consultas, cotizaciones y confirmaciones."),
      moduleItem(MODULES.BOOKINGS, "Agenda de reservas", "Reservas por fecha, hora, personas, sucursal o domicilio."),
      moduleItem(MODULES.CUSTOMERS, "Clientes", "Historial de clientes, preferencias y recurrencia.", "PRO"),
      moduleItem(MODULES.REVENUE, "Ganancias", "Ingresos confirmados, pendientes y forecast.", "PRO"),
      moduleItem(MODULES.MARKETING, "Campanas", "Promociones, historias, reels y mensajes.", "BUSINESS"),
      moduleItem(MODULES.PAYMENTS, "Pagos", "Abonos, links y confirmaciones.", "BUSINESS"),
      moduleItem(MODULES.ANALYTICS, "Dashboard", "Reservas, ingresos, conversion y actividad.", "PRO")
    ],
    entities: [
      { key: "booking", label: "Reserva/evento", fields: ["cliente", "personas", "fecha", "hora", "lugar", "monto", "notas"] },
      { key: "customer", label: "Cliente", fields: ["nombre", "telefono", "preferencias", "historial"] },
      { key: "revenue", label: "Ingreso", fields: ["concepto", "monto", "estado", "reserva_asociada"] }
    ],
    workflows: ["cotizar", "confirmar datos", "agendar", "crear pago", "recordar", "postventa"]
  },
  AUTOMOTIVE: {
    code: "AUTOMOTIVE",
    name: "Automotriz",
    summary: "Vehiculos, repuestos, mecanicos, agenda de taller y aviso de retiro.",
    modules: [
      moduleItem(MODULES.INBOX, "Inbox taller", "Mensajes por cliente, vehiculo y estado de servicio."),
      moduleItem(MODULES.VEHICLES, "Vehiculos", "Ficha de vehiculo, cliente, patente, kilometraje y diagnostico.", "PRO"),
      moduleItem(MODULES.PARTS_INVENTORY, "Repuestos", "Fotos, stock, ubicacion, costo y compatibilidad.", "BUSINESS"),
      moduleItem(MODULES.MECHANIC_ASSIGNMENTS, "Asignacion de mecanicos", "Distribucion de trabajos segun carga y especialidad.", "PRO"),
      moduleItem(MODULES.READY_NOTIFICATIONS, "Aviso de retiro", "Mensaje automatico al cliente cuando el vehiculo esta listo.", "PRO"),
      moduleItem(MODULES.BOOKINGS, "Agenda de taller", "Citas, entregas y retiros.", "PRO"),
      moduleItem(MODULES.PAYMENTS, "Pagos", "Abonos, saldos y links de pago.", "BUSINESS"),
      moduleItem(MODULES.ANALYTICS, "Dashboard", "Ordenes, tiempos, repuestos y rendimiento.", "PRO")
    ],
    entities: [
      { key: "vehicle", label: "Vehiculo", fields: ["cliente", "patente", "marca", "modelo", "ano", "kilometraje", "diagnostico"] },
      { key: "part", label: "Repuesto", fields: ["foto", "sku", "stock", "ubicacion", "costo", "compatibilidad"] },
      { key: "work_order", label: "Orden de trabajo", fields: ["vehiculo", "mecanico", "estado", "fecha_entrega", "notas"] }
    ],
    workflows: ["recibir vehiculo", "asignar mecanico", "validar repuestos", "reparar", "avisar retiro", "cobrar"]
  },
  DENTAL: {
    code: "DENTAL",
    name: "Clinica dental",
    summary: "Pacientes, citas, tratamientos, recordatorios y pagos.",
    modules: [
      moduleItem(MODULES.INBOX, "Inbox pacientes", "Consultas, confirmaciones y recordatorios."),
      moduleItem(MODULES.BOOKINGS, "Agenda clinica", "Citas por profesional, box y tratamiento."),
      moduleItem(MODULES.CUSTOMERS, "Pacientes", "Ficha, historial y preferencias.", "PRO"),
      moduleItem(MODULES.PAYMENTS, "Pagos", "Abonos y saldos de tratamiento.", "BUSINESS"),
      moduleItem(MODULES.ANALYTICS, "Dashboard", "Citas, asistencia y conversion.", "PRO")
    ],
    entities: [
      { key: "patient", label: "Paciente", fields: ["nombre", "telefono", "tratamiento", "historial", "observaciones"] },
      { key: "appointment", label: "Cita", fields: ["paciente", "profesional", "fecha", "hora", "box"] }
    ],
    workflows: ["consulta", "agendar cita", "recordar", "atender", "cobrar", "seguimiento"]
  },
  VETERINARY: {
    code: "VETERINARY",
    name: "Clinica veterinaria",
    summary: "Mascotas, tutores, citas, tratamientos y recordatorios.",
    modules: [
      moduleItem(MODULES.INBOX, "Inbox tutores", "Consultas y seguimiento de mascotas."),
      moduleItem(MODULES.BOOKINGS, "Agenda veterinaria", "Citas, controles y vacunacion."),
      moduleItem(MODULES.CUSTOMERS, "Tutores y mascotas", "Ficha del tutor, mascota e historial.", "PRO"),
      moduleItem(MODULES.PAYMENTS, "Pagos", "Abonos, tratamientos y productos.", "BUSINESS"),
      moduleItem(MODULES.ANALYTICS, "Dashboard", "Citas, tratamientos y recurrencia.", "PRO")
    ],
    entities: [
      { key: "pet", label: "Mascota", fields: ["nombre", "especie", "raza", "edad", "tutor", "historial"] },
      { key: "appointment", label: "Cita veterinaria", fields: ["mascota", "motivo", "fecha", "hora", "profesional"] }
    ],
    workflows: ["consulta", "agendar", "atender", "recordar vacuna/control", "cobrar", "seguimiento"]
  }
});

const INDUSTRY_ALIASES = Object.freeze({
  GENERAL: "GENERAL",
  GENERICO: "GENERAL",
  RESTAURANTE: "GASTRONOMY",
  GASTRONOMIA: "GASTRONOMY",
  GASTRONOMY: "GASTRONOMY",
  FOOD: "GASTRONOMY",
  INMOBILIARIA: "REAL_ESTATE",
  INMOBILIARIO: "REAL_ESTATE",
  REALTY: "REAL_ESTATE",
  REAL_ESTATE: "REAL_ESTATE",
  AUTOMOTRIZ: "AUTOMOTIVE",
  AUTOMOTIVE: "AUTOMOTIVE",
  TALLER: "AUTOMOTIVE",
  DENTAL: "DENTAL",
  ODONTOLOGIA: "DENTAL",
  VETERINARIA: "VETERINARY",
  VETERINARY: "VETERINARY"
});

function normalizeText(value) {
  return String(value || "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/(^_|_$)/g, "")
    .toUpperCase();
}

export function normalizeIndustryCode(value) {
  const normalized = normalizeText(value);
  return INDUSTRY_ALIASES[normalized] || (INDUSTRY_TEMPLATES[normalized] ? normalized : "GENERAL");
}

export function listIndustryTemplates() {
  return Object.values(INDUSTRY_TEMPLATES);
}

export function getIndustryTemplate(value) {
  return INDUSTRY_TEMPLATES[normalizeIndustryCode(value)] || INDUSTRY_TEMPLATES.GENERAL;
}

export function getIndustryModulesForPlan(industry, plan = "STARTER") {
  const template = getIndustryTemplate(industry);
  return getTemplateModulesForPlan(template, plan);
}

export function getTemplateModulesForPlan(template, plan = "STARTER") {
  const rank = PLAN_RANK[normalizePlanCode(plan)] || PLAN_RANK.STARTER;
  return template.modules
    .filter((item) => (PLAN_RANK[normalizePlanCode(item.minPlan)] || PLAN_RANK.STARTER) <= rank)
    .map((item) => item.key);
}

export function buildBalancedAssignments(items = [], assignees = []) {
  const cleanItems = items.filter(Boolean);
  const cleanAssignees = assignees.filter(Boolean);
  if (!cleanAssignees.length) return [];

  return cleanItems.map((item, index) => {
    const assignee = cleanAssignees[index % cleanAssignees.length];
    return {
      item,
      assignee,
      order: index + 1,
      mode: "balanced_round_robin"
    };
  });
}
