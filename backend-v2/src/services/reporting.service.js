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

const REPORT_PERIOD_DAYS = 30;

function daysAgo(days, now = new Date()) {
  const value = new Date(now);
  value.setDate(value.getDate() - days);
  return value;
}

function inRange(value, start, end) {
  const date = value ? new Date(value) : null;
  return Boolean(date && !Number.isNaN(date.getTime()) && date >= start && date < end);
}

function inCurrentPeriod(items, dateOf, period) {
  return items.filter((item) => inRange(dateOf(item), period.start, period.end));
}

function inPreviousPeriod(items, dateOf, period) {
  return items.filter((item) => inRange(dateOf(item), period.previousStart, period.start));
}

function changeDetail(current, previous, unit = "registros") {
  const delta = number(current) - number(previous);
  if (!previous && !current) return `Sin ${unit} en los últimos dos periodos`;
  if (!previous) return `${current} ${unit}; sin base anterior para comparar`;
  const percent = Math.round((delta / previous) * 100);
  if (!delta) return `Sin variación vs. periodo anterior (${previous})`;
  return `${delta > 0 ? "+" : ""}${delta} ${unit} (${percent > 0 ? "+" : ""}${percent}%) vs. periodo anterior`;
}

function moneyFromRecord(record) {
  const data = record?.data && typeof record.data === "object" && !Array.isArray(record.data) ? record.data : {};
  return number(data.amount ?? data.monto ?? data.cost ?? data.costo ?? data.value ?? data.valor ?? 0);
}

function rate(numerator, denominator) {
  if (!denominator) return 0;
  return Math.round((number(numerator) / number(denominator)) * 100);
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
  const now = new Date();
  const period = {
    days: REPORT_PERIOD_DAYS,
    end: now,
    start: daysAgo(REPORT_PERIOD_DAYS, now),
    previousStart: daysAgo(REPORT_PERIOD_DAYS * 2, now)
  };
  const [tenant, conversations, leads, contacts, bookings, payments, recordGroups, expenses, outcomes] = await Promise.all([
    prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true, industry: true } }),
    prisma.conversation.findMany({ where: { tenantId }, select: { status: true, aiHandoffRequired: true, aiCloseScore: true, createdAt: true } }),
    prisma.lead.findMany({ where: { tenantId }, select: { status: true, budget: true, closeProbability: true, createdAt: true } }),
    prisma.contact.findMany({ where: { tenantId }, select: { createdAt: true } }),
    prisma.booking.findMany({ where: { tenantId }, select: { status: true, total: true, date: true, createdAt: true } }),
    prisma.payment.findMany({ where: { tenantId }, select: { status: true, amount: true, currency: true, paidAt: true, createdAt: true } }),
    prisma.industryRecord.groupBy({ where: { tenantId }, by: ["recordType"], _count: { _all: true } }),
    prisma.industryRecord.findMany({ where: { tenantId, recordType: "expense" }, select: { data: true, createdAt: true } }),
    prisma.salesOutcome.findMany({ where: { tenantId }, select: { outcome: true, createdAt: true } })
  ]);

  const recordCounts = Object.fromEntries(recordGroups.map((group) => [group.recordType, group._count._all]));
  const pendingPayments = payments.filter((payment) => ["PENDING", "PARTIAL"].includes(payment.status));
  const paidPayments = payments.filter((payment) => payment.status === "PAID");
  const canceledPayments = payments.filter((payment) => payment.status === "CANCELED");
  const hotLeads = leads.filter((lead) => number(lead.closeProbability) >= 75 || ["READY_TO_CLOSE", "NEGOTIATION", "PAYMENT_PENDING"].includes(lead.status));
  const forecast = sum(leads, "budget");
  const industry = String(tenant?.industry || "GENERAL").toUpperCase();
  const paymentDate = (payment) => payment.paidAt || payment.createdAt;
  const currentPaid = inCurrentPeriod(paidPayments, paymentDate, period);
  const previousPaid = inPreviousPeriod(paidPayments, paymentDate, period);
  const currentCanceled = inCurrentPeriod(payments.filter((payment) => ["CANCELED", "REFUNDED", "FAILED"].includes(payment.status)), (payment) => payment.createdAt, period);
  const previousCanceled = inPreviousPeriod(payments.filter((payment) => ["CANCELED", "REFUNDED", "FAILED"].includes(payment.status)), (payment) => payment.createdAt, period);
  const currentRefunded = inCurrentPeriod(payments.filter((payment) => payment.status === "REFUNDED"), (payment) => payment.createdAt, period);
  const previousRefunded = inPreviousPeriod(payments.filter((payment) => payment.status === "REFUNDED"), (payment) => payment.createdAt, period);
  const currentExpenses = inCurrentPeriod(expenses, (item) => item.createdAt, period);
  const previousExpenses = inPreviousPeriod(expenses, (item) => item.createdAt, period);
  const currentContacts = inCurrentPeriod(contacts, (item) => item.createdAt, period);
  const previousContacts = inPreviousPeriod(contacts, (item) => item.createdAt, period);
  const currentLeads = inCurrentPeriod(leads, (item) => item.createdAt, period);
  const previousLeads = inPreviousPeriod(leads, (item) => item.createdAt, period);
  const currentBookings = inCurrentPeriod(bookings, (item) => item.createdAt, period);
  const previousBookings = inPreviousPeriod(bookings, (item) => item.createdAt, period);
  const currentOutcomes = inCurrentPeriod(outcomes, (item) => item.createdAt, period);
  const previousOutcomes = inPreviousPeriod(outcomes, (item) => item.createdAt, period);
  const currentIncome = sum(currentPaid, "amount");
  const previousIncome = sum(previousPaid, "amount");
  const currentExpenseAmount = currentExpenses.reduce((total, item) => total + moneyFromRecord(item), 0);
  const previousExpenseAmount = previousExpenses.reduce((total, item) => total + moneyFromRecord(item), 0);
  const currentRefundedAmount = sum(currentRefunded, "amount");
  const previousRefundedAmount = sum(previousRefunded, "amount");
  const currentNet = currentIncome - currentExpenseAmount - currentRefundedAmount;
  const previousNet = previousIncome - previousExpenseAmount - previousRefundedAmount;
  const currentWon = currentOutcomes.filter((item) => ["WON", "PAID"].includes(item.outcome)).length;
  const currentLost = currentOutcomes.filter((item) => ["LOST", "NO_RESPONSE"].includes(item.outcome)).length;
  const previousWon = previousOutcomes.filter((item) => ["WON", "PAID"].includes(item.outcome)).length;
  const previousLost = previousOutcomes.filter((item) => ["LOST", "NO_RESPONSE"].includes(item.outcome)).length;

  return {
    generatedAt: new Date().toISOString(),
    tenant: { name: tenant?.name || "Cuenta", industry, industryLabel: INDUSTRY_LABELS[industry] || industry },
    period: {
      days: period.days,
      start: period.start.toISOString(),
      end: period.end.toISOString(),
      previousStart: period.previousStart.toISOString()
    },
    summary: [
      metric("Resultado neto", currentNet, changeDetail(currentNet, previousNet, "CLP")),
      metric("Ingresos cobrados", currentIncome, changeDetail(currentIncome, previousIncome, "CLP")),
      metric("Costos registrados", currentExpenseAmount, changeDetail(currentExpenseAmount, previousExpenseAmount, "CLP")),
      metric("Clientes nuevos", currentContacts.length, changeDetail(currentContacts.length, previousContacts.length, "clientes")),
      metric("Leads nuevos", currentLeads.length, changeDetail(currentLeads.length, previousLeads.length, "leads")),
      metric("Cobros caídos", sum(currentCanceled, "amount"), changeDetail(sum(currentCanceled, "amount"), sum(previousCanceled, "amount"), "CLP"))
    ],
    economicChart: {
      title: "Estado económico del período (CLP)",
      series: [
        { label: "Ingresos", value: currentIncome },
        { label: "Costos", value: currentExpenseAmount },
        { label: "Devuelto", value: currentRefundedAmount },
        { label: "Neto", value: Math.max(0, currentNet) }
      ]
    },
    comparisons: {
      economics: [
        { label: "Ingresos", current: currentIncome, previous: previousIncome, format: "currency" },
        { label: "Costos", current: currentExpenseAmount, previous: previousExpenseAmount, format: "currency" },
        { label: "Neto", current: currentNet, previous: previousNet, format: "currency" },
        { label: "Cobros caídos", current: sum(currentCanceled, "amount"), previous: sum(previousCanceled, "amount"), format: "currency" }
      ],
      operation: [
        { label: "Clientes nuevos", current: currentContacts.length, previous: previousContacts.length },
        { label: "Leads", current: currentLeads.length, previous: previousLeads.length },
        { label: "Reservas", current: currentBookings.length, previous: previousBookings.length },
        { label: "Cierres", current: currentWon, previous: previousWon }
      ]
    },
    executiveStatus: {
      totalCustomers: contacts.length,
      currentCustomers: currentContacts.length,
      previousCustomers: previousContacts.length,
      customerVariation: currentContacts.length - previousContacts.length,
      currentIncome,
      previousIncome,
      currentExpenses: currentExpenseAmount,
      previousExpenses: previousExpenseAmount,
      currentRefunded: currentRefundedAmount,
      currentNet,
      previousNet,
      currentLost,
      previousLost,
      conversionRate: rate(currentWon, currentLeads.length),
      pendingCollection: sum(pendingPayments, "amount"),
      handoffs: conversations.filter((item) => item.aiHandoffRequired).length
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
          metric("Ingresos cobrados", currentIncome, `${currentPaid.length} pagos confirmados en el período`),
          metric("Pendientes", sum(pendingPayments, "amount"), `${pendingPayments.length} pagos por cobrar`),
          metric("Costos registrados", currentExpenseAmount, `${currentExpenses.length} gastos registrados en el período`),
          metric("Cobros caídos", sum(currentCanceled, "amount"), `${currentCanceled.length} pagos cancelados, fallidos o devueltos`),
          metric("Resultado neto", currentNet, "Ingresos menos costos y devoluciones")
        ]
      },
      ...industrySections(industry, recordCounts, bookings, payments),
      {
        id: "base",
        title: "Base operativa",
        description: "Datos disponibles para reportes automáticos y futuras verticales.",
        metrics: [
          metric("Contactos", contacts.length, "Base omnicanal"),
          metric("Reservas", bookings.length, `${bookings.filter((item) => item.status === "CONFIRMED").length} confirmadas`),
          metric("Registros de rubro", Object.values(recordCounts).reduce((total, count) => total + number(count), 0), "Metadatos y fichas operativas"),
          metric("Tipos de registro", Object.keys(recordCounts).length, "Modelo adaptable por vertical")
        ]
      }
    ]
  };
}
