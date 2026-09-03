// Matriz explícita para Finance OS. Los permisos se validan además de los
// módulos contratados: tener el módulo no convierte a un agente en aprobador.
export const FINANCE_ACTIONS = Object.freeze({
  VIEW: "VIEW",
  PREPARE: "PREPARE",
  REGISTER: "REGISTER",
  APPROVE_RECONCILIATION: "APPROVE_RECONCILIATION",
  CLOSE_PERIOD: "CLOSE_PERIOD",
  IMPORT_HISTORY: "IMPORT_HISTORY",
  CONFIGURE: "CONFIGURE"
});

const MANAGERS = new Set(["OWNER", "ADMIN", "SUPER_ADMIN"]);
const STAFF = new Set([...MANAGERS, "AGENT", "SELLER"]);

export function canPerformFinanceAction(role, action) {
  const normalizedRole = String(role || "").toUpperCase();
  const normalizedAction = String(action || "").toUpperCase();
  if (normalizedAction === FINANCE_ACTIONS.VIEW) return new Set([...STAFF, "VIEWER"]).has(normalizedRole);
  if (normalizedAction === FINANCE_ACTIONS.PREPARE) return STAFF.has(normalizedRole);
  if ([FINANCE_ACTIONS.REGISTER, FINANCE_ACTIONS.APPROVE_RECONCILIATION, FINANCE_ACTIONS.CLOSE_PERIOD, FINANCE_ACTIONS.IMPORT_HISTORY, FINANCE_ACTIONS.CONFIGURE].includes(normalizedAction)) return MANAGERS.has(normalizedRole);
  return false;
}

export function financeRoleCapabilities(role) {
  return Object.values(FINANCE_ACTIONS).filter((action) => canPerformFinanceAction(role, action));
}
