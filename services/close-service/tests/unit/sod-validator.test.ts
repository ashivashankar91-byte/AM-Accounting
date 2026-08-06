import { describe, it, expect } from 'vitest';
import { validateFinalCloseActor, validateReopenActor, SoDViolationError } from '../../src/domain/sod-validator';

describe('sod-validator', () => {
  it('throws when actor is in overriderIds', () => {
    expect(() => validateFinalCloseActor({
      tenantId: 't1', legalEntityId: 'le1', periodYear: 2026, periodMonth: 1,
      actor: 'user1', overriderIds: ['user1'],
    })).toThrow(SoDViolationError);
  });

  it('passes when actor is not in overriderIds', () => {
    expect(() => validateFinalCloseActor({
      tenantId: 't1', legalEntityId: 'le1', periodYear: 2026, periodMonth: 1,
      actor: 'user2', overriderIds: ['user1'],
    })).not.toThrow();
  });

  it('throws when reopen initiator equals approver', () => {
    expect(() => validateReopenActor('user1', 'user1')).toThrow(SoDViolationError);
  });

  it('passes when reopen initiator differs from approver', () => {
    expect(() => validateReopenActor('user1', 'user2')).not.toThrow();
  });
});
