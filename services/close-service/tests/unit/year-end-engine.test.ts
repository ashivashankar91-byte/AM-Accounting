import { describe, it, expect } from 'vitest';
import { buildYearEndIdempotencyKey, computeRetainedEarningsImpact } from '../../src/domain/year-end-engine';
import { Decimal } from '@prisma/client/runtime/library';

describe('year-end-engine', () => {
  it('builds correct idempotency key', () => {
    const key = buildYearEndIdempotencyKey('tenant1', 'le1', 2025);
    expect(key).toBe('year-end:tenant1:le1:2025');
  });

  it('computes retained earnings impact correctly', () => {
    const items = [
      { accountCode: '4000', description: 'Revenue', balance: new Decimal(100000), closingEntry: new Decimal(-100000) },
      { accountCode: '5000', description: 'Expense', balance: new Decimal(-80000), closingEntry: new Decimal(80000) },
    ];
    const impact = computeRetainedEarningsImpact(items);
    expect(impact.toNumber()).toBe(-20000);
  });

  it('returns zero for empty items', () => {
    const impact = computeRetainedEarningsImpact([]);
    expect(impact.toNumber()).toBe(0);
  });
});
