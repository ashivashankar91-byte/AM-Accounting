import { describe, it, expect } from 'vitest';
import { computeHoldUntil, isEligibleForDeletion, findApplicablePolicy } from '../../src/domain/retention-engine';

describe('retention-engine', () => {
  it('computes holdUntil correctly', () => {
    const created = new Date('2025-01-01');
    const holdUntil = computeHoldUntil(created, 365);
    expect(holdUntil.getFullYear()).toBe(2026);
    expect(holdUntil.getMonth()).toBe(0);
  });

  it('isEligibleForDeletion returns true when past hold date', () => {
    const past = new Date('2020-01-01');
    expect(isEligibleForDeletion(past, new Date('2025-01-01'))).toBe(true);
  });

  it('isEligibleForDeletion returns false when before hold date', () => {
    const future = new Date('2030-01-01');
    expect(isEligibleForDeletion(future, new Date('2025-01-01'))).toBe(false);
  });

  it('findApplicablePolicy returns matching policy', () => {
    const policies = [{ recordClass: 'JOURNAL', retentionDays: 2555 }];
    const policy = findApplicablePolicy('JOURNAL', policies);
    expect(policy?.retentionDays).toBe(2555);
  });

  it('findApplicablePolicy returns undefined for unknown class', () => {
    expect(findApplicablePolicy('UNKNOWN', [])).toBeUndefined();
  });
});
