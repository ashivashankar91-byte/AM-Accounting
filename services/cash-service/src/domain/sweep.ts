// S056 — ZBA Sweeps & FP-Offset Allocation domain rules. Pure functions;
// no I/O. Two independent features share this file: (a) zero-balance-
// account sweeps between a configured store/operating account pair, and
// (b) floorplan-offset allocation, a pure allocation of an already-entered
// lender-statement figure — never an invented interest calculation.

export type SweepStatus = 'RECORDED' | 'POSTED' | 'VOID';
export type SweepDirection = 'STORE_TO_OPERATING' | 'OPERATING_TO_STORE';

export function isValidSweepDirection(direction: string): direction is SweepDirection {
  return direction === 'STORE_TO_OPERATING' || direction === 'OPERATING_TO_STORE';
}

export function canPostSweep(status: SweepStatus): boolean {
  return status === 'RECORDED';
}

export function canVoidSweep(status: SweepStatus): boolean {
  return status === 'RECORDED';
}

/**
 * AC: a sweep pair nets exactly zero across the two accounts — the debit
 * leg on one account and the credit leg on the other must be equal in
 * magnitude by construction (a single amount + direction, not two
 * independently-entered figures), so this function exists purely to make
 * that invariant explicit and testable rather than to reconcile two
 * user-entered numbers.
 */
export function sweepNetsToZero(debitLegCents: number, creditLegCents: number): boolean {
  return debitLegCents === creditLegCents && debitLegCents + -creditLegCents === 0;
}

export class SweepInputError extends Error {
  readonly status = 400;
  readonly code = 'SWEEP_INPUT_ERROR';
}

export class SweepConfigNotFoundError extends Error {
  readonly status = 404;
  readonly code = 'SWEEP_CONFIG_NOT_FOUND';
}

export class SweepNotFoundError extends Error {
  readonly status = 404;
  readonly code = 'SWEEP_NOT_FOUND';
}

export class SweepNotPostableError extends Error {
  readonly status = 409;
  readonly code = 'SWEEP_NOT_POSTABLE';
  constructor(message = 'Sweep is not in a postable state (must be RECORDED)') {
    super(message);
    this.name = 'SweepNotPostableError';
  }
}

export class SweepNotVoidableError extends Error {
  readonly status = 409;
  readonly code = 'SWEEP_NOT_VOIDABLE';
  constructor(message = 'Sweep can only be voided while RECORDED') {
    super(message);
    this.name = 'SweepNotVoidableError';
  }
}

// ── FP-Offset Allocation ──────────────────────────────────────────────────

export type FpOffsetStatus = 'DRAFT' | 'POSTED';

export interface FpOffsetLineLike {
  amount: string | number;
}

/**
 * AC: allocation total equals the entered statement figure exactly — no
 * interest/actuarial calculation is performed here or anywhere in this
 * feature; the statement figure is a manually entered fact and the lines
 * merely allocate it across floorplan units.
 */
export function assertAllocationEqualsStatement(lines: FpOffsetLineLike[], statementAmountCents: number): void {
  const sum = lines.reduce((acc, l) => acc + Math.round(Number(l.amount) * 100), 0);
  if (sum !== statementAmountCents) {
    throw new FpOffsetAllocationMismatchError(sum, statementAmountCents);
  }
}

export class FpOffsetAllocationMismatchError extends Error {
  readonly status = 409;
  readonly code = 'FP_OFFSET_ALLOCATION_MISMATCH';
  constructor(readonly lineSumCents: number, readonly statementAmountCents: number) {
    super(`Allocation lines sum to ${lineSumCents} cents but the entered statement figure is ${statementAmountCents} cents`);
    this.name = 'FpOffsetAllocationMismatchError';
  }
}

export function canPostFpOffsetAllocation(status: FpOffsetStatus): boolean {
  return status === 'DRAFT';
}
