import { describe, it, expect } from 'vitest';
import { toCents, centsToDollars, centsToDollarString, requireNonNegativeCents, requirePositiveCents, InvalidAmountError } from '../../src/domain/money';

describe('money', () => {
  it('toCents parses dollar strings/numbers to integer cents', () => {
    expect(toCents('123.45')).toBe(12345);
    expect(toCents(123.45)).toBe(12345);
    expect(toCents('0.00')).toBe(0);
    expect(toCents(null)).toBe(0);
    expect(toCents(undefined)).toBe(0);
    expect(toCents('')).toBe(0);
  });

  it('toCents rounds sub-cent floating error away', () => {
    expect(toCents('19.99')).toBe(1999);
    expect(toCents(0.1 + 0.2)).toBe(30); // 0.30000000000000004 -> 30 cents, not 29
  });

  it('centsToDollars / centsToDollarString round-trip', () => {
    expect(centsToDollars(12345)).toBe(123.45);
    expect(centsToDollarString(12345)).toBe('123.45');
    expect(centsToDollarString(0)).toBe('0.00');
  });

  it('requireNonNegativeCents accepts zero and positive, rejects negative/NaN', () => {
    expect(requireNonNegativeCents('x', '0')).toBe(0);
    expect(requireNonNegativeCents('x', '10.00')).toBe(1000);
    expect(() => requireNonNegativeCents('x', '-1.00')).toThrow(InvalidAmountError);
    expect(() => requireNonNegativeCents('x', 'not-a-number')).toThrow(InvalidAmountError);
  });

  it('requirePositiveCents rejects zero', () => {
    expect(requirePositiveCents('x', '0.01')).toBe(1);
    expect(() => requirePositiveCents('x', '0.00')).toThrow(InvalidAmountError);
    expect(() => requirePositiveCents('x', '-5.00')).toThrow(InvalidAmountError);
  });
});
