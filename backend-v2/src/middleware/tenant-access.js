import { prisma } from "../lib/db.js";
import { hasTenantModule, ensureTenantSubscriptionAndModules, getTenantModules } from "../services/tenant-modules.service.js";

export const ROLE_GROUPS = {
  STAFF: [
    "OWNER",
    "ADMIN",
    "AGENT",
    "SELLER"
  ],

  MANAGERS: [
    "OWNER",
    "ADMIN"
  ],

  VIEWERS: [
    "OWNER",
    "ADMIN",
    "AGENT",
    "SELLER",
    "VIEWER"
  ]
};

function normalizeRoles(roles) {
  if (roles.length === 1 && Array.isArray(roles[0])) return roles[0];
  return roles.flat();
}

export function requireRole(...roles) {
  const allowedRoles = normalizeRoles(roles);

  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: "No autorizado" });

    const role = req.user.role;

    // SUPER_ADMIN siempre tiene acceso global.
    if (role === "SUPER_ADMIN") return next();

    // OWNER y ADMIN tienen acceso total dentro de su tenant,
    // excepto rutas explícitamente exclusivas del SaaS global.
    const superAdminOnly =
      allowedRoles.length === 1 &&
      allowedRoles.includes("SUPER_ADMIN");

    if (!superAdminOnly && ["OWNER", "ADMIN"].includes(role)) {
      return next();
    }

    if (!allowedRoles.includes(role)) {
      console.warn("[AUTH_ROLE_FORBIDDEN]", {
        userId: req.user?.id,
        tenantId: req.tenantId,
        role: req.user?.role,
        allowedRoles
      });
      return res.status(403).json({ error: "No tienes permiso para esta acción" });
    }

    return next();
  };
}

export function requireTenant(req, res, next) {
  if (!req.tenantId) {
    return res.status(401).json({ error: "Tenant requerido" });
  }
  return next();
}

export async function tenantContext(req, res, next) {
  try {
    if (req.tenant && req.tenantId) return next();
    if (!req.user?.tenantId) return res.status(401).json({ error: "No autorizado" });

    const tenant = await prisma.tenant.findUnique({ where: { id: req.user.tenantId } });
    if (!tenant) return res.status(404).json({ error: "Tenant no encontrado" });

    req.tenant = tenant;
    req.tenantId = tenant.id;
    return next();
  } catch (error) {
    return next(error);
  }
}

/**
 * Control de módulos por tenant.
 *
 * Regla SaaS:
 * - SUPER_ADMIN, OWNER y ADMIN nunca deben quedar bloqueados por un falso negativo de módulos.
 * - AGENT/SELLER sí dependen de que el módulo esté habilitado para el tenant.
 * - Si el tenant no tiene módulos sincronizados, se autorepara con el plan activo.
 */
export function requireModule(module) {
  return async (req, res, next) => {
    try {
      const role = req.user?.role;

      if (["SUPER_ADMIN", "OWNER", "ADMIN"].includes(role)) {
        return next();
      }

      const tenantId = req.tenantId || req.user?.tenantId;
      if (!tenantId) return res.status(401).json({ error: "Tenant requerido" });

      let ok = await hasTenantModule(tenantId, module);

      if (!ok) {
        const tenant = req.tenant || await prisma.tenant.findUnique({ where: { id: tenantId } });
        if (tenant) {
          await ensureTenantSubscriptionAndModules({ tenantId, planCode: tenant.plan || "STARTER" });
          ok = await hasTenantModule(tenantId, module);
        }
      }

      if (!ok) {
        const modules = await getTenantModules(tenantId).catch(() => []);
        console.warn("[AUTH_MODULE_FORBIDDEN]", {
          userId: req.user?.id,
          tenantId,
          role,
          module,
          availableModules: modules
        });
        return res.status(403).json({
          error: `Módulo no habilitado: ${module}`,
          module,
          availableModules: modules
        });
      }

      return next();
    } catch (error) {
      return next(error);
    }
  };
}

export function assertSameTenant(req, tenantId) {
  return req.user?.role === "SUPER_ADMIN" || req.tenantId === tenantId;
}
