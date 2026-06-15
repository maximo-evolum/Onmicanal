import bcrypt from "bcryptjs";
import { prisma } from "./src/lib/db.js";
import { ensureTenantSubscriptionAndModules, syncPlans } from "./src/services/tenant-modules.service.js";

async function hashPassword(password) {
  return await bcrypt.hash(password, 10);
}

const SUPER_ADMIN_EMAIL = String(process.env.SUPER_ADMIN_EMAIL || "admin@platform.local").trim().toLowerCase();
const SUPER_ADMIN_PASSWORD = process.env.SUPER_ADMIN_PASSWORD || null;

async function ensureDefaultAiProfile({ tenantId, name, industry, objective }) {
  await prisma.tenantAiProfile.upsert({
    where: { tenantId_code: { tenantId, code: "default" } },
    update: { name, industry, objective, isActive: true },
    create: {
      tenantId,
      code: "default",
      name,
      industry,
      basePersona: "Asistente comercial experto para atención omnicanal",
      tone: "cercano y profesional",
      objective,
      responseStyle: "breve, natural y orientado a acción",
      businessRules: []
    }
  });
}

async function ensureChannelConfig({ tenantId, channel, phoneNumberId, externalAccountId, accessToken, verifyToken }) {
  if (!phoneNumberId && !externalAccountId && !accessToken && !verifyToken) return;
  await prisma.tenantChannelConfig.upsert({
    where: { tenantId_channel: { tenantId, channel } },
    update: { phoneNumberId: phoneNumberId || null, externalAccountId: externalAccountId || null, accessToken: accessToken || null, verifyToken: verifyToken || null, isActive: true },
    create: { tenantId, channel, label: `${channel} principal`, phoneNumberId: phoneNumberId || null, externalAccountId: externalAccountId || null, accessToken: accessToken || null, verifyToken: verifyToken || null, isActive: true }
  });
}

async function main() {
  await syncPlans();

  const platformTenant = await prisma.tenant.upsert({
    where: { slug: "platform-admin" },
    update: { plan: "ENTERPRISE" },
    create: {
      name: "Platform Admin",
      slug: "platform-admin",
      type: "BUSINESS",
      industry: "saas",
      plan: "ENTERPRISE",
      businessPrompt: "Tenant interno para administración global de la plataforma.",
      onboardingCompleted: true
    }
  });
  await ensureTenantSubscriptionAndModules({ tenantId: platformTenant.id, planCode: "ENTERPRISE" });
  const existingSuperAdmin = await prisma.workspaceUser.findUnique({
    where: { email: SUPER_ADMIN_EMAIL }
  });

  if (!existingSuperAdmin && (!SUPER_ADMIN_PASSWORD || SUPER_ADMIN_PASSWORD.length < 12)) {
    throw new Error("Define SUPER_ADMIN_PASSWORD con al menos 12 caracteres para crear el super admin inicial.");
  }

  const superAdminPasswordPatch = SUPER_ADMIN_PASSWORD
    ? { passwordHash: await hashPassword(SUPER_ADMIN_PASSWORD) }
    : {};

  await prisma.workspaceUser.upsert({
    where: { email: SUPER_ADMIN_EMAIL },
    update: {
      tenantId: platformTenant.id,
      name: "Super Admin",
      role: "SUPER_ADMIN",
      isActive: true,
      ...superAdminPasswordPatch
    },
    create: {
      tenantId: platformTenant.id,
      name: "Super Admin",
      email: SUPER_ADMIN_EMAIL,
      role: "SUPER_ADMIN",
      passwordHash: await hashPassword(SUPER_ADMIN_PASSWORD)
    }
  });

  console.log(`SUPER_ADMIN listo: ${SUPER_ADMIN_EMAIL}`);

  const tenant = await prisma.tenant.upsert({
    where: { slug: "demo-inmobiliaria" },
    update: {
      name: "Demo Inmobiliaria",
      industry: "inmobiliaria",
      plan: "BUSINESS",
      businessPrompt: "Atiendes clientes interesados en departamentos y casas en Santiago. Tu foco es orientar, calificar y avanzar hacia visita.",
      onboardingCompleted: true,
      whatsappPhoneNumberId: process.env.DEMO_INMOBILIARIA_WHATSAPP_PHONE_NUMBER_ID || null,
      instagramBusinessAccountId: process.env.DEMO_INMOBILIARIA_INSTAGRAM_BUSINESS_ACCOUNT_ID || null
    },
    create: {
      name: "Demo Inmobiliaria",
      slug: "demo-inmobiliaria",
      type: "BUSINESS",
      industry: "inmobiliaria",
      plan: "BUSINESS",
      businessPrompt: "Atiendes clientes interesados en departamentos y casas en Santiago. Tu foco es orientar, calificar y avanzar hacia visita.",
      onboardingCompleted: true,
      whatsappPhoneNumberId: process.env.DEMO_INMOBILIARIA_WHATSAPP_PHONE_NUMBER_ID || null,
      instagramBusinessAccountId: process.env.DEMO_INMOBILIARIA_INSTAGRAM_BUSINESS_ACCOUNT_ID || null
    }
  });

  await ensureDefaultAiProfile({
    tenantId: tenant.id,
    name: "IA Demo Inmobiliaria",
    industry: "inmobiliaria",
    objective: "calificar clientes, orientar propiedades y avanzar hacia visitas"
  });

  await ensureChannelConfig({
    tenantId: tenant.id,
    channel: "whatsapp",
    phoneNumberId: process.env.DEMO_INMOBILIARIA_WHATSAPP_PHONE_NUMBER_ID || null,
    accessToken: process.env.DEMO_INMOBILIARIA_META_ACCESS_TOKEN || process.env.META_ACCESS_TOKEN || null,
    verifyToken: process.env.DEMO_INMOBILIARIA_VERIFY_TOKEN || process.env.VERIFY_TOKEN || null
  });

  const agents = [
    { name: "Agente Demo", email: "agente@demo.cl", role: "AGENT" },
    { name: "Vendedor Demo", email: "seller@demo.cl", role: "SELLER" },
    { name: "Supervisión", email: "supervision@demo.cl", role: "ADMIN" }
  ];

  for (const agent of agents) {
    await prisma.workspaceUser.upsert({
      where: { email: agent.email },
      update: {},
      create: {
        tenantId: tenant.id,
        name: agent.name,
        email: agent.email,
        role: agent.role
      }
    });
  }

  const rules = [
    {
      name: "Saludo",
      trigger: "hola",
      response: "¡Hola! 👋 Gracias por escribirnos. ¿Buscas una propiedad para vivir o como inversión?",
      priority: 1,
      channel: null
    },
    {
      name: "Precio",
      trigger: "precio",
      response: "Claro 👌 Para ayudarte mejor, ¿qué presupuesto aproximado tienes y en qué comuna estás buscando?",
      priority: 2,
      channel: null
    },
    {
      name: "Visita",
      trigger: "visita",
      response: "Perfecto 🙌 Podemos coordinar una visita. ¿Qué día y horario te acomodan mejor?",
      priority: 3,
      channel: null
    }
  ];

  for (const rule of rules) {
    const exists = await prisma.rule.findFirst({ where: { tenantId: tenant.id, name: rule.name } });
    if (!exists) {
      await prisma.rule.create({ data: { tenantId: tenant.id, ...rule } });
    }
  }



  const products = [
    {
      name: "Departamento 2D 2B en Ñuñoa",
      description: "Departamento moderno con balcón, cercano a metro y comercio.",
      price: 520000,
      stock: 3,
      category: "inmobiliaria",
      location: "Ñuñoa"
    },
    {
      name: "Departamento 1D 1B en Santiago Centro",
      description: "Opción económica ideal para arriendo o inversión.",
      price: 380000,
      stock: 5,
      category: "inmobiliaria",
      location: "Santiago Centro"
    },
    {
      name: "Servicio de diseño web para negocios",
      description: "Sitio web profesional con enfoque en conversión y captación de clientes.",
      price: 250000,
      stock: 10,
      category: "servicios",
      location: "Despacho digital"
    }
  ];

  for (const product of products) {
    const exists = await prisma.product.findFirst({
      where: { tenantId: tenant.id, name: product.name }
    });
    if (!exists) {
      await prisma.product.create({ data: { tenantId: tenant.id, ...product } });
    }
  }



  const altaBrasaPrompt = `Eventos Alta Brasa realiza experiencias premium de parrilladas para eventos. Servicios oficiales: Cóctel Parrillero, Asado al Plato, Servicio Mixto (Cóctel + Asado al Plato) y servicios adicionales como bar abierto, postres, mobiliario, vajilla y DJ. Debes responder con tono premium, cercano y experto; explicar con precisión los servicios; pedir cantidad de personas, comuna/lugar y fecha para cotizar; y avanzar hacia reserva, agenda o contacto humano cuando exista interés.`;

  const bbqTenant = await prisma.tenant.upsert({
    where: { slug: "demo-parrilladas" },
    update: {
      name: "Eventos Alta Brasa",
      industry: "parrilladas",
      businessPrompt: altaBrasaPrompt,
      onboardingCompleted: true,
      plan: "BUSINESS",
      whatsappPhoneNumberId: process.env.ALTA_BRASA_WHATSAPP_PHONE_NUMBER_ID || process.env.WHATSAPP_PHONE_NUMBER_ID || null,
      instagramBusinessAccountId: process.env.ALTA_BRASA_INSTAGRAM_BUSINESS_ACCOUNT_ID || process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID || null
    },
    create: {
      name: "Eventos Alta Brasa",
      slug: "demo-parrilladas",
      type: "BUSINESS",
      industry: "parrilladas",
      plan: "BUSINESS",
      businessPrompt: altaBrasaPrompt,
      onboardingCompleted: true,
      whatsappPhoneNumberId: process.env.ALTA_BRASA_WHATSAPP_PHONE_NUMBER_ID || process.env.WHATSAPP_PHONE_NUMBER_ID || null,
      instagramBusinessAccountId: process.env.ALTA_BRASA_INSTAGRAM_BUSINESS_ACCOUNT_ID || process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID || null
    }
  });

  await ensureDefaultAiProfile({
    tenantId: bbqTenant.id,
    name: "IA Eventos Alta Brasa",
    industry: "parrilladas",
    objective: "informar servicios premium, cotizar y avanzar hacia reserva"
  });

  await ensureChannelConfig({
    tenantId: bbqTenant.id,
    channel: "whatsapp",
    phoneNumberId: process.env.ALTA_BRASA_WHATSAPP_PHONE_NUMBER_ID || process.env.WHATSAPP_PHONE_NUMBER_ID || null,
    accessToken: process.env.ALTA_BRASA_META_ACCESS_TOKEN || process.env.META_ACCESS_TOKEN || null,
    verifyToken: process.env.ALTA_BRASA_VERIFY_TOKEN || process.env.VERIFY_TOKEN || null
  });

  await prisma.workspaceUser.upsert({
    where: { email: "parrillas@demo.cl" },
    update: {
      tenantId: bbqTenant.id,
      name: "Eventos Alta Brasa",
      role: "OWNER",
      isActive: true
    },
    create: {
      tenantId: bbqTenant.id,
      name: "Eventos Alta Brasa",
      email: "parrillas@demo.cl",
      role: "OWNER"
    }
  });

  // Reglas mínimas. Para Alta Brasa la respuesta final la genera la IA usando la base de conocimiento,
  // por eso las reglas no deben reemplazar el contexto oficial del negocio.
  const bbqRules = [
    {
      name: "Saludo Alta Brasa",
      trigger: "hola",
      response: "Hola 🙌 gracias por escribir a Eventos Alta Brasa. ¿Para cuántas personas sería el evento y en qué comuna?",
      priority: 1,
      channel: null
    },
    {
      name: "Reserva Alta Brasa",
      trigger: "reservar",
      response: "Buenísimo 🙌 para avanzar con la reserva necesito nombre, teléfono, fecha, comuna y cantidad de personas. ¿Me los compartes?",
      priority: 2,
      channel: null
    }
  ];

  for (const rule of bbqRules) {
    const exists = await prisma.rule.findFirst({ where: { tenantId: bbqTenant.id, name: rule.name } });
    if (!exists) await prisma.rule.create({ data: { tenantId: bbqTenant.id, ...rule } });
  }

  const altaBrasaServices = [
    {
      name: "Cóctel Parrillero",
      basePrice: 0,
      pricePerGuest: 0,
      minGuests: 0,
      includes: [
        "parrilla colgante",
        "ahumado con leña frutal",
        "cortes selectos",
        "embutidos artesanales",
        "frutas frescas",
        "verduras asadas",
        "presentación en tablas rústicas"
      ],
      zones: ["Santiago", "Región Metropolitana", "otras zonas a coordinar"],
      notes: "Propuesta innovadora pensada para sorprender. Ideal para espacios reducidos, no requiere mesas ni sillas y fomenta la interacción entre invitados. La cotización final depende de cantidad de personas, comuna/lugar, fecha y adicionales.",
      priority: 1,
      isActive: true
    },
    {
      name: "Asado al Plato",
      basePrice: 0,
      pricePerGuest: 0,
      minGuests: 0,
      includes: [
        "parrilla colgante",
        "ahumado con leña frutal",
        "carnes premium Angus",
        "guarniciones",
        "buffet variado de ensaladas frescas"
      ],
      zones: ["Santiago", "Región Metropolitana", "otras zonas a coordinar"],
      notes: "Experiencia gastronómica completa. Carnes de origen argentino, uruguayo y estadounidense, todas de raza Angus y crianza seleccionada. La cotización final depende de cantidad de personas, comuna/lugar, fecha y adicionales.",
      priority: 2,
      isActive: true
    },
    {
      name: "Servicio Mixto: Cóctel + Asado al Plato",
      basePrice: 0,
      pricePerGuest: 0,
      minGuests: 0,
      includes: [
        "Cóctel Parrillero de bienvenida",
        "bocados gourmet",
        "frutas, verduras y embutidos",
        "Asado al Plato",
        "carnes premium",
        "guarniciones",
        "ensaladas",
        "servicio cuidado y elegante"
      ],
      zones: ["Santiago", "Región Metropolitana", "otras zonas a coordinar"],
      notes: "Combinación perfecta para un evento completo. Inicia con Cóctel Parrillero y luego pasa a Asado al Plato, creando una experiencia progresiva pensada para sorprender en cada etapa. La cotización final depende de cantidad de personas, comuna/lugar, fecha y adicionales.",
      priority: 3,
      isActive: true
    }
  ];

  for (const service of altaBrasaServices) {
    const existing = await prisma.service.findFirst({ where: { tenantId: bbqTenant.id, name: service.name } });
    if (existing) {
      await prisma.service.update({ where: { id: existing.id }, data: service });
    } else {
      await prisma.service.create({ data: { tenantId: bbqTenant.id, ...service } });
    }
  }

  const bbqProducts = [
    {
      name: "Cóctel Parrillero Alta Brasa",
      description: "Parrilla colgante, ahumado con leña frutal, cortes selectos, embutidos artesanales, frutas frescas y verduras asadas en tablas rústicas.",
      price: 0,
      stock: 999,
      category: "parrilladas",
      location: "Santiago"
    },
    {
      name: "Asado al Plato Alta Brasa",
      description: "Asado premium con carnes Angus argentinas, uruguayas y estadounidenses, guarniciones y buffet de ensaladas frescas.",
      price: 0,
      stock: 999,
      category: "parrilladas",
      location: "Santiago"
    },
    {
      name: "Servicio Mixto Alta Brasa",
      description: "Cóctel Parrillero de bienvenida seguido de Asado al Plato con carnes premium, guarniciones y ensaladas.",
      price: 0,
      stock: 999,
      category: "parrilladas",
      location: "Santiago"
    }
  ];

  for (const product of bbqProducts) {
    const exists = await prisma.product.findFirst({ where: { tenantId: bbqTenant.id, name: product.name } });
    if (!exists) await prisma.product.create({ data: { tenantId: bbqTenant.id, ...product } });
  }



  const ecommercePrompt = `Demo Ecommerce es una tienda online que ayuda a clientes a encontrar productos, confirmar precio, stock, despacho y alternativas. Debes responder como asesor de ventas claro y amable: primero resuelve la duda, luego recomienda productos del catálogo y pregunta solo lo necesario para avanzar.`;

  const ecommerceTenant = await prisma.tenant.upsert({
    where: { slug: "demo-ecommerce" },
    update: {
      name: "Demo Ecommerce",
      industry: "ecommerce",
      businessPrompt: ecommercePrompt,
      onboardingCompleted: true,
      plan: "BUSINESS"
    },
    create: {
      name: "Demo Ecommerce",
      slug: "demo-ecommerce",
      type: "BUSINESS",
      industry: "ecommerce",
      plan: "BUSINESS",
      businessPrompt: ecommercePrompt,
      onboardingCompleted: true
    }
  });

  await ensureDefaultAiProfile({
    tenantId: ecommerceTenant.id,
    name: "IA Demo Ecommerce",
    industry: "ecommerce",
    objective: "recomendar productos, confirmar stock y avanzar hacia compra"
  });

  await ensureChannelConfig({
    tenantId: ecommerceTenant.id,
    channel: "whatsapp",
    phoneNumberId: process.env.DEMO_ECOMMERCE_WHATSAPP_PHONE_NUMBER_ID || null,
    accessToken: process.env.DEMO_ECOMMERCE_META_ACCESS_TOKEN || process.env.META_ACCESS_TOKEN || null,
    verifyToken: process.env.DEMO_ECOMMERCE_VERIFY_TOKEN || process.env.VERIFY_TOKEN || null
  });

  await prisma.workspaceUser.upsert({
    where: { email: "ecommerce@demo.cl" },
    update: {
      tenantId: ecommerceTenant.id,
      name: "Demo Ecommerce",
      role: "OWNER",
      isActive: true
    },
    create: {
      tenantId: ecommerceTenant.id,
      name: "Demo Ecommerce",
      email: "ecommerce@demo.cl",
      role: "OWNER"
    }
  });

  const ecommerceProducts = [
    {
      name: "Parrilla portátil acero inoxidable",
      description: "Parrilla compacta ideal para terrazas, camping y reuniones pequeñas. Fácil de transportar y limpiar.",
      price: 89990,
      stock: 12,
      category: "parrillas",
      location: "Despacho nacional"
    },
    {
      name: "Set de cuchillos parrilleros premium",
      description: "Set de cuchillos para asado con mango ergonómico y estuche. Recomendado para uso doméstico y regalos.",
      price: 45990,
      stock: 20,
      category: "accesorios",
      location: "Despacho nacional"
    },
    {
      name: "Carbón premium bolsa 10 kg",
      description: "Carbón de alto rendimiento para parrilladas largas, con buena duración y calor parejo.",
      price: 12990,
      stock: 35,
      category: "insumos",
      location: "Retiro o despacho"
    }
  ];

  for (const product of ecommerceProducts) {
    const exists = await prisma.product.findFirst({ where: { tenantId: ecommerceTenant.id, name: product.name } });
    if (exists) {
      await prisma.product.update({ where: { id: exists.id }, data: product });
    } else {
      await prisma.product.create({ data: { tenantId: ecommerceTenant.id, ...product } });
    }
  }

  await ensureTenantSubscriptionAndModules({ tenantId: tenant.id, planCode: "BUSINESS" });
  await ensureTenantSubscriptionAndModules({ tenantId: bbqTenant.id, planCode: "BUSINESS" });
  await ensureTenantSubscriptionAndModules({ tenantId: ecommerceTenant.id, planCode: "BUSINESS" });

  console.log("Seed completado");
  console.log("Tenant:", tenant.slug);
}

main()
  .catch((error) => {
    console.error("Seed error:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
