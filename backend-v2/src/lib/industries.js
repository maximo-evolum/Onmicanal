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
    summary: "Broker inmobiliario con propiedades, propietarios, corredores, visitas, negocios, comisiones y base para IA.",
    modules: [
      moduleItem(MODULES.INBOX, "Inbox inmobiliario", "Consultas y seguimientos por propiedad."),
      moduleItem(MODULES.REALTY_LOADS, "Cargas inmobiliarias", "Creacion de propiedades, corredores, importacion masiva, capacitacion, recordatorios, agenda comercial y comisiones.", "PRO"),
      moduleItem(MODULES.PROPERTIES, "Propiedades", "Portal de propiedades cargadas con fichas, fotos, estado comercial y datos relevantes.", "PRO"),
      moduleItem(MODULES.BROKERS, "Corredores", "Perfiles de corredores y asignacion manual o automatica de propiedades.", "PRO"),
      moduleItem(MODULES.BROKER_PORTAL, "Portal corredor", "Vista independiente de propiedades asignadas y seguimiento comercial por corredor.", "PRO"),
      moduleItem(MODULES.PROPERTY_ASSIGNMENTS, "Asignacion de ventas", "Distribucion automatica o manual de propiedades entre vendedores.", "PRO"),
      moduleItem(MODULES.REALTY_ACTIVITY, "Actividad inmobiliaria", "Visitas, propietarios, portal corredor, alertas y propiedades activas.", "PRO"),
      moduleItem(MODULES.BOOKINGS, "Agenda de visitas", "Visitas por propiedad, sucursal o direccion.", "PRO"),
      moduleItem(MODULES.SALES, "Pipeline inmobiliario", "Estados comerciales por propiedad y comprador.", "PRO"),
      moduleItem(MODULES.REALTY_CLIENTS, "Clientes", "Fichas de compradores, presupuesto, preferencias y propiedades compatibles.", "PRO"),
      moduleItem(MODULES.MARKETING, "Campanas inmobiliarias", "Publicaciones y mensajes por propiedad.", "BUSINESS"),
      moduleItem(MODULES.PAYMENTS, "Pagos y reservas", "Reservas, abonos y compromisos de compra.", "BUSINESS"),
      moduleItem(MODULES.ANALYTICS, "Dashboard", "Ventas, visitas, conversion y rendimiento de vendedores.", "PRO")
    ],
    entities: [
      {
        type: "property",
        label: "Vivienda / propiedad",
        fields: {
          address: { type: "string", required: true },
          propertyType: { type: "string", required: true, options: ["casa", "departamento", "terreno", "oficina", "local"] },
          operation: { type: "string", required: true, options: ["venta", "arriendo"] },
          price: { type: "number", required: true },
          stage: { type: "string", required: true },
          status: { type: "string", required: true },
          meters: "number",
          bedrooms: "number",
          bathrooms: "number",
          parking: "number",
          material: "string",
          photoUrl: "string",
          captureDate: "string",
          captureOrigin: { type: "string", options: ["TGI", "referido", "captacion_evolum"] },
          observations: "string",
          source: { type: "string", options: ["manual", "excel_import", "api", "agent"] },
          importBatchId: "string",
          importFileName: "string",
          importRowNumber: "number",
          recognizedFields: "number",
          predictiveLearning: "json"
        }
      },
      {
        type: "owner",
        label: "Propietario",
        fields: {
          name: { type: "string", required: true },
          phone: "string",
          email: "string",
          origin: { type: "string", options: ["referido", "captacion_evolum", "base_tgi", "web"] }
        }
      },
      {
        type: "lead",
        label: "Contacto / lead",
        fields: {
          name: { type: "string", required: true },
          phone: "string",
          interestType: { type: "string", options: ["compra", "arriendo"] },
          budget: "number",
          pipelineStage: "string",
          interestedPropertyId: "string"
        }
      },
      {
        type: "seller_assignment",
        label: "Asignacion vendedor-propiedad",
        fields: {
          sellerId: { type: "string", required: true },
          propertyId: { type: "string", required: true },
          assignmentMode: { type: "string", options: ["manual", "balanceada"] },
          brokerLevel: { type: "string", options: ["STARTER", "MEDIO", "SENIOR"] }
        }
      },
      {
        type: "visit",
        label: "Visita",
        fields: {
          client: { type: "string", required: true },
          propertyId: { type: "string", required: true },
          scheduledAt: { type: "string", required: true },
          address: "string",
          result: "string"
        }
      },
      {
        type: "deal",
        label: "Negocio",
        fields: {
          dealType: { type: "string", required: true, options: ["venta", "arriendo"] },
          value: { type: "number", required: true },
          propertyId: { type: "string", required: true },
          brokerLevel: { type: "string", required: true, options: ["STARTER", "MEDIO", "SENIOR"] },
          closeDate: "string",
          commissionTotal: "number",
          brokerShare: "number",
          evolumShare: "number",
          tgiShare: "number",
          captureCommission: "number"
        }
      },
      {
        type: "commission_distribution",
        label: "Distribucion de comision",
        fields: {
          dealId: { type: "string", required: true },
          brokerLevel: { type: "string", required: true, options: ["STARTER", "MEDIO", "SENIOR"] },
          commissionTotal: { type: "number", required: true },
          brokerShare: "number",
          evolumShare: "number",
          tgiShare: "number",
          captureCommission: "number",
          lockedAtClose: "boolean"
        }
      },
      {
        type: "forecast",
        label: "Forecast predictivo",
        fields: {
          predictiveScore: "number",
          projectedValue: "number",
          highIntent: "number",
          totalProperties: "number",
          openVisits: "number",
          recommendation: "string"
        }
      },
      {
        type: "ai_interaction",
        label: "Interaccion agente IA",
        fields: {
          agentType: { type: "string", required: true },
          context: "string",
          result: "string",
          requiresSupervision: "boolean",
          linkedRecordId: "string",
          importBatchId: "string",
          importFileName: "string",
          importedPropertyIds: "json",
          skippedRows: "number"
        }
      }
    ],
    workflows: [
      "captar propiedad",
      "cargar propiedad",
      "asignar vendedor",
      "publicar campana",
      "registrar lead",
      "agendar visita",
      "negociar",
      "calcular comision",
      "cerrar",
      "postventa"
    ]
  },
  GASTRONOMY: {
    code: "GASTRONOMY",
    name: "Gastronomia",
    summary: "Flujos y datos propios de gastronomia sobre el Core CRM, sin duplicar agenda, ventas, marketing, pagos, ganancias ni dashboard.",
    // Pagos y ganancias pertenecen al CRM transversal; no son exclusivos de
    // gastronomia. La vertical aporta sus entidades y flujos operativos.
    modules: [
      moduleItem(MODULES.GASTRONOMY_OPERATIONS, "Operación de restaurante", "Mesas, comandas, clientes frecuentes y cierre diario sin duplicar los pagos del Core.", "PRO"),
      moduleItem(MODULES.SHIFT_MANAGEMENT, "Turnos de local", "Planifica garzones, cocina y responsables de cada jornada.", "PRO")
    ],
    entities: [
      { key: "restaurant_table", label: "Mesa", fields: ["numero", "sector", "capacidad", "estado"] },
      { key: "restaurant_order", label: "Comanda", fields: ["mesa", "cliente", "items", "estado", "responsable", "total"] },
      { key: "restaurant_guest", label: "Cliente frecuente", fields: ["nombre", "telefono", "preferencias", "visitas", "observaciones"] },
      { key: "restaurant_daily_close", label: "Cierre diario", fields: ["fecha", "ventas", "pagos", "diferencias", "responsable", "notas"] }
    ],
    workflows: ["recibir reserva", "asignar mesa", "abrir comanda", "preparar", "servir", "cerrar cuenta", "cierre diario", "fidelizar cliente"]
  },
  FINANCE: {
    code: "FINANCE",
    name: "EVOLUM Finance OS",
    summary: "Cuentas por cobrar, conciliacion bancaria y cobranza inteligente sobre el ERP existente, sin reemplazarlo.",
    modules: [
      moduleItem(MODULES.FINANCE_INVOICES, "Facturas por cobrar", "Facturas emitidas, saldos, vencimientos y estado de cada cobro."),
      moduleItem(MODULES.FINANCE_BANK_SYNC, "Cartolas y movimientos", "Carga manual segura de cartolas y movimientos bancarios para normalizarlos.", "STARTER"),
      moduleItem(MODULES.FINANCE_RECONCILIATION, "Conciliacion IA", "Propone el cruce de pagos y facturas con un nivel de confianza explicable."),
      moduleItem(MODULES.FINANCE_EXCEPTIONS, "Excepciones financieras", "Gestiona pagos parciales, duplicados, diferencias y movimientos sin factura."),
      moduleItem(MODULES.FINANCE_COLLECTIONS, "Cobranza IA", "Segmenta facturas vencidas, organiza seguimientos y registra compromisos de pago.", "PRO"),
      moduleItem(MODULES.FINANCE_ANALYTICS, "Dashboard financiero", "Caja, cartera, DSO, morosidad, conciliaciones y acciones prioritarias.")
    ],
    entities: [
      { key: "finance_invoice", label: "Factura por cobrar", fields: { invoiceNumber: { type: "string", required: true }, customerName: { type: "string", required: true }, rut: "string", issueDate: "string", dueDate: { type: "string", required: true }, amount: { type: "number", required: true }, balance: "number", status: { type: "string", options: ["OPEN", "PARTIAL", "PAID", "OVERDUE", "CANCELLED"] }, erpSource: "string" } },
      { key: "bank_statement", label: "Cartola bancaria", fields: { bankName: "string", accountReference: "string", periodStart: "string", periodEnd: "string", source: { type: "string", options: ["manual", "pdf", "excel", "csv", "api"] }, documentId: "string" } },
      { key: "bank_movement", label: "Movimiento bancario", fields: { statementId: "string", transactionDate: { type: "string", required: true }, amount: { type: "number", required: true }, reference: "string", payerName: "string", rut: "string", movementType: { type: "string", options: ["credit", "debit", "transfer", "charge", "commission", "interest"] }, status: { type: "string", options: ["UNRECONCILED", "MATCHED", "EXCEPTION"] } } },
      { key: "finance_reconciliation", label: "Conciliacion", fields: { invoiceId: { type: "string", required: true }, movementId: { type: "string", required: true }, confidence: "number", matchReasons: "json", status: { type: "string", options: ["SUGGESTED", "APPROVED", "REJECTED"] }, approvedAt: "string" } },
      { key: "finance_exception", label: "Excepcion financiera", fields: { type: { type: "string", options: ["PARTIAL_PAYMENT", "DUPLICATE_PAYMENT", "NO_INVOICE", "UNPAID_INVOICE", "AMOUNT_DIFFERENCE", "UNKNOWN_TRANSFER"] }, invoiceId: "string", movementId: "string", resolution: "string", status: { type: "string", options: ["OPEN", "IN_REVIEW", "RESOLVED"] } } },
      { key: "finance_collection_case", label: "Caso de cobranza", fields: { invoiceId: { type: "string", required: true }, customerName: "string", agingBucket: "string", channel: { type: "string", options: ["whatsapp", "email", "sms", "manual"] }, nextActionAt: "string", promiseDueDate: "string", status: { type: "string", options: ["PENDING", "CONTACTED", "PROMISE", "PAID", "ESCALATED"] } } }
    ],
    workflows: ["registrar factura", "cargar cartola", "normalizar movimientos", "conciliar", "revisar excepcion", "gestionar cobranza", "actualizar ERP", "analizar cartera"]
  },
  AUTOMOTIVE: {
    code: "AUTOMOTIVE",
    name: "Automotriz",
    summary: "Vehiculos, repuestos, mecanicos, agenda de taller y aviso de retiro.",
    modules: [
      moduleItem(MODULES.INBOX, "Inbox taller", "Mensajes por cliente, vehiculo y estado de servicio."),
      moduleItem(MODULES.VEHICLE_OWNERS, "Dueños y vehículos", "Ficha de dueño, vehículo, historial técnico, repuestos y presupuestos.", "PRO"),
      moduleItem(MODULES.PARTS_INVENTORY, "Repuestos", "Fotos, stock, ubicacion, costo y compatibilidad.", "BUSINESS"),
      moduleItem(MODULES.MECHANIC_ASSIGNMENTS, "Asignacion de mecanicos", "Distribucion de trabajos segun carga y especialidad.", "PRO"),
      moduleItem(MODULES.READY_NOTIFICATIONS, "Aviso de retiro", "Mensaje automatico al cliente cuando el vehiculo esta listo.", "PRO"),
      moduleItem(MODULES.BOOKINGS, "Agenda de taller", "Citas, entregas y retiros.", "PRO"),
      moduleItem(MODULES.PAYMENTS, "Pagos", "Abonos, saldos y links de pago.", "BUSINESS"),
      moduleItem(MODULES.ANALYTICS, "Dashboard", "Ordenes, tiempos, repuestos y rendimiento.", "PRO")
    ],
    entities: [
      { key: "vehicle", label: "Dueño y vehículo", fields: ["dueno", "telefono", "correo", "patente", "marca", "modelo", "ano", "kilometraje", "diagnostico"] },
      { key: "part", label: "Repuesto", fields: ["foto", "sku", "stock", "ubicacion", "costo", "compatibilidad"] },
      { key: "work_order", label: "Orden de trabajo", fields: ["vehiculo", "mecanico", "estado", "fecha_entrega", "repuestos", "presupuesto", "notas"] }
    ],
    workflows: ["recibir vehiculo", "asignar mecanico", "validar repuestos", "reparar", "avisar retiro", "cobrar"]
  },
  DENTAL: {
    code: "DENTAL",
    name: "Clinica dental",
    summary: "Pacientes, citas, tratamientos, recordatorios y pagos.",
    modules: [
      moduleItem(MODULES.DENTAL_CARE, "Atención dental", "Ficha odontológica, odontograma, tratamientos, presupuestos y consentimientos con revisión profesional.", "PRO"),
      moduleItem(MODULES.INBOX, "Inbox pacientes", "Consultas, confirmaciones y recordatorios."),
      moduleItem(MODULES.BOOKINGS, "Agenda clinica", "Citas por profesional, box y tratamiento."),
      moduleItem(MODULES.PATIENTS, "Pacientes", "Ficha, historial y continuidad de atencion dental."),
      moduleItem(MODULES.EXAMS, "Examenes y presupuestos", "Ordenes, resultados, planes de tratamiento y cotizaciones."),
      moduleItem(MODULES.SHIFT_MANAGEMENT, "Turnos odontológicos", "Disponibilidad de dentistas, asistentes, boxes y recepción.", "PRO"),
      moduleItem(MODULES.PAYMENTS, "Pagos", "Abonos y saldos de tratamiento.", "BUSINESS"),
      moduleItem(MODULES.ANALYTICS, "Dashboard", "Citas, asistencia y conversion.", "PRO")
    ],
    entities: [
      { key: "dental_patient", label: "Paciente dental", fields: ["nombre", "telefono", "antecedentes", "alergias", "observaciones"] },
      { key: "dental_odontogram", label: "Odontograma", fields: ["paciente", "pieza", "estado", "observaciones", "profesional"] },
      { key: "dental_treatment", label: "Tratamiento", fields: ["paciente", "tipo", "presupuesto", "estado", "profesional", "notas"] },
      { key: "dental_consent", label: "Consentimiento", fields: ["paciente", "tratamiento", "estado", "fecha", "archivo"] }
    ],
    workflows: ["crear ficha", "registrar odontograma", "planificar tratamiento", "gestionar consentimiento", "agendar", "atender", "cobrar", "seguimiento"]
  },
  HEALTH: {
    code: "HEALTH",
    name: "Clinica de salud",
    summary: "Atencion clinica humana con fichas de pacientes, citas, tratamientos y documentos propios de salud.",
    modules: [
      moduleItem(MODULES.HEALTH_CARE, "Atención clínica", "Fichas clínicas, atenciones, órdenes y seguimiento administrativo con control profesional.", "PRO"),
      moduleItem(MODULES.INBOX, "Inbox clinico", "Consultas, confirmaciones y recordatorios de pacientes."),
      moduleItem(MODULES.BOOKINGS, "Agenda clinica", "Citas por profesional, box y especialidad.", "PRO"),
      moduleItem(MODULES.PATIENTS, "Pacientes", "Ficha de paciente, antecedentes y continuidad de atencion."),
      moduleItem(MODULES.EXAMS, "Examenes y presupuestos", "Ordenes, resultados, prestaciones y presupuestos clinicos."),
      moduleItem(MODULES.SHIFT_MANAGEMENT, "Turnos clínicos", "Disponibilidad de médicos, profesionales, boxes y recepción.", "PRO"),
      moduleItem(MODULES.PAYMENTS, "Pagos", "Abonos y saldos de prestaciones.", "BUSINESS"),
      moduleItem(MODULES.ANALYTICS, "Dashboard clinico", "Citas, asistencia y capacidad operativa.", "PRO")
    ],
    entities: [
      { key: "clinical_patient", label: "Paciente clínico", fields: ["nombre", "telefono", "antecedentes", "alergias", "contacto_emergencia"] },
      { key: "clinical_attention", label: "Atención clínica", fields: ["paciente", "profesional", "especialidad", "fecha", "motivo", "estado"] },
      { key: "clinical_order", label: "Orden o presupuesto", fields: ["paciente", "tipo", "profesional", "estado", "monto", "notas"] },
      { key: "clinical_followup", label: "Seguimiento", fields: ["paciente", "fecha", "canal", "estado", "notas"] }
    ],
    workflows: ["crear ficha", "agendar", "registrar atención", "emitir orden", "revisión profesional", "cobrar", "seguimiento"]
  },
  VETERINARY: {
    code: "VETERINARY",
    name: "Clinica veterinaria",
    summary: "Mascotas, tutores, citas, tratamientos y recordatorios.",
    modules: [
      moduleItem(MODULES.VETERINARY_CARE, "Atención veterinaria", "Mascotas y tutores, vacunas, hospitalización, recetas y seguimiento veterinario con revisión profesional.", "PRO"),
      moduleItem(MODULES.INBOX, "Inbox tutores", "Consultas y seguimiento de mascotas."),
      moduleItem(MODULES.BOOKINGS, "Agenda veterinaria", "Citas, controles y vacunacion."),
      moduleItem(MODULES.PATIENTS, "Pacientes", "Ficha de paciente animal, tutor e historial veterinario.", "PRO"),
      moduleItem(MODULES.EXAMS, "Examenes y presupuestos veterinarios", "Ordenes, resultados, tratamientos y presupuestos de cada mascota.", "PRO"),
      moduleItem(MODULES.SHIFT_MANAGEMENT, "Turnos veterinarios", "Disponibilidad de veterinarios, técnicos, hospitalización y recepción.", "PRO"),
      moduleItem(MODULES.PAYMENTS, "Pagos", "Abonos, tratamientos y productos.", "BUSINESS"),
      moduleItem(MODULES.ANALYTICS, "Dashboard", "Citas, tratamientos y recurrencia.", "PRO")
    ],
    entities: [
      { key: "veterinary_pet", label: "Mascota y tutor", fields: ["nombre", "especie", "raza", "edad", "tutor", "telefono_tutor", "antecedentes"] },
      { key: "veterinary_vaccine", label: "Vacuna o control", fields: ["mascota", "vacuna", "fecha", "proxima_fecha", "profesional", "estado"] },
      { key: "veterinary_hospitalization", label: "Hospitalización", fields: ["mascota", "ingreso", "estado", "responsable", "observaciones"] },
      { key: "veterinary_prescription", label: "Receta o presupuesto", fields: ["mascota", "tipo", "profesional", "estado", "monto", "notas"] }
    ],
    workflows: ["crear ficha", "agendar", "registrar atención", "vacunar o controlar", "hospitalizar", "revisión veterinaria", "cobrar", "seguimiento"]
  }
});

const INDUSTRY_ALIASES = Object.freeze({
  GENERAL: "GENERAL",
  GENERICO: "GENERAL",
  RESTAURANTE: "GASTRONOMY",
  GASTRONOMIA: "GASTRONOMY",
  GASTRONOMY: "GASTRONOMY",
  FOOD: "GASTRONOMY",
  FINANCE: "FINANCE",
  FINANZAS: "FINANCE",
  CONTABLE: "FINANCE",
  CONTABILIDAD: "FINANCE",
  CUENTAS_POR_COBRAR: "FINANCE",
  INMOBILIARIA: "REAL_ESTATE",
  INMOBILIARIO: "REAL_ESTATE",
  REALTY: "REAL_ESTATE",
  REAL_ESTATE: "REAL_ESTATE",
  AUTOMOTRIZ: "AUTOMOTIVE",
  AUTOMOTIVE: "AUTOMOTIVE",
  TALLER: "AUTOMOTIVE",
  DENTAL: "DENTAL",
  ODONTOLOGIA: "DENTAL",
  SALUD: "HEALTH",
  CLINICA: "HEALTH",
  HEALTH: "HEALTH",
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
  const modules = template.modules
    .filter((item) => (PLAN_RANK[normalizePlanCode(item.minPlan)] || PLAN_RANK.STARTER) <= rank)
    .map((item) => item.key);

  return modules;
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
