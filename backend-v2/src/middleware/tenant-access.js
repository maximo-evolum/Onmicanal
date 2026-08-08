import { prisma } from "../lib/db.js";
import { hasTenantModule, ensureTenantModuleEligibility, getTenantModules } from "../services/tenant-modules.service.js";
import { isModuleAllowedForIndustry } from "../lib/industry-module-access.js";

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

export function hasRoleAccess(role, allowedRoles) {
  if (!role) return false;
  if (role === "SUPER_ADMIN") return true;
  const superAdminOnly = allowedRoles.length === 1 && allowedRoles.includes("SUPER_ADMIN");
  if (!superAdminOnly && ["OWNER", "ADMIN"].includes(role)) return true;
  return allowedRoles.includes(role);
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

    if (!hasRoleAccess(role, allowedRoles)) {
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
 * - SUPER_ADMIN mantiene bypass global porque administra la plataforma.
 * - Los usuarios del tenant dependen de que el módulo esté habilitado.
 * - Si el tenant no tiene módulos sincronizados, se autorepara con el plan activo.
 */
export function createRequireModule(module, dependencies = {}) {
  const hasModule = dependencies.hasTenantModule || hasTenantModule;
  const ensureEligibility = dependencies.ensureTenantModuleEligibility || ensureTenantModuleEligibility;
  const listModules = dependencies.getTenantModules || getTenantModules;
  const findTenant = dependencies.findTenant || ((tenantId) => prisma.tenant.findUnique({ where: { id: tenantId } }));

  return async (req, res, next) => {
    try {
      const role = req.user?.role;

      if (role === "SUPER_ADMIN") {
        return next();
      }

      const tenantId = req.tenantId || req.user?.tenantId;
      if (!tenantId) return res.status(401).json({ error: "Tenant requerido" });

      const tenant = req.tenant || await findTenant(tenantId);
      if (!tenant) return res.status(404).json({ error: "Tenant no encontrado" });

      // Una fila tenant_module habilitada nunca debe permitir que una cuenta
      // opere un modulo exclusivo de otro rubro. Esta validacion protege la
      // API incluso ante accesos directos por URL o datos historicos.
      if (!isModuleAllowedForIndustry(module, tenant.industry)) {
        const availableModules = await listModules(tenantId).catch(() => []);
        console.warn("[AUTH_INDUSTRY_MODULE_FORBIDDEN]", {
          userId: req.user?.id,
          tenantId,
          role,
          industry: tenant.industry || "GENERAL",
          module,
          availableModules
        });
        return res.status(403).json({
          error: `Modulo no disponible para el rubro: ${module}`,
          module,
          industry: tenant.industry || "GENERAL",
          availableModules
        });
      }

      // Reportes ejecutivos es parte del Core EVOLUM y no depende de que una
      // cuenta antigua tenga sincronizada la fila tenant_module correspondiente.
      if (module === "reports") return next();

      let ok = await hasModule(tenantId, module);

      if (!ok) {
        ok = await ensureEligibility({ tenantId, module, tenant });
      }

      if (!ok) {
        const modules = await listModules(tenantId).catch(() => []);
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

export function requireModule(module) {
  return createRequireModule(module);
}

export function assertSameTenant(req, tenantId) {
  return req.user?.role === "SUPER_ADMIN" || req.tenantId === tenantId;
}
