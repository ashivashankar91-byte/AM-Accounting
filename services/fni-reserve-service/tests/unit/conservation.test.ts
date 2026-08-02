// The MOST important tests in this service: pure conservation-math proofs
// for S091 (chargeback accrual + draw), S093 (cancellation three-leg split),
// and S094 (straight-line recognition). No DB, no network — every case here
// is a deterministic, numerically provable identity.
import { describe, it, expect } from 'vitest';
import { allocateCents, divideEqually, toCents, centsToDollars } from '../../src/domain/money';
import {
  computeChargebackAccrual,
  computeChargebackDraw,
  percentToBp,
  ChargebackReserveDomainError,
} from '../../src/domain/chargeback-reserve';
import {
  computeCancellationLegsFromPercent,
  computeCancellationLegsFromQuoteAmount,
  resolveProRataPercent,
  CancellationDomainError,
} from '../../src/domain/cancellation';
import {
  buildStraightLineSchedule,
  computeRecognition,
  wholeMonthsElapsed,
  DeferralDomainError,
} from '../../src/domain/deferral';

describe('money.ts — allocation primitives', () => {
  it('allocateCents always sums exactly to totalCents, for many weight splits', () => {
    const cases: Array<[number, number[]]> = [
      [100_000, [3333, 3333, 3334]],
      [1, [5000, 5000]],
      [999, [1500, 8500]],
      [123_457, [1, 9999]],
      [0, [5000, 5000]],
    ];
    for (const [total, weights] of cases) {
      const out = allocateCents(total, weights);
      expect(out.reduce((a, b) => a + b, 0)).toBe(total);
      expect(out.length).toBe(weights.length);
    }
  });

  it('divideEqually always sums exactly to totalCents and shares differ by at most 1 cent', () => {
    for (const [total, parts] of [[1000, 3], [1, 7], [123457, 12], [0, 4]] as Array<[number, number]>) {
      const out = divideEqually(total, parts);
      expect(out.reduce((a, b) => a + b, 0)).toBe(total);
      const max = Math.max(...out);
      const min = Math.min(...out);
      expect(max - min).toBeLessThanOrEqual(1);
    }
  });

  it('toCents/centsToDollars round-trip', () => {
    expect(toCents('1234.56')).toBe(123456);
    expect(centsToDollars(123456)).toBe(1234.56);
    expect(toCents(0)).toBe(0);
  });
});

describe('S091(b) — flat-% chargeback reserve accrual', () => {
  it('computes accrual + retained conserving the full reserve income, for a clean percent', () => {
    const result = computeChargebackAccrual('1000.00', '15.00');
    expect(result.accrualBp).toBe(1500);
    expect(result.accrualCents + result.retainedCents).toBe(result.reserveIncomeCents);
    expect(result.accrualCents).toBe(15000); // 15% of $1000.00 = $150.00
  });

  it('conserves exactly under rounding-prone amounts (odd cents, fractional percent)', () => {
    const cases: Array<[string, string]> = [
      ['1234.57', '12.50'],
      ['0.01', '50.00'],
      ['999.99', '33.33'],
      ['10000.00', '0.00'],
      ['10000.00', '100.00'],
      ['7.77', '7.77'],
    ];
    for (const [income, pct] of cases) {
      const result = computeChargebackAccrual(income, pct);
      expect(result.accrualCents + result.retainedCents).toBe(toCents(income));
      expect(result.accrualCents).toBeGreaterThanOrEqual(0);
      expect(result.retainedCents).toBeGreaterThanOrEqual(0);
    }
  });

  it('rejects an out-of-range percent (never silently clamps)', () => {
    expect(() => computeChargebackAccrual('100.00', '150.00')).toThrow(ChargebackReserveDomainError);
    expect(() => computeChargebackAccrual('100.00', '-5.00')).toThrow(ChargebackReserveDomainError);
  });

  it('percentToBp is exact for boundary values', () => {
    expect(percentToBp('0')).toBe(0);
    expect(percentToBp('100')).toBe(10000);
    expect(percentToBp(15)).toBe(1500);
  });
});

describe('S091(c)/S093 shared — chargeback draw conservation', () => {
  it('draw + excess === chargebackAmount, exactly, when chargeback is LESS than remaining reserve', () => {
    const result = computeChargebackDraw('500.00', '2000.00');
    expect(result.drawFromReserveCents).toBe(50000);
    expect(result.excessToExpenseCents).toBe(0);
    expect(result.drawFromReserveCents + result.excessToExpenseCents).toBe(result.chargebackAmountCents);
  });

  it('draw + excess === chargebackAmount, exactly, when chargeback EXACTLY EQUALS the remaining reserve (boundary)', () => {
    const result = computeChargebackDraw('1500.00', '1500.00');
    expect(result.drawFromReserveCents).toBe(150000);
    expect(result.excessToExpenseCents).toBe(0);
    expect(result.drawFromReserveCents + result.excessToExpenseCents).toBe(result.chargebackAmountCents);
  });

  it('draw + excess === chargebackAmount, exactly, when chargeback EXCEEDS the remaining reserve', () => {
    const result = computeChargebackDraw('2200.00', '1500.00');
    expect(result.drawFromReserveCents).toBe(150000); // fully drains the reserve
    expect(result.excessToExpenseCents).toBe(70000); // excess of $700.00 to expense
    expect(result.drawFromReserveCents + result.excessToExpenseCents).toBe(result.chargebackAmountCents);
  });

  it('draw + excess === chargebackAmount when reserve balance is ZERO (fully-drawn already)', () => {
    const result = computeChargebackDraw('300.00', '0.00');
    expect(result.drawFromReserveCents).toBe(0);
    expect(result.excessToExpenseCents).toBe(30000);
    expect(result.drawFromReserveCents + result.excessToExpenseCents).toBe(result.chargebackAmountCents);
  });

  it('conserves for a large randomized sweep of (chargeback, balance) pairs', () => {
    let seed = 42;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    for (let i = 0; i < 200; i++) {
      const chargeback = (Math.floor(rand() * 10_000_00) + 1) / 100;
      const balance = Math.floor(rand() * 10_000_00) / 100;
      const result = computeChargebackDraw(chargeback.toFixed(2), balance.toFixed(2));
      expect(result.drawFromReserveCents + result.excessToExpenseCents).toBe(result.chargebackAmountCents);
      expect(result.drawFromReserveCents).toBeLessThanOrEqual(result.reserveBalanceBeforeCents);
      expect(result.drawFromReserveCents).toBeLessThanOrEqual(result.chargebackAmountCents);
    }
  });

  it('rejects a non-positive chargeback amount', () => {
    expect(() => computeChargebackDraw('0.00', '100.00')).toThrow(ChargebackReserveDomainError);
    expect(() => computeChargebackDraw('-5.00', '100.00')).toThrow(ChargebackReserveDomainError);
  });
});

describe('S093 — cancellation three-leg conservation', () => {
  it('income-reversal + remit-adjustment === refund-payable === quote total, at 100% refund (zero elapsed time)', () => {
    const legs = computeCancellationLegsFromPercent('600.00', '400.00', 100);
    expect(legs.quoteTotalCents).toBe(100000); // full $1000 original
    expect(legs.incomeReversalCents + legs.remitAdjustmentCents).toBe(legs.refundPayableCents);
    expect(legs.refundPayableCents).toBe(legs.quoteTotalCents);
    expect(legs.incomeReversalCents).toBe(60000);
    expect(legs.remitAdjustmentCents).toBe(40000);
  });

  it('income-reversal + remit-adjustment === refund-payable === quote total, at a mid-term pro-rata percent', () => {
    const legs = computeCancellationLegsFromPercent('733.33', '266.67', 37.5);
    expect(legs.incomeReversalCents + legs.remitAdjustmentCents).toBe(legs.refundPayableCents);
    expect(legs.refundPayableCents).toBe(legs.quoteTotalCents);
  });

  it('income-reversal + remit-adjustment === refund-payable === quote total, at 0% refund (fully earned out)', () => {
    const legs = computeCancellationLegsFromPercent('500.00', '500.00', 0);
    expect(legs.quoteTotalCents).toBe(0);
    expect(legs.incomeReversalCents).toBe(0);
    expect(legs.remitAdjustmentCents).toBe(0);
    expect(legs.refundPayableCents).toBe(0);
  });

  it('conserves for an ENTERED quote dollar amount (not a percent), proportioned by the original income:remit ratio', () => {
    const legs = computeCancellationLegsFromQuoteAmount('700.00', '300.00', '250.00');
    expect(legs.incomeReversalCents + legs.remitAdjustmentCents).toBe(legs.refundPayableCents);
    expect(legs.refundPayableCents).toBe(25000);
    // proportional split: 70% income share, 30% remit share of the $250 quote
    expect(legs.incomeReversalCents).toBe(17500);
    expect(legs.remitAdjustmentCents).toBe(7500);
  });

  it('rejects an entered quote that exceeds the original total (never silently clamps)', () => {
    expect(() => computeCancellationLegsFromQuoteAmount('100.00', '50.00', '999.00')).toThrow(CancellationDomainError);
  });

  it('conserves across a sweep of odd-cent original splits and fractional refund percents', () => {
    const cases: Array<[string, string, number]> = [
      ['333.33', '111.11', 66.67],
      ['1.01', '0.02', 50],
      ['999.99', '0.01', 12.34],
      ['50.00', '50.00', 99.99],
    ];
    for (const [income, remit, pct] of cases) {
      const legs = computeCancellationLegsFromPercent(income, remit, pct);
      expect(legs.incomeReversalCents + legs.remitAdjustmentCents).toBe(legs.refundPayableCents);
    }
  });

  it('resolveProRataPercent picks the highest applicable breakpoint (no interpolation)', () => {
    const table = [
      { monthsElapsed: 0, refundPercent: '100.00' },
      { monthsElapsed: 6, refundPercent: '50.00' },
      { monthsElapsed: 12, refundPercent: '25.00' },
    ];
    expect(resolveProRataPercent(table, 0)).toBe(100);
    expect(resolveProRataPercent(table, 5)).toBe(100);
    expect(resolveProRataPercent(table, 6)).toBe(50);
    expect(resolveProRataPercent(table, 11)).toBe(50);
    expect(resolveProRataPercent(table, 12)).toBe(25);
    expect(resolveProRataPercent(table, 999)).toBe(25);
  });

  it('resolveProRataPercent refuses (never guesses) when no breakpoint applies', () => {
    const table = [{ monthsElapsed: 6, refundPercent: '50.00' }];
    expect(() => resolveProRataPercent(table, 0)).toThrow(CancellationDomainError);
    expect(() => resolveProRataPercent([], 0)).toThrow(CancellationDomainError);
  });
});

describe('S093 chargeback-linkage — shared draw function identity', () => {
  it('cancellation-triggered chargeback draw uses byte-identical math to the S091(c) actual-chargeback path', async () => {
    // Both paths import from the same module — this test proves the
    // application layer cannot accidentally diverge them by re-checking the
    // conservation identity through the re-exported alias.
    const { computeCancellationChargebackDraw } = await import('../../src/domain/cancellation');
    const a = computeChargebackDraw('800.00', '500.00');
    const b = computeCancellationChargebackDraw('800.00', '500.00');
    expect(b).toEqual(a);
  });
});

describe('S094 — straight-line deferral recognition conservation', () => {
  it('buildStraightLineSchedule sums exactly to the original amount', () => {
    for (const [amount, months] of [[120000, 12], [100, 3], [1, 7], [999999, 11]] as Array<[number, number]>) {
      const schedule = buildStraightLineSchedule(amount, months);
      expect(schedule.length).toBe(months);
      expect(schedule.reduce((a, b) => a + b, 0)).toBe(amount);
    }
  });

  it('rejects a non-positive months config (never silently no-ops)', () => {
    expect(() => buildStraightLineSchedule(1200, 0)).toThrow(DeferralDomainError);
    expect(() => buildStraightLineSchedule(1200, -3)).toThrow(DeferralDomainError);
  });

  it('wholeMonthsElapsed: zero elapsed time at booking, capped at the pattern length', () => {
    const booked = new Date('2026-03-15T00:00:00Z');
    expect(wholeMonthsElapsed(booked, new Date('2026-03-15T00:00:00Z'), 12)).toBe(0);
    expect(wholeMonthsElapsed(booked, new Date('2026-04-14T00:00:00Z'), 12)).toBe(0);
    expect(wholeMonthsElapsed(booked, new Date('2026-04-15T00:00:00Z'), 12)).toBe(1);
    expect(wholeMonthsElapsed(booked, new Date('2030-01-01T00:00:00Z'), 12)).toBe(12); // capped
  });

  it('computeRecognition: zero elapsed time recognizes exactly $0 (mid-term-vs-zero-elapsed edge case)', () => {
    const booked = new Date('2026-01-01T00:00:00Z');
    const result = computeRecognition(120000, 12, booked, booked, 0);
    expect(result.elapsedPeriods).toBe(0);
    expect(result.earnedThisRunCents).toBe(0);
    expect(result.cumulativeEarnedCents).toBe(0);
  });

  it('computeRecognition: mid-term run recognizes exactly the elapsed periods, no more', () => {
    const booked = new Date('2026-01-01T00:00:00Z');
    const asOf = new Date('2026-07-01T00:00:00Z'); // 6 whole months elapsed
    const result = computeRecognition(120000, 12, booked, asOf, 0);
    expect(result.elapsedPeriods).toBe(6);
    expect(result.cumulativeEarnedCents).toBe(60000); // exactly half of $1200.00
    expect(result.earnedThisRunCents).toBe(60000);
  });

  it('computeRecognition: a second run only recognizes the NEWLY elapsed periods (idempotent, no double-recognition)', () => {
    const booked = new Date('2026-01-01T00:00:00Z');
    const firstRun = computeRecognition(120000, 12, booked, new Date('2026-07-01T00:00:00Z'), 0);
    const secondRun = computeRecognition(120000, 12, booked, new Date('2026-10-01T00:00:00Z'), firstRun.cumulativeEarnedCents);
    expect(secondRun.elapsedPeriods).toBe(9);
    expect(secondRun.earnedThisRunCents).toBe(secondRun.cumulativeEarnedCents - firstRun.cumulativeEarnedCents);
    expect(firstRun.cumulativeEarnedCents + secondRun.earnedThisRunCents).toBe(secondRun.cumulativeEarnedCents);
  });

  it('computeRecognition: re-running with an unchanged asOfDate recognizes exactly $0 the second time (pure idempotency)', () => {
    const booked = new Date('2026-01-01T00:00:00Z');
    const asOf = new Date('2026-07-01T00:00:00Z');
    const firstRun = computeRecognition(120000, 12, booked, asOf, 0);
    const replay = computeRecognition(120000, 12, booked, asOf, firstRun.cumulativeEarnedCents);
    expect(replay.earnedThisRunCents).toBe(0);
  });

  it('computeRecognition: full-term recognition sums exactly to the original amount, to the cent, across an odd-cent amount', () => {
    const booked = new Date('2026-01-01T00:00:00Z');
    const asOf = new Date('2027-01-15T00:00:00Z'); // >12 months later, capped
    const result = computeRecognition(100001, 12, booked, asOf, 0); // $1000.01 over 12 months
    expect(result.elapsedPeriods).toBe(12);
    expect(result.cumulativeEarnedCents).toBe(100001);
  });
});
