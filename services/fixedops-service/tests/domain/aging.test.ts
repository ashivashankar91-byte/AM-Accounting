import { describe, it, expect } from 'vitest';
import { ageInDays, bandFor } from '../../src/domain/aging';

describe('aging', () => {
  it('computes whole-day age', () => {
    const since = new Date('2026-07-01T00:00:00Z');
    const asOf = new Date('2026-08-01T00:00:00Z');
    expect(ageInDays(since, asOf)).toBe(31);
  });

  it('never returns a negative age', () => {
    expect(ageInDays(new Date('2026-08-02T00:00:00Z'), new Date('2026-08-01T00:00:00Z'))).toBe(0);
  });

  it.each([
    [0, '0-30'], [30, '0-30'], [31, '31-60'], [60, '31-60'], [61, '61-90'], [90, '61-90'], [91, '91+'], [400, '91+'],
  ])('bands day %i as %s', (days, expected) => {
    expect(bandFor(days)).toBe(expected);
  });
});
