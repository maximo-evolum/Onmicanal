import { prisma } from "../lib/db.js";
import { hasTenantModule, ensureTenantSubscriptionAndModules } from "../services/tenant-modules.service.js";

export const ROLE_GROUPS = Object.freeze({
  STAFF: ["SUPER_ADMIN", "OWNER", "ADMIN", "AGENT", "SELLER"],
  MANAGERS: ["SUPER_ADMIN", "OWNER", "ADMIN"],
  OWNERS: ["SUPER_ADMIN", "OWNER"],
  SUPER_ADMIN: ["SUPER_ADMIN"]
});

function normalizeRoles(roles) {
  if (roles.length === 1 && Array.isArray(roles[0])) return roles[0];
  return roles.flat();
}

export function requireRole(...roles) {
  const allowedRoles = normalizeRoles(roles);

  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: "No autorizado" });
    if (req.user.role === "SUPER_ADMIN") return next();

    if (!allowedRoles.includes(req.user.role)) {
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

export function requireModule(module) {
  return async (req, res, next) => {
    try {
      if (req.user?.role === "SUPER_ADMIN") return next();

      const tenantId = req.tenantId || req.user?.tenantId;
      if (!tenantId) return res.status(401).json({ error: "Tenant requerido" });

      let ok = await hasTenantModule(tenantId, module);

      if (!ok) {
        // Autoreparación: algunos tenants antiguos no tienen módulos sincronizados aunque su plan sí los incluya.
        const tenant = req.tenant || await prisma.tenant.findUnique({ where: { id: tenantId } });
        if (tenant) {
          await ensureTenantSubscriptionAndModules({ tenantId, planCode: tenant.plan || "STARTER" });
          ok = await hasTenantModule(tenantId, module);
        }
      }

      if (!ok) {
        console.warn("[AUTH_MODULE_FORBIDDEN]", {
          userId: req.user?.id,
          tenantId,
          role: req.user?.role,
          module
        });
        return res.status(403).json({
          error: `Módulo no habilitado: ${module}`,
          module
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
