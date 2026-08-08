import { prisma } from "../src/lib/db.js";
import { getFinanceOverview, getFinanceReconciliationSuggestions } from "../src/services/finance.service.js";
import { getTenantSalesLearning } from "../src/services/ai-performance-learning.service.js";
import { scoreRealtyLeadMatch } from "../src/services/realty-intelligence.service.js";

// Escenarios seguros para demos. No crea mensajes salientes, cobros, OAuth ni
// llamadas a proveedores externos. Todos los datos quedan identificados para
// poder encontrarlos o retirarlos posteriormente.
const RUN = process.env.TRAINING_RUN_ID || "TRAINING-2026-08-08";
const APPLY = process.argv.includes("--apply") && process.env.CONFIRM_TRAINING_SCENARIOS === "YES";
const SUPER_ADMIN_SHOWCASE = process.argv.includes("--super-admin-showcase");
const SUPER_ADMIN_EMAIL = "admin@platform.local";
const TEST_ACCOUNTS = {
  finance: "contadores@prueba.cl",
  automotive: "tallermecanico@prueba.cl",
  realty: "inmobiliaria@prueba.cl",
  gastronomy: "eventosaltabrasa@prueba.cl",
  dental: "clinicadental@prueba.cl",
  veterinary: "clinicaveterinaria@prueba.cl"
};

function title(label) {
  return `${RUN} | ${label}`;
}

async function testTenant(email) {
  const user = await prisma.workspaceUser.findUnique({
    where: { email },
    include: { tenant: true }
  });
  if (!user?.tenant || !user.isActive) throw new Error(`Cuenta de prueba no disponible: ${email}`);
  return { user, tenant: user.tenant };
}

async function record(tenantId, recordType, label, data, status = "ACTIVE", assignedToId = null) {
  const recordTitle = title(label);
  const existing = await prisma.industryRecord.findFirst({ where: { tenantId, recordType, title: recordTitle } });
  if (existing) return existing;
  return prisma.industryRecord.create({
    data: { tenantId, recordType, title: recordTitle, status, assignedToId, data: { ...data, trainingRun: RUN, demoOnly: true } }
  });
}

async function coreScenario({ tenant, user }, label) {
  const suffix = tenant.id.slice(-6);
  const contact = await prisma.contact.upsert({
    where: { tenantId_externalId_channel: { tenantId: tenant.id, externalId: `training-${RUN}-${suffix}`, channel: "whatsapp" } },
    update: { name: `Cliente demo ${label}`, metadata: { trainingRun: RUN, demoOnly: true } },
    create: { tenantId: tenant.id, externalId: `training-${RUN}-${suffix}`, channel: "whatsapp", name: `Cliente demo ${label}`, metadata: { trainingRun: RUN, demoOnly: true } }
  });
  let conversation = await prisma.conversation.findFirst({ where: { tenantId: tenant.id, contactId: contact.id, decisionSummary: RUN } });
  if (!conversation) {
    conversation = await prisma.conversation.create({
      data: { tenantId: tenant.id, contactId: contact.id, assignedToId: user.id, status: "OPEN", mode: "BOT", priorityLabel: "medium", priorityScore: 66, lastIntent: "demo_training", decisionSummary: RUN, aiSummary: `Escenario demostrativo de ${label}.`, aiNextAction: "Revisar y continuar flujo de demostracion.", aiSuggestedReply: "Gracias, prepararemos una propuesta demostrativa.", aiLeadScore: 72, aiCloseScore: 72 }
    });
  }
  await prisma.lead.upsert({
    where: { conversationId: conversation.id },
    update: { interest: `Escenario ${label}`, status: "QUALIFIED", closeProbability: 72, closeReason: "Datos de demostracion" },
    create: { tenantId: tenant.id, conversationId: conversation.id, name: `Lead demo ${label}`, phone: "+56900000000", interest: `Escenario ${label}`, status: "QUALIFIED", closeProbability: 72, closeReason: "Datos de demostracion" }
  });
  await prisma.conversationMemory.upsert({
    where: { conversationId: conversation.id },
    update: { interestLevel: 72, urgencyLevel: 58, summary: `Contexto de demostracion ${label}`, scenario: RUN, customerProfile: { demoOnly: true, trainingRun: RUN } },
    create: { tenantId: tenant.id, conversationId: conversation.id, interestLevel: 72, urgencyLevel: 58, summary: `Contexto de demostracion ${label}`, scenario: RUN, customerProfile: { demoOnly: true, trainingRun: RUN } }
  });
  const existingOutcome = await prisma.salesOutcome.findFirst({ where: { tenantId: tenant.id, conversationId: conversation.id, reason: RUN } });
  if (!existingOutcome) await prisma.salesOutcome.create({ data: { tenantId: tenant.id, conversationId: conversation.id, outcome: "BOOKED", reason: RUN, closeScore: 72, industry: tenant.industry } });
  const product = await prisma.product.findFirst({ where: { tenantId: tenant.id, name: title(`Producto demo ${label}`) } });
  if (!product) await prisma.product.create({ data: { tenantId: tenant.id, name: title(`Producto demo ${label}`), description: "Registro de demostracion; no disponible para cobro.", price: 100000, stock: 10, category: "TRAINING", attributes: { trainingRun: RUN, demoOnly: true } } });
  const service = await prisma.service.findFirst({ where: { tenantId: tenant.id, name: title(`Servicio demo ${label}`) } });
  if (!service) await prisma.service.create({ data: { tenantId: tenant.id, name: title(`Servicio demo ${label}`), basePrice: 100000, pricePerGuest: 0, minGuests: 1, includes: ["Demostracion"], zones: ["Demo"], notes: "No contacta clientes ni genera cobros.", isActive: true } });
  const campaign = await prisma.campaign.findFirst({ where: { tenantId: tenant.id, name: title(`Campana borrador ${label}`) } });
  if (!campaign) await prisma.campaign.create({ data: { tenantId: tenant.id, name: title(`Campana borrador ${label}`), segment: "training_only", template: "Borrador interno para demostracion. No publicar.", status: "DRAFT" } });
  const booking = await prisma.booking.findFirst({ where: { tenantId: tenant.id, notes: RUN } });
  if (!booking) await prisma.booking.create({ data: { tenantId: tenant.id, conversationId: conversation.id, name: `Reserva demo ${label}`, phone: "+56900000000", email: "demo@evolum.test", date: new Date("2026-09-15T15:00:00.000Z"), guests: 2, location: "Demostracion interna", total: 100000, status: "PENDING", notes: RUN, metadata: { demoOnly: true } } });
  return conversation;
}

async function realtyScenario(ctx) {
  const { tenant, user } = ctx;
  await coreScenario(ctx, "Inmobiliaria");
  const owner = await record(tenant.id, "owner", "Propietaria demo", { name: "Carolina Demo", phone: "+56900000001", email: "carolina.demo@evolum.test", origin: "captacion_evolum" });
  const property = await record(tenant.id, "property", "Departamento Providencia", { address: "Av. Demo 1234, Providencia", commune: "Providencia", propertyType: "departamento", operation: "venta", price: 210000000, meters: 78, bedrooms: 2, bathrooms: 2, parking: 1, stage: "PUBLICADA", status: "ACTIVE", ownerId: owner.id, source: "training" }, "ACTIVE", user.id);
  const customer = await record(tenant.id, "customer", "Comprador compatible", { name: "Matias Demo", phone: "+56900000002", interestType: "compra", budget: 205000000, commune: "Providencia", propertyType: "departamento", interestedPropertyId: property.id }, "QUALIFIED");
  await record(tenant.id, "visit", "Visita demostrativa", { client: "Matias Demo", propertyId: property.id, scheduledAt: "2026-09-15T15:00:00.000Z", address: "Av. Demo 1234, Providencia", result: "Pendiente de confirmar" }, "SCHEDULED", user.id);
  await record(tenant.id, "seller_assignment", "Asignacion demostrativa", { sellerId: user.id, propertyId: property.id, assignmentMode: "manual", brokerLevel: "SENIOR" }, "ASSIGNED", user.id);
  await record(tenant.id, "deal", "Negocio demostrativo", { dealType: "venta", value: 210000000, propertyId: property.id, brokerLevel: "SENIOR", commissionTotal: 6300000 }, "NEGOTIATION", user.id);
  await record(tenant.id, "forecast", "Forecast demostrativo", { predictiveScore: 82, projectedValue: 210000000, highIntent: 1, totalProperties: 1, openVisits: 1, recommendation: "Priorizar seguimiento de comprador compatible." });
  const match = scoreRealtyLeadMatch({ budget: 205000000, interest: "Comprar departamento en Providencia", customFields: {} }, { status: "ACTIVE", data: property.data });
  if (match.score < 70) throw new Error("El matching inmobiliario no alcanzó el umbral de demostracion");
}

async function financeScenario(ctx) {
  const { tenant } = ctx;
  await coreScenario(ctx, "Finanzas");
  const invoice = await record(tenant.id, "finance_invoice", "Factura demo vencida", { invoiceNumber: "TRN-FAC-1001", customerName: "Comercial Demo SpA", rut: "76111222-3", issueDate: "2026-06-01", dueDate: "2026-06-30", amount: 895000, balance: 895000, erpSource: "manual" }, "OPEN");
  const partial = await record(tenant.id, "finance_invoice", "Factura demo pago parcial", { invoiceNumber: "TRN-FAC-1002", customerName: "Servicios Demo Ltda", rut: "76222333-4", issueDate: "2026-07-01", dueDate: "2026-07-31", amount: 600000, balance: 300000, erpSource: "manual" }, "PARTIAL");
  const statement = await record(tenant.id, "bank_statement", "Cartola BancoEstado demo", { bankName: "BancoEstado", accountReference: "Cuenta demo terminada 1234", periodStart: "2026-07-01", periodEnd: "2026-07-31", source: "csv" }, "IMPORTED");
  const exactMovement = await record(tenant.id, "bank_movement", "Abono TRN-FAC-1001", { statementId: statement.id, transactionDate: "2026-07-03", amount: 895000, reference: "TRN-FAC-1001", payerName: "Comercial Demo SpA", rut: "76111222-3", movementType: "credit", status: "UNRECONCILED" }, "UNRECONCILED");
  await record(tenant.id, "bank_movement", "Abono parcial TRN-FAC-1002", { statementId: statement.id, transactionDate: "2026-07-05", amount: 300000, reference: "TRN-FAC-1002", payerName: "Servicios Demo Ltda", rut: "76222333-4", movementType: "credit", status: "UNRECONCILED" }, "UNRECONCILED");
  await record(tenant.id, "finance_exception", "Excepcion demostrativa", { type: "PARTIAL_PAYMENT", invoiceId: partial.id, priority: "MEDIUM", status: "OPEN", resolution: "Pendiente de revision humana" }, "OPEN");
  await record(tenant.id, "finance_collection_case", "Caso cobranza demostrativo", { invoiceId: invoice.id, invoiceNumber: "TRN-FAC-1001", customerName: "Comercial Demo SpA", balance: 895000, agingBucket: "31-60 dias", channel: "manual", nextActionAt: "2026-08-15T10:00:00.000Z", status: "PENDING" }, "PENDING");
  const suggestions = await getFinanceReconciliationSuggestions({ tenantId: tenant.id });
  if (!suggestions.some((item) => item.movementId === exactMovement.id && item.confidence >= 80)) throw new Error("No se generó una sugerencia financiera de alta confianza");
  const overview = await getFinanceOverview({ tenantId: tenant.id });
  if (!overview.invoices.total) throw new Error("El overview financiero no recibió facturas de demostracion");
}

async function automotiveScenario(ctx) {
  const { tenant, user } = ctx;
  await coreScenario(ctx, "Taller automotriz");
  const vehicle = await record(tenant.id, "vehicle", "Vehiculo demo", { ownerName: "Patricia Demo", phone: "+56900000003", plate: "TRN-100", brand: "Toyota", model: "Corolla", year: 2021, mileage: 58000, diagnosis: "Mantencion preventiva" }, "IN_SERVICE", user.id);
  const part = await record(tenant.id, "part", "Filtro aceite demo", { sku: "TRN-FILT-01", stock: 5, location: "Bodega A", cost: 12000, compatibility: "Toyota Corolla 2021" }, "AVAILABLE");
  await record(tenant.id, "work_order", "Orden trabajo demo", { vehicleId: vehicle.id, mechanic: user.name, status: "IN_PROGRESS", deliveryDate: "2026-09-16", parts: [part.id], budget: 85000, notes: "No contactar al cliente; demostracion interna." }, "IN_PROGRESS", user.id);
  await record(tenant.id, "ready_notification", "Aviso retiro demo", { vehicleId: vehicle.id, status: "DRAFT", channel: "none", message: "Vehiculo listo. Mensaje no enviado por ser demostracion." }, "DRAFT");
  await record(tenant.id, "shift", "Turno taller demo", { date: "2026-09-15", startTime: "09:00", endTime: "18:00", role: "Mecanico", responsible: user.name, coverage: "Taller principal" }, "SCHEDULED", user.id);
}

async function gastronomyScenario(ctx) {
  const { tenant, user } = ctx;
  await coreScenario(ctx, "Gastronomia");
  const table = await record(tenant.id, "restaurant_table", "Mesa demo 12", { number: "12", sector: "Terraza", capacity: 4, status: "OCCUPIED" }, "ACTIVE");
  await record(tenant.id, "restaurant_guest", "Cliente frecuente demo", { name: "Sofia Demo", phone: "+56900000004", preferences: "Opciones vegetarianas", visits: 4, observations: "No enviar comunicaciones externas." }, "ACTIVE");
  await record(tenant.id, "restaurant_order", "Comanda demo mesa 12", { tableId: table.id, client: "Sofia Demo", items: ["Menu demo", "Bebida"], status: "PREPARING", responsible: user.name, total: 42000 }, "OPEN", user.id);
  await record(tenant.id, "restaurant_daily_close", "Cierre diario demo", { date: "2026-08-08", sales: 42000, payments: 42000, differences: 0, responsible: user.name, notes: "Cierre de demostracion" }, "CLOSED", user.id);
  await record(tenant.id, "shift", "Turno restaurante demo", { date: "2026-09-15", startTime: "12:00", endTime: "22:00", role: "Garzon", responsible: user.name, coverage: "Salon" }, "SCHEDULED", user.id);
}

async function dentalScenario(ctx) {
  const { tenant, user } = ctx;
  await coreScenario(ctx, "Clinica dental");
  const patient = await record(tenant.id, "dental_patient", "Paciente dental demo", { name: "Andrea Demo", phone: "+56900000005", antecedentes: "Sin antecedentes relevantes", alergias: "Ninguna", observations: "Ficha ficticia de demostracion." }, "ACTIVE");
  await record(tenant.id, "dental_odontogram", "Odontograma demo", { patientId: patient.id, piece: "16", status: "Caries inicial", observations: "Evaluar restauracion", professional: user.name }, "PENDING", user.id);
  await record(tenant.id, "dental_treatment", "Tratamiento dental demo", { patientId: patient.id, type: "Restauracion", budget: 95000, status: "PROPOSED", professional: user.name, notes: "Presupuesto ficticio." }, "PROPOSED", user.id);
  await record(tenant.id, "dental_consent", "Consentimiento dental demo", { patientId: patient.id, treatment: "Restauracion", status: "PENDING_SIGNATURE", date: "2026-09-15", file: "No adjunto; demostracion" }, "PENDING");
  await record(tenant.id, "shift", "Turno dental demo", { date: "2026-09-15", startTime: "09:00", endTime: "17:00", role: "Dentista", responsible: user.name, coverage: "Box 1" }, "SCHEDULED", user.id);
}

async function veterinaryScenario(ctx) {
  const { tenant, user } = ctx;
  await coreScenario(ctx, "Clinica veterinaria");
  const pet = await record(tenant.id, "veterinary_pet", "Mascota demo Luna", { name: "Luna", species: "Canino", breed: "Mestiza", age: 4, tutor: "Camila Demo", phone: "+56900000006", history: "Control preventivo" }, "ACTIVE");
  await record(tenant.id, "veterinary_vaccine", "Vacuna demo Luna", { petId: pet.id, vaccine: "Octuple", date: "2026-08-08", nextDueDate: "2027-08-08", professional: user.name }, "APPLIED", user.id);
  await record(tenant.id, "veterinary_hospitalization", "Hospitalizacion demo", { petId: pet.id, reason: "Observacion preventiva", status: "MONITORING", admissionDate: "2026-08-08", professional: user.name }, "OPEN", user.id);
  await record(tenant.id, "veterinary_prescription", "Receta veterinaria demo", { petId: pet.id, type: "Presupuesto", professional: user.name, status: "DRAFT", amount: 45000, notes: "Documento ficticio; no emitir." }, "DRAFT", user.id);
  await record(tenant.id, "shift", "Turno veterinario demo", { date: "2026-09-15", startTime: "09:00", endTime: "18:00", role: "Veterinario", responsible: user.name, coverage: "Consulta 1" }, "SCHEDULED", user.id);
}

async function healthScenario(ctx) {
  const { tenant, user } = ctx;
  await coreScenario(ctx, "Salud clinica");
  const patient = await record(tenant.id, "clinical_patient", "Paciente clinico demo", { name: "Javiera Demo", phone: "+56900000007", antecedentes: "Sin antecedentes relevantes", alergias: "Ninguna", emergencyContact: "Contacto demostrativo" }, "ACTIVE");
  await record(tenant.id, "clinical_attention", "Atencion clinica demo", { patientId: patient.id, professional: user.name, specialty: "Medicina general", date: "2026-09-15", reason: "Control demostrativo", status: "PENDING" }, "SCHEDULED", user.id);
  await record(tenant.id, "clinical_order", "Orden clinica demo", { patientId: patient.id, type: "Examen preventivo", professional: user.name, amount: 38000, status: "PENDING", notes: "Orden ficticia para prueba visual." }, "PENDING", user.id);
  await record(tenant.id, "clinical_followup", "Seguimiento clinico demo", { patientId: patient.id, date: "2026-09-22", channel: "manual", status: "PENDING", notes: "Seguimiento de demostracion; no contactar." }, "PENDING", user.id);
  await record(tenant.id, "shift", "Turno clinico demo", { date: "2026-09-15", startTime: "08:00", endTime: "17:00", role: "Profesional de salud", responsible: user.name, coverage: "Box clinico 1" }, "SCHEDULED", user.id);
}

async function runSuperAdminShowcase() {
  const context = await testTenant(SUPER_ADMIN_EMAIL);
  const checks = [
    ["Inmobiliaria", () => realtyScenario(context)],
    ["Finanzas", () => financeScenario(context)],
    ["Automotriz", () => automotiveScenario(context)],
    ["Gastronomia", () => gastronomyScenario(context)],
    ["Dental", () => dentalScenario(context)],
    ["Veterinaria", () => veterinaryScenario(context)],
    ["Salud clinica", () => healthScenario(context)]
  ];
  const results = [];
  for (const [vertical, run] of checks) {
    await run();
    results.push({ vertical, tenant: context.tenant.name, visibleAs: "SUPER_ADMIN" });
  }
  console.table(results);
}

async function main() {
  if (!APPLY) {
    console.log(`Vista previa: se prepararán escenarios ${RUN}. Ejecuta con CONFIRM_TRAINING_SCENARIOS=YES y --apply.`);
    return;
  }
  if (SUPER_ADMIN_SHOWCASE) {
    await runSuperAdminShowcase();
    return;
  }
  const contexts = Object.fromEntries(await Promise.all(Object.entries(TEST_ACCOUNTS).map(async ([key, email]) => [key, await testTenant(email)])));
  const checks = [
    ["Inmobiliaria", "realty", () => realtyScenario(contexts.realty)],
    ["Finanzas", "finance", () => financeScenario(contexts.finance)],
    ["Automotriz", "automotive", () => automotiveScenario(contexts.automotive)],
    ["Gastronomia", "gastronomy", () => gastronomyScenario(contexts.gastronomy)],
    ["Dental", "dental", () => dentalScenario(contexts.dental)],
    ["Veterinaria", "veterinary", () => veterinaryScenario(contexts.veterinary)]
  ];
  const results = [];
  for (const [vertical, key, run] of checks) {
    await run();
    const ctx = contexts[key];
    const learning = await getTenantSalesLearning({ tenantId: ctx.tenant.id, industry: ctx.tenant.industry });
    results.push({ vertical, tenant: ctx.tenant.name, industry: ctx.tenant.industry, learningSamples: learning.sampleSize });
  }
  console.table(results);
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
