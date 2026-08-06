/**
 * Domain unit tests — S028 FIFO sweep + S029 split conservation.
 * Pure functions in src/domain/open-item.ts, no Prisma/DB involved.
 */
import { describe, it, expect } from 'vitest';
import { Prisma } from '.prisma/schedule-client';
import { sweepFifo, validateSplitParts, FifoCandidate } from '../src/domain/open-item';

function dec(n: number | string) {
  return new Prisma.Decimal(n);
}

function candidate(id: string, remaining: number, txDate: string, createdAt = '2025-01-01'): FifoCandidate {
  return {
    id,
    originalAmount: dec(remaining),
    remainingBalance: dec(remaining),
    transactionDate: new Date(txDate),
    createdAt: new Date(createdAt),
  };
}

describe('sweepFifo (S028 D-CE08-01 auto/on-account application)', () => {
  it('applies oldest-first, fully relieving the oldest item before touching the next', () => {
    const candidates = [
      candidate('newer', 50, '2025-03-01'),
      candidate('oldest', 30, '2025-01-01'),
      candidate('middle', 40, '2025-02-01'),
    ];
    const { allocations, unappliedAmount } = sweepFifo(candidates, dec('60.00'));
    expect(allocations).toHaveLength(2);
    expect(allocations[0].itemId).toBe('oldest');
    expect(allocations[0].applyAmount.toFixed(2)).toBe('30.00');
    expect(allocations[0].newStatus).toBe('CLOSED');
    expect(allocations[1].itemId).toBe('middle');
    expect(allocations[1].applyAmount.toFixed(2)).toBe('30.00');
    expect(allocations[1].newStatus).toBe('PARTIALLY_APPLIED');
    expect(unappliedAmount.toFixed(2)).toBe('0.00');
  });

  it('spans multiple open items in one payment (§7 cross-item application)', () => {
    const candidates = [candidate('a', 20, '2025-01-01'), candidate('b', 20, '2025-01-02'), candidate('c', 20, '2025-01-03')];
    const { allocations, unappliedAmount } = sweepFifo(candidates, dec('45.00'));
    expect(allocations.map((a) => a.itemId)).toEqual(['a', 'b', 'c']);
    expect(allocations[2].applyAmount.toFixed(2)).toBe('5.00');
    expect(unappliedAmount.toFixed(2)).toBe('0.00');
  });

  it('routes any amount left over after every candidate is relieved as unappliedAmount (never fabricates a new item)', () => {
    const candidates = [candidate('a', 10, '2025-01-01')];
    const { allocations, unappliedAmount } = sweepFifo(candidates, dec('30.00'));
    expect(allocations).toHaveLength(1);
    expect(allocations[0].applyAmount.toFixed(2)).toBe('10.00');
    expect(unappliedAmount.toFixed(2)).toBe('20.00');
  });

  it('returns the full amount as unapplied when there are no candidates', () => {
    const { allocations, unappliedAmount } = sweepFifo([], dec('15.00'));
    expect(allocations).toHaveLength(0);
    expect(unappliedAmount.toFixed(2)).toBe('15.00');
  });

  it('never over-applies an individual item even when it is the last one swept', () => {
    const candidates = [candidate('a', 100, '2025-01-01')];
    const { allocations } = sweepFifo(candidates, dec('40.00'));
    expect(allocations[0].newRemaining.toFixed(2)).toBe('60.00');
  });
});

describe('validateSplitParts (S029 split conservation)', () => {
  it('accepts parts that sum exactly to the original remaining balance', () => {
    expect(() => validateSplitParts(dec('100.00'), [dec('40.00'), dec('60.00')])).not.toThrow();
  });

  it('rejects parts that do not sum to the whole (to the cent)', () => {
    expect(() => validateSplitParts(dec('100.00'), [dec('40.00'), dec('59.99')])).toThrow('SPLIT_PARTS_MUST_SUM_TO_WHOLE');
  });

  it('rejects fewer than two parts', () => {
    expect(() => validateSplitParts(dec('100.00'), [dec('100.00')])).toThrow('SPLIT_REQUIRES_AT_LEAST_TWO_PARTS');
  });

  it('rejects a zero or negative part', () => {
    expect(() => validateSplitParts(dec('100.00'), [dec('100.00'), dec('0.00')])).toThrow('SPLIT_PARTS_MUST_BE_POSITIVE');
  });
});
