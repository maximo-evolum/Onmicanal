import { MODULES } from '../lib/modules.js';
import { financeDocumentSide } from './finance-document-values.service.js';

// Single module classification for generic record access. Unknown financial
// types are denied until explicitly classified, including for superadmins.
export const FINANCE_RECORD_MODULES = Object.freeze({
  finance_invoice: MODULES.FINANCE_INVOICES,
  finance_invoice_receipt: MODULES.FINANCE_INVOICES,
  finance_document_adjustment: MODULES.FINANCE_INVOICES,
  finance_document_reference: MODULES.FINANCE_INVOICES,
  finance_sii_import_batch: MODULES.FINANCE_INVOICES,
  finance_payable: MODULES.FINANCE_PAYABLES,
  finance_payable_payment: MODULES.FINANCE_PAYABLES,
  bank_statement: MODULES.FINANCE_BANK_SYNC,
  bank_movement: MODULES.FINANCE_BANK_SYNC,
  finance_bank_account: MODULES.FINANCE_BANK_SYNC,
  finance_open_banking_consent: MODULES.FINANCE_BANK_SYNC,
  finance_reconciliation: MODULES.FINANCE_RECONCILIATION,
  finance_customer_credit: MODULES.FINANCE_RECONCILIATION,
  finance_credit_application: MODULES.FINANCE_RECONCILIATION,
  finance_reconciliation_difference: MODULES.FINANCE_RECONCILIATION,
  finance_reconciliation_group: MODULES.FINANCE_RECONCILIATION,
  finance_exception: MODULES.FINANCE_EXCEPTIONS,
  finance_collection_case: MODULES.FINANCE_COLLECTIONS,
  finance_reminder_batch: MODULES.FINANCE_COLLECTIONS,
  finance_collection_delivery: MODULES.FINANCE_COLLECTIONS,
  finance_budget: MODULES.FINANCE_ANALYTICS,
  finance_monthly_close: MODULES.FINANCE_ANALYTICS,
  finance_period_reopening: MODULES.FINANCE_ANALYTICS,
  finance_period_coverage: MODULES.FINANCE_ANALYTICS,
  finance_historical_correction: MODULES.FINANCE_ANALYTICS,
  finance_migration_batch: MODULES.FINANCE_MIGRATION,
  finance_opening_balance: MODULES.FINANCE_MIGRATION
});

export function financeRecordModule(recordType, data) {
  if (recordType === 'finance_invoice' && data && financeDocumentSide({ recordType, data }) === 'SUPPLIER') return MODULES.FINANCE_PAYABLES;
  return FINANCE_RECORD_MODULES[recordType] || null;
}

const reconciliationSources = [MODULES.FINANCE_BANK_SYNC, MODULES.FINANCE_INVOICES];
export const FINANCE_CLOSE_SOURCE_MODULES = Object.freeze([
  ...reconciliationSources, MODULES.FINANCE_PAYABLES, MODULES.FINANCE_RECONCILIATION,
  MODULES.FINANCE_EXCEPTIONS, MODULES.FINANCE_COLLECTIONS
]);

// Stored summaries can contain copied document data, not only foreign IDs.
// A disabled source must therefore also hide its derived records.
export function financeRecordRequiredModules(recordType, data) {
  const owner = financeRecordModule(recordType, data);
  if (!owner) return [];
  const sources = owner === MODULES.FINANCE_RECONCILIATION ? reconciliationSources
    : owner === MODULES.FINANCE_COLLECTIONS ? [MODULES.FINANCE_INVOICES]
    : ['finance_monthly_close', 'finance_period_reopening', 'finance_period_coverage'].includes(recordType) ? FINANCE_CLOSE_SOURCE_MODULES
    : [];
  return [...new Set([owner, ...sources])];
}

export const GENERIC_FINANCE_WRITABLE_TYPES = new Set(['finance_invoice', 'finance_payable', 'bank_movement']);
