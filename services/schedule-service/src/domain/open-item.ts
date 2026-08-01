// @wave S026 — Schedule Open-Item Core
// @trace-cobol komdetail.cbl DE-APPLYNO/DE-APPLY-CD generalized into a real
// open-item balance ledger (see docs/accounting-modernization/
// S026_S027_IMPLEMENTATION_CONTRACT.md for the UQ-18 schedule_key resolution).

import { Prisma } from '.prisma/schedule-client';

// @wave S029 — WRITTEN_OFF added: a distinct terminal state from CLOSED
// (settled by application) so a write-off ceremony's outcome is visible
// without inspecting ceremony history.
export type OpenItemStatus = 'OPEN' | 'PARTIALLY_APPLIED' | 'CLOSED' | 'WRITTEN_OFF';

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

// -----------------------------------------------------------------------
// S028 — Relieving Policy: auto/on-account application (D-CE08-01
// APPROVED_IN_PRINCIPLE — smallest compliant derivation from Fable §3-S028
// "auto-application against oldest open items (FIFO) when no explicit
// apply-to reference is present" + §7 "an application may span multiple
// open items in a single payment").
// -----------------------------------------------------------------------

export interface FifoCandidate {
  id: string;
  originalAmount: Prisma.Decimal;
  remainingBalance: Prisma.Decimal;
  transactionDate: Date | null;
  createdAt: Date;
}

export interface FifoAllocation {
  itemId: string;
  applyAmount: Prisma.Decimal;
  newRemaining: Prisma.Decimal;
  newStatus: OpenItemStatus;
}

export interface FifoSweepResult {
  allocations: FifoAllocation[];
  unappliedAmount: Prisma.Decimal;
}

/**
 * Sweeps a single incoming amount oldest-first (FIFO, by transactionDate
 * then createdAt as tiebreak) across the given open items, applying as much
 * as each item can absorb before moving to the next. Never over-applies an
 * individual item (delegates to applyAmount's own guard). Any amount left
 * over after every candidate is fully relieved is returned as
 * `unappliedAmount` — the caller routes that to the S023/CE-09 unapplied-
 * receipt hand-off rather than fabricating a phantom open item.
 */
export function sweepFifo(candidates: FifoCandidate[], incomingAmount: Prisma.Decimal): FifoSweepResult {
  const ordered = [...candidates].sort((a, b) => {
    const aDate = a.transactionDate?.getTime() ?? 0;
    const bDate = b.transactionDate?.getTime() ?? 0;
    if (aDate !== bDate) return aDate - bDate;
    return a.createdAt.getTime() - b.createdAt.getTime();
  });

  let remainingToApply = incomingAmount;
  const allocations: FifoAllocation[] = [];

  for (const item of ordered) {
    if (remainingToApply.lte(0)) break;
    if (item.remainingBalance.lte(0)) continue;

    const portion = Prisma.Decimal.min(remainingToApply, item.remainingBalance);
    const newRemaining = applyAmount(item.originalAmount, item.remainingBalance, portion);
    allocations.push({
      itemId: item.id,
      applyAmount: portion,
      newRemaining,
      newStatus: deriveStatus(item.originalAmount, newRemaining),
    });
    remainingToApply = remainingToApply.sub(portion);
  }

  return { allocations, unappliedAmount: remainingToApply };
}

// -----------------------------------------------------------------------
// S029 — split conservation check. Fable §3-S029: "split preserves the sum
// of parts equal to the whole (to the cent)".
// -----------------------------------------------------------------------
export function validateSplitParts(originalRemaining: Prisma.Decimal, parts: Prisma.Decimal[]): void {
  if (parts.length < 2) {
    throw new Error('SPLIT_REQUIRES_AT_LEAST_TWO_PARTS');
  }
  if (parts.some((p) => p.lte(0))) {
    throw new Error('SPLIT_PARTS_MUST_BE_POSITIVE');
  }
  const sum = parts.reduce((acc, p) => acc.add(p), new Prisma.Decimal(0));
  if (!sum.equals(originalRemaining)) {
    throw new Error('SPLIT_PARTS_MUST_SUM_TO_WHOLE');
  }
}
