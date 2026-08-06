import { describe, it, expect } from 'vitest';
import { assertNoOverlap, resolveEffective, resolveEffectiveOne } from '../../src/domain/effective-dating';

describe('effective-dating', () => {
  const rows = [
    { id: 'a', effectiveFrom: '2025-01-01', effectiveTo: '2025-06-30' },
    { id: 'b', effectiveFrom: '2025-07-01', effectiveTo: null },
  ];

  it('resolves the row effective at a given businessDate', () => {
    expect(resolveEffectiveOne(rows, '2025-03-15')?.id).toBe('a');
    expect(resolveEffectiveOne(rows, '2025-08-01')?.id).toBe('b');
    expect(resolveEffectiveOne(rows, '2024-12-31')).toBeNull();
  });

  it('history-proof: a backdated businessDate resolves the historical row, not "today"', () => {
    // Simulates "today" being far in the future — a backdated transaction
    // must still resolve the row effective at ITS businessDate.
    const backdated = resolveEffectiveOne(rows, '2025-02-01');
    expect(backdated?.id).toBe('a');
  });

  it('resolveEffective returns all matches (never silently disambiguates)', () => {
    const overlapping = [
      { id: 'a', effectiveFrom: '2025-01-01', effectiveTo: '2025-12-31' },
      { id: 'b', effectiveFrom: '2025-06-01', effectiveTo: '2025-12-31' },
    ];
    expect(resolveEffective(overlapping, '2025-07-01')).toHaveLength(2);
  });

  it('assertNoOverlap rejects an overlapping new row', () => {
    const conflict = assertNoOverlap(rows as any, { effectiveFrom: '2025-05-01', effectiveTo: '2025-08-01' });
    expect(conflict?.id).toBe('a');
  });

  it('assertNoOverlap allows a non-overlapping new row', () => {
    const bounded = [{ id: 'a', effectiveFrom: '2025-01-01', effectiveTo: '2025-06-30' }];
    const conflict = assertNoOverlap(bounded as any, { effectiveFrom: '2026-01-01', effectiveTo: null });
    expect(conflict).toBeNull();
  });

  it('assertNoOverlap excludes the row being updated (excludeId)', () => {
    const conflict = assertNoOverlap(rows as any, { effectiveFrom: '2025-01-01', effectiveTo: '2025-06-30' }, 'a');
    expect(conflict).toBeNull();
  });

  it('assertNoOverlap treats a null effectiveTo as open-ended', () => {
    const openEnded = [{ id: 'a', effectiveFrom: '2025-01-01', effectiveTo: null }];
    const conflict = assertNoOverlap(openEnded as any, { effectiveFrom: '2026-01-01', effectiveTo: null });
    expect(conflict?.id).toBe('a');
  });
});
