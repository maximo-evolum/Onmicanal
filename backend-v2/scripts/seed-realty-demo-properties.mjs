import "dotenv/config";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const REALTY_MODULES = [
  "inbox",
  "agenda",
  "pipeline",
  "dashboard",
  "ai_ops",
  "realty_loads",
  "properties",
  "realty_activity",
  "broker_portal",
  "brokers",
  "payments",
  "campaigns",
  "integrations",
];

const BROKERS = [
  { name: "Maria Fernanda Ruiz", email: "maria.ruiz@demo-evolum.cl", phone: "+56961010001" },
  { name: "Carlos Mendoza Soto", email: "carlos.mendoza@demo-evolum.cl", phone: "+56961010002" },
  { name: "Laura Campos Vidal", email: "laura.campos@demo-evolum.cl", phone: "+56961010003" },
  { name: "Diego Alvarez Pena", email: "diego.alvarez@demo-evolum.cl", phone: "+56961010004" },
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
    title: "Townhouse Piedra Roja",
    propertyType: "Townhouse",
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
    observations: "Edificio nuevo con cowork, quincho panoramico y gimnasio.",
    features: ["nuevo", "cowork", "gimnasio", "quincho"],
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
  const tenants = await prisma.tenant.findMany({ orderBy: { createdAt: "asc" } });
  return tenants.find(tenantLooksRealty) || tenants[0] || null;
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
  const passwordHash = await bcrypt.hash("Demo1234!", 10);
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

  const existing = await prisma.industryRecord.findFirst({
    where: { tenantId, recordType: "property", title: property.title },
  });

  if (existing) {
    return prisma.industryRecord.update({
      where: { id: existing.id },
      data: {
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

async function main() {
  const tenant = await findTenant();
  if (!tenant) {
    throw new Error("No hay tenants para cargar propiedades demo.");
  }

  await ensureModules(tenant.id);
  const brokers = await ensureBrokers(tenant.id);
  const properties = [];

  for (let index = 0; index < PROPERTIES.length; index += 1) {
    properties.push(await upsertProperty(tenant.id, PROPERTIES[index], index, brokers));
  }

  console.log(JSON.stringify({
    tenant: tenant.name,
    tenantId: tenant.id,
    modulesEnabled: REALTY_MODULES.length,
    brokers: brokers.length,
    properties: properties.length,
    assigned: properties.filter((property) => property.assignedToId).length,
    unassigned: properties.filter((property) => !property.assignedToId).length,
    brokerPassword: "Demo1234!",
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
