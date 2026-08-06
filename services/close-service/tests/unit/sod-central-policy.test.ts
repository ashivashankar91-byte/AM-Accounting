import { describe, it, expect } from 'vitest';
import { createDefaultSoDPolicy } from '../../src/domain/sod-validator';

describe('createDefaultSoDPolicy', () => {
  it('returns ACTIVE policy', () => {
    const p = createDefaultSoDPolicy('tenant-1', 'le-1');
    expect(p.status).toBe('ACTIVE');
  });

  it('has requesterApproverBarrier = true', () => {
    const p = createDefaultSoDPolicy('tenant-1', 'le-1');
    expect(p.requesterApproverBarrier).toBe(true);
  });

  it('automationIdentityRestrictions is empty (deny-all automation)', () => {
    const p = createDefaultSoDPolicy('tenant-1', 'le-1');
    expect(p.automationIdentityRestrictions).toEqual([]);
  });
});
