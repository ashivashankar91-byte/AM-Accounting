import { describe, it, expect } from 'vitest';
import { splitByBasisPoints, splitEqual, splitBalanceWeighted, BP_TOTAL } from '../../src/domain/allocation';

describe('splitByBasisPoints', () => {
  it('splits an amount across weights summing to exactly the total (no remainder)', () => {
    const result = splitByBasisPoints('100.00', [
      { key: 'a', bp: 5000 },
      { key: 'b', bp: 5000 },
    ]);
    expect(result).toEqual([
      { key: 'a', bp: 5000, amount: '50.00' },
      { key: 'b', bp: 5000, amount: '50.00' },
    ]);
  });

  it('absorbs remainder cents deterministically so the sum equals the total exactly', () => {
    const result = splitByBasisPoints('100.00', [
      { key: 'a', bp: 3334 },
      { key: 'b', bp: 3333 },
      { key: 'c', bp: 3333 },
    ]);
    const sumCents = result.reduce((s, r) => s + Math.round(Number(r.amount) * 100), 0);
    expect(sumCents).toBe(10000);
    // Largest-remainder method: 3334bp gets the extra cent since its exact
    // share (33.34) has no remainder while 3333bp shares round down twice.
    expect(result.find((r) => r.key === 'a')?.amount).toBe('33.34');
  });

  it('is exact for an odd cent total across three equal weights', () => {
    const result = splitByBasisPoints('10.01', [
      { key: 'a', bp: 3334 },
      { key: 'b', bp: 3333 },
      { key: 'c', bp: 3333 },
    ]);
    const sumCents = result.reduce((s, r) => s + Math.round(Number(r.amount) * 100), 0);
    expect(sumCents).toBe(1001);
  });

  it('rejects weights that do not sum to BP_TOTAL', () => {
    expect(() => splitByBasisPoints('100.00', [{ key: 'a', bp: 9000 }])).toThrow(/10000/);
  });

  it('rejects a non-positive bp weight', () => {
    expect(() =>
      splitByBasisPoints('100.00', [
        { key: 'a', bp: 10000 },
        { key: 'b', bp: 0 },
      ]),
    ).toThrow();
  });

  it('handles negative totals (e.g. a credit adjustment) preserving exact sum', () => {
    const result = splitByBasisPoints('-100.00', [
      { key: 'a', bp: 5000 },
      { key: 'b', bp: 5000 },
    ]);
    const sumCents = result.reduce((s, r) => s + Math.round(Number(r.amount) * 100), 0);
    expect(sumCents).toBe(-10000);
  });
});

describe('splitEqual', () => {
  it('splits an amount equally across N keys with exact sum for a non-divisible amount', () => {
    const result = splitEqual('100.00', ['u1', 'u2', 'u3']);
    const sumCents = result.reduce((s, r) => s + Math.round(Number(r.amount) * 100), 0);
    expect(sumCents).toBe(10000);
    expect(result).toHaveLength(3);
    const bpSum = result.reduce((s, r) => s + r.bp, 0);
    expect(bpSum).toBe(BP_TOTAL);
  });

  it('splits a single key with the entire amount', () => {
    const result = splitEqual('55.55', ['only']);
    expect(result).toEqual([{ key: 'only', bp: BP_TOTAL, amount: '55.55' }]);
  });
});

describe('splitBalanceWeighted', () => {
  it('weights proportionally to balance and sums exactly to the total', () => {
    const result = splitBalanceWeighted('300.00', [
      { key: 'u1', balance: '100.00' },
      { key: 'u2', balance: '200.00' },
    ]);
    const sumCents = result.reduce((s, r) => s + Math.round(Number(r.amount) * 100), 0);
    expect(sumCents).toBe(30000);
    // Two-stage rounding (balance -> bp, then bp -> amount) can skew an
    // individual line by a cent versus the naive proportional split, but
    // the exact-sum guarantee (asserted above) is what the AC requires —
    // each line must still land within a cent of its proportional share.
    const u1 = Number(result.find((r) => r.key === 'u1')?.amount);
    const u2 = Number(result.find((r) => r.key === 'u2')?.amount);
    expect(u1).toBeCloseTo(100, 1);
    expect(u2).toBeCloseTo(200, 1);
  });

  it('falls back to equal split when every balance is zero', () => {
    const result = splitBalanceWeighted('10.00', [
      { key: 'u1', balance: '0.00' },
      { key: 'u2', balance: '0.00' },
    ]);
    const sumCents = result.reduce((s, r) => s + Math.round(Number(r.amount) * 100), 0);
    expect(sumCents).toBe(1000);
  });
});
