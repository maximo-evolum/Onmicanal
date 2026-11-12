/** Archivo: Define y aplica el perfil estándar de acceso para corredores de Broker OS. */
import { normalizeIndustryCode } from "../lib/industries.js";

function upper(value) {
  return String(value || "").trim().toUpperCase();
}

/**
 * Determina si una cuenta debe comenzar como corredor operativo estándar.
 * Se limita estrictamente a Inmobiliaria/Broker OS: un SELLER de otra
 * vertical no recibe ni un perfil ni navegación inmobiliaria por accidente.
 */
export function isStandardBrokerAccount({ industry, user = {}, operationalRole } = {}) {
  if (normalizeIndustryCode(industry) !== "REAL_ESTATE") return false;
  // Una cuenta desactivada no debe recibir provisiones nuevas. Si vuelve a
  // activarse, las rutas de equipo o la actualización de usuario la
  // regularizan nuevamente con el mismo perfil estándar.
  if (user.isActive === false) return false;
  if (upper(operationalRole) === "REAL_ESTATE_BROKER") return true;
  if (upper(user.role) === "SELLER") return true;
  return upper(user.role) === "AGENT" && /corredor/i.test(String(user.jobTitle || ""));
}

/** El corredor parte con cartera propia, sin administración de la empresa. */
export function standardBrokerAccessProfileData(user = {}) {
  return {
    userId: String(user.id || ""),
    businessRole: "CORREDOR",
    accessScope: "ASSIGNED",
    teamKey: null,
    branchKey: null,
    version: 1
  };
}

/**
 * Crea el perfil estándar una sola vez. Si una jefatura ya configuró un
 * perfil personalizado o un alcance diferente, se conserva intacto.
 */
export async function ensureStandardBrokerAccessProfile(db, {
  tenantId,
  industry,
  user,
  operationalRole
} = {}) {
  if (!db || !tenantId || !user?.id || !isStandardBrokerAccount({ industry, user, operationalRole })) {
    return { created: false, profile: null };
  }

  const existing = await db.industryRecord.findFirst({
    where: {
      tenantId,
      recordType: "broker_access_profile",
      status: "ACTIVE",
      data: { path: ["userId"], equals: user.id }
    }
  });
  if (existing) return { created: false, profile: existing };

  const data = standardBrokerAccessProfileData(user);
  const profile = await db.industryRecord.create({
    data: {
      tenantId,
      recordType: "broker_access_profile",
      title: `Acceso estándar Broker: ${user.name || user.email || "Corredor"}`.slice(0, 220),
      status: "ACTIVE",
      assignedToId: user.id,
      data
    }
  });
  return { created: true, profile };
}

/**
 * Regulariza cuentas ya creadas al abrir la gestión de equipo. Solo agrega
 * perfiles faltantes; nunca cambia una configuración manual existente.
 */
export async function ensureStandardBrokerAccessForTenant(db, { tenantId, industry } = {}) {
  if (!db || !tenantId || normalizeIndustryCode(industry) !== "REAL_ESTATE") {
    return { inspected: 0, created: 0 };
  }

  const [users, profiles] = await Promise.all([
    db.workspaceUser.findMany({
      where: { tenantId, isActive: true },
      select: { id: true, name: true, email: true, role: true, jobTitle: true, isActive: true }
    }),
    db.industryRecord.findMany({
      where: { tenantId, recordType: "broker_access_profile", status: "ACTIVE" },
      select: { data: true }
    })
  ]);

  const configuredUserIds = new Set(profiles.map((record) => String(record?.data?.userId || "")).filter(Boolean));
  const candidates = users.filter((user) => isStandardBrokerAccount({ industry, user }));
  let created = 0;

  for (const user of candidates) {
    if (configuredUserIds.has(String(user.id))) continue;
    const result = await ensureStandardBrokerAccessProfile(db, { tenantId, industry, user });
    if (result.created) created += 1;
  }

  return { inspected: candidates.length, created };
}
