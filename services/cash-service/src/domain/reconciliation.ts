// S052 — blind-close reconciliation math (pure, no I/O). The single rule
// source for expected-cash/expected-checks/variance classification —
// BlindCloseService and ReconciliationService both call these, never
// re-derive expected totals independently.

import { toCents } from './money';

export type VarianceClassification = 'EXACT' | 'WITHIN_TOLERANCE' | 'OUTSIDE_TOLERANCE' | 'NON_CASH_EXCEPTION';

export interface MovementLike {
  movementType: string; // OPEN_FLOAT | CASH_RECEIPT | CASH_VOID_REVERSAL | CHECK_RECEIPT | CHECK_VOID_REVERSAL
  amount: number | string; // signed — void reversals are already negative
}

/**
 * expected cash = opening float + net cash received − cash reversed by
 * valid voids. Derived ONLY from append-only movements (BR: expected totals
 * must be reproducible from drawer movements, never a running balance
 * column that could silently drift).
 */
export function computeExpectedCashCents(movements: MovementLike[]): number {
  return movements
    .filter((m) => m.movementType === 'OPEN_FLOAT' || m.movementType === 'CASH_RECEIPT' || m.movementType === 'CASH_VOID_REVERSAL')
    .reduce((sum, m) => sum + toCents(m.amount), 0);
}

export interface ExpectedChecks {
  count: number;
  totalCents: number;
}

export function computeExpectedChecks(movements: MovementLike[]): ExpectedChecks {
  let count = 0;
  let totalCents = 0;
  for (const m of movements) {
    if (m.movementType === 'CHECK_RECEIPT') {
      count += 1;
      totalCents += toCents(m.amount);
    } else if (m.movementType === 'CHECK_VOID_REVERSAL') {
      count -= 1;
      totalCents += toCents(m.amount); // already negative
    }
  }
  return { count, totalCents };
}

export interface ClassifyVarianceInput {
  cashVarianceCents: number; // countedCash - expectedCash
  toleranceCents: number;
  checkDiscrepancy: boolean;
}

export interface ClassifyVarianceResult {
  classification: VarianceClassification;
  requiresApproval: boolean;
}

/**
 * Priority: a nonzero cash variance always wins the classification (EXACT
 * only when cash is exactly zero variance). A check discrepancy on an
 * otherwise-exact cash count is its own distinct classification
 * (NON_CASH_EXCEPTION) — BR: never fold a check discrepancy into a cash
 * over/short. Only OUTSIDE_TOLERANCE and NON_CASH_EXCEPTION require
 * supervisor approval; WITHIN_TOLERANCE and EXACT reconcile straight
 * through.
 */
export function classifyVariance(input: ClassifyVarianceInput): ClassifyVarianceResult {
  const absVariance = Math.abs(input.cashVarianceCents);
  if (absVariance > 0) {
    const classification: VarianceClassification = absVariance <= input.toleranceCents ? 'WITHIN_TOLERANCE' : 'OUTSIDE_TOLERANCE';
    return { classification, requiresApproval: classification === 'OUTSIDE_TOLERANCE' };
  }
  if (input.checkDiscrepancy) {
    return { classification: 'NON_CASH_EXCEPTION', requiresApproval: true };
  }
  return { classification: 'EXACT', requiresApproval: false };
}

/** deposit-eligible cash = counted closing cash − retained closing float. */
export function computeDepositEligibleCashCents(countedCashCents: number, retainedFloatCents: number): number {
  return countedCashCents - retainedFloatCents;
}
