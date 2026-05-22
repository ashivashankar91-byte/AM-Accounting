// Accounting Components — All shared, composable, production-ready
export { default as GLAccountLookup } from './GLAccountLookup';
export type { GLAccount as GLAccountType } from './GLAccountLookup';

export { default as JournalEntryTable } from './JournalEntryTable';
export type { JournalLine } from './JournalEntryTable';

export { default as VendorLookup } from './VendorLookup';
export type { Vendor } from './VendorLookup';

// S5-03: NameDatabaseLookup — superset of VendorLookup (CUSTOMER + VENDOR + EMPLOYEE + Smart Search)
export { default as NameDatabaseLookup } from './NameDatabaseLookup';
export type { NameEntity, EntityType } from './NameDatabaseLookup';

export { default as AgingDisplay } from './AgingDisplay';

export { default as PeriodSelector } from './PeriodSelector';
export type { Period } from './PeriodSelector';

export { default as FinancialStatementViewer } from './FinancialStatementViewer';
export type { FinancialStatementData, Transaction } from './FinancialStatementViewer';

export { default as ActionBar } from './ActionBar';
export type { ActionDefinition } from './ActionBar';

export { default as AuditTrailViewer } from './AuditTrailViewer';
export type { AuditEntry } from './AuditTrailViewer';
