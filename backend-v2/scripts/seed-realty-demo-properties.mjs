import "dotenv/config";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { MODULES } from "../src/lib/modules.js";
import { BROKER_AGENT_SCENARIOS } from "../src/services/broker-workflows.service.js";

const prisma = new PrismaClient();
const DEMO_PASSWORD = "Demo1234!";
const REALTY_TENANT_EMAIL = "inmobiliaria@prueba.cl";
const DEMO_SOURCE = "DATOS_DEMOSTRACION_BROKER_OS";

const REALTY_MODULES = [
  MODULES.INBOX,
  MODULES.BOOKINGS,
  MODULES.SALES,
  MODULES.ANALYTICS,
  MODULES.AI_OPS,
  MODULES.REALTY_LOADS,
  MODULES.PROPERTIES,
  MODULES.REALTY_CLIENTS,
  MODULES.REALTY_ACTIVITY,
  MODULES.BROKER_PORTAL,
  MODULES.BROKERS,
  MODULES.PROPERTY_ASSIGNMENTS,
  MODULES.PAYMENTS,
  MODULES.MARKETING,
  MODULES.INTEGRATIONS,
  MODULES.DOCUMENTS,
  MODULES.WORKFLOWS,
];

const BROKERS = [
  { name: "Maria Fernanda Ruiz", email: "maria.ruiz@demo-evolum.cl", phone: "+56961010001" },
  { name: "Carlos Mendoza Soto", email: "carlos.mendoza@demo-evolum.cl", phone: "+56961010002" },
  { name: "Laura Campos Vidal", email: "laura.campos@demo-evolum.cl", phone: "+56961010003" },
  { name: "Diego Alvarez Pena", email: "diego.alvarez@demo-evolum.cl", phone: "+56961010004" },
];

// Perfiles creados como leads reales del CRM: el motor de matching los usa
// exactamente igual que a un comprador que llega desde Inbox o un formulario.
const BUYERS = [
  { name: "Carolina Fuentes", email: "carolina.fuentes@comprador.demo", phone: "+56971110001", budget: 245000000, commune: "Providencia", propertyType: "Departamento", interest: "Compra departamento en Providencia", bedrooms: 3, bathrooms: 2, parking: 1, probability: 88 },
  { name: "Felipe Arancibia", email: "felipe.arancibia@comprador.demo", phone: "+56971110002", budget: 410000000, commune: "La Reina", propertyType: "Casa", interest: "Compra casa en La Reina", bedrooms: 4, bathrooms: 3, parking: 2, probability: 82 },
  { name: "Camila Soto", email: "camila.soto@comprador.demo", phone: "+56971110003", budget: 135000000, commune: "Santiago", propertyType: "Departamento", interest: "Compra departamento de inversión en Santiago", bedrooms: 1, bathrooms: 1, parking: 0, probability: 76 },
  { name: "Oficinas Cordillera SpA", email: "contacto@cordillera-demo.cl", phone: "+56971110004", budget: 340000000, commune: "Las Condes", propertyType: "Oficina", interest: "Compra oficina en Las Condes", bedrooms: 0, bathrooms: 2, parking: 2, probability: 74 },
  { name: "Valentina Mella", email: "valentina.mella@comprador.demo", phone: "+56971110005", budget: 205000000, commune: "Nunoa", propertyType: "Departamento", interest: "Compra departamento nuevo en Nunoa", bedrooms: 2, bathrooms: 2, parking: 1, probability: 79 },
];

const PROPERTIES = [
  {
    title: "Casa Mediterranea Los Trapenses",
    propertyType: "Casa",
    operation: "Venta",
    price: 685000000,
    ufPrice: 17950,
    address: "Camino Los Trapenses 4210, Lo Barnechea",
    comuna: "Lo Barnechea",
    region: "Metropolitana",
    bedrooms: 5,
    bathrooms: 4,
    parking: 3,
    meters: 290,
    builtM2: 290,
    landM2: 820,
    material: "Hormigon armado y terminaciones en piedra",
    yearBuilt: 2018,
    orientation: "Nororiente",
    commonExpenses: 230000,
    photoUrl: "https://images.unsplash.com/photo-1564013799919-ab600027ffc6?auto=format&fit=crop&w=1400&q=80",
    observations: "Casa familiar con quincho, piscina, jardin consolidado y seguridad 24/7.",
    features: ["piscina", "quincho", "seguridad", "jardin"],
    ownerName: "Patricia Villanueva",
    ownerPhone: "+56970010011",
    ownerEmail: "patricia.villanueva@example.com",
    stage: "LEAD",
  },
  {
    title: "Departamento Vista Parque Pocuro",
    propertyType: "Departamento",
    operation: "Venta",
    price: 238000000,
    ufPrice: 6230,
    address: "Pocuro 2980, Providencia",
    comuna: "Providencia",
    region: "Metropolitana",
    bedrooms: 3,
    bathrooms: 2,
    parking: 1,
    meters: 92,
    builtM2: 92,
    landM2: 0,
    material: "Hormigon armado",
    yearBuilt: 2016,
    orientation: "Oriente",
    commonExpenses: 145000,
    photoUrl: "https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?auto=format&fit=crop&w=1400&q=80",
    observations: "Vista despejada, terraza amplia, bodega y cercania a metro Ines de Suarez.",
    features: ["terraza", "bodega", "metro", "vista despejada"],
    ownerName: "Andres Toledo",
    ownerPhone: "+56970010012",
    ownerEmail: "andres.toledo@example.com",
    stage: "CONTACT",
  },
  {
    title: "Casa adosada Piedra Roja",
    propertyType: "Casa adosada",
    operation: "Venta",
    price: 420000000,
    ufPrice: 11000,
    address: "Av. Del Valle 15500, Chicureo",
    comuna: "Colina",
    region: "Metropolitana",
    bedrooms: 4,
    bathrooms: 3,
    parking: 2,
    meters: 180,
    builtM2: 180,
    landM2: 260,
    material: "Albanileria reforzada",
    yearBuilt: 2021,
    orientation: "Norte",
    commonExpenses: 180000,
    photoUrl: "https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?auto=format&fit=crop&w=1400&q=80",
    observations: "Condominio con areas verdes, quincho comunitario y acceso controlado.",
    features: ["condominio", "areas verdes", "seguridad", "quincho"],
    ownerName: "Ignacio Fuentes",
    ownerPhone: "+56970010013",
    ownerEmail: "ignacio.fuentes@example.com",
    stage: "QUALIFIED",
  },
  {
    title: "Oficina Premium Apoquindo",
    propertyType: "Oficina",
    operation: "Venta",
    price: 310000000,
    ufPrice: 8120,
    address: "Apoquindo 4501, Las Condes",
    comuna: "Las Condes",
    region: "Metropolitana",
    bedrooms: 0,
    bathrooms: 3,
    parking: 2,
    meters: 126,
    builtM2: 126,
    landM2: 0,
    material: "Planta libre con tabiques vidriados",
    yearBuilt: 2014,
    orientation: "Poniente",
    commonExpenses: 390000,
    photoUrl: "https://images.unsplash.com/photo-1497366754035-f200968a6e72?auto=format&fit=crop&w=1400&q=80",
    observations: "Oficina habilitada, sala de reuniones, recepcion y dos privados.",
    features: ["metro", "planta libre", "recepcion", "sala reuniones"],
    ownerName: "Sociedad Inversiones Norte",
    ownerPhone: "+56970010014",
    ownerEmail: "contacto@inversionesnorte.example.com",
    stage: "VISIT_SCHEDULED",
  },
  {
    title: "Parcela Condominio Puerto Varas",
    propertyType: "Parcela",
    operation: "Venta",
    price: 265000000,
    ufPrice: 6940,
    address: "Ruta V-505 Km 9, Puerto Varas",
    comuna: "Puerto Varas",
    region: "Los Lagos",
    bedrooms: 3,
    bathrooms: 2,
    parking: 4,
    meters: 145,
    builtM2: 145,
    landM2: 5000,
    material: "Madera laminada y aislacion termica",
    yearBuilt: 2020,
    orientation: "Norponiente",
    commonExpenses: 85000,
    photoUrl: "https://images.unsplash.com/photo-1505693416388-ac5ce068fe85?auto=format&fit=crop&w=1400&q=80",
    observations: "Casa en parcela con vista parcial al lago, calefaccion central y bodega.",
    features: ["parcela", "vista lago", "bodega", "calefaccion"],
    ownerName: "Claudia Barrientos",
    ownerPhone: "+56970010015",
    ownerEmail: "claudia.barrientos@example.com",
    stage: "OFFER",
  },
  {
    title: "Departamento Nuevo Nunoa",
    propertyType: "Departamento",
    operation: "Venta",
    price: 198000000,
    ufPrice: 5180,
    address: "Irarrazaval 4200, Nunoa",
    comuna: "Nunoa",
    region: "Metropolitana",
    bedrooms: 2,
    bathrooms: 2,
    parking: 1,
    meters: 68,
    builtM2: 68,
    landM2: 0,
    material: "Hormigon armado",
    yearBuilt: 2024,
    orientation: "Suroriente",
    commonExpenses: 115000,
    photoUrl: "https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?auto=format&fit=crop&w=1400&q=80",
    observations: "Edificio nuevo con espacio colaborativo, quincho panorámico y gimnasio.",
    features: ["nuevo", "espacio colaborativo", "gimnasio", "quincho"],
    ownerName: "Constructora Urbano",
    ownerPhone: "+56970010016",
    ownerEmail: "ventas@urbano.example.com",
    stage: "NEGOTIATION",
  },
  {
    title: "Casa Familiar Penalolen Alto",
    propertyType: "Casa",
    operation: "Venta",
    price: 345000000,
    ufPrice: 9020,
    address: "Los Presidentes 8900, Penalolen",
    comuna: "Penalolen",
    region: "Metropolitana",
    bedrooms: 4,
    bathrooms: 3,
    parking: 2,
    meters: 168,
    builtM2: 168,
    landM2: 410,
    material: "Albanileria y ampliacion regularizada",
    yearBuilt: 2012,
    orientation: "Norte",
    commonExpenses: 0,
    photoUrl: "https://images.unsplash.com/photo-1572120360610-d971b9d7767c?auto=format&fit=crop&w=1400&q=80",
    observations: "Barrio tranquilo, quincho techado, escritorio y buena conectividad.",
    features: ["quincho", "escritorio", "patio", "conectividad"],
    ownerName: "Jorge Herrera",
    ownerPhone: "+56970010017",
    ownerEmail: "jorge.herrera@example.com",
    stage: "CLOSING",
  },
  {
    title: "Local Comercial Vitacura",
    propertyType: "Local",
    operation: "Venta",
    price: 580000000,
    ufPrice: 15180,
    address: "Av. Vitacura 5200, Vitacura",
    comuna: "Vitacura",
    region: "Metropolitana",
    bedrooms: 0,
    bathrooms: 2,
    parking: 3,
    meters: 150,
    builtM2: 150,
    landM2: 0,
    material: "Planta comercial habilitada",
    yearBuilt: 2010,
    orientation: "Oriente",
    commonExpenses: 260000,
    photoUrl: "https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?auto=format&fit=crop&w=1400&q=80",
    observations: "Alto flujo peatonal, vitrina amplia y estacionamientos de clientes.",
    features: ["alto flujo", "vitrina", "estacionamientos", "comercial"],
    ownerName: "Comercial Oriente SPA",
    ownerPhone: "+56970010018",
    ownerEmail: "admin@comercialoriente.example.com",
    stage: "POSTSALE",
  },
  {
    title: "Departamento Inversion Santiago Centro",
    propertyType: "Departamento",
    operation: "Venta",
    price: 118000000,
    ufPrice: 3090,
    address: "Lord Cochrane 220, Santiago",
    comuna: "Santiago",
    region: "Metropolitana",
    bedrooms: 1,
    bathrooms: 1,
    parking: 0,
    meters: 38,
    builtM2: 38,
    landM2: 0,
    material: "Hormigon armado",
    yearBuilt: 2019,
    orientation: "Poniente",
    commonExpenses: 72000,
    photoUrl: "https://images.unsplash.com/photo-1536376072261-38c75010e6c9?auto=format&fit=crop&w=1400&q=80",
    observations: "Ideal inversion, arriendo activo y alta demanda universitaria.",
    features: ["inversion", "arriendo activo", "metro", "alta demanda"],
    ownerName: "Fernanda Rojas",
    ownerPhone: "+56970010019",
    ownerEmail: "fernanda.rojas@example.com",
    stage: "LEAD",
  },
  {
    title: "Casa Remodelada La Reina",
    propertyType: "Casa",
    operation: "Venta",
    price: 395000000,
    ufPrice: 10330,
    address: "Talinay 720, La Reina",
    comuna: "La Reina",
    region: "Metropolitana",
    bedrooms: 4,
    bathrooms: 3,
    parking: 2,
    meters: 172,
    builtM2: 172,
    landM2: 510,
    material: "Albanileria remodelada",
    yearBuilt: 2008,
    orientation: "Oriente",
    commonExpenses: 0,
    photoUrl: "https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=1400&q=80",
    observations: "Remodelacion completa, cocina integrada, jardin y pieza de servicio.",
    features: ["remodelada", "jardin", "cocina integrada", "servicio"],
    ownerName: "Rodrigo Salinas",
    ownerPhone: "+56970010020",
    ownerEmail: "rodrigo.salinas@example.com",
    stage: "CONTACT",
  },
  {
    title: "Penthouse Costa de Montemar",
    propertyType: "Penthouse",
    operation: "Venta",
    price: 520000000,
    ufPrice: 13600,
    address: "Avenida Cornisa 900, Concon",
    comuna: "Concon",
    region: "Valparaiso",
    bedrooms: 4,
    bathrooms: 4,
    parking: 3,
    meters: 210,
    builtM2: 210,
    landM2: 0,
    material: "Hormigon armado premium",
    yearBuilt: 2022,
    orientation: "Norponiente",
    commonExpenses: 310000,
    photoUrl: "https://images.unsplash.com/photo-1600566753190-17f0baa2a6c3?auto=format&fit=crop&w=1400&q=80",
    observations: "Vista al mar, terraza perimetral, terminaciones premium y domotica.",
    features: ["vista mar", "terraza", "domotica", "premium"],
    ownerName: "Valentina Araya",
    ownerPhone: "+56970010021",
    ownerEmail: "valentina.araya@example.com",
    stage: "QUALIFIED",
  },
  {
    title: "Bodega Industrial Quilicura",
    propertyType: "Bodega",
    operation: "Venta",
    price: 760000000,
    ufPrice: 19890,
    address: "Lo Echevers 1050, Quilicura",
    comuna: "Quilicura",
    region: "Metropolitana",
    bedrooms: 0,
    bathrooms: 4,
    parking: 8,
    meters: 920,
    builtM2: 920,
    landM2: 1400,
    material: "Estructura metalica industrial",
    yearBuilt: 2017,
    orientation: "Sur",
    commonExpenses: 0,
    photoUrl: "https://images.unsplash.com/photo-1586528116311-ad8dd3c8310d?auto=format&fit=crop&w=1400&q=80",
    observations: "Galpon con oficinas, andenes, patio de maniobra y acceso a autopistas.",
    features: ["industrial", "andenes", "oficinas", "patio maniobra"],
    ownerName: "Logistica Centro Norte",
    ownerPhone: "+56970010022",
    ownerEmail: "operaciones@logisticacentro.example.com",
    stage: "VISIT_SCHEDULED",
  },
];

function tenantLooksRealty(tenant) {
  const value = `${tenant.name || ""} ${tenant.slug || ""} ${tenant.industry || ""}`.toLowerCase();
  return value.includes("inmob") || value.includes("realty") || value.includes("corretaje") || value.includes("tgi");
}

async function findTenant() {
  if (process.env.SEED_TENANT_ID) {
    const tenant = await prisma.tenant.findUnique({ where: { id: process.env.SEED_TENANT_ID } });
    if (tenant) return tenant;
  }
  const bySlug = await prisma.tenant.findUnique({ where: { slug: "inmobiliaria" } });
  if (bySlug) return bySlug;

  const byAdmin = await prisma.workspaceUser.findUnique({
    where: { email: REALTY_TENANT_EMAIL },
    include: { tenant: true },
  });
  if (byAdmin?.tenant) return byAdmin.tenant;

  const tenants = await prisma.tenant.findMany({ orderBy: { createdAt: "asc" } });
  return tenants.find(tenantLooksRealty) || tenants[0] || null;
}

async function ensureRealtyTenant(tenant) {
  return prisma.tenant.update({
    where: { id: tenant.id },
    data: {
      name: "Inmobiliaria",
      slug: "inmobiliaria",
      industry: "REAL_ESTATE",
      plan: "ENTERPRISE",
      onboardingCompleted: true,
    },
  });
}

async function ensureOwner(tenantId) {
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);
  return prisma.workspaceUser.upsert({
    where: { email: REALTY_TENANT_EMAIL },
    update: {
      tenantId,
      name: "Admin inmobiliaria",
      passwordHash,
      role: "ADMIN",
      jobTitle: "Administrador inmobiliario",
      isActive: true,
    },
    create: {
      tenantId,
      name: "Admin inmobiliaria",
      email: REALTY_TENANT_EMAIL,
      passwordHash,
      role: "ADMIN",
      jobTitle: "Administrador inmobiliario",
      isActive: true,
    },
  });
}

async function ensureModules(tenantId) {
  for (const module of REALTY_MODULES) {
    await prisma.tenantModule.upsert({
      where: { tenantId_module: { tenantId, module } },
      update: { enabled: true, source: "REALTY_DEMO" },
      create: { tenantId, module, enabled: true, source: "REALTY_DEMO" },
    });
  }
}

async function ensureBrokers(tenantId) {
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);
  const users = [];

  for (const broker of BROKERS) {
    const user = await prisma.workspaceUser.upsert({
      where: { email: broker.email },
      update: {
        tenantId,
        name: broker.name,
        passwordHash,
        role: "SELLER",
        jobTitle: "Corredor inmobiliario",
        isActive: true,
      },
      create: {
        tenantId,
        name: broker.name,
        email: broker.email,
        passwordHash,
        role: "SELLER",
        jobTitle: "Corredor inmobiliario",
        isActive: true,
      },
    });

    const existingProfile = await prisma.industryRecord.findFirst({
      where: { tenantId, recordType: "broker_profile", title: broker.name },
    });
    const profileData = {
      userId: user.id,
      email: broker.email,
      phone: broker.phone,
      role: "CORREDOR",
      source: "seed-realty-demo",
    };

    if (existingProfile) {
      await prisma.industryRecord.update({
        where: { id: existingProfile.id },
        data: { assignedToId: user.id, status: "ACTIVE", data: profileData },
      });
    } else {
      await prisma.industryRecord.create({
        data: {
          tenantId,
          recordType: "broker_profile",
          title: broker.name,
          status: "ACTIVE",
          assignedToId: user.id,
          data: profileData,
        },
      });
    }

    users.push(user);
  }

  return users;
}

async function ensureBuyers(tenantId) {
  const buyers = [];
  for (const buyer of BUYERS) {
    const externalId = `demo-buyer:${buyer.email}`;
    const contact = await prisma.contact.upsert({
      where: { tenantId_externalId_channel: { tenantId, externalId, channel: "manual" } },
      update: { name: buyer.name },
      create: { tenantId, externalId, channel: "manual", name: buyer.name },
    });
    let conversation = await prisma.conversation.findFirst({ where: { tenantId, contactId: contact.id } });
    if (!conversation) {
      conversation = await prisma.conversation.create({
        data: { tenantId, contactId: contact.id, status: "OPEN", mode: "HUMAN", priorityLabel: "medium", priorityScore: buyer.probability },
      });
    }
    const leadData = {
      tenantId,
      conversationId: conversation.id,
      name: buyer.name,
      phone: buyer.phone,
      interest: buyer.interest,
      propertyType: buyer.propertyType,
      commune: buyer.commune,
      budget: buyer.budget,
      status: "QUALIFIED",
      closeProbability: buyer.probability,
      notes: "Perfil comprador de demostración para recomendaciones inmobiliarias.",
      customFields: {
        source: "seed-realty-demo-buyer",
        email: buyer.email,
        bedrooms: buyer.bedrooms,
        bathrooms: buyer.bathrooms,
        parking: buyer.parking,
      },
    };
    const existing = await prisma.lead.findUnique({ where: { conversationId: conversation.id } });
    buyers.push(existing
      ? await prisma.lead.update({ where: { id: existing.id }, data: leadData })
      : await prisma.lead.create({ data: leadData }));
  }
  return buyers;
}

async function normalizeLegacyTrainingProperty(tenantId) {
  const legacy = await prisma.industryRecord.findFirst({
    where: { tenantId, recordType: "property", title: { startsWith: "TRAINING-" } },
    orderBy: { updatedAt: "desc" },
  });
  if (!legacy) return null;
  return prisma.industryRecord.update({
    where: { id: legacy.id },
    data: {
      title: "Departamento Providencia",
      status: "ACTIVE",
      data: {
        ...(legacy.data && typeof legacy.data === "object" ? legacy.data : {}),
        propertyType: "Departamento",
        operation: "Venta",
        price: 210000000,
        address: "Av. Pedro de Valdivia 1234",
        comuna: "Providencia",
        region: "Metropolitana",
        bedrooms: 2,
        bathrooms: 2,
        parking: 1,
        meters: 74,
        builtM2: 74,
        material: "Hormigón armado",
        photoUrl: "https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?auto=format&fit=crop&w=1400&q=80",
        gallery: [
          "https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?auto=format&fit=crop&w=1400&q=80",
          "https://images.unsplash.com/photo-1600607687920-4e2a09cf159d?auto=format&fit=crop&w=1200&q=80",
        ],
        observations: "Departamento de demostración con terraza, bodega, excelente conectividad y cercanía a servicios.",
        source: "seed-realty-demo-normalized",
      },
    },
  });
}

async function upsertProperty(tenantId, property, index, brokers) {
  const broker = index < 8 ? brokers[index % brokers.length] : null;
  const data = {
    ...property,
    assignedBrokerId: broker?.id || "",
    assignedBrokerName: broker?.name || "",
    assignmentMode: broker ? "seed_balanceado" : "pendiente_asignacion",
    source: "seed-realty-demo",
    gallery: [
      property.photoUrl,
      "https://images.unsplash.com/photo-1600607687920-4e2a09cf159d?auto=format&fit=crop&w=1200&q=80",
      "https://images.unsplash.com/photo-1600566752355-35792bedcfea?auto=format&fit=crop&w=1200&q=80",
    ],
  };

  const legacyTitle = property.title === "Casa adosada Piedra Roja" ? "Townhouse Piedra Roja" : null;
  const existing = await prisma.industryRecord.findFirst({
    where: {
      tenantId,
      recordType: "property",
      ...(legacyTitle ? { title: { in: [property.title, legacyTitle] } } : { title: property.title })
    },
  });

  if (existing) {
    return prisma.industryRecord.update({
      where: { id: existing.id },
      data: {
        title: property.title,
        status: "ACTIVE",
        assignedToId: broker?.id || null,
        data,
      },
    });
  }

  return prisma.industryRecord.create({
    data: {
      tenantId,
      recordType: "property",
      title: property.title,
      status: "ACTIVE",
      assignedToId: broker?.id || null,
      data,
    },
  });
}

async function upsertDemoRecord(tenantId, { recordType, title, status, data, assignedToId = null }) {
  const payload = {
    ...data,
    source: DEMO_SOURCE,
    demo: true,
    demoLabel: "Datos de demostración Broker OS",
  };
  const legacyTitle = title === "Tasación aprobada - Casa adosada Piedra Roja"
    ? "Tasación aprobada - Townhouse Piedra Roja"
    : null;
  const existing = await prisma.industryRecord.findFirst({
    where: {
      tenantId,
      recordType,
      ...(legacyTitle ? { title: { in: [title, legacyTitle] } } : { title })
    },
    select: { id: true },
  });
  if (existing) {
    return prisma.industryRecord.update({
      where: { id: existing.id },
      data: { title, status, assignedToId, data: payload },
    });
  }
  return prisma.industryRecord.create({
    data: { tenantId, recordType, title, status, assignedToId, data: payload },
  });
}

async function seedAgentEvaluations(tenantId) {
  const results = {
    "comprador-providencia": { decision: "CONFIRMED", outcome: "La recomendación permitió priorizar una visita con una compradora compatible.", note: "El equipo confirmó que presupuesto, comuna y dormitorios coincidían." },
    "oferta-bajo-rango": { decision: "ADJUSTMENT_NEEDED", outcome: "La contraoferta se ajustó después de revisar comparables y condiciones de financiamiento.", note: "La IA debe mostrar el margen porcentual antes de sugerir el siguiente paso." },
    "publicacion-pendiente": { decision: "CONFIRMED", outcome: "Se completaron fotografías y descripción antes de publicar la propiedad.", note: "La publicación siguió pendiente hasta la aprobación del corredor responsable." },
    "documento-por-vencer": { decision: "CONFIRMED", outcome: "Se solicitó el documento actualizado y se registró la revisión humana.", note: "El aviso fue útil y no modificó ningún antecedente por sí solo." },
    "visita-sin-seguimiento": { decision: "CONFIRMED", outcome: "El corredor registró una llamada de seguimiento después de la visita.", note: "La tarea quedó como borrador hasta que el corredor decidió ejecutarla." },
    "arriendo-vencimiento": { decision: "PENDING_REVIEW", outcome: "Caso preparado para revisar renovación, reajuste y antecedentes del arrendatario.", note: "No se envió ningún aviso al arrendatario sin aprobación humana." },
    "mantencion-presupuesto": { decision: "CONFIRMED", outcome: "La cotización se comparó con el presupuesto aprobado de la propiedad.", note: "La selección del proveedor quedó pendiente de autorización del administrador." },
    "postventa-garantia": { decision: "ADJUSTMENT_NEEDED", outcome: "El caso se derivó a postventa con evidencia fotográfica adicional.", note: "Se pidió a la IA priorizar garantía vigente y fecha de compromiso." },
    "financiamiento-en-revision": { decision: "PENDING_REVIEW", outcome: "La solicitud quedó lista para validar antecedentes con la entidad financiera.", note: "La IA no aprueba créditos ni comparte información financiera." },
    "cartera-sin-responsable": { decision: "CONFIRMED", outcome: "Se propuso un corredor según carga de cartera y zona de trabajo.", note: "La asignación se dejó para confirmación de un administrador." }
  };
  const records = [];
  for (const scenario of BROKER_AGENT_SCENARIOS) {
    const result = results[scenario.key] || { decision: "PENDING_REVIEW", outcome: "Escenario preparado para revisión del equipo.", note: "Pendiente de retroalimentación humana." };
    records.push(await upsertDemoRecord(tenantId, {
      recordType: "broker_agent_evaluation",
      title: `Evaluación IA: ${scenario.title}`,
      status: result.decision,
      data: {
        scenarioKey: scenario.key,
        agentKey: scenario.agentKey,
        area: scenario.area,
        expectedRecommendation: scenario.expectedRecommendation,
        requiresHumanApproval: scenario.requiresHumanApproval,
        decision: result.decision,
        outcome: result.outcome,
        note: result.note,
        reviewedAt: "2026-08-15T12:00:00.000Z",
        reviewedBy: "Equipo de demostración Broker OS"
      }
    }));
  }
  return records;
}

async function seedBrokerWorkspace(tenantId, properties, brokers, buyers) {
  const propertyId = (title) => {
    const record = properties.find((property) => property.title === title);
    if (!record) throw new Error(`No se encontró la propiedad demo: ${title}`);
    return record.id;
  };
  const brokerId = (name) => brokers.find((broker) => broker.name === name)?.id || null;
  const buyerId = (name) => buyers.find((buyer) => buyer.name === name)?.id || null;
  const property = {
    pocuro: propertyId("Departamento Vista Parque Pocuro"),
    piedraRoja: propertyId("Casa adosada Piedra Roja"),
    apoquindo: propertyId("Oficina Premium Apoquindo"),
    nunoa: propertyId("Departamento Nuevo Nunoa"),
    penalolen: propertyId("Casa Familiar Penalolen Alto"),
    vitacura: propertyId("Local Comercial Vitacura"),
    santiago: propertyId("Departamento Inversion Santiago Centro"),
    montemar: propertyId("Penthouse Costa de Montemar"),
    quilicura: propertyId("Bodega Industrial Quilicura"),
  };
  const assigned = {
    maria: brokerId("Maria Fernanda Ruiz"),
    carlos: brokerId("Carlos Mendoza Soto"),
    laura: brokerId("Laura Campos Vidal"),
    diego: brokerId("Diego Alvarez Pena"),
  };
  const buyersByName = {
    carolina: buyerId("Carolina Fuentes"),
    felipe: buyerId("Felipe Arancibia"),
    camila: buyerId("Camila Soto"),
    valentina: buyerId("Valentina Mella"),
    oficinas: buyerId("Oficinas Cordillera SpA"),
  };

  const records = [];
  const put = async (record) => {
    const result = await upsertDemoRecord(tenantId, record);
    records.push(result);
    return result;
  };

  // Perfiles persistentes: el demo deja de depender del cálculo por defecto y
  // permite comprobar de forma visible los alcances por usuario.
  const workspaceUsers = await prisma.workspaceUser.findMany({
    where: { tenantId, isActive: true },
    select: { id: true, name: true, role: true },
    orderBy: { name: "asc" },
  });
  for (const user of workspaceUsers) {
    const isAdministrator = ["ADMIN", "OWNER", "SUPER_ADMIN"].includes(user.role);
    await put({
      recordType: "broker_access_profile",
      title: `Acceso Broker: ${user.name}`,
      status: "ACTIVE",
      assignedToId: user.id,
      data: {
        userId: user.id,
        businessRole: isAdministrator ? "CEO" : "CORREDOR",
        accessScope: isAdministrator ? "COMPANY" : "ASSIGNED",
        teamKey: "corretaje-demo",
        branchKey: "santiago",
        version: 1,
      },
    });
  }

  // Operaciones principales: muestran venta, arriendo y administración en etapas reales.
  await put({
    recordType: "broker_operation", title: "Venta Departamento Vista Parque Pocuro", status: "ACTIVE", assignedToId: assigned.maria,
    data: {
      operationType: "SALE", propertyId: property.pocuro, buyerId: buyersByName.carolina, clientName: "Carolina Fuentes", stage: "NEGOCIACION",
      expectedCloseDate: "2026-09-18", estimatedCommission: 7140000,
      timeline: [
        { at: "2026-07-28T10:00:00.000Z", type: "CAPTACION", stage: "CAPTACION", note: "Propiedad incorporada a cartera con mandato vigente." },
        { at: "2026-08-03T16:30:00.000Z", type: "VISITA", stage: "VISITA", note: "Visita realizada con compradora preaprobada." },
        { at: "2026-08-12T11:15:00.000Z", type: "NEGOCIACION", stage: "NEGOCIACION", note: "Oferta recibida; se revisan condiciones de cierre." },
      ],
    },
  });
  await put({
    recordType: "broker_operation", title: "Arriendo Departamento Inversión Santiago Centro", status: "ACTIVE", assignedToId: assigned.carlos,
    data: {
      operationType: "RENTAL", propertyId: property.santiago, buyerId: buyersByName.camila, clientName: "Camila Soto", stage: "CONTRATO",
      expectedCloseDate: "2026-08-28", monthlyRent: 590000,
      timeline: [
        { at: "2026-07-30T14:00:00.000Z", type: "CAPTACION", stage: "CAPTACION", note: "Unidad preparada para arriendo de inversión." },
        { at: "2026-08-06T18:00:00.000Z", type: "EVALUACION", stage: "EVALUACION", note: "Antecedentes de arrendataria revisados por el equipo." },
        { at: "2026-08-13T12:00:00.000Z", type: "CONTRATO", stage: "CONTRATO", note: "Contrato listo para firma y fecha de entrega acordada." },
      ],
    },
  });
  await put({
    recordType: "broker_operation", title: "Administración Local Comercial Vitacura", status: "ACTIVE", assignedToId: assigned.laura,
    data: {
      operationType: "ADMINISTRATION", propertyId: property.vitacura, clientName: "Comercial Oriente SpA", stage: "LIQUIDACION",
      expectedCloseDate: "2026-08-31", monthlyManagementFee: 174000,
      timeline: [
        { at: "2026-07-01T09:00:00.000Z", type: "INCORPORACION", stage: "INCORPORACION", note: "Cartera comercial recibida con inventario documental." },
        { at: "2026-08-02T10:00:00.000Z", type: "COBRO", stage: "COBRO", note: "Canon de agosto registrado para conciliación." },
        { at: "2026-08-14T12:00:00.000Z", type: "LIQUIDACION", stage: "LIQUIDACION", note: "Liquidación del período preparada para aprobación humana." },
      ],
    },
  });

  // Comercial y cierre.
  await put({ recordType: "property_appraisal", title: "Tasación aprobada - Casa adosada Piedra Roja", status: "APPROVED", assignedToId: assigned.diego, data: { propertyId: property.piedraRoja, estimatedValue: 425000000, method: "Comparables de mercado", appraisedAt: "2026-08-04", notes: "Valor referencial validado con oferta y demanda de Chicureo." } });
  await put({ recordType: "property_mandate", title: "Mandato vigente - Departamento Vista Parque Pocuro", status: "SIGNED", assignedToId: assigned.maria, data: { propertyId: property.pocuro, ownerName: "Andrés Toledo", startDate: "2026-07-25", endDate: "2026-10-25", exclusivity: true } });
  await put({ recordType: "property_offer", title: "Oferta Carolina Fuentes - Vista Parque Pocuro", status: "SUBMITTED", assignedToId: assigned.maria, data: { propertyId: property.pocuro, buyerName: "Carolina Fuentes", buyerId: buyersByName.carolina, amount: 229000000, validityUntil: "2026-08-20", financing: "Crédito hipotecario preaprobado" } });
  await put({ recordType: "property_promise", title: "Promesa de compraventa - Casa Familiar Peñalolén Alto", status: "PENDING_SIGNATURE", assignedToId: assigned.carlos, data: { propertyId: property.penalolen, buyerName: "Felipe Arancibia", buyerId: buyersByName.felipe, signingDate: "2026-08-22", agreedAmount: 338000000, notary: "Notaría de Peñalolén" } });
  await put({ recordType: "commission_settlement", title: "Liquidación de comisión - Penthouse Costa de Montemar", status: "PENDING", assignedToId: assigned.laura, data: { propertyId: property.montemar, amount: 8700000, operationAmount: 435000000, percentage: 2, payableTo: "Laura Campos Vidal" } });

  // Arriendos y administración.
  await put({ recordType: "rental_application", title: "Postulación de arriendo - Camila Soto", status: "APPROVED", assignedToId: assigned.carlos, data: { propertyId: property.santiago, tenantName: "Camila Soto", tenantId: buyersByName.camila, incomeVerified: true, guarantor: "Javiera Soto" } });
  await put({ recordType: "administration_profile", title: "Ficha de administración - Departamento Inversión Santiago Centro", status: "ACTIVE", assignedToId: assigned.carlos, data: { propertyId: property.santiago, ownerName: "Inversiones Santiago Centro SpA", tenantName: "Camila Soto", managementRatePct: 8, ownerPaymentDay: 10, contractReference: "ARR-2026-081" } });
  await put({ recordType: "rental_contract", title: "Contrato activo - Departamento Inversión Santiago Centro", status: "ACTIVE", assignedToId: assigned.carlos, data: { propertyId: property.santiago, tenantName: "Camila Soto", startDate: "2026-08-01", monthlyRent: 590000, endDate: "2027-08-31", paymentDay: 5 } });
  await put({ recordType: "rental_payment", title: "Cobro de arriendo - Agosto 2026", status: "PAID", assignedToId: assigned.carlos, data: { propertyId: property.santiago, amount: 590000, dueDate: "2026-08-05", paidAt: "2026-08-05", period: "2026-08", tenantName: "Camila Soto" } });
  await put({ recordType: "utility_monitoring", title: "Servicios comunes - Agosto 2026", status: "RECORDED", assignedToId: assigned.carlos, data: { propertyId: property.santiago, amount: 42000, dueDate: "2026-08-12", period: "2026-08", description: "Gasto común y servicios básicos informados por administración." } });
  await put({ recordType: "maintenance_ticket", title: "Reparación menor - Departamento Inversión Santiago Centro", status: "RESOLVED", assignedToId: assigned.carlos, data: { propertyId: property.santiago, category: "Gasfitería", description: "Reparación de llave de lavaplatos con evidencia de cierre.", amount: 28000, completedAt: "2026-08-16", period: "2026-08" } });
  await put({ recordType: "administration_liquidation", title: "Liquidación administración - Departamento Inversión Santiago Centro", status: "PENDING_APPROVAL", assignedToId: assigned.carlos, data: { propertyId: property.santiago, period: "2026-08", monthlyRent: 590000, paidAmount: 590000, commonExpenses: 42000, maintenanceCost: 28000, managementRatePct: 8, amount: 472800, requiresHumanApproval: true, automaticTransfer: false } });
  await put({ recordType: "administration_liquidation", title: "Liquidación administración - Local Vitacura", status: "PENDING_APPROVAL", assignedToId: assigned.laura, data: { propertyId: property.vitacura, period: "2026-08", amount: 174000, income: 5800000, expenses: 420000, requiresHumanApproval: true, automaticTransfer: false } });

  // Mantenciones y proveedores.
  await put({ recordType: "maintenance_ticket", title: "Mantención climatización - Oficina Premium Apoquindo", status: "QUOTING", assignedToId: assigned.diego, data: { propertyId: property.apoquindo, category: "Climatización", description: "Revisión preventiva de equipos de aire acondicionado antes de nueva visita comercial.", priority: "MEDIA", reportedAt: "2026-08-11" } });
  await put({ recordType: "service_provider", title: "Servicios Técnicos Cordillera SpA", status: "ACTIVE", data: { providerName: "Servicios Técnicos Cordillera SpA", specialty: "Climatización y mantención de oficinas", contactName: "Tomás Vega", phone: "+56962223344", rating: 4.8 } });
  await put({ recordType: "provider_quote", title: "Cotización climatización - Oficina Apoquindo", status: "RECEIVED", assignedToId: assigned.diego, data: { propertyId: property.apoquindo, providerName: "Servicios Técnicos Cordillera SpA", amount: 485000, validUntil: "2026-08-23", scope: "Mantención preventiva de cuatro equipos." } });
  await put({ recordType: "material_purchase", title: "Compra materiales - Casa Peñalolén Alto", status: "APPROVED", assignedToId: assigned.diego, data: { propertyId: property.penalolen, supplierName: "Ferretería Los Presidentes", amount: 198500, concept: "Reparación de cierre perimetral", approvedAt: "2026-08-12" } });

  // Proyecto, publicación y postventa.
  await put({ recordType: "remodeling_project", title: "Puesta en valor - Penthouse Costa de Montemar", status: "IN_PROGRESS", assignedToId: assigned.laura, data: { propertyId: property.montemar, projectType: "Puesta en valor para publicación", budget: 3200000, startDate: "2026-08-01", targetDate: "2026-09-05" } });
  await put({ recordType: "project_budget", title: "Presupuesto remodelación - Penthouse Costa de Montemar", status: "APPROVED", assignedToId: assigned.laura, data: { propertyId: property.montemar, amount: 3200000, scope: "Pintura, iluminación y estilismo comercial", approvedBy: "Admin inmobiliaria" } });
  await put({ recordType: "project_milestone", title: "Hito fotografías profesionales - Penthouse Costa de Montemar", status: "PENDING", assignedToId: assigned.laura, data: { propertyId: property.montemar, milestoneDate: "2026-08-21", description: "Sesión fotográfica, tour virtual y material de publicación." } });
  await put({ recordType: "marketing_publication", title: "Publicación portal y redes - Departamento Nuevo Ñuñoa", status: "PUBLISHED", assignedToId: assigned.maria, data: { propertyId: property.nunoa, channel: "Portal inmobiliario y redes sociales", publicationStatus: "Publicado", publishedAt: "2026-08-08", leadsGenerated: 14 } });
  await put({ recordType: "property_inspection", title: "Inspección pre-entrega - Casa Familiar Peñalolén Alto", status: "COMPLETED", assignedToId: assigned.carlos, data: { propertyId: property.penalolen, inspectionDate: "2026-08-13", checklist: "Pintura revisada, medidores fotografiados, llaves completas y observaciones documentadas." } });
  await put({ recordType: "property_handover", title: "Entrega programada - Casa Familiar Peñalolén Alto", status: "PENDING_SIGNATURE", assignedToId: assigned.carlos, data: { propertyId: property.penalolen, handoverDate: "2026-08-30", recipientName: "Felipe Arancibia", inventoryAttached: true } });
  await put({ recordType: "post_sale_case", title: "Postventa terraza - Casa Familiar Peñalolén Alto", status: "IN_PROGRESS", assignedToId: assigned.carlos, data: { propertyId: property.penalolen, description: "Revisión de sello exterior en terraza antes de la entrega definitiva.", openedAt: "2026-08-14", owner: "Constructora y vendedor" } });
  await put({ recordType: "warranty_case", title: "Garantía iluminación - Casa Familiar Peñalolén Alto", status: "UNDER_REVIEW", assignedToId: assigned.carlos, data: { propertyId: property.penalolen, description: "Una luminaria exterior requiere validación de garantía del proveedor.", warrantyUntil: "2027-02-28" } });

  // Expediente documental y financiamiento: siempre bajo aprobación humana.
  await put({ recordType: "property_document", title: "Carpeta propiedad - Departamento Vista Parque Pocuro", status: "AVAILABLE", assignedToId: assigned.maria, data: { propertyId: property.pocuro, documentType: "Carpeta comercial y fotografías", url: "demo://broker/pocuro/carpeta", verifiedAt: "2026-08-09" } });
  await put({ recordType: "legal_document", title: "Certificado de dominio vigente - Departamento Vista Parque Pocuro", status: "APPROVED", assignedToId: assigned.maria, data: { propertyId: property.pocuro, documentType: "Certificado de dominio vigente", expiresAt: "2026-09-30", reviewedBy: "Revisión documental humana" } });
  await put({ recordType: "digital_signature", title: "Firma digital de mandato - Departamento Vista Parque Pocuro", status: "SIGNED", assignedToId: assigned.maria, data: { propertyId: property.pocuro, documentType: "Mandato de corretaje", signerName: "Andrés Toledo", signedAt: "2026-07-25" } });
  const financing = await put({ recordType: "operation_financing", title: "Financiamiento de compra - Departamento Vista Parque Pocuro", status: "UNDER_REVIEW", assignedToId: assigned.maria, data: { propertyId: property.pocuro, purpose: "Crédito hipotecario para compra", requestedAmount: 175000000, applicantName: "Carolina Fuentes", buyerId: buyersByName.carolina, institution: "Banco de demostración", requiresHumanApproval: true } });
  await put({ recordType: "operation_financing_expense", title: "Gasto tasación bancaria - Departamento Vista Parque Pocuro", status: "APPROVED", assignedToId: assigned.maria, data: { financingId: financing.id, propertyId: property.pocuro, concept: "Tasación bancaria", amount: 180000, dueDate: "2026-08-19", requiresHumanApproval: true } });

  // Actividad y alertas para el centro de control inmobiliario.
  await put({ recordType: "visit", title: "Visita confirmada - Oficina Premium Apoquindo", status: "SCHEDULED", assignedToId: assigned.diego, data: { propertyId: property.apoquindo, buyerId: buyersByName.oficinas, buyerName: "Oficinas Cordillera SpA", brokerName: "Diego Alvarez Pena", visitAt: "2026-08-18T16:30:00-04:00", notes: "Visita con gerencia y encargado de operaciones." } });
  await put({ recordType: "visit", title: "Visita realizada - Departamento Nuevo Ñuñoa", status: "ACTIVE", assignedToId: assigned.maria, data: { propertyId: property.nunoa, buyerId: buyersByName.valentina, buyerName: "Valentina Mella", brokerName: "Maria Fernanda Ruiz", visitAt: "2026-08-12T18:00:00-04:00", notes: "Interesada solicita simulación de crédito y segunda visita." } });
  await put({ recordType: "realty_alert", title: "Renovar certificado de dominio - Vista Parque Pocuro", status: "OPEN", assignedToId: assigned.maria, data: { propertyId: property.pocuro, priority: "MEDIA", dueDate: "2026-08-25", detail: "El certificado vigente vence antes de la fecha estimada de cierre." } });
  await put({ recordType: "realty_alert", title: "Confirmar proveedor de iluminación - Casa Peñalolén Alto", status: "OPEN", assignedToId: assigned.carlos, data: { propertyId: property.penalolen, priority: "ALTA", dueDate: "2026-08-17", detail: "Se requiere confirmación humana antes de cerrar el caso de garantía." } });

  return records;
}

const BROKER_DEMO_AREAS = [
  { area: "Propiedades y cartera", recordTypes: ["property"] },
  { area: "Captacion, tasacion y cierre", recordTypes: ["property_appraisal", "property_mandate", "property_offer", "property_promise", "commission_settlement"] },
  { area: "Arriendos y administracion", recordTypes: ["administration_profile", "rental_application", "rental_contract", "rental_payment", "utility_monitoring", "administration_liquidation"] },
  { area: "Mantenciones y proveedores", recordTypes: ["maintenance_ticket", "service_provider", "provider_quote", "material_purchase"] },
  { area: "Proyectos y publicacion", recordTypes: ["remodeling_project", "project_budget", "project_milestone", "marketing_publication"] },
  { area: "Postventa y garantias", recordTypes: ["property_inspection", "property_handover", "post_sale_case", "warranty_case"] },
  { area: "Expediente y financiamiento", recordTypes: ["property_document", "legal_document", "digital_signature", "operation_financing", "operation_financing_expense"] },
  { area: "Actividad, alertas y entrenamiento IA", recordTypes: ["visit", "realty_alert", "broker_agent_evaluation"] },
  { area: "Gobierno y accesos", recordTypes: ["broker_access_profile"] },
];

async function verifyBrokerDemo() {
  const tenant = await findTenant();
  if (!tenant) {
    throw new Error("No se encontro el tenant de demostracion de Broker OS.");
  }

  const records = await prisma.industryRecord.findMany({
    where: { tenantId: tenant.id },
    select: { recordType: true },
  });
  const counts = records.reduce((accumulator, record) => {
    accumulator[record.recordType] = (accumulator[record.recordType] || 0) + 1;
    return accumulator;
  }, {});
  const areas = BROKER_DEMO_AREAS.map(({ area, recordTypes }) => ({
    area,
    total: recordTypes.reduce((total, recordType) => total + (counts[recordType] || 0), 0),
    registros: recordTypes.map((recordType) => ({
      tipo: recordType,
      total: counts[recordType] || 0,
    })),
  }));
  const faltantes = areas
    .filter((area) => area.total === 0)
    .map((area) => area.area);

  console.log(JSON.stringify({
    tenant: tenant.name,
    tenantId: tenant.id,
    totalRegistros: records.length,
    propiedades: counts.property || 0,
    areas,
    demostracionLista: faltantes.length === 0,
    faltantes,
  }, null, 2));

  if (faltantes.length > 0) {
    process.exitCode = 1;
  }
}

async function main() {
  const tenant = await findTenant();
  if (!tenant) {
    throw new Error("No hay tenants para cargar propiedades demo.");
  }

  const realtyTenant = await ensureRealtyTenant(tenant);
  await ensureOwner(realtyTenant.id);
  await ensureModules(realtyTenant.id);
  const brokers = await ensureBrokers(realtyTenant.id);
  const buyers = await ensureBuyers(realtyTenant.id);
  const normalizedLegacy = await normalizeLegacyTrainingProperty(realtyTenant.id);
  const properties = [];

  for (let index = 0; index < PROPERTIES.length; index += 1) {
    properties.push(await upsertProperty(realtyTenant.id, PROPERTIES[index], index, brokers));
  }
  const brokerRecords = await seedBrokerWorkspace(realtyTenant.id, properties, brokers, buyers);
  const agentEvaluations = await seedAgentEvaluations(realtyTenant.id);

  console.log(JSON.stringify({
    tenant: realtyTenant.name,
    tenantId: realtyTenant.id,
    adminEmail: REALTY_TENANT_EMAIL,
    modulesEnabled: REALTY_MODULES.length,
    brokers: brokers.length,
    buyers: buyers.length,
    properties: properties.length,
    brokerWorkspaceRecords: brokerRecords.length,
    agentEvaluations: agentEvaluations.length,
    legacyPropertyNormalized: Boolean(normalizedLegacy),
    assigned: properties.filter((property) => property.assignedToId).length,
    unassigned: properties.filter((property) => !property.assignedToId).length,
  }, null, 2));
}

(process.argv.includes("--verify") ? verifyBrokerDemo() : main())
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
