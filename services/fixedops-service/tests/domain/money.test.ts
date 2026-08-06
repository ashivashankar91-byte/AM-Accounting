import { describe, it, expect } from 'vitest';
import { toCents, centsToDollars, assertConserves, ConservationViolationError } from '../../src/domain/money';

describe('money helpers', () => {
  it('toCents/centsToDollars round-trip exactly', () => {
    expect(toCents('123.45')).toBe(12345);
    expect(centsToDollars(12345)).toBe(123.45);
  });

  it('assertConserves passes when parts sum exactly', () => {
    expect(() => assertConserves('100.00', ['33.33', '33.33', '33.34'], 'ctx')).not.toThrow();
  });

  it('assertConserves throws on a sub-cent-visible mismatch', () => {
    expect(() => assertConserves('100.00', ['33.33', '33.33', '33.33'], 'ctx')).toThrow(ConservationViolationError);
  });
});
