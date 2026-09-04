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

// La API genérica de registros se usa por varias pantallas del producto. Esta
// matriz evita que un registro financiero quede protegido solo por su vista:
// aunque alguien invoque /industry-records directamente, debe tener el mismo
// permiso que tendría en las rutas especializadas de Finance OS.
const FINANCE_RECORD_ACTIONS = Object.freeze({
  finance_invoice: FINANCE_ACTIONS.REGISTER,
  finance_invoice_receipt: FINANCE_ACTIONS.REGISTER,
  finance_payable: FINANCE_ACTIONS.REGISTER,
  finance_payable_payment: FINANCE_ACTIONS.REGISTER,
  finance_document_adjustment: FINANCE_ACTIONS.REGISTER,
  finance_document_reference: FINANCE_ACTIONS.REGISTER,
  bank_movement: FINANCE_ACTIONS.REGISTER,
  bank_statement: FINANCE_ACTIONS.IMPORT_HISTORY,
  finance_migration_batch: FINANCE_ACTIONS.IMPORT_HISTORY,
  finance_sii_import_batch: FINANCE_ACTIONS.IMPORT_HISTORY,
  finance_reconciliation: FINANCE_ACTIONS.APPROVE_RECONCILIATION,
  finance_monthly_close: FINANCE_ACTIONS.CLOSE_PERIOD,
  finance_budget: FINANCE_ACTIONS.CONFIGURE,
  finance_open_banking_consent: FINANCE_ACTIONS.CONFIGURE,
  // Estas dos entidades representan trabajo preparatorio. Nunca ejecutan un
  // cobro, pago, conciliación o comunicación externa por sí mismas.
  finance_exception: FINANCE_ACTIONS.PREPARE,
  finance_collection_case: FINANCE_ACTIONS.PREPARE
});

function normalizeFinanceRecordType(recordType) {
  return String(recordType || "").trim().toLowerCase();
}

export function isFinanceRecordType(recordType) {
  const normalized = normalizeFinanceRecordType(recordType);
  return normalized.startsWith("finance_") || normalized === "bank_movement" || normalized === "bank_statement";
}

export function financeActionForRecordMutation(recordType) {
  const normalized = normalizeFinanceRecordType(recordType);
  if (!isFinanceRecordType(normalized)) return null;
  // Un tipo financiero nuevo debe nacer restringido hasta que se defina su
  // acción explícita; así una ampliación futura no abre un bypass accidental.
  return FINANCE_RECORD_ACTIONS[normalized] || FINANCE_ACTIONS.CONFIGURE;
}

export function canMutateFinanceRecord(role, recordType) {
  const action = financeActionForRecordMutation(recordType);
  return !action || canPerformFinanceAction(role, action);
}

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
