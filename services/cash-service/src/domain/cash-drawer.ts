// S052 — cash drawer state machine + open-drawer validation (pure, no I/O).
//
// Status lifecycle (linear, no branch back except VARIANCE_REVIEW_REQUIRED's
// single approve-and-return-to-BLIND_COUNT_SUBMITTED step):
//
//   OPEN --submitBlindClose(no approval needed)--> BLIND_COUNT_SUBMITTED --reconcile--> RECONCILED
//   OPEN --submitBlindClose(approval needed)-->    VARIANCE_REVIEW_REQUIRED
//                                                    --approveVariance-->  BLIND_COUNT_SUBMITTED --reconcile--> RECONCILED
//
// RECONCILED is terminal: every write path below rejects it.

import { toCents } from './money';

export type DrawerStatus = 'OPEN' | 'BLIND_COUNT_SUBMITTED' | 'VARIANCE_REVIEW_REQUIRED' | 'RECONCILED';

export interface Violation {
  rule: string;
  field?: string;
  diagnostic: string;
}

export interface OpenDrawerInput {
  storeId?: string | null;
  storeCode?: string | null;
  terminalCode?: string | null;
  cashierId?: string | null;
  businessDate?: string | null; // YYYY-MM-DD
  openingFloat?: number | string | null;
  currency?: string | null;
}

const BUSINESS_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** BR: opening float can't be negative; every scope field is required to
 * open a drawer (BR: one active drawer per cashier/location, one per
 * terminal — both enforced with these fields as the natural key). */
export function validateOpenDrawer(input: OpenDrawerInput): Violation[] {
  const violations: Violation[] = [];
  if (!input.storeId) violations.push({ rule: 'S052-OPEN-1', field: 'storeId', diagnostic: 'storeId is required' });
  if (!input.storeCode) violations.push({ rule: 'S052-OPEN-1', field: 'storeCode', diagnostic: 'storeCode is required' });
  if (!input.terminalCode) violations.push({ rule: 'S052-OPEN-1', field: 'terminalCode', diagnostic: 'terminalCode is required' });
  if (!input.cashierId) violations.push({ rule: 'S052-OPEN-1', field: 'cashierId', diagnostic: 'cashierId is required' });
  if (!input.businessDate || !BUSINESS_DATE_RE.test(input.businessDate)) {
    violations.push({ rule: 'S052-OPEN-2', field: 'businessDate', diagnostic: 'businessDate must be YYYY-MM-DD' });
  }
  const floatCents = toCents(input.openingFloat ?? 0);
  if (!Number.isFinite(floatCents)) {
    violations.push({ rule: 'S052-OPEN-3', field: 'openingFloat', diagnostic: 'openingFloat must be a valid amount' });
  } else if (floatCents < 0) {
    violations.push({ rule: 'S052-OPEN-3', field: 'openingFloat', diagnostic: 'openingFloat cannot be negative' });
  }
  return violations;
}

/** BR: receipts can only be issued against an OPEN drawer. */
export function canIssueReceipt(status: DrawerStatus): boolean {
  return status === 'OPEN';
}

/** BR: a direct void requires the drawer still OPEN — rejected after blind-count
 * submission (BLIND_COUNT_SUBMITTED/VARIANCE_REVIEW_REQUIRED) or reconciliation. */
export function canVoidDirect(status: DrawerStatus): boolean {
  return status === 'OPEN';
}

/** BR: prevents receipt creation / blind-close resubmission after blind close. */
export function canSubmitBlindClose(status: DrawerStatus): boolean {
  return status === 'OPEN';
}

export function canApproveVariance(status: DrawerStatus): boolean {
  return status === 'VARIANCE_REVIEW_REQUIRED';
}

/** BR: prevents reconciliation before blind close; VARIANCE_REVIEW_REQUIRED
 * must be approved first (it returns the drawer to BLIND_COUNT_SUBMITTED). */
export function canReconcile(status: DrawerStatus): boolean {
  return status === 'BLIND_COUNT_SUBMITTED';
}

export function isReconciled(status: DrawerStatus): boolean {
  return status === 'RECONCILED';
}
