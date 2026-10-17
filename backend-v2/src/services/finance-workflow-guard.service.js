/** Archivo: Implementa reglas de negocio y procesos del dominio finance workflow guard. */
import { FinanceOperationError } from "./finance-integrity.service.js";

export function assertWorkflowFinancialSafety(actions, targetRecord) {
  const financial = (value) => /^(finance_|bank_)/.test(String(value || "").trim().toLowerCase());
  // Prevalida la lista completa de acciones antes de ejecutar siquiera su primera mutación.
  for (const action of actions || []) {
    const type = String(action.type || "").trim().toLowerCase();
    const recordType = type === "create_record" ? action.recordType : targetRecord?.recordType;
    if (["create_record", "set_status", "set_field"].includes(type) && financial(recordType)) {
      throw new FinanceOperationError(409, "El flujo no puede modificar registros financieros directamente. Utiliza la operación de facturas, pagos, conciliación o cierre correspondiente. No se ejecutaron las acciones del flujo.");
    }
  }
}
