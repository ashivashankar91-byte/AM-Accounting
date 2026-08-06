// S053 — Deposit Workflow domain rules. Pure functions; no I/O.

export type DepositStatus = 'OPEN' | 'POSTED' | 'VOID';

export function canAddReceiptToDeposit(receiptStatus: string): boolean {
  return receiptStatus === 'ISSUED';
}

export function canPostDeposit(status: DepositStatus): boolean {
  return status === 'OPEN';
}

export function canVoidDeposit(status: DepositStatus): boolean {
  return status === 'OPEN';
}

export interface DepositLineLike {
  amount: string | number;
}

/**
 * BR (conservation): the deposit's stated total must equal the sum of its
 * lines exactly, to the cent. Any residual — even $0.01 — is a hard reject,
 * never a silent force-balance (mirrors the S023 D-19 rounding rule: an
 * out-of-tolerance residual must be rejected, not absorbed).
 */
export function assertDepositConserves(lines: DepositLineLike[], statedTotalCents: number): void {
  const sum = lines.reduce((acc, l) => acc + Math.round(Number(l.amount) * 100), 0);
  if (sum !== statedTotalCents) {
    throw new DepositConservationError(sum, statedTotalCents);
  }
}

export class DepositConservationError extends Error {
  readonly status = 409;
  readonly code = 'DEPOSIT_CONSERVATION_FAILED';
  constructor(readonly lineSumCents: number, readonly statedTotalCents: number) {
    super(`Deposit lines sum to ${lineSumCents} cents but stated total is ${statedTotalCents} cents`);
    this.name = 'DepositConservationError';
  }
}
