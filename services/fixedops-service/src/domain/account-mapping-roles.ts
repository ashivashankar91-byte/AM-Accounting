// Event families and their fixed role sets, exactly per
// CE11_FABLE_EPIC_PACKAGE.md Workstream A/B journal-structure text. Roles
// are FIXED (no invented DR/CR behavior beyond what the package specifies);
// account NUMBERS are always tenant-resolved via FixedOpsAccountMapping —
// never hardcoded here or anywhere else in this service.

export const EVENT_FAMILY = {
  RO_CLOSE_CUSTOMER: 'RO_CLOSE_CUSTOMER',
  RO_CLOSE_WARRANTY: 'RO_CLOSE_WARRANTY',
  RO_CLOSE_INTERNAL: 'RO_CLOSE_INTERNAL',
  RO_REVERSAL: 'RO_REVERSAL',
  SUBLET_ACCRUAL: 'SUBLET_ACCRUAL',
  SUBLET_RELIEF: 'SUBLET_RELIEF',
  WARRANTY_CLAIM_DISPOSITION: 'WARRANTY_CLAIM_DISPOSITION',
  DEFERRED_CONTRACT_SALE: 'DEFERRED_CONTRACT_SALE',
  DEFERRED_CONTRACT_REDEMPTION: 'DEFERRED_CONTRACT_REDEMPTION',
  UNAPPLIED_TIME_ABSORPTION: 'UNAPPLIED_TIME_ABSORPTION',
} as const;
export type EventFamily = (typeof EVENT_FAMILY)[keyof typeof EVENT_FAMILY];

/** Roles referenced by each event family — package text, §Workstream A/B. */
export const ROLES_BY_FAMILY: Record<EventFamily, readonly string[]> = {
  // C: DR AR-customer / CR labor,parts,sublet,fee sales + tax per S124/S125;
  // DR COS labor/parts/sublet (offset labor-in-process/inventory/sublet accrual).
  [EVENT_FAMILY.RO_CLOSE_CUSTOMER]: [
    'AR_CUSTOMER', 'LABOR_SALES', 'PARTS_SALES', 'SUBLET_INCOME', 'FEE_INCOME', 'TAX_PAYABLE',
    'COS_LABOR', 'LABOR_IN_PROCESS_OFFSET', 'COS_PARTS', 'INVENTORY_OFFSET', 'COS_SUBLET', 'SUBLET_ACCRUAL_OFFSET',
  ],
  // W: DR warranty claim receivable (creates claim item) / CR sales at warranty rates; COS identically.
  [EVENT_FAMILY.RO_CLOSE_WARRANTY]: [
    'WARRANTY_CLAIM_RECEIVABLE', 'WARRANTY_LABOR_SALES', 'WARRANTY_PARTS_SALES', 'WARRANTY_SUBLET_INCOME',
    'COS_LABOR', 'LABOR_IN_PROCESS_OFFSET', 'COS_PARTS', 'INVENTORY_OFFSET', 'COS_SUBLET', 'SUBLET_ACCRUAL_OFFSET',
  ],
  // I: DR internal expense (charged dept) / CR internal sales; COS identically — no external receivable.
  [EVENT_FAMILY.RO_CLOSE_INTERNAL]: [
    'INTERNAL_EXPENSE', 'INTERNAL_SALES',
    'COS_LABOR', 'LABOR_IN_PROCESS_OFFSET', 'COS_PARTS', 'INVENTORY_OFFSET', 'COS_SUBLET', 'SUBLET_ACCRUAL_OFFSET',
  ],
  // Reversal uses the same roles as the original close (byte-symmetric negation) — no new roles.
  [EVENT_FAMILY.RO_REVERSAL]: [],
  // Accrue at close if invoice not yet received: DR COS sublet / CR sublet accrual.
  [EVENT_FAMILY.SUBLET_ACCRUAL]: ['COS_SUBLET', 'SUBLET_ACCRUAL'],
  // Invoice posting relieves accrual; variance to COS.
  [EVENT_FAMILY.SUBLET_RELIEF]: ['SUBLET_ACCRUAL', 'AP_ACCRUAL', 'COS_SUBLET_VARIANCE'],
  // Short-pay disposition: write-down or transfer-to-customer-responsibility.
  [EVENT_FAMILY.WARRANTY_CLAIM_DISPOSITION]: ['WARRANTY_CLAIM_RECEIVABLE', 'WARRANTY_WRITE_DOWN_EXPENSE', 'AR_CUSTOMER'],
  // Sold maintenance contract: DR cash/AR / CR deferred revenue.
  [EVENT_FAMILY.DEFERRED_CONTRACT_SALE]: ['CASH_OR_AR', 'DEFERRED_REVENUE'],
  // Redemption: DR deferred revenue / CR service revenue for redeemed value.
  [EVENT_FAMILY.DEFERRED_CONTRACT_REDEMPTION]: ['DEFERRED_REVENUE', 'SERVICE_REVENUE'],
  // Unapplied+guarantee absorption: DR unapplied-labor/guarantee expense / CR applied-labor or accrual.
  [EVENT_FAMILY.UNAPPLIED_TIME_ABSORPTION]: ['UNAPPLIED_LABOR_EXPENSE', 'GUARANTEE_EXPENSE', 'APPLIED_LABOR_ACCRUAL'],
};
// LABOR_WIP_ACCRUAL was removed as a gap-closure cleanup: it was never
// emitted as its own event by anything in this service — WIP mode instead
// branches WITHIN the RO_CLOSE_CUSTOMER/WARRANTY/INTERNAL blueprints via
// payload.wipMode (see ro-close-service.ts's "branching is expressed to
// the rule pack via payload.wipMode, not decided here"), already live-
// certified through the mixed-pay RO close golden test. Dead/unreachable
// scaffolding, not a functional gap — removing it rather than leaving an
// ambiguous duplicate event path that looks live but never fires.

/** Single labeled certification tenant permitted a resolved (still-opaque)
 * fixture mapping value, per the S023 standing rule mirrored from CE-10. */
export const TEST_FIXTURE_TENANT_ID = 'TEST-TENANT-CE11-CERTIFICATION-ONLY';
export const ACCOUNT_MAPPING_VALUES_PENDING = 'ACCOUNT_MAPPING_VALUES_PENDING';
export const TEST_FIXTURE_RESOLVED = 'TEST_FIXTURE_RESOLVED';
export const RESOLVED = 'RESOLVED';
