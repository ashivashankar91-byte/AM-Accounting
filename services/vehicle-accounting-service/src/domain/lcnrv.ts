// S076 — Lower-of-cost-or-NRV write-down domain logic (pure, no I/O).
import { requirePositiveCents } from './money';

export class LcnrvValidationError extends Error {
  readonly status = 400;
  readonly code = 'LCNRV_VALIDATION_ERROR';
  constructor(message: string) {
    super(message);
    this.name = 'LcnrvValidationError';
  }
}

/** Named, deterministic refusal — never a silent cap. */
export class WriteDownThresholdExceededError extends Error {
  readonly status = 422;
  readonly code = 'WRITE_DOWN_THRESHOLD_EXCEEDED';
  constructor(readonly writeDownCents: number, readonly thresholdCents: number) {
    super(`Write-down amount (${(writeDownCents / 100).toFixed(2)}) exceeds the configured threshold (${(thresholdCents / 100).toFixed(2)}) and is refused. A write-down above threshold requires the threshold to be reconfigured by an authorized user first — it is never silently capped or auto-approved.`);
    this.name = 'WriteDownThresholdExceededError';
  }
}

export interface WriteDownComputation {
  bookValueBeforeCents: number;
  marketValueCents: number;
  writeDownCents: number; // 0 if market >= book (no write-down needed)
}

/** Book value vs entered market-value evidence -> the mechanical write-down
 * amount (book - market, floored at 0 — LCNRV never proposes a write-UP;
 * see S076 "one-way in v1"). */
export function computeWriteDown(bookValueBeforeCents: number, marketValueCents: number): WriteDownComputation {
  if (bookValueBeforeCents <= 0) throw new LcnrvValidationError('Cannot evaluate LCNRV for a unit with a zero or negative book value.');
  if (marketValueCents < 0) throw new LcnrvValidationError('marketValue must not be negative.');
  const writeDownCents = Math.max(0, bookValueBeforeCents - marketValueCents);
  return { bookValueBeforeCents, marketValueCents, writeDownCents };
}

/** Deterministic threshold check — throws WriteDownThresholdExceededError, never auto-caps. */
export function assertWithinThreshold(writeDownCents: number, thresholdCents: number): void {
  if (writeDownCents > thresholdCents) {
    throw new WriteDownThresholdExceededError(writeDownCents, thresholdCents);
  }
}

export function requirePositiveWriteDownCents(field: string, value: string): number {
  return requirePositiveCents(field, value);
}
