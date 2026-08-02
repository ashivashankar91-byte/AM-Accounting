import { describe, it, expect } from 'vitest';
import { toCents, centsToDollars, addCents } from '../../src/lib/money';

describe('money helpers (deterministic cents math)', () => {
  it('converts dollars to cents without float drift', () => {
    expect(toCents(19.99)).toBe(1999);
    expect(toCents('19.99')).toBe(1999);
    expect(toCents(0.1 + 0.2)).toBe(30); // classic float trap — must round correctly
  });
  it('converts cents back to dollars', () => {
    expect(centsToDollars(1999)).toBe(19.99);
    expect(centsToDollars(0)).toBe(0);
  });
  it('sums mixed inputs in cents', () => {
    expect(addCents(10, '5.50', null, undefined)).toBe(1550);
  });
});
