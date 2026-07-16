import { prisma } from "../lib/db.js";

const INDUSTRY_LABELS = Object.freeze({
  REAL_ESTATE: "Inmobiliaria",
  GASTRONOMY: "Gastronomía",
  AUTOMOTIVE: "Taller mecánico",
  HEALTH: "Clínica de salud",
  DENTAL: "Clínica dental",
  VETERINARY: "Veterinaria",
  GENERAL: "General"
});

const RECORD_LABELS = Object.freeze({
  property: "Propiedades",
  owner: "Propietarios",
  broker_profile: "Corredores",
  seller_assignment: "Asignaciones comerciales",
  visit: "Visitas",
  deal: "Negocios",
  commission_distribution: "Comisiones",
  vehicle: "Vehículos",
  part: "Repuestos",
  work_order: "Órdenes de taller",
  ready_notification: "Avisos de retiro",
  customer: "Clientes o pacientes",
  document: "Documentos",
  revenue: "Ingresos",
  expense: "Gastos",
  workflow_run: "Ejecuciones de flujo"
});

function number(value) {
  return Number(value || 0);
}

function sum(items, property) {
  return items.reduce((total, item) => total + number(item[property]), 0);
}

function metric(label, value, detail = "") {
  return { label, value, detail };
}

function recordCount(recordCounts, type) {
  return recordCounts[type] || 0;
}

function industrySections(industry, recordCounts, bookings, payments) {
  const shared = [
    {
      id: "clientes",
      title: "Clientes y atención",
      description: "Base operativa y continuidad de la relación comercial.",
      metrics: [
        metric("Fichas", recordCount(recordCounts, "customer"), "Clientes o pacientes registrados"),
        metric("Reservas", bookings.length, "Agenda y citas"),
        metric("Documentos", recordCount(recordCounts, "document"), "Archivos disponibles")
      ]
    }
  ];

  if (industry === "REAL_ESTATE") {
    return [
      {
        id: "inmobiliaria",
        title: "Informe inmobiliario",
        description: "Inventario, cartera comercial y actividad de corredores.",
        metrics: [
          metric("Propiedades", recordCount(recordCounts, "property"), "Inventario publicado o en preparación"),
          metric("Propietarios", recordCount(recordCounts, "owner"), "Base de captación"),
          metric("Corredores", recordCount(recordCounts, "broker_profile"), "Usuarios comerciales activos"),
          metric("Visitas", recordCount(recordCounts, "visit"), "Agenda comercial"),
          metric("Negocios", recordCount(recordCounts, "deal"), "Ventas o arriendos en gestión"),
          metric("Comisiones", recordCount(recordCounts, "commission_distribution"), "Distribuciones registradas")
        ]
      },
      ...shared
    ];
  }

  if (industry === "AUTOMOTIVE") {
    return [
      {
        id: "automotriz",
        title: "Informe de taller",
        description: "Vehículos, inventario, órdenes y avisos de retiro.",
        metrics: [
          metric("Vehículos", recordCount(recordCounts, "vehicle"), "Ingresos al taller"),
          metric("Repuestos", recordCount(recordCounts, "part"), "Stock registrado"),
          metric("Órdenes", recordCount(recordCounts, "work_order"), "Trabajos en curso"),
          metric("Avisos de retiro", recordCount(recordCounts, "ready_notification"), "Clientes notificados")
        ]
      },
      ...shared
    ];
  }

  if (industry === "VETERINARY") {
    return [
      {
        id: "veterinaria",
        title: "Informe veterinario",
        description: "Mascotas, tutores, controles, documentos y continuidad de atencion veterinaria.",
        metrics: [
          metric("Tutores y mascotas", recordCount(recordCounts, "customer"), "Fichas veterinarias activas"),
          metric("Controles", bookings.length, "Agenda veterinaria por confirmar o atendida"),
          metric("Documentos veterinarios", recordCount(recordCounts, "document"), "Archivos clinicos de mascotas disponibles")
        ]
      },
      ...shared
    ];
  }

  if (industry === "HEALTH") {
    return [
      {
        id: "atencion",
        title: "Informe de salud clínica",
        description: "Pacientes, agenda, exámenes, presupuestos y continuidad de atención humana.",
        metrics: [
          metric("Pacientes", recordCount(recordCounts, "customer"), "Fichas activas"),
          metric("Citas", bookings.length, "Agenda por confirmar o atendida"),
          metric("Exámenes y presupuestos", recordCount(recordCounts, "exam"), "Órdenes, resultados y cotizaciones"),
          metric("Documentos", recordCount(recordCounts, "document"), "Archivos clínicos disponibles")
        ]
      },
      ...shared
    ];
  }

  if (industry === "DENTAL") {
    return [
      {
        id: "atencion_dental",
        title: "Informe de clínica dental",
        description: "Pacientes, agenda, exámenes, presupuestos y planes de tratamiento dental.",
        metrics: [
          metric("Pacientes", recordCount(recordCounts, "customer"), "Fichas odontológicas activas"),
          metric("Citas", bookings.length, "Agenda por confirmar o atendida"),
          metric("Exámenes y presupuestos", recordCount(recordCounts, "exam"), "Órdenes, resultados y cotizaciones"),
          metric("Documentos", recordCount(recordCounts, "document"), "Archivos de tratamiento disponibles")
        ]
      },
      ...shared
    ];
  }

  if (industry === "GASTRONOMY") {
    return [
      {
        id: "gastronomia",
        title: "Informe gastronómico",
        description: "Reservas, clientes y operación gastronómica sobre el Core CRM.",
        metrics: [
          metric("Reservas", bookings.length, "Eventos, mesas y servicios"),
          metric("Clientes", recordCount(recordCounts, "customer"), "Preferencias e historial")
        ]
      },
      ...shared
    ];
  }

  const verticalRecords = Object.entries(recordCounts)
    .filter(([type]) => !["customer", "document", "revenue", "expense"].includes(type))
    .slice(0, 8)
    .map(([type, count]) => metric(RECORD_LABELS[type] || type.replaceAll("_", " "), count, "Dato de la vertical"));

  return [
    {
      id: "vertical",
      title: "Informe de la vertical",
      description: "Indicadores generados automáticamente desde los registros del rubro.",
      metrics: verticalRecords.length ? verticalRecords : [metric("Registros", 0, "Sin registros específicos todavía")]
    },
    ...shared
  ];
}

export async function getIndustryReports({ tenantId }) {
  const [tenant, conversations, leads, contacts, bookings, payments, recordGroups] = await Promise.all([
    prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true, industry: true } }),
    prisma.conversation.findMany({ where: { tenantId }, select: { status: true, aiHandoffRequired: true, aiCloseScore: true } }),
    prisma.lead.findMany({ where: { tenantId }, select: { status: true, budget: true, closeProbability: true } }),
    prisma.contact.count({ where: { tenantId } }),
    prisma.booking.findMany({ where: { tenantId }, select: { status: true, total: true, date: true } }),
    prisma.payment.findMany({ where: { tenantId }, select: { status: true, amount: true, currency: true } }),
    prisma.industryRecord.groupBy({ where: { tenantId }, by: ["recordType"], _count: { _all: true } })
  ]);

  const recordCounts = Object.fromEntries(recordGroups.map((group) => [group.recordType, group._count._all]));
  const pendingPayments = payments.filter((payment) => ["PENDING", "PARTIAL"].includes(payment.status));
  const paidPayments = payments.filter((payment) => payment.status === "PAID");
  const canceledPayments = payments.filter((payment) => payment.status === "CANCELED");
  const hotLeads = leads.filter((lead) => number(lead.closeProbability) >= 75 || ["READY_TO_CLOSE", "NEGOTIATION", "PAYMENT_PENDING"].includes(lead.status));
  const forecast = sum(leads, "budget");
  const industry = String(tenant?.industry || "GENERAL").toUpperCase();

  return {
    generatedAt: new Date().toISOString(),
    tenant: { name: tenant?.name || "Cuenta", industry, industryLabel: INDUSTRY_LABELS[industry] || industry },
    summary: [
      metric("Leads", leads.length, `${hotLeads.length} con prioridad comercial`),
      metric("Conversaciones", conversations.length, `${conversations.filter((item) => item.aiHandoffRequired).length} requieren seguimiento`),
      metric("Cobrado", sum(paidPayments, "amount"), `${paidPayments.length} pagos confirmados`),
      metric("Pendiente", sum(pendingPayments, "amount"), `${pendingPayments.length} cobros por gestionar`)
    ],
    economicChart: {
      title: "Resumen económico (CLP)",
      series: [
        { label: "Cobrado", value: sum(paidPayments, "amount") },
        { label: "Pendiente", value: sum(pendingPayments, "amount") },
        { label: "Cancelado", value: sum(canceledPayments, "amount") },
        { label: "Forecast", value: forecast }
      ]
    },
    sections: [
      {
        id: "comercial",
        title: "Comercial y ventas",
        description: "Pipeline, cierres y señales de conversión.",
        metrics: [
          metric("Leads", leads.length, "Oportunidades registradas"),
          metric("Listos para cierre", hotLeads.length, "Alta intención o pago pendiente"),
          metric("Forecast", forecast, "Valor estimado del pipeline"),
          metric("Score promedio", leads.length ? Math.round(sum(leads, "closeProbability") / leads.length) : 0, "Probabilidad comercial")
        ]
      },
      {
        id: "contabilidad",
        title: "Contabilidad y cobranza",
        description: "Estado de pagos, ingresos y anulaciones.",
        metrics: [
          metric("Pagados", sum(paidPayments, "amount"), `${paidPayments.length} pagos confirmados`),
          metric("Pendientes", sum(pendingPayments, "amount"), `${pendingPayments.length} pagos por cobrar`),
          metric("Cancelados", sum(canceledPayments, "amount"), `${canceledPayments.length} pagos cancelados`),
          metric("Ingresos registrados", recordCount(recordCounts, "revenue"), "Registros de ganancias")
        ]
      },
      ...industrySections(industry, recordCounts, bookings, payments),
      {
        id: "base",
        title: "Base operativa",
        description: "Datos disponibles para reportes automáticos y futuras verticales.",
        metrics: [
          metric("Contactos", contacts, "Base omnicanal"),
          metric("Reservas", bookings.length, `${bookings.filter((item) => item.status === "CONFIRMED").length} confirmadas`),
          metric("Registros de rubro", Object.values(recordCounts).reduce((total, count) => total + number(count), 0), "Metadatos y fichas operativas"),
          metric("Tipos de registro", Object.keys(recordCounts).length, "Modelo adaptable por vertical")
        ]
      }
    ]
  };
}
