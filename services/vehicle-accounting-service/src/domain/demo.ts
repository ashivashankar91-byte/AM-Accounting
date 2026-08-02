// S075 — Demo reclass + periodic value adjustment domain logic (pure, no I/O).
import { requirePositiveCents, centsToDollarString } from './money';

export class DemoValidationError extends Error {
  readonly status = 400;
  readonly code = 'DEMO_VALIDATION_ERROR';
  constructor(message: string) {
    super(message);
    this.name = 'DemoValidationError';
  }
}

/** S075 AC: "reclass conserves unit value" — the reclass journal moves the
 * FULL current book value from the old-status account to the new-status
 * account; nothing may be dropped or invented at reclass time. */
export function reclassUnitValue(currentBookValueCents: number): number {
  if (currentBookValueCents <= 0) {
    throw new DemoValidationError('Cannot reclass a unit with a zero or negative book value.');
  }
  return currentBookValueCents;
}

/** SAFE_CONFIGURATION basis: percent-of-cost-per-period, computed
 * mechanically from the configured basis points and elapsed whole periods
 * — never an invented/estimated figure. Rounds down (floor) at the cents
 * level so an approved preview never proposes MORE depreciation than the
 * configured rate strictly allows. */
export function computeDemoValueAdjustmentPreview(
  currentBookValueCents: number,
  percentPerPeriodBp: number,
  elapsedPeriods: number,
): number {
  if (currentBookValueCents <= 0) throw new DemoValidationError('Cannot adjust a unit with a zero or negative book value.');
  if (percentPerPeriodBp <= 0) throw new DemoValidationError('percentPerPeriodBp must be positive.');
  if (elapsedPeriods <= 0) throw new DemoValidationError('elapsedPeriods must be positive.');

  const totalBp = percentPerPeriodBp * elapsedPeriods;
  const proposedCents = Math.floor((currentBookValueCents * totalBp) / 10_000);
  // Never propose writing down more than the unit is actually worth.
  return Math.min(proposedCents, currentBookValueCents);
}

export interface ApprovedAdjustment {
  approvedAmountCents: number;
}

/** S075 AC: "adjustment = approved preview exactly" — the posted amount
 * must be byte-identical to what was approved, never silently re-derived
 * at post time. */
export function assertApprovedAmountMatchesPreview(proposedCents: number, approved: ApprovedAdjustment): void {
  if (approved.approvedAmountCents !== proposedCents) {
    throw new DemoValidationError(
      `Approved amount (${centsToDollarString(approved.approvedAmountCents)}) does not match the computed preview (${centsToDollarString(proposedCents)}).`,
    );
  }
}

export function requirePositiveAdjustmentCents(field: string, value: string): number {
  return requirePositiveCents(field, value);
}
