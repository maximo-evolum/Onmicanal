/** Archivo: Implementa reglas de negocio y procesos del dominio broker access. */
import { ensureStandardBrokerAccessProfile } from "./broker-standard-access.service.js";
export const BROKER_ACCESS_ACTIONS = Object.freeze(["VIEW", "CREATE", "EDIT", "DELETE", "IMPORT", "EXPORT", "APPROVE", "REJECT", "ASSIGN", "REASSIGN", "CONFIGURE"]);
export const BROKER_ACCESS_SCOPES = Object.freeze(["ASSIGNED", "TEAM", "BRANCH", "COMPANY", "HOLDING"]);
export const BROKER_BUSINESS_ROLES = Object.freeze([
  "CEO", "GERENTE_COMERCIAL", "COORDINADOR_COMERCIAL", "CORREDOR", "CAPTADOR", "MARKETING", "TASADOR", "JURIDICO", "ADMINISTRACION", "FINANZAS", "POSTVENTA", "LECTURA"
]);

const ALL_AREAS = ["overview", "operations", "commercial", "rentals", "maintenance", "projects", "post_sale", "documents", "financing", "commissions", "administration", "ai", "configuration", "access"];

// Los workspaces son una capa de organización de Broker OS. Un perfil
// personalizado nunca agrega acciones: solo reduce los permisos que ya posee
// su perfil de sistema base a los espacios indicados aquí.
export const BROKER_WORKSPACE_CATALOG = Object.freeze({
  CARTERA: { label: "Cartera y operaciones", areas: ["overview", "operations", "commercial"] },
  ARRIENDOS: { label: "Arriendos y administración", areas: ["rentals", "administration", "commissions"] },
  OPERACIONES: { label: "Mantenciones, proyectos y postventa", areas: ["maintenance", "projects", "post_sale"] },
  EXPEDIENTE: { label: "Expediente y documentación", areas: ["documents"] },
  FINANZAS: { label: "Financiamiento y comisiones", areas: ["financing", "commissions", "administration"] },
  INTELIGENCIA: { label: "IA y análisis", areas: ["ai", "overview"] },
  CONFIGURACION: { label: "Cuenta, perfiles y configuración", areas: ["configuration", "access"] }
});

export const BROKER_CUSTOM_PROFILE_TYPE = "broker_custom_profile";

const PROFILE_POLICIES = Object.freeze({
  CEO: { label: "Dirección general", defaultScope: "COMPANY", actions: { "*": BROKER_ACCESS_ACTIONS } },
  GERENTE_COMERCIAL: { label: "Gerencia comercial", defaultScope: "COMPANY", actions: { overview: ["VIEW", "EXPORT"], operations: ["VIEW", "CREATE", "EDIT", "ASSIGN", "REASSIGN", "APPROVE"], commercial: ["VIEW", "CREATE", "EDIT", "ASSIGN", "REASSIGN", "APPROVE", "EXPORT"], projects: ["VIEW", "CREATE", "EDIT", "APPROVE"], documents: ["VIEW", "CREATE", "EDIT", "EXPORT"], commissions: ["VIEW", "EXPORT"], ai: ["VIEW", "APPROVE"] } },
  COORDINADOR_COMERCIAL: { label: "Coordinación comercial", defaultScope: "TEAM", actions: { overview: ["VIEW"], operations: ["VIEW", "CREATE", "EDIT", "ASSIGN", "REASSIGN"], commercial: ["VIEW", "CREATE", "EDIT", "ASSIGN", "REASSIGN"], documents: ["VIEW", "CREATE", "EDIT"], projects: ["VIEW", "CREATE", "EDIT"], ai: ["VIEW"] } },
  CORREDOR: { label: "Corredor", defaultScope: "ASSIGNED", actions: { overview: ["VIEW"], operations: ["VIEW", "CREATE", "EDIT"], commercial: ["VIEW", "CREATE", "EDIT"], rentals: ["VIEW", "CREATE", "EDIT"], commissions: ["VIEW"], documents: ["VIEW", "CREATE", "EDIT"], post_sale: ["VIEW", "CREATE", "EDIT"], ai: ["VIEW"] } },
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

function profileSource(profile) {
  if (!profile || typeof profile !== "object") return {};
  return profile.data && typeof profile.data === "object" && !Array.isArray(profile.data) ? profile.data : profile;
}

function unique(values = []) {
  return [...new Set(values.filter(Boolean))];
}

function systemActionsForArea(policy, area) {
  return [...new Set(policy?.actions?.[area] || policy?.actions?.["*"] || [])];
}

function customProfileWorkspaces(profile) {
  const values = Array.isArray(profile?.workspaceKeys) ? profile.workspaceKeys : [];
  return unique(values.map((item) => upper(item)).filter((key) => Object.hasOwn(BROKER_WORKSPACE_CATALOG, key)));
}

function effectiveCustomPolicy(profile) {
  const baseRole = BROKER_BUSINESS_ROLES.includes(upper(profile?.baseRole)) ? upper(profile.baseRole) : "LECTURA";
  const base = PROFILE_POLICIES[baseRole] || PROFILE_POLICIES.LECTURA;
  const workspaceKeys = customProfileWorkspaces(profile);
  const areas = unique(workspaceKeys.flatMap((key) => BROKER_WORKSPACE_CATALOG[key].areas));
  const actions = Object.fromEntries(areas.map((area) => [area, systemActionsForArea(base, area)]).filter(([, allowed]) => allowed.length));
  return {
    label: `Perfil personalizado · ${text(profile?.name, "Sin nombre")}`,
    defaultScope: profile?.accessScope || "ASSIGNED",
    actions,
    baseRole,
    workspaceKeys,
    agentKeys: unique((Array.isArray(profile?.agentKeys) ? profile.agentKeys : []).map((item) => text(item)).filter(Boolean)).slice(0, 16)
  };
}

export function brokerSystemProfileCatalog() {
  return BROKER_BUSINESS_ROLES.map((key) => {
    const policy = PROFILE_POLICIES[key];
    const actions = Object.fromEntries(ALL_AREAS.map((area) => [area, systemActionsForArea(policy, area)]).filter(([, allowed]) => allowed.length));
    return { key, label: policy.label, defaultScope: policy.defaultScope, actions, kind: "SYSTEM" };
  });
}

export function normalizeBrokerCustomProfile(input = {}) {
  const name = text(input.name).slice(0, 120);
  const description = text(input.description).slice(0, 500);
  const baseRole = upper(input.baseRole);
  const accessScope = upper(input.accessScope);
  const workspaceKeys = customProfileWorkspaces(input);
  const agentKeys = unique((Array.isArray(input.agentKeys) ? input.agentKeys : []).map((item) => text(item).toLowerCase()).filter((item) => /^[a-z0-9_-]{2,64}$/.test(item))).slice(0, 16);
  if (name.length < 3) return { ok: false, error: "El nombre del perfil debe tener al menos 3 caracteres." };
  if (!BROKER_BUSINESS_ROLES.includes(baseRole)) return { ok: false, error: "Selecciona un perfil de sistema válido como base." };
  if (!BROKER_ACCESS_SCOPES.includes(accessScope) || accessScope === "HOLDING") return { ok: false, error: "Un perfil personalizado debe usar un alcance entre asignado y empresa; el alcance holding se administra por separado." };
  if (!workspaceKeys.length) return { ok: false, error: "Selecciona al menos un workspace para restringir el perfil." };
  const data = { name, description, baseRole, accessScope, workspaceKeys, agentKeys, version: 1 };
  return { ok: true, data, effective: effectiveCustomPolicy(data) };
}

export function brokerCustomProfilePayload(record, assignedUserCount = 0) {
  const profile = profileSource(record);
  const effective = effectiveCustomPolicy(profile);
  return {
    id: record?.id || null,
    name: text(profile.name, record?.title || "Perfil personalizado"),
    description: text(profile.description),
    baseRole: effective.baseRole,
    accessScope: effective.defaultScope,
    workspaceKeys: effective.workspaceKeys,
    agentKeys: effective.agentKeys,
    actions: effective.actions,
    kind: "CUSTOM",
    assignedUserCount: Number(assignedUserCount || 0),
    canDelete: Number(assignedUserCount || 0) === 0,
    updatedAt: record?.updatedAt || null
  };
}

export function defaultBrokerBusinessRole(user = {}) {
  if (["SUPER_ADMIN", "OWNER", "ADMIN"].includes(upper(user.role))) return "CEO";
  if (upper(user.role) === "VIEWER") return "LECTURA";
  // Nombre y cargo son datos editables, nunca una fuente de privilegios.
  if (["SELLER", "AGENT"].includes(upper(user.role))) return "CORREDOR";
  return "LECTURA";
}

export function normalizeBrokerAccessProfile(input = {}, user = {}, customProfile = null) {
  const custom = profileSource(customProfile);
  const customEnabled = Boolean(input?.customProfileId && custom?.name);
  const customPolicy = customEnabled ? effectiveCustomPolicy(custom) : null;
  const businessRole = upper(user.role) === "VIEWER" ? "LECTURA" : customPolicy?.baseRole || (BROKER_BUSINESS_ROLES.includes(upper(input.businessRole)) ? upper(input.businessRole) : input.businessRole ? "LECTURA" : defaultBrokerBusinessRole(user));
  const policy = customPolicy || PROFILE_POLICIES[businessRole];
  const requestedScope = customPolicy ? upper(customPolicy.defaultScope) : upper(input.accessScope);
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
    policy: { label: policy.label, defaultScope: policy.defaultScope, actions: policy.actions },
    profileKind: customPolicy ? "CUSTOM" : "SYSTEM",
    customProfileId: customPolicy ? text(input.customProfileId) : null,
    workspaceKeys: customPolicy?.workspaceKeys || null,
    agentKeys: customPolicy?.agentKeys || null,
  };
}

export function canBrokerAction(access, resource, action) {
  if (!access) return false;
  if (upper(access.technicalRole) === "SUPER_ADMIN") return true;
  if (upper(access.technicalRole) === "VIEWER" && upper(action) !== "VIEW") return false;
  // Un perfil personalizado ya trae una política reducida en `access.policy`.
  // No se debe recalcular desde businessRole porque aquello ignoraría los
  // workspaces del perfil y podría devolver privilegios que fueron quitados.
  const policy = access.profileKind === "CUSTOM" && access.policy && typeof access.policy === "object"
    ? access.policy
    : PROFILE_POLICIES[access.businessRole];
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

export function profileRecordData(userId, input, user, customProfile = null) {
  const normalized = normalizeBrokerAccessProfile(input, user, customProfile);
  return {
    userId,
    businessRole: normalized.businessRole,
    accessScope: normalized.requestedScope,
    teamKey: normalized.teamKey,
    branchKey: normalized.branchKey,
    ...(normalized.customProfileId ? { customProfileId: normalized.customProfileId } : {}),
    version: 1
  };
}

function profileData(record) { return record?.data && typeof record.data === "object" && !Array.isArray(record.data) ? record.data : {}; }

export async function loadBrokerAccessContext({ prisma, tenantId, industry, user }) {
  if (!tenantId || !user?.id || user.isActive === false) throw new Error("Sesión Broker no válida.");
  // Las cuentas antiguas de corredores funcionaban por inferencia. Al primer
  // acceso Broker dejamos su perfil estándar persistido, sin reemplazar una
  // configuración creada manualmente por una jefatura.
  await ensureStandardBrokerAccessProfile(prisma, { tenantId, industry, user }).catch(() => null);
  const records = await prisma.industryRecord.findMany({ where: { tenantId, recordType: { in: ["broker_access_profile", BROKER_CUSTOM_PROFILE_TYPE] }, status: "ACTIVE" }, select: { id: true, title: true, recordType: true, data: true }, orderBy: [{ updatedAt: "desc" }, { id: "desc" }] });
  const accessRecords = records.filter((record) => record.recordType !== BROKER_CUSTOM_PROFILE_TYPE);
  const customProfiles = new Map(records.filter((record) => record.recordType === BROKER_CUSTOM_PROFILE_TYPE).map((record) => [String(record.id), record]));
  const latest = [...new Map(accessRecords.map(profileData).reverse().map(profile => [String(profile.userId), profile])).values()];
  const current = latest.find((profile) => String(profile.userId) === String(user?.id)) || {};
  const selectedCustomProfile = current.customProfileId ? customProfiles.get(String(current.customProfileId)) : null;
  const access = normalizeBrokerAccessProfile(upper(user.role) === "SUPER_ADMIN" ? { businessRole: "CEO", accessScope: current.accessScope === "HOLDING" ? "HOLDING" : "COMPANY" } : current, user, selectedCustomProfile);
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

export function validateBrokerAccessProfile(input = {}, user = {}, customProfile = null) {
  const custom = profileSource(customProfile);
  const usingCustom = Boolean(input?.customProfileId && custom?.name);
  if (!usingCustom && !BROKER_BUSINESS_ROLES.includes(upper(input.businessRole))) return "Selecciona un rol de negocio válido.";
  if (!usingCustom && !BROKER_ACCESS_SCOPES.includes(upper(input.accessScope))) return "Selecciona un alcance válido.";
  const scope = usingCustom ? upper(custom.accessScope) : upper(input.accessScope);
  if (scope === "TEAM" && !text(input.teamKey)) return "Indica el equipo para el alcance de equipo.";
  if (scope === "BRANCH" && !text(input.branchKey)) return "Indica la sucursal para ese alcance.";
  const role = usingCustom ? upper(custom.baseRole) : upper(input.businessRole);
  if (upper(user.role) === "VIEWER" && role !== "LECTURA") return "Una cuenta de solo lectura no puede recibir un rol de escritura.";
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
