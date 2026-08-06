import { describe, it, expect } from 'vitest';
import {
  proveMirroredReversal,
  computeCitShortfallCents,
  verifyFeeWithheldConservation,
  determinePayoffVarianceDisposition,
  computePayoffVarianceCents,
  determineWholesaleOutcome,
  verifyWholesaleConservation,
  applyArbitrationPriceAdjustmentCents,
  computeArbitrationUnitReturnNetCents,
} from '../../src/domain/conservation';

describe('S086 — unwind mirrored-reversal proof', () => {
  it('proves a correct mirrored reversal', () => {
    const original = [{ drCents: 100000, crCents: 0 }, { drCents: 0, crCents: 100000 }];
    const reversal = [{ drCents: 0, crCents: 100000 }, { drCents: 100000, crCents: 0 }];
    expect(proveMirroredReversal(original, reversal)).toBe(true);
  });

  it('detects a non-mirrored (broken) reversal', () => {
    const original = [{ drCents: 100000, crCents: 0 }];
    const reversal = [{ drCents: 100000, crCents: 0 }]; // should have been swapped
    expect(proveMirroredReversal(original, reversal)).toBe(false);
  });

  it('detects a line-count mismatch', () => {
    const original = [{ drCents: 100000, crCents: 0 }, { drCents: 0, crCents: 100000 }];
    const reversal = [{ drCents: 0, crCents: 100000 }];
    expect(proveMirroredReversal(original, reversal)).toBe(false);
  });
});

describe('S088 — CIT short-fund conservation', () => {
  it('computes zero shortfall on an exact match', () => {
    expect(computeCitShortfallCents(2500000, 2500000)).toBe(0);
  });

  it('computes the shortfall amount', () => {
    expect(computeCitShortfallCents(2500000, 2450000)).toBe(50000);
  });

  it('never returns a negative shortfall (over-funding is not a shortfall)', () => {
    expect(computeCitShortfallCents(2500000, 2550000)).toBe(0);
  });

  it('FEE_WITHHELD conserves: received + fee === original, exactly', () => {
    const original = 2500000;
    const received = 2450000;
    const fee = 50000;
    expect(verifyFeeWithheldConservation(original, received, fee)).toBe(true);
  });

  it('FEE_WITHHELD flags a non-conserving fee amount', () => {
    expect(verifyFeeWithheldConservation(2500000, 2450000, 40000)).toBe(false);
  });
});

describe('S089 — payoff variance disposition', () => {
  it('actual > recap -> ADDITIONAL_PAYMENT', () => {
    expect(determinePayoffVarianceDisposition(420000, 421500)).toBe('ADDITIONAL_PAYMENT');
    expect(computePayoffVarianceCents(420000, 421500)).toBe(1500);
  });

  it('actual < recap -> REFUND_RECEIVABLE', () => {
    expect(determinePayoffVarianceDisposition(420000, 418000)).toBe('REFUND_RECEIVABLE');
    expect(computePayoffVarianceCents(420000, 418000)).toBe(-2000);
  });

  it('actual === recap -> NONE', () => {
    expect(determinePayoffVarianceDisposition(420000, 420000)).toBe('NONE');
    expect(computePayoffVarianceCents(420000, 420000)).toBe(0);
  });
});

describe('S090 — wholesale disposition + arbitration conservation', () => {
  it('GAIN when wholesale amount exceeds unit relief', () => {
    const r = determineWholesaleOutcome(1200000, 1000000);
    expect(r.outcome).toBe('GAIN');
    expect(r.amountCents).toBe(200000);
    expect(verifyWholesaleConservation(1200000, 1000000, r.outcome, r.amountCents)).toBe(true);
  });

  it('LOSS when wholesale amount is below unit relief', () => {
    const r = determineWholesaleOutcome(900000, 1000000);
    expect(r.outcome).toBe('LOSS');
    expect(r.amountCents).toBe(100000);
    expect(verifyWholesaleConservation(900000, 1000000, r.outcome, r.amountCents)).toBe(true);
  });

  it('NONE when equal', () => {
    const r = determineWholesaleOutcome(1000000, 1000000);
    expect(r.outcome).toBe('NONE');
    expect(verifyWholesaleConservation(1000000, 1000000, r.outcome, r.amountCents)).toBe(true);
  });

  it('flags a broken conservation identity', () => {
    expect(verifyWholesaleConservation(1200000, 1000000, 'GAIN', 999)).toBe(false);
  });

  it('arbitration price adjustment applies signed delta to the AR', () => {
    expect(applyArbitrationPriceAdjustmentCents(1200000, -50000)).toBe(1150000);
    expect(applyArbitrationPriceAdjustmentCents(1200000, 30000)).toBe(1230000);
  });

  it('arbitration unit return nets to -original + conditionCost', () => {
    expect(computeArbitrationUnitReturnNetCents(1200000, 45000)).toBe(-1155000);
  });
});
