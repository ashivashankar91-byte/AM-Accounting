// S094 — Dealer-Obligor Deferral Mode. Pure recognition-schedule math, no
// I/O. The earning-schedule PATTERN LIST is config (SAFE_CONFIGURATION —
// DeferralModeConfig.earningPatternType); once a pattern is selected, the
// per-period math below is purely mechanical, never invented.

import { divideEqually, toCents } from './money';

export class DeferralDomainError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'DeferralDomainError';
  }
}

export const SUPPORTED_EARNING_PATTERNS = ['STRAIGHT_LINE_MONTHS'] as const;
export type EarningPatternType = (typeof SUPPORTED_EARNING_PATTERNS)[number];

export function isSupportedEarningPattern(v: string): v is EarningPatternType {
  return (SUPPORTED_EARNING_PATTERNS as readonly string[]).includes(v);
}

/**
 * Straight-line-over-N-months schedule: originalAmountCents divided into
 * `months` equal periods (last period absorbs the rounding remainder — see
 * money.ts#divideEqually). Cumulative sum through period N-1 is always
 * exactly originalAmountCents — the defining conservation property this
 * module guarantees for every input.
 */
export function buildStraightLineSchedule(originalAmountCents: number, months: number): number[] {
  if (!Number.isInteger(months) || months <= 0) {
    throw new DeferralDomainError('INVALID_PATTERN_CONFIG', `earningPatternMonths must be a positive integer, got ${months}`);
  }
  if (!Number.isFinite(originalAmountCents) || originalAmountCents < 0) {
    throw new DeferralDomainError('INVALID_AMOUNT', `originalAmountCents must be a non-negative integer, got ${originalAmountCents}`);
  }
  return divideEqually(originalAmountCents, months);
}

/**
 * Whole calendar months elapsed between two dates, clamped to [0, cap].
 * "Whole month" = the day-of-month of `asOf` has reached/passed the
 * day-of-month of `from` (matches standard straight-line-months DMS
 * convention — e.g. booked Jan 15, as-of Feb 14 = 0 elapsed months; as-of
 * Feb 15 = 1 elapsed month).
 */
export function wholeMonthsElapsed(from: Date, asOf: Date, cap: number): number {
  let months = (asOf.getUTCFullYear() - from.getUTCFullYear()) * 12 + (asOf.getUTCMonth() - from.getUTCMonth());
  if (asOf.getUTCDate() < from.getUTCDate()) months -= 1;
  return Math.max(0, Math.min(cap, months));
}

export interface RecognitionComputation {
  scheduleCents: number[];
  elapsedPeriods: number;
  /** Cumulative earned through elapsedPeriods (sum of scheduleCents[0..elapsedPeriods-1]). */
  cumulativeEarnedCents: number;
  /** cumulativeEarnedCents - alreadyRecognizedCents, floored at 0 (never negative — a
   *  batch that finds no NEW periods elapsed contributes $0, never a refund). */
  earnedThisRunCents: number;
}

/**
 * S094 recognition-run per-line math: given a booking's original amount,
 * its straight-line pattern (months), how many whole months have elapsed
 * since booking as of the run date, and how much has already been
 * recognized in PRIOR runs, compute exactly how much this run should
 * recognize. Idempotent by construction: re-running with the same asOfDate
 * and the same alreadyRecognizedCents always yields the same
 * earnedThisRunCents; running again after alreadyRecognizedCents has caught
 * up to cumulativeEarnedCents yields 0 (never double-recognizes).
 */
export function computeRecognition(
  originalAmountCents: number,
  months: number,
  bookingDate: Date,
  asOfDate: Date,
  alreadyRecognizedCents: number,
): RecognitionComputation {
  const scheduleCents = buildStraightLineSchedule(originalAmountCents, months);
  const elapsedPeriods = wholeMonthsElapsed(bookingDate, asOfDate, months);
  const cumulativeEarnedCents = scheduleCents.slice(0, elapsedPeriods).reduce((a, b) => a + b, 0);
  const earnedThisRunCents = Math.max(0, cumulativeEarnedCents - alreadyRecognizedCents);
  return { scheduleCents, elapsedPeriods, cumulativeEarnedCents, earnedThisRunCents };
}

export function toCentsStrict(amount: number | string): number {
  const cents = toCents(amount);
  if (!Number.isFinite(cents)) throw new DeferralDomainError('INVALID_AMOUNT', `Amount "${amount}" is not a valid decimal.`);
  return cents;
}
