// Fixed event families and GL account ROLES per CE11_FABLE_EPIC_PACKAGE.md
// Workstream C/D (S066-S072). Roles are what a family's blueprint resolves
// against FixedOpsAccountMapping — no DR/CR treatment beyond what the
// package text explicitly supports is invented here (golden-journal
// discipline, package line 9).

export const EVENT_FAMILY = {
  PARTS_RECEIPT: 'PARTS_RECEIPT',
  PARTS_RO_ISSUE: 'PARTS_RO_ISSUE',
  PARTS_COUNTER_SALE: 'PARTS_COUNTER_SALE',
  PARTS_RETURN_TO_STOCK: 'PARTS_RETURN_TO_STOCK',
  PARTS_RETURN_TO_VENDOR: 'PARTS_RETURN_TO_VENDOR',
  PARTS_INTERNAL_ISSUE: 'PARTS_INTERNAL_ISSUE',
  PRICE_TAPE_REVALUATION: 'PRICE_TAPE_REVALUATION',
  OBSOLESCENCE_PROVISION: 'OBSOLESCENCE_PROVISION',
  SCRAP_DISPOSAL: 'SCRAP_DISPOSAL',
  PHYSICAL_ADJUSTMENT: 'PHYSICAL_ADJUSTMENT',
  SPECIAL_ORDER_DEPOSIT: 'SPECIAL_ORDER_DEPOSIT',
  SPECIAL_ORDER_DEPOSIT_APPLY: 'SPECIAL_ORDER_DEPOSIT_APPLY',
  SPECIAL_ORDER_DEPOSIT_REFUND: 'SPECIAL_ORDER_DEPOSIT_REFUND',
  OEM_RETURN_SHIP: 'OEM_RETURN_SHIP',
  OEM_RETURN_CREDIT: 'OEM_RETURN_CREDIT',
  /// S066 tie-out: the ONE designated GL inventory-control account this
  /// legal entity's perpetual balance reconciles against — a single,
  /// tenant-configured mapping (not a per-movement-family account), since
  /// the perpetual-to-GL proof compares one authoritative total, not many.
  PARTS_RECONCILIATION: 'PARTS_RECONCILIATION',
} as const;

export type EventFamily = (typeof EVENT_FAMILY)[keyof typeof EVENT_FAMILY];

/** Package S066: "receipt (DR inventory / CR AP-accrual or AP via S039 match)" */
const RECEIPT_ROLES = ['INVENTORY', 'AP_ACCRUAL'];
/** Package S066: "RO issue (CR inventory / DR COS-parts ... linked into S059's journal or companion)" */
const RO_ISSUE_ROLES = ['INVENTORY', 'COS_PARTS'];
/** Package S066: "counter sale (CR inventory / DR COS + the sale via CE-09)" */
const COUNTER_SALE_ROLES = ['INVENTORY', 'COS_PARTS', 'COUNTER_SALE_REVENUE'];
/** Package S066: "return-to-stock (reverse issue)" */
const RETURN_TO_STOCK_ROLES = ['INVENTORY', 'COS_PARTS'];
/** Package S066: "return-to-vendor (CR inventory / DR AP-debit-memo item)" */
const RETURN_TO_VENDOR_ROLES = ['INVENTORY', 'AP_DEBIT_MEMO'];
/** Package S066: "internal issue (DR internal expense)" */
const INTERNAL_ISSUE_ROLES = ['INVENTORY', 'INTERNAL_EXPENSE'];
/** Package S069: adjustment posts DR/CR inventory vs shrinkage */
const PHYSICAL_ADJUSTMENT_ROLES = ['INVENTORY', 'INVENTORY_SHRINKAGE'];
/** Package S067: preview-approve posts DR/CR inventory vs price-variance */
const PRICE_TAPE_ROLES = ['INVENTORY', 'PRICE_VARIANCE'];
/** Package S068: provision DR obsolescence expense / CR allowance */
const OBSOLESCENCE_ROLES = ['OBSOLESCENCE_EXPENSE', 'OBSOLESCENCE_ALLOWANCE'];
/** Package S068: scrap CR inventory / DR allowance-then-expense */
const SCRAP_ROLES = ['INVENTORY', 'OBSOLESCENCE_ALLOWANCE', 'SCRAP_EXPENSE'];
/** Package S070: DR cash / CR customer-deposit liability */
const DEPOSIT_ROLES = ['CASH_OR_AR', 'CUSTOMER_DEPOSIT_LIABILITY'];
const DEPOSIT_APPLY_ROLES = ['CUSTOMER_DEPOSIT_LIABILITY', 'SALE_REVENUE'];
const DEPOSIT_REFUND_ROLES = ['CUSTOMER_DEPOSIT_LIABILITY', 'CASH_OR_AR'];
/** Package S071: shipment CR inventory / DR OEM-return receivable */
const OEM_RETURN_SHIP_ROLES = ['INVENTORY', 'OEM_RETURN_RECEIVABLE'];
/** Package S071: factory credit relieves item; restocking-fee variance line */
const OEM_RETURN_CREDIT_ROLES = ['OEM_RETURN_RECEIVABLE', 'RESTOCKING_FEE_VARIANCE', 'AP_OR_CASH'];

export const EVENT_FAMILY_ROLES: Record<EventFamily, string[]> = {
  PARTS_RECEIPT: RECEIPT_ROLES,
  PARTS_RO_ISSUE: RO_ISSUE_ROLES,
  PARTS_COUNTER_SALE: COUNTER_SALE_ROLES,
  PARTS_RETURN_TO_STOCK: RETURN_TO_STOCK_ROLES,
  PARTS_RETURN_TO_VENDOR: RETURN_TO_VENDOR_ROLES,
  PARTS_INTERNAL_ISSUE: INTERNAL_ISSUE_ROLES,
  PRICE_TAPE_REVALUATION: PRICE_TAPE_ROLES,
  OBSOLESCENCE_PROVISION: OBSOLESCENCE_ROLES,
  SCRAP_DISPOSAL: SCRAP_ROLES,
  PHYSICAL_ADJUSTMENT: PHYSICAL_ADJUSTMENT_ROLES,
  SPECIAL_ORDER_DEPOSIT: DEPOSIT_ROLES,
  SPECIAL_ORDER_DEPOSIT_APPLY: DEPOSIT_APPLY_ROLES,
  SPECIAL_ORDER_DEPOSIT_REFUND: DEPOSIT_REFUND_ROLES,
  OEM_RETURN_SHIP: OEM_RETURN_SHIP_ROLES,
  OEM_RETURN_CREDIT: OEM_RETURN_CREDIT_ROLES,
  PARTS_RECONCILIATION: ['INVENTORY_CONTROL'],
};

// "ADJUSTMENT" is deliberately NOT a key here — adjustment movements may
// only be created via the real S069 physical-inventory approval ceremony
// (PHYSICAL_ADJUSTMENT event family, physical-inventory-service.ts), never
// through this generic movements endpoint. movement-service.ts refuses
// movementFamily==='ADJUSTMENT' with an explicit redirect message before
// ever reaching this lookup — removed the dead PARTS_ADJUSTMENT event
// family/mapping-role entry this previously (unreachably) pointed to.
export const MOVEMENT_FAMILY_TO_EVENT_FAMILY: Record<string, EventFamily> = {
  RECEIPT: 'PARTS_RECEIPT',
  RO_ISSUE: 'PARTS_RO_ISSUE',
  COUNTER_SALE: 'PARTS_COUNTER_SALE',
  RETURN_TO_STOCK: 'PARTS_RETURN_TO_STOCK',
  RETURN_TO_VENDOR: 'PARTS_RETURN_TO_VENDOR',
  INTERNAL_ISSUE: 'PARTS_INTERNAL_ISSUE',
};

/** Movement families that relieve/decrement on-hand quantity (CR inventory side). */
export const RELIEVING_MOVEMENT_FAMILIES = new Set([
  'RO_ISSUE', 'COUNTER_SALE', 'RETURN_TO_VENDOR', 'INTERNAL_ISSUE',
]);
/** Movement families that increase on-hand quantity (DR inventory side). */
export const REPLENISHING_MOVEMENT_FAMILIES = new Set(['RECEIPT', 'RETURN_TO_STOCK']);

export const CERTIFICATION_TEST_TENANT_ID = 'TEST-TENANT-CE11-CERTIFICATION-ONLY';
export const TEST_FIXTURE_MAPPING_VALUE = 'TEST-FIXTURE-MAPPING-RESOLVED';
