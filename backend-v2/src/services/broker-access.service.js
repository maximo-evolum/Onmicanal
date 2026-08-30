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
  FINANZAS: { label: "Finanzas", defaultScope: "COMPANY", actions: { overview: ["VIEW", "EXPORT"], financing: ["VIEW", "CREATE", "EDIT", "APPROVE", "REJECT", "EXPORT"], commissions: ["VIEW", "CREATE", "EDIT", "APPROVE", "EXPORT"], administration: ["VIEW", "CREATE", "EDIT", "EXPORT"], documents: ["VIEW", "EXPORT"] } },
  POSTVENTA: { label: "Postventa", defaultScope: "ASSIGNED", actions: { overview: ["VIEW"], post_sale: ["VIEW", "CREATE", "EDIT"], maintenance: ["VIEW", "CREATE", "EDIT"], documents: ["VIEW", "CREATE", "EDIT"] } },
  LECTURA: { label: "Solo lectura", defaultScope: "ASSIGNED", actions: Object.fromEntries(ALL_AREAS.map((area) => [area, ["VIEW"]])) },
});

function text(value, fallback = "") { const result = String(value ?? "").trim(); return result || fallback; }
function upper(value, fallback = "") { return text(value, fallback).toUpperCase(); }

export function defaultBrokerBusinessRole(user = {}) {
  if (["SUPER_ADMIN", "OWNER", "ADMIN"].includes(upper(user.role))) return "CEO";
  const title = `${text(user.jobTitle)} ${text(user.name)}`.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
  if (title.includes("GERENTE")) return "GERENTE_COMERCIAL";
  if (title.includes("COORDINADOR")) return "COORDINADOR_COMERCIAL";
  if (title.includes("CAPTADOR")) return "CAPTADOR";
  if (title.includes("MARKETING")) return "MARKETING";
  if (title.includes("TASADOR")) return "TASADOR";
  if (title.includes("JURID")) return "JURIDICO";
  if (title.includes("ADMINISTR")) return "ADMINISTRACION";
  if (title.includes("FINAN") || title.includes("CONTADOR")) return "FINANZAS";
  if (title.includes("POSTVENTA")) return "POSTVENTA";
  if (upper(user.role) === "VIEWER") return "LECTURA";
  if (upper(user.role) === "SELLER") return "CORREDOR";
  return "COORDINADOR_COMERCIAL";
}

export function normalizeBrokerAccessProfile(input = {}, user = {}) {
  const businessRole = BROKER_BUSINESS_ROLES.includes(upper(input.businessRole)) ? upper(input.businessRole) : defaultBrokerBusinessRole(user);
  const policy = PROFILE_POLICIES[businessRole];
  const requestedScope = upper(input.accessScope);
  const accessScope = BROKER_ACCESS_SCOPES.includes(requestedScope) ? requestedScope : policy.defaultScope;
  return {
    businessRole,
    profileLabel: policy.label,
    accessScope: accessScope === "HOLDING" && upper(user.role) !== "SUPER_ADMIN" ? "COMPANY" : accessScope,
    requestedScope: accessScope,
    teamKey: text(input.teamKey) || null,
    branchKey: text(input.branchKey) || null,
    policy,
  };
}

export function canBrokerAction(access, resource, action) {
  if (upper(access?.technicalRole) === "SUPER_ADMIN" || ["OWNER", "ADMIN"].includes(upper(access?.technicalRole))) return true;
  const policy = access?.policy || PROFILE_POLICIES[access?.businessRole] || PROFILE_POLICIES.LECTURA;
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
  const records = await prisma.industryRecord.findMany({ where: { tenantId, recordType: "broker_access_profile", status: "ACTIVE" }, select: { data: true } });
  const current = records.map(profileData).find((profile) => String(profile.userId) === String(user?.id)) || {};
  const access = normalizeBrokerAccessProfile(current, user);
  const sameScopeUsers = records.map(profileData).filter((profile) => {
    if (!profile.userId) return false;
    if (access.accessScope === "TEAM") return access.teamKey && String(profile.teamKey || "") === access.teamKey;
    if (access.accessScope === "BRANCH") return access.branchKey && String(profile.branchKey || "") === access.branchKey;
    return false;
  }).map((profile) => String(profile.userId));
  const scopeUserIds = access.accessScope === "COMPANY" || access.accessScope === "HOLDING" ? null : [...new Set([String(user?.id || ""), ...sameScopeUsers].filter(Boolean))];
  return { ...access, technicalRole: upper(user?.role), userId: user?.id || null, scopeUserIds };
}

export function brokerRecordWhere(req, extra = {}) {
  const where = { tenantId: req.tenantId, ...extra };
  const ids = req.brokerAccess?.scopeUserIds;
  if (Array.isArray(ids)) where.assignedToId = { in: ids };
  return where;
}

export function requireBrokerAction(resource, action) {
  return (req, res, next) => {
    if (canBrokerAction(req.brokerAccess, resource, action)) return next();
    return res.status(403).json({ error: "No tienes permiso para esta acción en Broker OS.", resource, action, scope: req.brokerAccess?.accessScope || "ASSIGNED" });
  };
}
