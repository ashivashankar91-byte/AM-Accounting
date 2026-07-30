// @wave S026 — Schedule Open-Item Core
// @trace-cobol komdetail.cbl DE-APPLYNO/DE-APPLY-CD generalized into a real
// open-item balance ledger (see docs/accounting-modernization/
// S026_S027_IMPLEMENTATION_CONTRACT.md for the UQ-18 schedule_key resolution).

import { Prisma } from '.prisma/schedule-client';

export type OpenItemStatus = 'OPEN' | 'PARTIALLY_APPLIED' | 'CLOSED';

export interface CreateOpenItemInput {
  scheduleNumber: string;
  controlNumber: string;
  itemNumber: string;
  glAccountNumber?: string | null;
  journalSource?: string | null;
  originalAmount: Prisma.Decimal;
  transactionDate?: Date | null;
  dueDate?: Date | null;
  description?: string | null;
  journalEntryId: string;
  scheduleDetailId?: string | null;
  sourceCorrelationId: string;
}

export interface ManualApplyInput {
  amount: string;
  idempotencyKey: string;
  note?: string;
  appliedBy?: string;
}

// @trace-improvement no legacy over-application guard existed for DE-APPLYNO
// mutations; this derivation + the DB CHECK constraint in migration
// 20260730010000_s026_open_items together are the AMACC 2.0 enhancement.
export function deriveStatus(originalAmount: Prisma.Decimal, remainingBalance: Prisma.Decimal): OpenItemStatus {
  if (remainingBalance.equals(0)) return 'CLOSED';
  if (remainingBalance.equals(originalAmount)) return 'OPEN';
  return 'PARTIALLY_APPLIED';
}

/**
 * Validates a proposed application amount against an open item's current
 * remaining balance. Returns the new remaining balance, or throws if the
 * application would flip the balance's sign or exceed its magnitude
 * (over-application protection).
 */
export function applyAmount(
  originalAmount: Prisma.Decimal,
  remainingBalance: Prisma.Decimal,
  applicationAmount: Prisma.Decimal,
): Prisma.Decimal {
  const next = remainingBalance.sub(applicationAmount);
  const originalIsNonNegative = originalAmount.gte(0);
  const overApplied = originalIsNonNegative
    ? next.lt(0) || next.gt(originalAmount)
    : next.gt(0) || next.lt(originalAmount);
  if (overApplied) {
    throw new Error('OVER_APPLICATION');
  }
  return next;
}

export function ageDaysFrom(referenceDate: Date | null, asOfDate: Date): number {
  if (!referenceDate) return 0;
  const msPerDay = 1000 * 60 * 60 * 24;
  return Math.floor((asOfDate.getTime() - referenceDate.getTime()) / msPerDay);
}
