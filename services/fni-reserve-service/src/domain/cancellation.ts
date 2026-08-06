// S093 — Product Cancellations. Pure conservation math, no I/O.
//
// Refund computation NEVER invents math: it is always driven by either (a)
// an ENTERED provider quote (a specific refund percent or a specific total
// refund dollar amount) or (b) a configured pro-rata breakpoint table
// (ProviderProgramConfig). If neither is available/derivable, callers must
// refuse the cancellation (4xx) — this module signals that by throwing
// CancellationDomainError('NO_REFUND_BASIS', ...), never by guessing 0 or
// silently defaulting.
//
// Conservation identity used by this service (documented explicitly, per
// the epic package's allowance for "an explicitly documented different
// conservation identity" as long as it is provable numerically):
//
//   incomeReversalAmount + remitAdjustmentAmount === refundPayableAmount
//                                                 === quoteTotal
//
// Rationale: the ORIGINAL product price at booking time was split into an
// income portion (dealer's share, credited to revenue) and a remit portion
// (provider's share, credited to the remit-liability item) — see S092. A
// cancellation reverses a refundPercent-share of THAT SAME original split:
// the income-reversal leg (DR income) and the remit-adjustment leg (DR/
// relief of the remit-liability item) are the two SOURCE-side postings, and
// their sum is, by construction, exactly the total refunded to the
// customer/lender (the third, refund-payable leg, CR refund payable) — a
// single dollar cannot be reversed from more than one of {income, remit}
// without either double-counting or under-counting the refund, so
// income-reversal + remit-adjustment necessarily EQUALS the refund payable
// total, not a fourth, independent number.

import { allocateCents, toCents } from './money';
import { computeChargebackDraw, ChargebackDrawComputation } from './chargeback-reserve';

export class CancellationDomainError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'CancellationDomainError';
  }
}

export interface ProRataBreakpoint {
  monthsElapsed: number;
  refundPercent: number | string;
}

/**
 * S093 — resolve a refund percent (0-100) from a configured pro-rata
 * breakpoint table: the highest breakpoint whose monthsElapsed <= the
 * actual elapsed months applies. Breakpoints are used EXACTLY as entered —
 * no interpolation is performed (never invented math).
 */
export function resolveProRataPercent(table: ProRataBreakpoint[], monthsElapsed: number): number {
  if (!Array.isArray(table) || table.length === 0) {
    throw new CancellationDomainError('NO_REFUND_BASIS', 'Pro-rata table is empty or missing — cannot compute refund without an entered provider quote or a configured table.');
  }
  const sorted = [...table].sort((a, b) => a.monthsElapsed - b.monthsElapsed);
  let applicable: ProRataBreakpoint | null = null;
  for (const bp of sorted) {
    if (bp.monthsElapsed <= monthsElapsed) applicable = bp;
    else break;
  }
  if (!applicable) {
    throw new CancellationDomainError('NO_REFUND_BASIS', `No pro-rata breakpoint applies at ${monthsElapsed} months elapsed (earliest breakpoint is ${sorted[0].monthsElapsed} months).`);
  }
  const pct = typeof applicable.refundPercent === 'string' ? Number(applicable.refundPercent) : applicable.refundPercent;
  if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
    throw new CancellationDomainError('INVALID_CONFIG', `Configured refundPercent ${applicable.refundPercent} is not a valid 0-100 percentage.`);
  }
  return pct;
}

export interface CancellationLegs {
  originalIncomeCents: number;
  originalRemitCents: number;
  refundPercentBp: number;
  quoteTotalCents: number;
  incomeReversalCents: number;
  remitAdjustmentCents: number;
  refundPayableCents: number;
}

/**
 * Compute the three cancellation legs from the ORIGINAL income/remit split
 * (entered — these are the exact figures S092/deal-accounting-service's
 * recap booked at deal time, never re-derived here) and a refund percent
 * (0-100, from an entered provider quote percent or a resolved pro-rata
 * breakpoint). Uses the same remainder-absorbing allocateCents() technique
 * throughout: first the refund total is allocated from the original
 * (income+remit) total at refundPercent, then that refund total is
 * allocated between the income and remit legs in proportion to the
 * ORIGINAL income:remit ratio — both allocations use allocateCents so the
 * LAST allocation always absorbs the rounding remainder, guaranteeing exact
 * conservation at every step.
 */
export function computeCancellationLegsFromPercent(
  originalIncomeAmount: number | string,
  originalRemitAmount: number | string,
  refundPercent: number,
): CancellationLegs {
  const originalIncomeCents = toCents(originalIncomeAmount);
  const originalRemitCents = toCents(originalRemitAmount);
  if (!Number.isFinite(originalIncomeCents) || originalIncomeCents < 0 || !Number.isFinite(originalRemitCents) || originalRemitCents < 0) {
    throw new CancellationDomainError('INVALID_AMOUNT', 'originalIncomeAmount and originalRemitAmount must be non-negative decimal amounts.');
  }
  if (!Number.isFinite(refundPercent) || refundPercent < 0 || refundPercent > 100) {
    throw new CancellationDomainError('INVALID_CONFIG', `refundPercent must be between 0 and 100, got ${refundPercent}`);
  }
  const originalTotalCents = originalIncomeCents + originalRemitCents;
  if (originalTotalCents === 0) {
    throw new CancellationDomainError('NO_REFUND_BASIS', 'Original income and remit amounts are both zero — nothing to cancel.');
  }
  const refundPercentBp = Math.round(refundPercent * 100);
  // Two-way split (refund share + complement to BP_TOTAL) — same technique
  // computeChargebackAccrual uses — NOT a single-weight allocateCents call,
  // which would degenerate (its "last element absorbs the remainder" rule
  // returns the full total unchanged when there is only one weight).
  const [quoteTotalCents] = allocateCents(originalTotalCents, [refundPercentBp, 10_000 - refundPercentBp]);

  // Split the refund total between income-reversal and remit-adjustment in
  // proportion to the ORIGINAL income:remit ratio (same allocateCents
  // remainder-absorbing technique — the last leg, remit-adjustment,
  // absorbs any rounding remainder).
  const incomeShareBp = Math.round((originalIncomeCents * 10_000) / originalTotalCents);
  const [incomeReversalCents, remitAdjustmentCents] = allocateCents(quoteTotalCents, [incomeShareBp, 10_000 - incomeShareBp]);

  return {
    originalIncomeCents,
    originalRemitCents,
    refundPercentBp,
    quoteTotalCents,
    incomeReversalCents,
    remitAdjustmentCents,
    refundPayableCents: incomeReversalCents + remitAdjustmentCents,
  };
}

/**
 * Alternative entry point: an ENTERED provider quote gives the total refund
 * DOLLAR AMOUNT directly (not a percent) — still never invented, still
 * split between income/remit legs by the original ratio via allocateCents.
 */
export function computeCancellationLegsFromQuoteAmount(
  originalIncomeAmount: number | string,
  originalRemitAmount: number | string,
  quoteTotalAmount: number | string,
): CancellationLegs {
  const originalIncomeCents = toCents(originalIncomeAmount);
  const originalRemitCents = toCents(originalRemitAmount);
  const quoteTotalCents = toCents(quoteTotalAmount);
  if (!Number.isFinite(originalIncomeCents) || originalIncomeCents < 0 || !Number.isFinite(originalRemitCents) || originalRemitCents < 0) {
    throw new CancellationDomainError('INVALID_AMOUNT', 'originalIncomeAmount and originalRemitAmount must be non-negative decimal amounts.');
  }
  if (!Number.isFinite(quoteTotalCents) || quoteTotalCents < 0) {
    throw new CancellationDomainError('INVALID_AMOUNT', `quoteTotalAmount must be a non-negative decimal amount, got ${quoteTotalAmount}`);
  }
  const originalTotalCents = originalIncomeCents + originalRemitCents;
  if (originalTotalCents === 0) {
    throw new CancellationDomainError('NO_REFUND_BASIS', 'Original income and remit amounts are both zero — nothing to cancel.');
  }
  if (quoteTotalCents > originalTotalCents) {
    throw new CancellationDomainError('QUOTE_EXCEEDS_ORIGINAL', `Entered quote total (${quoteTotalCents / 100}) exceeds the original income+remit total (${originalTotalCents / 100}).`);
  }
  const refundPercentBp = Math.round((quoteTotalCents * 10_000) / originalTotalCents);
  const incomeShareBp = Math.round((originalIncomeCents * 10_000) / originalTotalCents);
  const [incomeReversalCents, remitAdjustmentCents] = allocateCents(quoteTotalCents, [incomeShareBp, 10_000 - incomeShareBp]);

  return {
    originalIncomeCents,
    originalRemitCents,
    refundPercentBp,
    quoteTotalCents,
    incomeReversalCents,
    remitAdjustmentCents,
    refundPayableCents: incomeReversalCents + remitAdjustmentCents,
  };
}

/**
 * S093's chargeback-linkage requirement: if the cancelled product is
 * chargeback-reserve-affecting, the cancellation ALSO triggers the S091
 * chargeback-draw logic. This function is a thin, named pass-through to the
 * SAME shared computeChargebackDraw() S091(c)'s actual-chargeback path
 * calls — never duplicated/diverged, per the epic package's explicit
 * requirement ("reuse the same draw-conservation math, don't duplicate/
 * diverge it — factor it into a shared internal function both S091's
 * actual-chargeback path and S093's cancellation path call").
 */
export function computeCancellationChargebackDraw(chargebackAmount: number | string, reserveBalanceBefore: number | string): ChargebackDrawComputation {
  return computeChargebackDraw(chargebackAmount, reserveBalanceBefore);
}
