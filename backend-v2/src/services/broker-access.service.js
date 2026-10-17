/** Archivo: Implementa reglas de negocio y procesos del dominio broker access. */
export const BROKER_ACCESS_ACTIONS = Object.freeze(["VIEW", "CREATE", "EDIT", "DELETE", "IMPORT", "EXPORT", "APPROVE", "REJECT", "ASSIGN", "REASSIGN", "CONFIGURE"]);
export const BROKER_ACCESS_SCOPES = Object.freeze(["ASSIGNED", "TEAM", "BRANCH", "COMPANY", "HOLDING"]);
export const BROKER_BUSINESS_ROLES = Object.freeze([
  "CEO", "GERENTE_COMERCIAL", "COORDINADOR_COMERCIAL", "CORREDOR", "CAPTADOR", "MARKETING", "TASADOR", "JURIDICO", "ADMINISTRACION", "FINANZAS", "POSTVENTA", "LECTURA"
]);

const ALL_AREAS = ["overview", "operations", "commercial", "rentals", "maintenance", "projects", "post_sale", "documents", "financing", "commissions", "administration", "ai", "configuration", "access"];

const PROFILE_POLICIES = Object.freeze({
  CEO: { label: "Dirección general", defaultScope: "COMPANY", actions: { "*": BROKER_ACCESS_ACTIONS } },
  GERENTE_COMERCIAL: { label: "Gerencia comercial", defaultScope: "COMPANY", actions: { overview: ["VIEW", "EXPORT"], operations: ["VIEW", "CREATE", "EDIT", "ASSIGN", "REASSIGN", "APPROVE"], commercial: ["VIEW", "CREATE", "EDIT", "ASSIGN", "REASSIGN", "APPROVE", "EXPORT"], projects: ["VIEW", "CREATE", "EDIT", "APPROVE"], documents: ["VIEW", "CREATE", "EDIT", "EXPORT"], commissions: ["VIEW", "EXPORT"], ai: ["VIEW", "APPROVE"] } },
  COORDINADOR_COMERCIAL: { label: "Coordinación comercial", defaultScope: "TEAM", actions: { overview: ["VIEW"], operations: ["VIEW", "CREATE", "EDIT", "ASSIGN", "REASSIGN"], commercial: ["VIEW", "CREATE", "EDIT", "ASSIGN", "REASSIGN"], documents: ["VIEW", "CREATE", "EDIT"], projects: ["VIEW", "CREATE", "EDIT"], ai: ["VIEW"] } },
  CORREDOR: { label: "Corredor", defaultScope: "ASSIGNED", actions: { overview: ["VIEW"], operations: ["VIEW", "CREATE", "EDIT"], commercial: ["VIEW", "CREATE", "EDIT"], rentals: ["VIEW", "CREATE", "EDIT"], documents: ["VIEW", "CREATE", "EDIT"], post_sale: ["VIEW", "CREATE", "EDIT"], ai: ["VIEW"] } },
  CAPTADOR: { label: "Captador", defaultScope: "ASSIGNED", actions: { overview: ["VIEW"], commercial: ["VIEW", "CREATE", "EDIT"], documents: ["VIEW", "CREATE", "EDIT"], projects: ["VIEW", "CREATE", "EDIT"] } },
  MARKETING: { label: "Marketing", defaultScope: "COMPANY", actions: { overview: ["VIEW"], commercial: ["VIEW"], projects: ["VIEW", "CREATE", "EDIT", "EXPORT"], documents: ["VIEW"] } },
  TASADOR: { label: "Tasador", defaultScope: "ASSIGNED", actions: { overview: ["VIEW"], commercial: ["VIEW", "CREATE", "EDIT"], documents: ["VIEW", "CREATE", "EDIT"] } },
  JURIDICO: { label: "Jurídico", defaultScope: "COMPANY", actions: { overview: ["VIEW"], commercial: ["VIEW"], documents: ["VIEW", "CREATE", "EDIT", "APPROVE", "REJECT", "EXPORT"], operations: ["VIEW"] } },
  ADMINISTRACION: { label: "Administración", defaultScope: "COMPANY", actions: { overview: ["VIEW"], rentals: ["VIEW", "CREATE", "EDIT", "EXPORT"], maintenance: ["VIEW", "CREATE", "EDIT"], post_sale: ["VIEW", "CREATE", "EDIT"], administration: ["VIEW", "CREATE", "EDIT"], documents: ["VIEW", "CREATE", "EDIT"] } },
  FINANZAS: { label: "Finanzas", defaultScope: "COMPANY", actions: { overview: ["VIEW", "EXPORT"], financing: ["VIEW", "CREATE", "EDIT", "APPROVE", "REJECT", "EXPORT"], commissions: ["VIEW", "CREATE", "EDIT", "APPROVE", "EXPORT"], administration: ["VIEW", "CREATE", "EDIT", "APPROVE", "EXPORT"], documents: ["VIEW", "EXPORT"] } },
  POSTVENTA: { label: "Postventa", defaultScope: "ASSIGNED", actions: { overview: ["VIEW"], post_sale: ["VIEW", "CREATE", "EDIT"], maintenance: ["VIEW", "CREATE", "EDIT"], documents: ["VIEW", "CREATE", "EDIT"] } },
  LECTURA: { label: "Solo lectura", defaultScope: "ASSIGNED", actions: Object.fromEntries(ALL_AREAS.filter(area => !["configuration", "access"].includes(area)).map((area) => [area, ["VIEW"]])) },
});

function text(value, fallback = "") { const result = String(value ?? "").trim(); return result || fallback; }
function upper(value, fallback = "") { return text(value, fallback).toUpperCase(); }

export function defaultBrokerBusinessRole(user = {}) {
  if (["SUPER_ADMIN", "OWNER", "ADMIN"].includes(upper(user.role))) return "CEO";
  if (upper(user.role) === "VIEWER") return "LECTURA";
  // Nombre y cargo son datos editables, nunca una fuente de privilegios.
  if (["SELLER", "AGENT"].includes(upper(user.role))) return "CORREDOR";
  return "LECTURA";
}

export function normalizeBrokerAccessProfile(input = {}, user = {}) {
  const businessRole = upper(user.role) === "VIEWER" ? "LECTURA" : BROKER_BUSINESS_ROLES.includes(upper(input.businessRole)) ? upper(input.businessRole) : input.businessRole ? "LECTURA" : defaultBrokerBusinessRole(user);
  const policy = PROFILE_POLICIES[businessRole];
  const requestedScope = upper(input.accessScope);
  const accessScope = BROKER_ACCESS_SCOPES.includes(requestedScope) ? requestedScope : policy.defaultScope;
  return {
    businessRole,
    profileLabel: policy.label,
    // HOLDING se valida contra una relación explícita de gobierno en
    // loadBrokerAccessContext. No se concede solo por seleccionar la opción.
    accessScope,
    requestedScope: accessScope,
    teamKey: text(input.teamKey) || null,
    branchKey: text(input.branchKey) || null,
    policy,
  };
}

export function canBrokerAction(access, resource, action) {
  if (!access) return false;
  if (upper(access.technicalRole) === "SUPER_ADMIN") return true;
  if (upper(access.technicalRole) === "VIEWER" && upper(action) !== "VIEW") return false;
  const policy = PROFILE_POLICIES[access.businessRole];
  if (!policy) return false;
  const allowed = policy.actions[resource] || policy.actions["*"] || [];
  return allowed.includes(upper(action));
}

// Registrar una etapa preparatoria no equivale a aprobar una operación. Las
// resoluciones, desembolsos informados, liquidaciones y cierres requieren un
// perfil con capacidad de aprobación; rechazo o cancelación requieren rechazo.
export function brokerFinancingActionForStage(stage) {
  const normalized = upper(stage);
  if (["RECHAZADO", "CANCELADO"].includes(normalized)) return "REJECT";
  if (["APROBACION", "DESEMBOLSO", "LIQUIDACION", "CIERRE"].includes(normalized)) return "APPROVE";
  return "EDIT";
}

export function profileRecordData(userId, input, user) {
  const normalized = normalizeBrokerAccessProfile(input, user);
  return { userId, businessRole: normalized.businessRole, accessScope: normalized.requestedScope, teamKey: normalized.teamKey, branchKey: normalized.branchKey, version: 1 };
}

function profileData(record) { return record?.data && typeof record.data === "object" && !Array.isArray(record.data) ? record.data : {}; }

export async function loadBrokerAccessContext({ prisma, tenantId, user }) {
  if (!tenantId || !user?.id || user.isActive === false) throw new Error("Sesión Broker no válida.");
  const records = await prisma.industryRecord.findMany({ where: { tenantId, recordType: "broker_access_profile", status: "ACTIVE" }, select: { data: true }, orderBy: [{ updatedAt: "desc" }, { id: "desc" }] });
  const latest = [...new Map(records.map(profileData).reverse().map(profile => [String(profile.userId), profile])).values()];
  const current = latest.find((profile) => String(profile.userId) === String(user?.id)) || {};
  const access = normalizeBrokerAccessProfile(upper(user.role) === "SUPER_ADMIN" ? { businessRole: "CEO", accessScope: current.accessScope === "HOLDING" ? "HOLDING" : "COMPANY" } : current, user);
  let sameScopeUsers = latest.filter((profile) => {
    if (!profile.userId) return false;
    if (access.accessScope === "TEAM") return access.teamKey && String(profile.teamKey || "") === access.teamKey && String(profile.branchKey || "") === (access.branchKey || "");
    if (access.accessScope === "BRANCH") return access.branchKey && String(profile.branchKey || "") === access.branchKey;
    return false;
  }).map((profile) => String(profile.userId));
  if (sameScopeUsers.length) {
    sameScopeUsers = (await prisma.workspaceUser.findMany({ where: { tenantId, isActive: true, id: { in: sameScopeUsers } }, select: { id: true } })).map(item => item.id);
  }
  let effectiveScope = access.accessScope;
  let scopeTenantIds = [tenantId];
  let holding = null;

  if (access.accessScope === "HOLDING") {
    const membership = await prisma.brokerHoldingTenant.findUnique({
      where: { tenantId },
      include: { holding: { include: { tenants: { select: { tenantId: true } } } } },
    });
    const technicalRole = upper(user?.role);
    const granted = technicalRole === "SUPER_ADMIN" || (membership
      ? await prisma.brokerHoldingAccess.findFirst({ where: { holdingId: membership.holdingId, userId: user?.id, isActive: true }, select: { id: true } })
      : null);

    if (membership?.holding?.isActive && granted) {
      scopeTenantIds = membership.holding.tenants.map((item) => item.tenantId);
      holding = { id: membership.holding.id, code: membership.holding.code, name: membership.holding.name, tenantCount: scopeTenantIds.length };
    } else {
      // Si no existe gobierno multiempresa o el usuario no fue autorizado,
      // preservar la sesión dentro de su propia empresa es la opción segura.
      effectiveScope = "ASSIGNED";
    }
  }

  const scopeUserIds = effectiveScope === "COMPANY" || effectiveScope === "HOLDING" ? null : [...new Set([String(user?.id || ""), ...sameScopeUsers].filter(Boolean))];
  return { ...access, accessScope: effectiveScope, technicalRole: upper(user?.role), userId: user?.id || null, scopeUserIds, scopeTenantIds, holding };
}

export function brokerRecordWhere(req, extra = {}) {
  const readOnly = !req.method || ["GET", "HEAD"].includes(req.method);
  const tenantIds = readOnly && Array.isArray(req.brokerAccess?.scopeTenantIds) && req.brokerAccess.scopeTenantIds.length
    ? req.brokerAccess.scopeTenantIds
    : [req.tenantId];
  const scope = { tenantId: tenantIds.length === 1 ? tenantIds[0] : { in: tenantIds } };
  const ids = req.brokerAccess ? req.brokerAccess.scopeUserIds : [];
  if (Array.isArray(ids) || ids !== null) scope.assignedToId = { in: Array.isArray(ids) ? ids : [] };
  // Intersección: un filtro del llamador nunca sustituye tenant o responsable.
  if (Object.keys(scope).some(key => Object.hasOwn(extra, key))) return { AND: [scope, extra] };
  return { ...scope, ...extra };
}

export function validateBrokerAccessProfile(input = {}, user = {}) {
  if (!BROKER_BUSINESS_ROLES.includes(upper(input.businessRole))) return "Selecciona un rol de negocio válido.";
  if (!BROKER_ACCESS_SCOPES.includes(upper(input.accessScope))) return "Selecciona un alcance válido.";
  if (upper(input.accessScope) === "TEAM" && !text(input.teamKey)) return "Indica el equipo para el alcance de equipo.";
  if (upper(input.accessScope) === "BRANCH" && !text(input.branchKey)) return "Indica la sucursal para ese alcance.";
  if (upper(user.role) === "VIEWER" && upper(input.businessRole) !== "LECTURA") return "Una cuenta de solo lectura no puede recibir un rol de escritura.";
  return null;
}

export function brokerAssigneeAllowed(access, userId) {
  return Boolean(access) && (access.scopeUserIds === null || access.scopeUserIds?.includes(String(userId)));
}

export function requireBrokerAction(resource, action) {
  return (req, res, next) => {
    if (canBrokerAction(req.brokerAccess, resource, action)) return next();
    return res.status(403).json({ error: "No tienes permiso para esta acción en Broker OS.", resource, action, scope: req.brokerAccess?.accessScope || "ASSIGNED" });
  };
}
