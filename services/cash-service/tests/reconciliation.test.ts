import { describe, it, expect } from 'vitest';
import {
  computeExpectedCashCents, computeExpectedChecks, classifyVariance, computeDepositEligibleCashCents,
} from '../src/domain/reconciliation';

describe('computeExpectedCashCents', () => {
  it('sums opening float + cash receipts', () => {
    const cents = computeExpectedCashCents([
      { movementType: 'OPEN_FLOAT', amount: 100 },
      { movementType: 'CASH_RECEIPT', amount: 45 },
      { movementType: 'CASH_RECEIPT', amount: 20 },
    ]);
    expect(cents).toBe(16500);
  });

  it('subtracts cash reversed by a valid void', () => {
    const cents = computeExpectedCashCents([
      { movementType: 'OPEN_FLOAT', amount: 100 },
      { movementType: 'CASH_RECEIPT', amount: 45 },
      { movementType: 'CASH_VOID_REVERSAL', amount: -45 },
    ]);
    expect(cents).toBe(10000);
  });

  it('ignores check movements entirely', () => {
    const cents = computeExpectedCashCents([
      { movementType: 'OPEN_FLOAT', amount: 100 },
      { movementType: 'CHECK_RECEIPT', amount: 500 },
    ]);
    expect(cents).toBe(10000);
  });
});

describe('computeExpectedChecks', () => {
  it('counts and totals check receipts', () => {
    const r = computeExpectedChecks([
      { movementType: 'CHECK_RECEIPT', amount: 120 },
      { movementType: 'CHECK_RECEIPT', amount: 80 },
    ]);
    expect(r.count).toBe(2);
    expect(r.totalCents).toBe(20000);
  });

  it('a voided check reduces count and total back out', () => {
    const r = computeExpectedChecks([
      { movementType: 'CHECK_RECEIPT', amount: 120 },
      { movementType: 'CHECK_VOID_REVERSAL', amount: -120 },
    ]);
    expect(r.count).toBe(0);
    expect(r.totalCents).toBe(0);
  });
});

describe('classifyVariance', () => {
  it('EXACT when cash variance is zero and no check discrepancy', () => {
    const r = classifyVariance({ cashVarianceCents: 0, toleranceCents: 0, checkDiscrepancy: false });
    expect(r.classification).toBe('EXACT');
    expect(r.requiresApproval).toBe(false);
  });

  it('WITHIN_TOLERANCE when the variance is nonzero but under tolerance', () => {
    const r = classifyVariance({ cashVarianceCents: 25, toleranceCents: 50, checkDiscrepancy: false });
    expect(r.classification).toBe('WITHIN_TOLERANCE');
    expect(r.requiresApproval).toBe(false);
  });

  it('a variance exactly at the tolerance boundary counts as within tolerance', () => {
    const r = classifyVariance({ cashVarianceCents: 50, toleranceCents: 50, checkDiscrepancy: false });
    expect(r.classification).toBe('WITHIN_TOLERANCE');
  });

  it('OUTSIDE_TOLERANCE requires approval', () => {
    const r = classifyVariance({ cashVarianceCents: -500, toleranceCents: 50, checkDiscrepancy: false });
    expect(r.classification).toBe('OUTSIDE_TOLERANCE');
    expect(r.requiresApproval).toBe(true);
  });

  it('NON_CASH_EXCEPTION when cash is exact but checks disagree — never folded into cash over/short', () => {
    const r = classifyVariance({ cashVarianceCents: 0, toleranceCents: 50, checkDiscrepancy: true });
    expect(r.classification).toBe('NON_CASH_EXCEPTION');
    expect(r.requiresApproval).toBe(true);
  });

  it('a nonzero cash variance takes priority over a simultaneous check discrepancy', () => {
    const r = classifyVariance({ cashVarianceCents: 1000, toleranceCents: 50, checkDiscrepancy: true });
    expect(r.classification).toBe('OUTSIDE_TOLERANCE');
  });

  it('defaults to a zero tolerance meaning only an exact count avoids OUTSIDE_TOLERANCE', () => {
    const r = classifyVariance({ cashVarianceCents: 1, toleranceCents: 0, checkDiscrepancy: false });
    expect(r.classification).toBe('OUTSIDE_TOLERANCE');
  });
});

describe('computeDepositEligibleCashCents', () => {
  it('subtracts the retained closing float from counted cash', () => {
    expect(computeDepositEligibleCashCents(50000, 10000)).toBe(40000);
  });

  it('can be negative if the retained float exceeds counted cash (surfaced, not clamped)', () => {
    expect(computeDepositEligibleCashCents(5000, 10000)).toBe(-5000);
  });
});
